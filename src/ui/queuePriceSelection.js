// 实现已迁移至 services 层（stores 入队裁剪与 UI 展示过滤共用同一实现，避免同步漂移）。
// 本模块保留为兼容出口：UI 页面与既有测试的导入路径不变。
export { buildChangedEquipmentKeys, buildSelectionKey } from '../services/queuePriceSelection.js';
