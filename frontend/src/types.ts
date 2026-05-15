export interface Parameter {
  name: string
  label: string
  unit: string
  description?: string
  default?: number
}

export interface FormulaInfo {
  id: string
  name: string
  formula: string
  description: string
  parameters: Parameter[]
}

export interface FlowState {
  /** 浆体管道流态判断公式（$C/C_A$ 判别，与临界流速公式分列） */
  浆体管道流态判断公式?: FormulaInfo[]
  临界流速计算?: FormulaInfo[]
  /** @deprecated 旧版 API，前端会迁移到 清水摩阻损失 / 浆体摩阻损失 */
  摩阻损失?: FormulaInfo[]
  清水摩阻损失?: FormulaInfo[]
  浆体摩阻损失?: FormulaInfo[]
  /** @deprecated 旧版键名，请使用 压力与扬程 */
  总扬程?: FormulaInfo[]
  压力与扬程?: FormulaInfo[]
  浆体加速流?: FormulaInfo[]
  浆体消能?: FormulaInfo[]
}

export interface CalculationResult {
  success: boolean
  result?: {
    Vc?: number
    i_k?: number
    K_QL?: number
    delta_h?: number
    rho_k?: number
    rho_1?: number
    rho_l?: number
    Re_B?: number
    lambda_coef?: number
    /** $C/C_A$ 等计算结果 */
    C_over_CA?: number
    C_CA_d95?: number
    C1v?: number
    f_L?: number
    friction_velocity_U?: number
    H_total?: number
    /** 离心泵总扬程步骤1：扬程降低率 */
    K_p?: number
    /** 容积式泵总扬程（压力，kPa） */
    P_b?: number
    /** 泵所需电机功率（kW） */
    N?: number
    /** 清水摩阻损失：单位长度水头损失 kPa/m */
    i?: number
    /** 似均质 / 复合 / 非均质 流态判定 */
    condition_met?: boolean
    /** 后端返回：`pseudo_homogeneous` | `heterogeneous` | `composite` */
    flow_regime?: 'pseudo_homogeneous' | 'heterogeneous' | 'composite' | string
    /** 孔板消能步骤 1 */
    beta?: number
    /** 孔板消能步骤 2 */
    K_Qk?: number
    unit: string
    intermediate?: Record<string, number | string | boolean>
    hl_curve?: Array<{ L: number; H: number }>
  }
  error?: string
  animation_type?: 'settle-30' | 'settle-20' | 'settle-10-flow' | 'still-flow' | 'medium-flow' | 'fast-flow'
  velocity_ratio?: number
}
