//! 区域遭遇战生成：`src/combatsimulator/zone.js`（127 行）的逐方法移植。
//!
//! 切片 5 用途：生产模拟路径里敌人不再是预置场景，而是每个遭遇战开始时由
//! `getRandomEncounter()` / `getNextWave()` 现场生成。**随机数消费顺序与次数**必须与 JS
//! 完全一致（每次迭代恰好一次 `Math.random()`），否则整个战斗轨迹的 RNG 流错位。
//!
//! 刻意保留的 JS 语义：
//! - `bossSpawns` 用真值判断（`null` / 缺失为假；空数组在 JS 里是 truthy，这里也照做）；
//! - boss 分支要求 `encountersKilled === battlesPerBoss` 严格相等，命中后把计数器**重置为 1**；
//! - `buildEncounterFromSpawnInfo`：`totalStrength += spawn.strength` 在容量判断之前累加，
//!   超容量 `break outer`；`maxSpawnCount` / `maxTotalStrength` 缺失时 JS 行为分别是
//!   「循环不执行」与「首次匹配即越界退出」（Rust 侧用 NaN 比较复刻）；
//! - `getNextWave`：先判 `encountersKilled > maxWaves`（完成一次副本）；
//!   `fixedSpawnsMap` 命中时**先自增再返回**，随机分支**先选取再自增**；
//!   `waveKeys` 是 `Object.keys(...).map(Number).sort((a,b)=>a-b)`；
//!   两种「找不到波次」的情形（空表 / 落在空隙）JS 都会在 `.reduce` 处抛 TypeError；
//! - 层级换算：`new Monster(hrid, entry.difficultyTier + this.difficultyTier)`。

use crate::rng::Mulberry32;
use crate::unit::UnitError;
use serde_json::{Map, Value};

pub struct Zone {
    pub hrid: String,
    difficulty_tier: f64,
    monster_spawn_info: Value,
    dungeon_spawn_info: Value,
    is_dungeon: bool,
    encounters_killed: f64,
    dungeons_completed: f64,
    dungeons_failed: f64,
}

impl Zone {
    /// 等价 JS `new Zone(hrid, difficultyTier)`。`monster_spawn_info` / `dungeon_spawn_info`
    /// 直接传 `combatZoneInfo.fightInfo` / `combatZoneInfo.dungeonInfo`（可为 `Value::Null`）。
    pub fn new(
        hrid: String,
        difficulty_tier: f64,
        monster_spawn_info: Value,
        dungeon_spawn_info: Value,
        is_dungeon: bool,
    ) -> Self {
        Self {
            hrid,
            difficulty_tier,
            monster_spawn_info,
            dungeon_spawn_info,
            is_dungeon,
            encounters_killed: 1.0,
            dungeons_completed: 0.0,
            dungeons_failed: 0.0,
        }
    }

    /// 等价 JS `getRandomEncounter()`：返回 `(combatMonsterHrid, entry.difficultyTier + zoneTier)`。
    pub fn get_random_encounter(&mut self, rng: &mut Mulberry32) -> Result<Vec<(String, f64)>, UnitError> {
        let boss_spawns = self
            .monster_spawn_info
            .get("bossSpawns")
            .ok_or_else(|| read_property_error(&self.monster_spawn_info, "bossSpawns"))?;

        if js_truthy(boss_spawns) {
            let battles_per_boss = self
                .monster_spawn_info
                .get("battlesPerBoss")
                .map(js_number)
                .unwrap_or(f64::NAN);
            if self.encounters_killed == battles_per_boss {
                self.encounters_killed = 1.0;
                return map_monster_entries(boss_spawns, self.difficulty_tier, "bossSpawns");
            }
        }

        self.encounters_killed += 1.0;
        let random_spawn_info = self
            .monster_spawn_info
            .get("randomSpawnInfo")
            .ok_or_else(|| read_property_error(&self.monster_spawn_info, "randomSpawnInfo"))?;
        self.build_encounter_from_spawn_info(random_spawn_info, rng)
    }

