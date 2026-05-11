import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { CalculationResult, FormulaInfo } from '../types'

const DESC_MAX = 1500

/** 供助手 LLM system 提示词注入的软件状态（由 MainContent 持续更新；嵌入式 GGUF 后端使用） */
export type AssistantWorkspaceSnapshot = {
  currentView: 'formula' | 'about' | 'settings'
  aboutDepartment: string | null
  language: 'zh' | 'en'
  formula: Pick<FormulaInfo, 'id' | 'name'> & { descriptionSnippet: string } | null
  parameters: Record<string, number | undefined>
  /** 当前公式最近一次计算接口返回（含 success/error/animation） */
  lastCalculation: CalculationResult | null
  lockedVc: number | null
}

type AssistantContextValue = {
  assistantSnapshot: AssistantWorkspaceSnapshot | null
  setAssistantSnapshot: Dispatch<SetStateAction<AssistantWorkspaceSnapshot | null>>
}

const AssistantContext = createContext<AssistantContextValue | null>(null)

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [assistantSnapshot, setAssistantSnapshot] = useState<AssistantWorkspaceSnapshot | null>(null)
  const value = useMemo(
    () => ({
      assistantSnapshot,
      setAssistantSnapshot,
    }),
    [assistantSnapshot]
  )
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}

export function useAssistantContext(): AssistantContextValue {
  const ctx = useContext(AssistantContext)
  if (!ctx) {
    throw new Error('useAssistantContext must be used within AssistantProvider')
  }
  return ctx
}

/** MainContent 子树外或未包裹 Provider 时安全调用（不抛错）。 */
export function useAssistantSnapshotOptional(): AssistantContextValue {
  const ctx = useContext(AssistantContext)
  return (
    ctx ?? {
      assistantSnapshot: null,
      setAssistantSnapshot: () => {},
    }
  )
}

export function buildFormulaDescriptionSnippet(description: string | undefined): string {
  const s = description ?? ''
  if (s.length <= DESC_MAX) return s
  return `${s.slice(0, DESC_MAX)}…`
}
