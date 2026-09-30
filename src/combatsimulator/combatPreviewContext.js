// 切片 21A：战斗预览上下文（playerMapper 专用）。
//
// 预览路径（buildCombatPreviewData / buildPartyAuraPreviewResult / buildDrinkPreviewCard）
// 此前 `new CombatSimulator(...)` 只为借它的单步动作方法（tryUseAbility /
// tryUseConsumable / processAbilityBuffEffect / canUseAbility / checkTriggersForUnit …），
// 从不调用 simulate()。21B 删除 JS 模拟执行层（combatSimulator.js / events/ / simResult）
// 之前，先把动作语义收拢到 CombatActionsCore（与真实引擎共享同一份实现），
// 本类只补齐基类构造契约所需的「轻量容器」：
// - 数组版事件队列：只支持 addEvent / clear / getMatching / clearMatching /
//   clearEventsForUnit / clearEventsOfType / containsEventOfTypesAndSource /
//   containsEventOfTypeAndHrid——预览从不排序/弹出事件，只在用完冷却/过期事件
//   时间戳后整批丢弃（playerMapper 各处 eventQueue.clear() 的既有语义）；
// - Noop 记账接收器：预览不读任何 simResult 输出，所有记账方法为 no-op。
//
// 语义对齐说明：与旧实现（new CombatSimulator + null zone/labyrinth）逐字对齐——
// minimalResult=false（走完整 SimResult 分支的 no-op 等价）、logCombatEvents=false
// （wipeLogs 为空数组，addToWipeLogs 直接短路）、无 zone/labyrinth（checkEncounterEnd
// 不触发副本/迷宫分支）。
import CombatActionsCore from './combatActions.js';

// 预览是零时刻静态快照：不推进冷却、不调度过期，事件只在写入后被查询或整批清除。
// 与 EventQueue 的 heap 语义差异：getMatching/clearMatching 遍历顺序为插入序而非时间序
// ——预览路径从未依赖时间序（查询都是 type/source 谓词），插入序在所有现有用例下等价。
class PreviewEventQueue {
  constructor() {
    this.events = [];
  }

  addEvent(event) {
    this.events.push(event);
  }

  clear() {
    this.events = [];
  }

  getMatching(fn) {
    for (const event of this.events) {
      if (fn(event)) {
        return event;
      }
    }
    return null;
  }

  clearMatching(fn) {
    let cleared = false;
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      if (fn(this.events[i])) {
        this.events.splice(i, 1);
        cleared = true;
      }
    }
    return cleared;
  }

  clearEventsForUnit(unit) {
    return this.clearMatching((event) => event.source == unit || event.target == unit);
  }

  clearEventsOfType(type) {
    return this.clearMatching((event) => event.type == type);
  }

  containsEventOfTypesAndSource(types, source) {
    for (const event of this.events) {
      for (let typeIndex = 0; typeIndex < types.length; typeIndex += 1) {
        if (event.type == types[typeIndex]) {
          if (event.source == source) return true;
          break;
        }
      }
    }
    return false;
  }

  containsEventOfTypeAndHrid(type, hrid) {
    for (const event of this.events) {
      if (event.type == type && event.hrid == hrid) return true;
    }
    return false;
  }
}

// 预览不消费任何记账输出（旧路径 new CombatSimulator(..., { enableHpMpVisualization: false })
// 构造的 SimResult 也从不被读取）。所有方法 no-op，保持动作方法调用形状不变。
class NoopPreviewSimResult {
  addDeath() {}
  recordMonsterDeathFromUnit() {}
  calculateExperienceGain() {
    return null;
  }
  addExperienceGainValues() {}
  addConsumableUse() {}
  addHitpointsGained() {}
  addManapointsGained() {}
  addRanOutOfManaCount() {}
  addAttack() {}
  updateTimeSpentAlive() {}
  updateDungenonFinish() {}
  addEncounterEnd() {}
  addHitpointsSpent() {}
  addWipeEvent() {}
}

// 旧路径构造：new CombatSimulator(simulationPlayers, null, null, { enableHpMpVisualization: false })
// ——zone=null、labyrinth=null、无卷轴、无日志、无可视化。预览上下文逐字复刻该构造的字段面。
export class CombatPreviewContext extends CombatActionsCore {
  constructor(players) {
    super();
    this.players = players;
    this.zone = null;
    this.labyrinth = null;
    this.enemies = null;
    this.simulationTime = 0;
    this.eventQueue = new PreviewEventQueue();
    this.simResult = new NoopPreviewSimResult();
    // CombatActionsCore 动作方法引用的其余状态（与旧构造等价）：
    this.isGuildTrial = false;
    this.scrollsAllowed = true;
    this.combatScrollsEnabled = false;
    this.logCombatEvents = false;
    this.minimalResult = false;
    this.simulationTimeLimit = 0;
    this.allPlayersDead = false;
    this.enrageBeginTime = 0;
    this.experienceAwardedEnemies = new WeakSet();
    this.enemyDeathSnapshots = new WeakMap();
    this.invalidExperienceRateWarningKeys = new Set();
    this.pendingExperienceGains = new Map();
    this.wipeLogs = { buffer: [], index: 0, count: 0, maxSize: 0 };
    // 基类 extends EventTarget（CombatSimulator 的 progress 依赖）；预览不派发。
  }
}

export default CombatPreviewContext;
