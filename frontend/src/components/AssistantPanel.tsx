import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlowState, FormulaInfo } from '../types'
import { API_BASE_URL, API_TIMEOUT } from '../config/api'
import { useAssistantContext } from '../context/AssistantContext'
import {
  buildAssistantWelcome,
  smartInterpretationNotReadyReply,
  tryRuleBasedAssistantReply,
} from '../utils/assistantFaq'

type ChatRole = 'user' | 'assistant'

interface ChatTurn {
  id: string
  role: ChatRole
  content: string
  navigateId?: string
}

interface AssistantPanelProps {
  formulas: FlowState
  darkMode: boolean
  language: 'zh' | 'en'
  onFormulaSelect: (f: FormulaInfo) => void
}

const WELCOME_ID = 'assistant-welcome'

const NAV_RE = /\[\[ACTION:NAVIGATE:([^\]]+)]]/

function flattenCatalog(fs: FlowState): { id: string; name: string; group: string }[] {
  const out: { id: string; name: string; group: string }[] = []
  for (const [group, list] of Object.entries(fs)) {
    if (!Array.isArray(list)) continue
    for (const f of list) {
      out.push({ id: f.id, name: f.name, group })
    }
  }
  return out
}

function formulasById(fs: FlowState): Map<string, FormulaInfo> {
  const m = new Map<string, FormulaInfo>()
  for (const [, list] of Object.entries(fs)) {
    if (!Array.isArray(list)) continue
    for (const f of list) m.set(f.id, f)
  }
  return m
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function stripNavigateLine(text: string): string {
  return text.replace(/\n?\[\[ACTION:NAVIGATE:[^\]]+]]\s*$/, '').trim()
}

function parseNavigateId(text: string): string | undefined {
  const m = text.match(NAV_RE)
  return m ? m[1].trim() : undefined
}

/** 探测本地 LLM；不可用时附带后端简明诊断（import / GGUF）。 */
async function fetchAssistantInferenceStatus(language: 'zh' | 'en'): Promise<{ ready: boolean; diagnostic?: string }> {
  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), Math.min(API_TIMEOUT, 10000))
  try {
    const res = await fetch(`${API_BASE_URL}/assistant/status`, { signal: ctrl.signal })
    let data: Record<string, unknown> = {}
    try {
      data = (await res.json()) as Record<string, unknown>
    } catch {
      /* ignore malformed JSON */
    }
    const ready = Boolean(data.inferenceReady)
    if (ready) return { ready }
    const diagZh =
      typeof data.failureDiagnosticZh === 'string' ? String(data.failureDiagnosticZh).trim() : ''
    const diagEn =
      typeof data.failureDiagnosticEn === 'string' ? String(data.failureDiagnosticEn).trim() : ''
    const diagnostic = language === 'en' ? diagEn || diagZh : diagZh || diagEn
    return { ready: false, diagnostic: diagnostic || undefined }
  } catch {
    return { ready: false }
  } finally {
    window.clearTimeout(t)
  }
}

