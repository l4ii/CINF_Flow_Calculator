/**
 * 锁定临界流速与当前算得的 V_c 对比时的流态分档（与后端 `classify_locked_vc_animation` 一致）。
 * r = V_{c,新} / V_{c,锁定}：新工况所需临界流速相对参考工况越高，
 * 在相同运行流速下越易沉降；比值越低越容易形成良好悬浮与输送。
 */

export type CriticalVelocityAnimationType =
  | 'settle-30'
  | 'settle-20'
  | 'settle-10-flow'
  | 'still-flow'
  | 'medium-flow'
  | 'fast-flow'

export function classifyLockedVcAnimation(newVc: number, lockedVc: number): CriticalVelocityAnimationType | null {
  const nv = Number(newVc)
  const lv = Number(lockedVc)
  if (!(lv > 0) || !(nv > 0)) return null

  const r = nv / lv
  const t03 = 1.0 / 0.3
  const t06 = 1.0 / 0.6
  const t09 = 1.0 / 0.9
  const t11 = 1.0 / 1.1
  const t15 = 1.0 / 1.5

  if (r > t03) return 'settle-30'
  if (r > t06) return 'settle-20'
  if (r > t09) return 'settle-10-flow'
  if (r >= t11 && r <= t09) return 'still-flow'
  if (r >= t15 && r < t11) return 'medium-flow'
  return 'fast-flow'
}
