import { getCombatScrollBuffTemplate } from '../shared/combatScrolls.js';
import Buff from './buff.js';

/**
 * 从共享的战斗卷轴 DTO 创建模拟器的可变 Buff 领域对象。
 * 将此适配器保留在模拟器层，可防止共享目录的使用方
 * 依赖模拟器类。战斗卷轴没有等级，
 * 因此通用 Buff 构造函数必须始终接收等级 1。
 */
export function createCombatScrollBuff(itemHrid, options = undefined) {
  const template = getCombatScrollBuffTemplate(itemHrid, options);
  if (!template) {
    return null;
  }

  return new Buff(template, 1);
}

/**
 * 真实队伍模拟中战斗卷轴使用的增益源键。
 * 预览路径必须用相同键注册卷轴增益，以便源级
 * 移除与源感知的对账与模拟器保持一致。
 */
export function getCombatScrollSourceKey(itemHrid) {
  return `scroll:${itemHrid}`;
}
