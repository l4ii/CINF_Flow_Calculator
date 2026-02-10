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
  密度混合公式?: FormulaInfo[]
}

export interface CalculationResult {
  success: boolean
  result?: {
    Vc?: number
    i_k?: number
    rho_k?: number
    unit: string
    intermediate?: Record<string, number>
  }
  error?: string
  animation_type?: 'settle-30' | 'settle-20' | 'settle-10-flow' | 'still-flow' | 'medium-flow' | 'fast-flow'
  velocity_ratio?: number
}