    /// 等价 JS `getNextWave()`（副本专用）。
    pub fn get_next_wave(&mut self, rng: &mut Mulberry32) -> Result<Vec<(String, f64)>, UnitError> {
        let max_waves = self
            .dungeon_spawn_info
            .get("maxWaves")
            .map(js_number)
            .unwrap_or(f64::NAN);
        if self.encounters_killed > max_waves {
            self.dungeons_completed += 1.0;
            self.encounters_killed = 1.0;
        }

        let fixed_spawns_map = self
            .dungeon_spawn_info
            .get("fixedSpawnsMap")
            .ok_or_else(|| read_property_error(&self.dungeon_spawn_info, "fixedSpawnsMap"))?;
        let fixed_key = js_number_key(self.encounters_killed);
        if let Some(monsters) = fixed_spawns_map.as_object().and_then(|map| map.get(&fixed_key)) {
            self.encounters_killed += 1.0;
            return map_monster_entries(monsters, self.difficulty_tier, "fixedSpawnsMap");
        }

        let random_spawn_info_map = self
            .dungeon_spawn_info
            .get("randomSpawnInfoMap")
            .ok_or_else(|| read_property_error(&self.dungeon_spawn_info, "randomSpawnInfoMap"))?;
        let random_map: &Map<String, Value> = random_spawn_info_map.as_object().ok_or_else(|| {
            UnitError::type_error(format!(
                "Cannot convert {} to object",
                js_type_name(random_spawn_info_map)
            ))
        })?;

        let mut wave_keys: Vec<f64> = random_map.keys().map(|key| js_number(&Value::String(key.clone()))).collect();
        wave_keys.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let monster_spawns: Option<&Value> = if wave_keys.is_empty() {
            None
        } else {
            let last_key = *wave_keys.last().expect("非空");
            if self.encounters_killed > last_key {
                random_map.get(&js_number_key(last_key))
            } else {
                let mut found = None;
                for index in 0..wave_keys.len().saturating_sub(1) {
                    if self.encounters_killed >= wave_keys[index] && self.encounters_killed <= wave_keys[index + 1] {
                        found = random_map.get(&js_number_key(wave_keys[index]));
                        break;
                    }
                }
                found
            }
        };

        // JS 侧 `let monsterSpawns = {}` 的兜底会让 `monsterSpawns.spawns` 变成 undefined，
        // 随后 `.reduce` 抛 TypeError（消息为 reading 'reduce'）。
        let monster_spawns = monster_spawns.ok_or_else(|| UnitError::type_error("Cannot read properties of undefined (reading 'reduce')"))?;

        let encounter = self.build_encounter_from_spawn_info(monster_spawns, rng)?;
        self.encounters_killed += 1.0;
        Ok(encounter)
    }

    /// 等价 JS `buildEncounterFromSpawnInfo(randomSpawnInfo)`。
    pub fn build_encounter_from_spawn_info(
        &self,
        spawn_info: &Value,
        rng: &mut Mulberry32,
    ) -> Result<Vec<(String, f64)>, UnitError> {
        let spawns = spawn_info
            .get("spawns")
            .and_then(|value| value.as_array())
            .ok_or_else(|| UnitError::type_error("Cannot read properties of undefined (reading 'spawns')"))?;
        let total_weight: f64 = spawns
            .iter()
            .map(|spawn| js_number(spawn.get("rate").unwrap_or(&Value::Null)))
            .sum();
        let max_spawn_count = spawn_info.get("maxSpawnCount").map(js_number).unwrap_or(f64::NAN);
        let max_total_strength = spawn_info.get("maxTotalStrength").map(js_number).unwrap_or(f64::NAN);

        let mut entries: Vec<(String, f64)> = Vec::new();
        let mut total_strength = 0.0;
        let mut index = 0.0;
        'outer: while index < max_spawn_count {
            index += 1.0;
            let random_weight = total_weight * rng.next_f64();
            let mut cumulative_weight = 0.0;

            for spawn in spawns {
                cumulative_weight += js_number(spawn.get("rate").unwrap_or(&Value::Null));
                if random_weight <= cumulative_weight {
                    total_strength += js_number(spawn.get("strength").unwrap_or(&Value::Null));
                    if total_strength <= max_total_strength {
                        entries.push(monster_entry(spawn));
                    } else {
                        break 'outer;
                    }
                    break;
                }
            }
        }

        Ok(entries
            .into_iter()
            .map(|(hrid, tier)| (hrid, tier + self.difficulty_tier))
            .collect())
    }

    /// 等价 JS `failWave()`。
    pub fn fail_wave(&mut self) {
        self.dungeons_failed += 1.0;
        self.encounters_killed = 1.0;
    }

    pub fn encounters_killed(&self) -> f64 {
        self.encounters_killed
    }

    pub fn dungeons_completed(&self) -> f64 {
        self.dungeons_completed
    }

    pub fn dungeons_failed(&self) -> f64 {
        self.dungeons_failed
    }

    pub fn is_dungeon(&self) -> bool {
        self.is_dungeon
    }

    pub fn difficulty_tier(&self) -> f64 {
        self.difficulty_tier
    }

    pub fn monster_spawn_info(&self) -> &Value {
        &self.monster_spawn_info
    }

    pub fn dungeon_spawn_info(&self) -> &Value {
        &self.dungeon_spawn_info
    }
}

