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
  临界流速计算?: FormulaInfo[]
  沿程摩阻损失?: FormulaInfo[]
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
    Re_B?: number
    lambda_coef?: number
    condition_met?: boolean
    unit: string
    intermediate?: Record<string, number | string | boolean>
  }
  error?: string
  animation_type?: 'settle-30' | 'settle-20' | 'settle-10-flow' | 'still-flow' | 'medium-flow' | 'fast-flow'
  velocity_ratio?: number
}
