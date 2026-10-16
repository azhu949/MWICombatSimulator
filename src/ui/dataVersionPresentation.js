// 数据版本展示口径：共享游戏数据索引的生成时刻是 ISO UTC（如 2026-09-14T06:40:54.365Z），
// 展示统一按中国时区（Asia/Shanghai，UTC+8）渲染为 YYYY-MM-DD HH:mm:ss，不带 UTC / Z /
// 时区后缀。形态固定：24 小时制（hourCycle h23，避免午夜被渲染成 24:00），且不随界面语言
// 漂移（固定 en-US 数字分段，避免 zh 下出现「2026/09/14」这类本地化分隔符）。
const DATA_VERSION_TIME_ZONE = 'Asia/Shanghai';

const dataVersionFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DATA_VERSION_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * 把索引生成时刻（ISO UTC 字符串）渲染成中国时区的 YYYY-MM-DD HH:mm:ss。
 * 无法解析时原样返回入参（空值回落 'unknown'），保证坏数据不会渲染成 'Invalid Date'。
 * @param {*} value 例如 GAME_DATA_VERSION（'2026-09-14T06:40:54.365Z' / 'unknown'）
 * @returns {string}
 */
export function formatDataVersionText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return 'unknown';
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  const parts = Object.fromEntries(dataVersionFormatter.formatToParts(parsed).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