// ---------------------------------------------------------------------------
// JS 强制转换/真值语义（局部实现，避免与其它模块耦合）
// ---------------------------------------------------------------------------

/// 等价 JS `Number(value)`（仅覆盖生产数据可能出现的形状）。
pub(crate) fn js_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(flag) => {
            if *flag {
                1.0
            } else {
                0.0
            }
        }
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return 0.0;
            }
            trimmed.parse::<f64>().unwrap_or(f64::NAN)
        }
        Value::Array(items) => {
            if items.is_empty() {
                0.0
            } else {
                f64::NAN
            }
        }
        Value::Object(_) => f64::NAN,
    }
}

/// 等价 JS `Number.prototype.toString()`（本模块只用于整数计数器与波次键）。
pub(crate) fn js_number_key(value: f64) -> String {
    // Rust 的 f64 Display 对整数值输出不带小数点（5.0 → "5"），与 JS 一致；
    // 非整数（本模块不会出现）输出最短往返表示，同样与 JS 常见值一致。
    format!("{value}")
}

/// 等价 JS 真值判断（`!!value`）。
fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().map(|inner| inner != 0.0 && !inner.is_nan()).unwrap_or(false),
        Value::String(text) => !text.is_empty(),
        // JS 里数组与对象恒为真（空数组也是 truthy）。
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// JS 属性读取失败时的 TypeError 消息（null / undefined 两种前缀）。
fn read_property_error(target: &Value, property: &str) -> UnitError {
    let label = match target {
        Value::Null => "null",
        _ => "undefined",
    };
    UnitError::type_error(format!("Cannot read properties of {label} (reading '{property}')"))
}

/// JS `typeof value === 'object'` 风格的错误措辞辅助（`Object.keys(undefined)` 消息）。
fn js_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Array(_) => "object",
        Value::Object(_) => "object",
        Value::String(_) => "string",
        Value::Number(_) => "number",
        Value::Bool(_) => "boolean",
    }
}

/// 把 `{ combatMonsterHrid, difficultyTier }` 条目映射为 `(hrid, tier)`；
/// hrid 缺失时 JS `new Monster(undefined, …)` 会抛 `No monster found for hrid: undefined`。
fn monster_entry(spawn: &Value) -> (String, f64) {
    let hrid = spawn
        .get("combatMonsterHrid")
        .map(|value| match value {
            Value::String(text) => text.clone(),
            other => js_string(other),
        })
        .unwrap_or_else(|| "undefined".to_string());
    let tier = spawn.get("difficultyTier").map(js_number).unwrap_or(f64::NAN);
    (hrid, tier)
}

/// 等价 JS `String(value)`（局部精简版）。
fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => "null".to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => js_number_key(number.as_f64().unwrap_or(f64::NAN)),
        Value::Array(_) | Value::Object(_) => "[object Object]".to_string(),
    }
}