export default function AssistantPanel({
  formulas,
  darkMode,
  language,
  onFormulaSelect,
}: AssistantPanelProps) {
  const { assistantSnapshot } = useAssistantContext()
  const [dockHover, setDockHover] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const lastPointerRef = useRef({ x: 0, y: 0 })

  const idMap = useMemo(() => formulasById(formulas), [formulas])
  const catalog = useMemo(() => flattenCatalog(formulas).slice(0, 96), [formulas])
  const allowedIds = useMemo(() => new Set(catalog.map((x) => x.id)), [catalog])

  const enrichedSnapshot = useMemo(
    () => ({
      ...assistantSnapshot,
      allowedFormulaIds: Array.from(allowedIds),
      formulaCatalog: catalog,
    }),
    [assistantSnapshot, allowedIds, catalog]
  )

  const surface = darkMode
    ? 'bg-gray-800 border-gray-600 text-gray-100'
    : 'bg-white border-gray-200 text-gray-900'
  const muted = darkMode ? 'text-gray-400' : 'text-gray-600'
  const inpCls = darkMode
    ? 'bg-gray-900 border-gray-600 text-gray-100 placeholder-gray-500'
    : 'bg-gray-50 border-gray-300 text-gray-900'

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].id === WELCOME_ID) {
        return [{ ...prev[0], content: buildAssistantWelcome(language) }]
      }
      return prev
    })
  }, [language])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy, dockHover])

  const clearHideTimer = () => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  useEffect(() => () => clearHideTimer(), [])

  /** 展开期间跟踪指针位置，收起时仅用 activeElement / relatedTarget + 该区域矩形判断「是否仍算在挂件内」 */
  useEffect(() => {
    if (!dockHover) return
    const track = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointermove', track, { capture: true })
    return () => window.removeEventListener('pointermove', track, { capture: true })
  }, [dockHover])

  /** 市面常见做法：仅当指针与焦点均已离开整块助手区域时才收起 */
  const tryCloseDockAfterLeave = () => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      const root = dockRef.current
      if (!root) {
        setDockHover(false)
        return
      }
      if (busyRef.current) return

      // 键盘输入或 Tab 在内：不因「误触 mouseleave」而关
      if (root.contains(document.activeElement)) return

      const r = root.getBoundingClientRect()
      const pad = 6
      const { x, y } = lastPointerRef.current
      const ptrInside =
        x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad
      if (ptrInside) return

      // 兜底：用当前坐标取样（少数环境下 leave 先于 pointermove 更新）
      let topEl: Element | null = null
      try {
        topEl = document.elementFromPoint(lastPointerRef.current.x, lastPointerRef.current.y)
      } catch {
        topEl = null
      }
      if (topEl && root.contains(topEl)) return

      setDockHover(false)
    }, 480)
  }

  const onDockEnter = (ev?: Pick<React.MouseEvent<Element>, 'clientX' | 'clientY'>) => {
    clearHideTimer()
    if (
      ev &&
      typeof ev.clientX === 'number' &&
      typeof ev.clientY === 'number'
    ) {
      lastPointerRef.current = { x: ev.clientX, y: ev.clientY }
    }
    setDockHover(true)
    setMessages((prev) => {
      if (prev.length > 0) return prev
      return [
        {
          id: WELCOME_ID,
          role: 'assistant',
          content: buildAssistantWelcome(language),
        },
      ]
    })
  }

  const onDockPointerLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const rt = e.relatedTarget
    if (rt instanceof Node && dockRef.current?.contains(rt)) return
    tryCloseDockAfterLeave()
  }

  const onDockFocusOutCapture = (e: React.FocusEvent<HTMLDivElement>) => {
    const rt = e.relatedTarget
    if (rt instanceof Node && dockRef.current?.contains(rt)) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (dockRef.current?.contains(document.activeElement)) return
        tryCloseDockAfterLeave()
      })
    })
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const userMsg: ChatTurn = { id: newId('u'), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setBusy(true)
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }))

    // 1) 规则/FAQ（前端静态）：命中即返回，不调后端
    const ruleReply = tryRuleBasedAssistantReply(text, language, catalog, assistantSnapshot)
    if (ruleReply) {
      const assistantId = newId('a')
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: ruleReply }])
      setBusy(false)
      return
    }

    // 2) 需 LLM：发送前探测 inferenceReady（不向界面展示模型状态）
    const inf = await fetchAssistantInferenceStatus(language)
    if (!inf.ready) {
      const assistantId = newId('a')
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: smartInterpretationNotReadyReply(language, inf.diagnostic),
        },
      ])
      setBusy(false)
      return
    }

    // 3) LLM：POST /api/assistant/chat（知识库在服务端注入 system，见 README_ASSISTANT_LLM.txt）

    const body: Record<string, unknown> = {
      locale: language,
      messages: history,
      snapshot: enrichedSnapshot,
      stream: true,
    }

    const assistantId = newId('a')
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const res = await fetch(`${API_BASE_URL}/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const errObj = (await res.json().catch(() => null)) as
          | { error?: unknown; hint?: unknown }
          | null
        const detailParts = [errObj?.hint, errObj?.error]
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter(Boolean)
        const fb = smartInterpretationNotReadyReply(
          language,
          detailParts.length ? detailParts.join('\n') : undefined
        )
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: fb } : m)))
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        const fb = smartInterpretationNotReadyReply(language)
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: fb } : m))
        )
        return
      }

      const dec = new TextDecoder()
      let carry = ''
      let assistantContent = ''

      const updateBubble = () => {
        const navRaw = parseNavigateId(assistantContent)
        const navId = navRaw && allowedIds.has(navRaw) ? navRaw : undefined
        const display = stripNavigateLine(assistantContent)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: display || assistantContent, navigateId: navId }
              : m
          )
        )
      }

      let full = ''
      let streamBackendError = false
      let streamBackendErrorText = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        carry += dec.decode(value, { stream: true })
        const lines = carry.split('\n')
        carry = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const o = JSON.parse(trimmed) as { content?: string; error?: string }
            if (o.error) {
              streamBackendError = true
              if (!streamBackendErrorText) streamBackendErrorText = String(o.error)
            }
            if (o.content) {
              full += o.content
              assistantContent = full
              updateBubble()
            }
          } catch {
            /* skip bad line */
          }
        }
      }
      const tail = carry.trim()
      if (tail) {
        try {
          const o = JSON.parse(tail) as { content?: string; error?: string }
          if (o.error) {
            streamBackendError = true
            if (!streamBackendErrorText) streamBackendErrorText = String(o.error)
          }
          if (o.content) {
            full += o.content
            assistantContent = full
          }
        } catch {
          /* ignore */
        }
      }

      if (streamBackendError) {
        assistantContent = smartInterpretationNotReadyReply(
          language,
          streamBackendErrorText || undefined
        )
      }

      const navRaw = parseNavigateId(assistantContent)
      const navId = navRaw && allowedIds.has(navRaw) ? navRaw : undefined
      const display = stripNavigateLine(assistantContent)

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: display || assistantContent, navigateId: navId } : m
        )
      )
      if (!assistantContent.trim()) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: smartInterpretationNotReadyReply(language) }
              : m
          )
        )
      }
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') return
      const fb = smartInterpretationNotReadyReply(language)
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: fb } : m))
      )
    } finally {
      setBusy(false)
    }
  }

  const applyNavigate = (fid: string) => {
    const f = idMap.get(fid)
    if (f) onFormulaSelect(f)
  }

  const stripLabel = language === 'en' ? 'Assistant' : '智能助手'
  const roleLabelAssistant = language === 'en' ? 'Assistant' : '助手'

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60]">
      <div
        ref={dockRef}
        className="pointer-events-auto flex flex-col items-end gap-2"
        onMouseEnter={(e) => onDockEnter(e)}
        onMouseLeave={onDockPointerLeave}
        onFocusCapture={clearHideTimer}
        onBlurCapture={onDockFocusOutCapture}
      >
        {dockHover && (
          <div
            className={`flex max-h-[min(72vh,520px)] w-[min(100vw-2rem,22rem)] flex-col overflow-hidden rounded-xl border shadow-2xl ${surface}`}
          >
            <div
              className={`flex items-center border-b px-3 py-2 ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}
            >
              <span className="text-sm font-semibold">{stripLabel}</span>
            </div>

            <div className="min-h-[220px] max-h-[340px] space-y-2 overflow-y-auto px-3 py-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg px-2 py-1.5 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? darkMode
                        ? 'ml-6 bg-blue-900/50'
                        : 'ml-6 bg-blue-50'
                      : darkMode
                        ? 'mr-3 bg-gray-700/90'
                        : 'mr-3 bg-gray-100'
                  }`}
                >
                  <div className={`mb-1 text-[10px] font-semibold opacity-70 ${muted}`}>
                    {m.role === 'user' ? (language === 'en' ? 'You' : '您') : roleLabelAssistant}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  {m.navigateId && idMap.has(m.navigateId) && (
                    <button
                      type="button"
                      className="mt-2 rounded bg-blue-600 px-2 py-1 text-[11px] text-white hover:bg-blue-700"
                      onClick={() => applyNavigate(m.navigateId!)}
                    >
                      {language === 'en' ? 'Open: ' : '打开：'}
                      {idMap.get(m.navigateId)?.name ?? m.navigateId}
                    </button>
                  )}
                </div>
              ))}
              {busy && (
                <div className={`text-xs ${muted}`}>
                  {language === 'en' ? 'Thinking…' : '正在回复…'}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div
              className={`flex gap-2 border-t p-2 ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}
            >
              <input
                type="text"
                className={`min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs ${inpCls}`}
                placeholder={language === 'en' ? 'Ask a question…' : '输入问题…（Enter 发送）'}
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={send}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {language === 'en' ? 'Send' : '发送'}
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400`}
          title={stripLabel}
          aria-label={stripLabel}
          onFocus={() => onDockEnter()}
        >
          <span className="text-2xl leading-none" aria-hidden>
            💬
          </span>
        </button>
      </div>
    </div>
  )
}
