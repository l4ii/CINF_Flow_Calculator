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
  似均质流态: FormulaInfo[]
  非均质流态: FormulaInfo[]
}

export interface CalculationResult {
  success: boolean
  result?: {
    Vc: number
    unit: string
    intermediate?: Record<string, number>
  }
  error?: string
  animation_type?: 'settle-30' | 'settle-20' | 'settle-10-flow' | 'still-flow' | 'medium-flow' | 'fast-flow'
  velocity_ratio?: number
}