/// `bossSpawns.map(...)` / `fixedSpawnsMap[key].map(...)`：非数组时等价 JS
/// `... .map is not a function` 的 TypeError。
fn map_monster_entries(monsters: &Value, zone_tier: f64, label: &str) -> Result<Vec<(String, f64)>, UnitError> {
    let array = monsters
        .as_array()
        .ok_or_else(|| UnitError::type_error(format!("monsters.{label}.map is not a function")))?;
    Ok(array
        .iter()
        .map(|spawn| {
            let (hrid, tier) = monster_entry(spawn);
            (hrid, tier + zone_tier)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::from_str;

    /// 真实 `actionDetailMap['/actions/combat/abyssal_imp'].combatZoneInfo.fightInfo`。
    const ABYSSAL_IMP_FIGHT_INFO: &str = r#"{"randomSpawnInfo":{"maxSpawnCount":1,"maxTotalStrength":1,"spawns":[{"combatMonsterHrid":"/monsters/abyssal_imp","difficultyTier":0,"rate":1,"strength":1}]},"bossSpawns":null,"battlesPerBoss":0}"#;
    /// 真实 `actionDetailMap['/actions/combat/gobo_planet'].combatZoneInfo.fightInfo`。
    const GOBO_PLANET_FIGHT_INFO: &str = r#"{"randomSpawnInfo":{"maxSpawnCount":3,"maxTotalStrength":250,"spawns":[{"combatMonsterHrid":"/monsters/gobo_stabby","difficultyTier":0,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_slashy","difficultyTier":0,"rate":1,"strength":70},{"combatMonsterHrid":"/monsters/gobo_smashy","difficultyTier":0,"rate":1,"strength":70},{"combatMonsterHrid":"/monsters/gobo_shooty","difficultyTier":0,"rate":1,"strength":90},{"combatMonsterHrid":"/monsters/gobo_boomy","difficultyTier":0,"rate":1,"strength":100}]},"bossSpawns":[{"combatMonsterHrid":"/monsters/gobo_chieftain","difficultyTier":0,"rate":0,"strength":0}],"battlesPerBoss":10}"#;
    /// 真实 `actionDetailMap['/actions/combat/jungle_planet'].combatZoneInfo.fightInfo`。
    const JUNGLE_PLANET_FIGHT_INFO: &str = r#"{"randomSpawnInfo":{"maxSpawnCount":4,"maxTotalStrength":250,"spawns":[{"combatMonsterHrid":"/monsters/jungle_sprite","difficultyTier":0,"rate":1,"strength":50},{"combatMonsterHrid":"/monsters/myconid","difficultyTier":0,"rate":1,"strength":60},{"combatMonsterHrid":"/monsters/treant","difficultyTier":0,"rate":1,"strength":70},{"combatMonsterHrid":"/monsters/centaur_archer","difficultyTier":0,"rate":1,"strength":100}]},"bossSpawns":[{"combatMonsterHrid":"/monsters/luna_empress","difficultyTier":0,"rate":0,"strength":0}],"battlesPerBoss":10}"#;
    /// 真实 `actionDetailMap['/actions/combat/chimerical_den'].combatZoneInfo.dungeonInfo`。
    const CHIMERICAL_DEN_DUNGEON_INFO: &str = r#"{"keyItemHrid":"/items/chimerical_entry_key","rewardDropTable":[{"itemHrid":"/items/chimerical_chest","dropRate":1,"minCount":1,"maxCount":1},{"itemHrid":"/items/chimerical_refinement_chest","dropRate":-0.3,"dropRatePerDifficultyTier":0.6,"minCount":1,"maxCount":1}],"maxWaves":50,"randomSpawnInfoMap":{"0":{"maxSpawnCount":4,"maxTotalStrength":250,"spawns":[{"combatMonsterHrid":"/monsters/rat","difficultyTier":4,"rate":1,"strength":40},{"combatMonsterHrid":"/monsters/skunk","difficultyTier":4,"rate":1,"strength":40},{"combatMonsterHrid":"/monsters/porcupine","difficultyTier":4,"rate":1,"strength":40},{"combatMonsterHrid":"/monsters/slimy","difficultyTier":4,"rate":1,"strength":40},{"combatMonsterHrid":"/monsters/frog","difficultyTier":4,"rate":1,"strength":45},{"combatMonsterHrid":"/monsters/snake","difficultyTier":4,"rate":1,"strength":45},{"combatMonsterHrid":"/monsters/swampy","difficultyTier":4,"rate":1,"strength":50},{"combatMonsterHrid":"/monsters/alligator","difficultyTier":4,"rate":1,"strength":50},{"combatMonsterHrid":"/monsters/sea_snail","difficultyTier":4,"rate":1,"strength":55},{"combatMonsterHrid":"/monsters/crab","difficultyTier":4,"rate":1,"strength":60},{"combatMonsterHrid":"/monsters/aquahorse","difficultyTier":4,"rate":1,"strength":65},{"combatMonsterHrid":"/monsters/jungle_sprite","difficultyTier":4,"rate":1,"strength":60},{"combatMonsterHrid":"/monsters/myconid","difficultyTier":4,"rate":1,"strength":65}]},"10":{"maxSpawnCount":5,"maxTotalStrength":300,"spawns":[{"combatMonsterHrid":"/monsters/swampy","difficultyTier":4,"rate":1,"strength":50},{"combatMonsterHrid":"/monsters/alligator","difficultyTier":4,"rate":1,"strength":50},{"combatMonsterHrid":"/monsters/sea_snail","difficultyTier":4,"rate":1,"strength":55},{"combatMonsterHrid":"/monsters/crab","difficultyTier":4,"rate":1,"strength":60},{"combatMonsterHrid":"/monsters/aquahorse","difficultyTier":4,"rate":1,"strength":65},{"combatMonsterHrid":"/monsters/nom_nom","difficultyTier":4,"rate":1,"strength":65},{"combatMonsterHrid":"/monsters/turtle","difficultyTier":4,"rate":1,"strength":70},{"combatMonsterHrid":"/monsters/jungle_sprite","difficultyTier":4,"rate":1,"strength":60},{"combatMonsterHrid":"/monsters/myconid","difficultyTier":4,"rate":1,"strength":65},{"combatMonsterHrid":"/monsters/centaur_archer","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_stabby","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_slashy","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_smashy","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_shooty","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_boomy","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/eye","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/butterjerry","difficultyTier":0,"rate":2,"strength":150}]},"30":{"maxSpawnCount":5,"maxTotalStrength":400,"spawns":[{"combatMonsterHrid":"/monsters/aquahorse","difficultyTier":4,"rate":1,"strength":65},{"combatMonsterHrid":"/monsters/nom_nom","difficultyTier":4,"rate":1,"strength":65},{"combatMonsterHrid":"/monsters/turtle","difficultyTier":4,"rate":1,"strength":70},{"combatMonsterHrid":"/monsters/jungle_sprite","difficultyTier":4,"rate":1,"strength":60},{"combatMonsterHrid":"/monsters/myconid","difficultyTier":4,"rate":1,"strength":65},{"combatMonsterHrid":"/monsters/centaur_archer","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_stabby","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_slashy","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_smashy","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_shooty","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/gobo_boomy","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/eye","difficultyTier":4,"rate":1,"strength":80},{"combatMonsterHrid":"/monsters/eyes","difficultyTier":4,"rate":1,"strength":90},{"combatMonsterHrid":"/monsters/veyes","difficultyTier":4,"rate":1,"strength":110},{"combatMonsterHrid":"/monsters/butterjerry","difficultyTier":0,"rate":2,"strength":150},{"combatMonsterHrid":"/monsters/jackalope","difficultyTier":0,"rate":0.5,"strength":250}]}},"fixedSpawnsMap":{"5":[{"combatMonsterHrid":"/monsters/butterjerry","difficultyTier":0,"rate":0,"strength":0}],"10":[{"combatMonsterHrid":"/monsters/jackalope","difficultyTier":0,"rate":0,"strength":0}],"15":[{"combatMonsterHrid":"/monsters/jackalope","difficultyTier":0,"rate":0,"strength":0},{"combatMonsterHrid":"/monsters/butterjerry","difficultyTier":0,"rate":0,"strength":0}],"20":[{"combatMonsterHrid":"/monsters/dodocamel","difficultyTier":0,"rate":0,"strength":0}],"25":[{"combatMonsterHrid":"/monsters/dodocamel","difficultyTier":0,"rate":0,"strength":0},{"combatMonsterHrid":"/monsters/butterjerry","difficultyTier":0,"rate":0,"strength":0}],"30":[{"combatMonsterHrid":"/monsters/jackalope","difficultyTier":0,"rate":0,"strength":0},{"combatMonsterHrid":"/monsters/dodocamel","difficultyTier":0,"rate":0,"strength":0}],"35":[{"combatMonsterHrid":"/monsters/manticore","difficultyTier":0,"rate":0,"strength":0}],"40":[{"combatMonsterHrid":"/monsters/jackalope","difficultyTier":0,"rate":0,"strength":0},{"combatMonsterHrid":"/monsters/manticore","difficultyTier":0,"rate":0,"strength":0}],"45":[{"combatMonsterHrid":"/monsters/manticore","difficultyTier":0,"rate":0,"strength":0},{"combatMonsterHrid":"/monsters/dodocamel","difficultyTier":0,"rate":0,"strength":0}],"50":[{"combatMonsterHrid":"/monsters/griffin","difficultyTier":0,"rate":0,"strength":0}]}}"#;

    fn expect_rows(actual: Vec<(String, f64)>, expected: &[(&str, f64)]) {
        let actual: Vec<(String, f64)> = actual;
        let expected: Vec<(String, f64)> = expected.iter().map(|(hrid, tier)| (hrid.to_string(), *tier)).collect();
        assert_eq!(actual, expected);
    }

    #[test]
    fn abyssal_imp_sequence_matches_js() {
        // JS: seed 7, 6 次 getRandomEncounter → 全部 /monsters/abyssal_imp，encountersKilled = 7。
        let mut zone = Zone::new(
            "/actions/combat/abyssal_imp".to_string(),
            0.0,
            from_str(ABYSSAL_IMP_FIGHT_INFO).expect("fightInfo"),
            Value::Null,
            false,
        );
        let mut rng = Mulberry32::new(7);
        for _ in 0..6 {
            let encounter = zone.get_random_encounter(&mut rng).expect("encounter");
            expect_rows(encounter, &[("/monsters/abyssal_imp", 0.0)]);
        }
        assert_eq!(zone.encounters_killed(), 7.0);
        assert!(!zone.is_dungeon());
    }

    #[test]
    fn jungle_planet_tier2_sequence_matches_js() {
        // JS: seed 11, 4 次 getRandomEncounter（tier 2），期望序列逐项一致。
        let mut zone = Zone::new(
            "/actions/combat/jungle_planet".to_string(),
            2.0,
            from_str(JUNGLE_PLANET_FIGHT_INFO).expect("fightInfo"),
            Value::Null,
            false,
        );
        let mut rng = Mulberry32::new(11);
        let expected: Vec<Vec<(&str, f64)>> = vec![
            vec![("/monsters/treant", 2.0), ("/monsters/treant", 2.0), ("/monsters/treant", 2.0)],
            vec![("/monsters/centaur_archer", 2.0), ("/monsters/treant", 2.0), ("/monsters/jungle_sprite", 2.0)],
            vec![("/monsters/treant", 2.0), ("/monsters/myconid", 2.0), ("/monsters/myconid", 2.0)],
            vec![
                ("/monsters/myconid", 2.0),
                ("/monsters/treant", 2.0),
                ("/monsters/treant", 2.0),
                ("/monsters/jungle_sprite", 2.0),
            ],
        ];
        for row in expected {
            let encounter = zone.get_random_encounter(&mut rng).expect("encounter");
            expect_rows(encounter, &row);
        }
        assert_eq!(zone.encounters_killed(), 5.0);
    }

    #[test]
    fn gobo_planet_boss_branch_matches_js() {
        // JS: seed 3, 12 次 getRandomEncounter；第 10 次命中 boss（battlesPerBoss = 10），
        // 计数器重置为 1；最终 encountersKilled = 3。
        let mut zone = Zone::new(
            "/actions/combat/gobo_planet".to_string(),
            0.0,
            from_str(GOBO_PLANET_FIGHT_INFO).expect("fightInfo"),
            Value::Null,
            false,
        );
        let mut rng = Mulberry32::new(3);
        let expected: Vec<Vec<(&str, f64)>> = vec![
            vec![("/monsters/gobo_shooty", 0.0), ("/monsters/gobo_stabby", 0.0), ("/monsters/gobo_smashy", 0.0)],
            vec![("/monsters/gobo_stabby", 0.0), ("/monsters/gobo_shooty", 0.0), ("/monsters/gobo_smashy", 0.0)],
            vec![("/monsters/gobo_smashy", 0.0), ("/monsters/gobo_stabby", 0.0), ("/monsters/gobo_slashy", 0.0)],
            vec![("/monsters/gobo_smashy", 0.0), ("/monsters/gobo_stabby", 0.0), ("/monsters/gobo_stabby", 0.0)],
            vec![("/monsters/gobo_shooty", 0.0), ("/monsters/gobo_smashy", 0.0), ("/monsters/gobo_shooty", 0.0)],
            vec![("/monsters/gobo_boomy", 0.0), ("/monsters/gobo_slashy", 0.0)],
            vec![("/monsters/gobo_slashy", 0.0), ("/monsters/gobo_shooty", 0.0), ("/monsters/gobo_smashy", 0.0)],
            vec![("/monsters/gobo_boomy", 0.0), ("/monsters/gobo_smashy", 0.0), ("/monsters/gobo_stabby", 0.0)],
            vec![("/monsters/gobo_boomy", 0.0), ("/monsters/gobo_slashy", 0.0)],
            vec![("/monsters/gobo_chieftain", 0.0)],
            vec![("/monsters/gobo_shooty", 0.0), ("/monsters/gobo_smashy", 0.0), ("/monsters/gobo_shooty", 0.0)],
            vec![("/monsters/gobo_stabby", 0.0), ("/monsters/gobo_slashy", 0.0), ("/monsters/gobo_shooty", 0.0)],
        ];
        for row in expected {
            let encounter = zone.get_random_encounter(&mut rng).expect("encounter");
            expect_rows(encounter, &row);
        }
        assert_eq!(zone.encounters_killed(), 3.0);
    }

    #[test]
    fn chimerical_den_waves_match_js() {
        // JS: seed 5 / tier 0，16 次 getNextWave；第 5、10、15 波命中 fixedSpawnsMap。
        let dungeon_info = from_str(CHIMERICAL_DEN_DUNGEON_INFO).expect("dungeonInfo");
        let mut zone = Zone::new(
            "/actions/combat/chimerical_den".to_string(),
            0.0,
            Value::Null,
            dungeon_info,
            true,
        );
        let mut rng = Mulberry32::new(5);
        let expected: Vec<Vec<(&str, f64)>> = vec![
            vec![("/monsters/sea_snail", 4.0), ("/monsters/aquahorse", 4.0), ("/monsters/porcupine", 4.0), ("/monsters/sea_snail", 4.0)],
            vec![("/monsters/skunk", 4.0), ("/monsters/alligator", 4.0), ("/monsters/crab", 4.0), ("/monsters/snake", 4.0)],
            vec![("/monsters/jungle_sprite", 4.0), ("/monsters/porcupine", 4.0), ("/monsters/aquahorse", 4.0), ("/monsters/crab", 4.0)],
            vec![("/monsters/sea_snail", 4.0), ("/monsters/rat", 4.0), ("/monsters/swampy", 4.0), ("/monsters/slimy", 4.0)],
            vec![("/monsters/butterjerry", 0.0)],
            vec![("/monsters/jungle_sprite", 4.0), ("/monsters/slimy", 4.0), ("/monsters/crab", 4.0), ("/monsters/crab", 4.0)],
            vec![("/monsters/slimy", 4.0), ("/monsters/rat", 4.0), ("/monsters/aquahorse", 4.0), ("/monsters/porcupine", 4.0)],
            vec![("/monsters/slimy", 4.0), ("/monsters/skunk", 4.0), ("/monsters/swampy", 4.0), ("/monsters/myconid", 4.0)],
            vec![("/monsters/slimy", 4.0), ("/monsters/skunk", 4.0), ("/monsters/jungle_sprite", 4.0), ("/monsters/frog", 4.0)],
            vec![("/monsters/jackalope", 0.0)],
            vec![("/monsters/jungle_sprite", 4.0), ("/monsters/butterjerry", 0.0), ("/monsters/aquahorse", 4.0)],
            vec![("/monsters/crab", 4.0), ("/monsters/eye", 4.0), ("/monsters/gobo_shooty", 4.0), ("/monsters/eye", 4.0)],
            vec![("/monsters/gobo_boomy", 4.0), ("/monsters/gobo_slashy", 4.0), ("/monsters/sea_snail", 4.0), ("/monsters/gobo_slashy", 4.0)],
            vec![("/monsters/nom_nom", 4.0), ("/monsters/gobo_boomy", 4.0), ("/monsters/gobo_stabby", 4.0), ("/monsters/swampy", 4.0)],
            vec![("/monsters/jackalope", 0.0), ("/monsters/butterjerry", 0.0)],
            vec![("/monsters/turtle", 4.0), ("/monsters/turtle", 4.0), ("/monsters/eye", 4.0), ("/monsters/aquahorse", 4.0)],
        ];
        for row in expected {
            let wave = zone.get_next_wave(&mut rng).expect("wave");
            expect_rows(wave, &row);
        }
        assert_eq!(zone.encounters_killed(), 17.0);
        assert_eq!(zone.dungeons_completed(), 0.0);
        assert_eq!(zone.dungeons_failed(), 0.0);
    }

    #[test]
    fn chimerical_den_tier3_waves_match_js() {
        // 同一副本 tier 3 / seed 9：fixed 波次的 tier 也随区域档上移（0 + 3 = 3）。
        let dungeon_info = from_str(CHIMERICAL_DEN_DUNGEON_INFO).expect("dungeonInfo");
        let mut zone = Zone::new(
            "/actions/combat/chimerical_den".to_string(),
            3.0,
            Value::Null,
            dungeon_info,
            true,
        );
        let mut rng = Mulberry32::new(9);
        let expected: Vec<Vec<(&str, f64)>> = vec![
            vec![("/monsters/porcupine", 7.0), ("/monsters/jungle_sprite", 7.0), ("/monsters/skunk", 7.0), ("/monsters/aquahorse", 7.0)],
            vec![("/monsters/crab", 7.0), ("/monsters/sea_snail", 7.0), ("/monsters/slimy", 7.0), ("/monsters/jungle_sprite", 7.0)],
            vec![("/monsters/skunk", 7.0), ("/monsters/sea_snail", 7.0), ("/monsters/crab", 7.0), ("/monsters/alligator", 7.0)],
            vec![("/monsters/slimy", 7.0), ("/monsters/myconid", 7.0), ("/monsters/slimy", 7.0), ("/monsters/crab", 7.0)],
            vec![("/monsters/butterjerry", 3.0)],
            vec![("/monsters/sea_snail", 7.0), ("/monsters/frog", 7.0), ("/monsters/swampy", 7.0), ("/monsters/jungle_sprite", 7.0)],
            vec![("/monsters/jungle_sprite", 7.0), ("/monsters/snake", 7.0), ("/monsters/jungle_sprite", 7.0), ("/monsters/porcupine", 7.0)],
            vec![("/monsters/sea_snail", 7.0), ("/monsters/frog", 7.0), ("/monsters/rat", 7.0), ("/monsters/jungle_sprite", 7.0)],
            vec![("/monsters/porcupine", 7.0), ("/monsters/swampy", 7.0), ("/monsters/swampy", 7.0), ("/monsters/rat", 7.0)],
            vec![("/monsters/jackalope", 3.0)],
            vec![("/monsters/eye", 7.0), ("/monsters/gobo_smashy", 7.0), ("/monsters/crab", 7.0), ("/monsters/alligator", 7.0)],
            vec![("/monsters/nom_nom", 7.0), ("/monsters/gobo_slashy", 7.0), ("/monsters/nom_nom", 7.0), ("/monsters/centaur_archer", 7.0)],
            vec![("/monsters/gobo_stabby", 7.0), ("/monsters/sea_snail", 7.0), ("/monsters/centaur_archer", 7.0), ("/monsters/nom_nom", 7.0)],
            vec![("/monsters/gobo_boomy", 7.0), ("/monsters/gobo_stabby", 7.0), ("/monsters/gobo_slashy", 7.0)],
            vec![("/monsters/jackalope", 3.0), ("/monsters/butterjerry", 3.0)],
            vec![("/monsters/gobo_slashy", 7.0), ("/monsters/myconid", 7.0), ("/monsters/crab", 7.0)],
        ];
        for row in expected {
            let wave = zone.get_next_wave(&mut rng).expect("wave");
            expect_rows(wave, &row);
        }
        assert_eq!(zone.encounters_killed(), 17.0);
    }

    #[test]
    fn fail_wave_resets_counter_and_counts_failure() {
        let dungeon_info = from_str(CHIMERICAL_DEN_DUNGEON_INFO).expect("dungeonInfo");
        let mut zone = Zone::new(
            "/actions/combat/chimerical_den".to_string(),
            0.0,
            Value::Null,
            dungeon_info,
            true,
        );
        let mut rng = Mulberry32::new(5);
        zone.get_next_wave(&mut rng).expect("wave");
        zone.get_next_wave(&mut rng).expect("wave");
        assert_eq!(zone.encounters_killed(), 3.0);
        zone.fail_wave();
        assert_eq!(zone.encounters_killed(), 1.0);
        assert_eq!(zone.dungeons_failed(), 1.0);
        assert_eq!(zone.dungeons_completed(), 0.0);
    }

    #[test]
    fn missing_spawn_fields_report_js_type_errors() {
        // JS 先读 bossSpawns：对象缺少该键时报 reading 'bossSpawns'。
        let mut zone = Zone::new(
            "/actions/combat/x".to_string(),
            0.0,
            serde_json::json!({ "battlesPerBoss": 3 }),
            Value::Null,
            false,
        );
        let mut rng = Mulberry32::new(1);
        let error = zone.get_random_encounter(&mut rng).expect_err("missing bossSpawns");
        assert_eq!(error.message, "Cannot read properties of undefined (reading 'bossSpawns')");

        // bossSpawns 为 null（falsy）时继续走普通分支，缺 randomSpawnInfo 报对应消息。
        let mut zone = Zone::new(
            "/actions/combat/x".to_string(),
            0.0,
            serde_json::json!({ "bossSpawns": null, "battlesPerBoss": 3 }),
            Value::Null,
            false,
        );
        let error = zone.get_random_encounter(&mut rng).expect_err("missing randomSpawnInfo");
        assert_eq!(error.message, "Cannot read properties of undefined (reading 'randomSpawnInfo')");
        // 失败发生在自增之后（JS `encountersKilled++` 先于 buildEncounterFromSpawnInfo）。
        assert_eq!(zone.encounters_killed(), 2.0);

        let mut zone = Zone::new(
            "/actions/combat/x".to_string(),
            0.0,
            Value::Null,
            Value::Null,
            false,
        );
        let error = zone.get_random_encounter(&mut rng).expect_err("null spawn info");
        assert_eq!(error.message, "Cannot read properties of null (reading 'bossSpawns')");

        let mut dungeon_zone = Zone::new(
            "/actions/combat/x".to_string(),
            0.0,
            Value::Null,
            serde_json::json!({ "maxWaves": 10, "fixedSpawnsMap": {}, "randomSpawnInfoMap": { "0": { "maxSpawnCount": 1, "maxTotalStrength": 10, "spawns": [] } } }),
            true,
        );
        // spawns 为空数组时 JS 的 reduce 起始值为 0，内层循环永不匹配 → 返回空遭遇战。
        let wave = dungeon_zone.get_next_wave(&mut rng).expect("empty spawns");
        assert!(wave.is_empty());
    }
}
