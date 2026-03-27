import { useState, useEffect, useRef, type ReactNode } from 'react';
import type { FormulaInfo, CalculationResult } from '../types';
import axios from 'axios';
import { API_BASE_URL, API_TIMEOUT } from '../config/api';
// @ts-ignore - react-katex types
import { BlockMath, InlineMath } from 'react-katex';
import 'katex/dist/katex.min.css';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { downloadScientificHlChartPng } from '../utils/chartExportCanvas';
import { APP_TAGLINE_EN, APP_TAGLINE_ZH } from '../constants/appCopy';

/** 浆体摩阻三步在界面内调用的后端 formula_id（与侧栏「浆体摩阻损失」工作流联动） */
const SLURRY_FRICTION_CHAIN_IDS = ['density_mixing', 'darcy_friction', 'slurry_friction_loss'] as const

/** 浆体摩阻工作流：各步骤参数的标签、单位后缀；提示写在输入框 placeholder 内 */
const SLURRY_FRICTION_WF_STEP1_FIELDS = [
  {
    name: 'C_w' as const,
    label: '$C_w$：固体质量浓度',
    unit: '无量纲',
    placeholder: '固相质量占比 0～1，如 0.35',
  },
  {
    name: 'rho_g' as const,
    label: '$\\rho_g$：载体（液相）密度',
    unit: 't/m³',
    placeholder: '清水常取 1',
  },
  {
    name: 'rho_s' as const,
    label: '$\\rho_s$：固体颗粒密度',
    unit: 't/m³',
    placeholder: '如 2.65；步骤2 用 kg/m³ 时请 ×1000',
  },
]

const SLURRY_FRICTION_WF_STEP2_FIELDS = [
  {
    name: 'rho_1' as const,
    label: '$\\rho_1$：混合物密度',
    unit: 'kg/m³',
    placeholder: '可直填如 1250；留空则用下方 ρg、ρs、C1v 推算',
  },
  {
    name: 'rho_g' as const,
    label: '$\\rho_g$：液相密度',
    unit: 'kg/m³',
    placeholder: '如 1000；与步骤1 t/m³ 差约 1000 倍',
  },
  {
    name: 'rho_s' as const,
    label: '$\\rho_s$：固相密度',
    unit: 'kg/m³',
    placeholder: '如 2650',
  },
  {
    name: 'C1v' as const,
    label: '$C_{1v}$：液相体积浓度',
    unit: '无量纲',
    placeholder: '液相体积分数 0～1，如 0.85',
  },
  {
    name: 'Re_B' as const,
    label: '$Re_B$：雷诺数',
    unit: '无量纲',
    placeholder: '可直填如 1.2e5；留空则用 V、Dn、η₁ 推算',
  },
  {
    name: 'V' as const,
    label: '$V$：断面平均流速',
    unit: 'm/s',
    placeholder: '与步骤3 同工况，如 2.0',
  },
  {
    name: 'D_n' as const,
    label: '$D_n$：管道内径',
    unit: 'm',
    placeholder: '如 0.20，多与步骤3 的 D 相同',
  },
  {
    name: 'eta_1' as const,
    label: '$\\eta_1$：混合物动力粘度',
    unit: 'Pa·s',
    placeholder: '推算 Re 用，如 0.001',
  },
  {
    name: 'epsilon' as const,
    label: '$\\varepsilon$：管壁绝对粗糙度',
    unit: 'm',
    placeholder: '可不填，默认 0.0002',
  },
]

const SLURRY_FRICTION_WF_STEP3_FIELDS = [
  {
    name: 'rho_k' as const,
    label: '$\\rho_k$：浆体当量密度',
    unit: 't/m³',
    placeholder: '步骤1 可自动填入，或直接填如 1.35',
  },
  {
    name: 'lambda_coef' as const,
    label: '$\\lambda$：达西摩阻系数',
    unit: '无量纲',
    placeholder: '步骤2 可自动填入，或直接填如 0.018',
  },
  {
    name: 'V' as const,
    label: '$V$：平均流速',
    unit: 'm/s',
    placeholder: '与步骤2 一致，如 2.0',
  },
  {
    name: 'D' as const,
    label: '$D$：管道内径',
    unit: 'm',
    placeholder: '如 0.20，多与 Dn 相同',
  },
  {
    name: 'rho_s' as const,
    label: '$\\rho_s$：固体颗粒密度',
    unit: 't/m³',
    placeholder: '与步骤1 同单位，如 2.65',
  },
  {
    name: 'g' as const,
    label: '$g$：重力加速度',
    unit: 'm/s²',
    placeholder: '工程常用 9.81',
  },
]

const SLURRY_FRICTION_WF_STEP_INTROS: Record<'step1' | 'step2' | 'step3', string> = {
  step1:
    '若尚无浆体当量密度 $\\rho_k$，可在此由质量浓度与液、固相密度求得；若已有化验或设计给定值，可跳过本步，在「水力坡降」中直接填写 $\\rho_k$。计算成功后 $\\rho_k$ 会写入最终式，并将本步的 $\\rho_g$、$\\rho_s$ 按 ×1000 换算为 $\\mathrm{kg/m^3}$ 填入达西页（仅当对应格为空时）。',
  step2:
    '达西摩阻系数 $\\lambda$ 是沿程损失的关键量：可直接输入 $\\rho_1$、$Re_B$，或由混合物与流速、管径、粘度推算。成功后 $\\lambda$ 会写入最终式，并在格为空时顺带填入与达西页一致的 $V$、$D$（由 $D_n$）及 $\\rho_s$（$\\mathrm{kg/m^3}\\to\\mathrm{t/m^3}$）。',
  step3:
    '核心结果为单位管长水力坡降 $i_k$（米水柱/米）：将 $\\lambda$、流速、管径与 $\\rho_k$、固相密度、$g$ 代入达西–魏斯巴赫关系。各量均可手填，亦可由前两步计算联动。',
}

/** 清水摩阻：管材类型与海澄–威廉系数 C_h 对应（自定义除外） */
const CLEAR_WATER_CH_PRESET_VALUES: Record<string, number> = {
  plastic140: 140,
  copper130: 130,
  lined130: 130,
  steel100: 100,
}

type ClearWaterChPresetKey = 'plastic140' | 'copper130' | 'lined130' | 'steel100' | 'custom'

const CLEAR_WATER_CH_MENU_ROWS: { key: ClearWaterChPresetKey; prose: string; math: string }[] = [
  { key: 'plastic140', prose: '塑料管、内衬（涂）塑管', math: 'C_h = 140' },
  { key: 'copper130', prose: '铜管、不锈钢管', math: 'C_h = 130' },
  { key: 'lined130', prose: '内衬水泥、树脂铸铁管', math: 'C_h = 130' },
  { key: 'steel100', prose: '普通钢管、铸铁管', math: 'C_h = 100' },
  { key: 'custom', prose: '用户自定义', math: 'C_h' },
]

/** 清水 $C_h$ 下拉：选项内使用 KaTeX（单位与全站一致：在输入控件外右侧 `text-sm` 展示） */
function ClearWaterChPresetMenu({
  darkMode,
  presetKey,
  onPick,
}: {
  darkMode: boolean
  presetKey: string
  onPick: (key: ClearWaterChPresetKey) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = CLEAR_WATER_CH_MENU_ROWS.find((r) => r.key === presetKey) ?? CLEAR_WATER_CH_MENU_ROWS[3]
  const btnCls = `w-full text-left px-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between gap-2 ${
    darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
  }`
  const listCls = `absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border shadow-lg ${
    darkMode ? 'bg-gray-700 border-gray-500' : 'bg-white border-gray-300'
  }`
  const itemCls = `w-full text-left px-3 py-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b last:border-b-0 transition-colors ${
    darkMode
      ? 'border-gray-600 hover:bg-gray-600/80 text-gray-100'
      : 'border-gray-100 hover:bg-slate-50 text-gray-900'
  }`

  return (
    <div className="relative w-full" ref={wrapRef}>
      <button
        type="button"
        className={btnCls}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{current.prose}，</span>
          <InlineMath math={current.math} />
        </span>
        <span className="shrink-0 text-xs opacity-70" aria-hidden>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <ul className={listCls} role="listbox">
          {CLEAR_WATER_CH_MENU_ROWS.map((row) => (
            <li key={row.key} role="option" aria-selected={row.key === presetKey}>
              <button type="button" className={itemCls} onClick={() => { onPick(row.key); setOpen(false) }}>
                <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{row.prose}，</span>
                <InlineMath math={row.math} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 孔板消能三步：参数与结果挂在独立 subId，与 slurry_dissipation_orifice 页面联动 */
const ORIFICE_WORKFLOW_SUB_IDS = ['orifice_step1', 'orifice_step2', 'orifice_step3'] as const

function kPaToFluidHeadM(kpa: number, rhoTPerM3: number, g: number): string {
  if (!Number.isFinite(kpa) || rhoTPerM3 <= 0 || g <= 0) return '—'
  return (kpa / (rhoTPerM3 * g)).toFixed(3)
}

/** 清水 / 浆体 P–L 曲线长度一致时合并为双线图数据 */
function mergePressureCurvesForDualChart(
  slurry: Array<{ L: number; H: number }> | undefined,
  clear: Array<{ L: number; H: number }> | undefined
): Array<{ L: number; Pk?: number; Pw?: number }> {
  if (slurry?.length && clear?.length && slurry.length === clear.length) {
    return slurry.map((p, i) => ({ L: p.L, Pk: p.H, Pw: clear[i]?.H }))
  }
  return []
}

type MunicipalHandbookSpec = { n: number; title: string }

function municipalDocSrc(n: number): string {
  return `./municipal/doc-image${String(n).padStart(2, '0')}.jpeg`
}

/** 列表用缩略路径：info1.jpg → info1-thumb.jpg（同目录放置小图可减轻首屏流量；缺失时自动回退原图） */
function researchThumbFromFull(full: string): string {
  return full.replace(/(\.[^.]+)$/i, '-thumb$1')
}

/** 市政页：全屏查看手册 / 业绩配图 */
function MunicipalImageLightbox({
  open,
  src,
  alt,
  onClose,
}: {
  open: boolean
  src: string | null
  alt: string
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open || !src) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
      <button
        type="button"
        className="absolute top-3 right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white transition hover:bg-white/20"
        onClick={onClose}
        aria-label="关闭"
      >
        ×
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[min(92vh,960px)] max-w-[min(96vw,1200px)] object-contain rounded-lg shadow-2xl ring-1 ring-white/15"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

/** 主持编制标准：自动轮播 + 点击放大 */
function MunicipalHandbookCarousel({
  darkMode,
  specs,
  onImageClick,
  align = 'center',
}: {
  darkMode: boolean
  specs: MunicipalHandbookSpec[]
  onImageClick: (payload: { src: string; alt: string }) => void
  /** 大屏下轮播卡片靠右（与左侧标题对齐、手册区右对齐时使用） */
  align?: 'center' | 'end'
}) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || specs.length <= 1) return
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % specs.length)
    }, 4800)
    return () => window.clearInterval(id)
  }, [paused, specs.length])

  useEffect(() => {
    setIndex((i) => (specs.length ? Math.min(i, specs.length - 1) : 0))
  }, [specs.length])

  if (!specs.length) return null

  const go = (delta: number) => {
    setIndex((i) => (i + delta + specs.length) % specs.length)
  }

  const spec = specs[index]
  const dotActive = darkMode ? 'bg-blue-400 w-7' : 'bg-blue-600 w-7'
  const dotIdle = darkMode ? 'bg-gray-500 hover:bg-gray-400' : 'bg-slate-300 hover:bg-slate-400'

  const navBtnCls = `absolute top-1/2 z-[2] -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border text-lg font-semibold shadow-md transition ${
    darkMode
      ? 'border-gray-500 bg-gray-800/90 text-gray-100 hover:bg-gray-700'
      : 'border-slate-200 bg-white/95 text-slate-700 hover:bg-slate-50'
  }`
  const cardAlignCls =
    align === 'end' ? 'mx-auto lg:ml-auto lg:mr-0' : 'mx-auto lg:mx-0'
  const captionAlignCls = align === 'end' ? 'text-right ml-auto' : 'text-center'

  return (
    <div
      className={align === 'end' ? 'w-full' : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className={`relative w-fit max-w-full overflow-hidden rounded-2xl border shadow-md ${cardAlignCls} ${
          darkMode ? 'border-gray-600 bg-gradient-to-b from-gray-800 to-gray-900' : 'border-slate-200/90 bg-white'
        }`}
      >
        {/* 竖版封面：固定高度 480px，宽度按 3:4 推导（360px），兼顾清晰度与与左侧正文对齐 */}
        <div className="relative aspect-[3/4] h-[480px] w-auto max-w-full">
          {specs.map((h, i) => (
            <div
              key={h.n}
              className={`absolute inset-0 transition-opacity duration-500 ease-out ${
                i === index ? 'z-[1] opacity-100' : 'z-0 opacity-0 pointer-events-none'
              }`}
            >
              <button
                type="button"
                className="block h-full w-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
                onClick={() => onImageClick({ src: municipalDocSrc(h.n), alt: h.title })}
                aria-label={`放大查看：${h.title}`}
              >
                <img
                  src={municipalDocSrc(h.n)}
                  alt={h.title}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  className="h-full w-full cursor-zoom-in rounded-xl object-cover object-top"
                />
              </button>
            </div>
          ))}
        </div>
        {specs.length > 1 && (
          <>
            <button type="button" className={`${navBtnCls} left-2`} onClick={() => go(-1)} aria-label="上一张">
              ‹
            </button>
            <button type="button" className={`${navBtnCls} right-2`} onClick={() => go(1)} aria-label="下一张">
              ›
            </button>
          </>
        )}
      </div>
      <p
        className={`mt-3 min-h-[2.5rem] max-w-[360px] px-1 text-sm sm:text-[15px] font-medium leading-snug ${captionAlignCls} ${
          darkMode ? 'text-gray-200' : 'text-slate-800'
        }`}
      >
        {spec.title}
      </p>
      {specs.length > 1 && (
        <div className={`mt-3 flex gap-2 ${align === 'end' ? 'justify-end' : 'justify-center'}`}>
          {specs.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`第 ${i + 1} 张`}
              aria-current={i === index ? 'true' : undefined}
              className={`h-2 rounded-full transition-all duration-100 ${i === index ? dotActive : `w-2 ${dotIdle}`}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
      <p
        className={`mt-2 text-[11px] ${captionAlignCls} ${darkMode ? 'text-gray-500' : 'text-slate-500'}`}
      >
        自动轮播 · 点击图片放大
      </p>
    </div>
  )
}

// 配置axios默认设置
axios.defaults.timeout = API_TIMEOUT;
axios.defaults.headers.common['Content-Type'] = 'application/json';

interface MainContentProps {
  formula: FormulaInfo | null
  darkMode?: boolean
  currentView?: 'formula' | 'about' | 'settings'
  aboutDepartment?: string | null
  language?: 'zh' | 'en'
  darkModeValue?: boolean
  onDarkModeChange?: (dark: boolean) => void
  onLanguageChange?: (lang: 'zh' | 'en') => void
}

export default function MainContent({ 
  formula, 
  darkMode = false,
  currentView = 'formula',
  aboutDepartment = null,
  language = 'zh',
  darkModeValue = false,
  onDarkModeChange,
  onLanguageChange
}: MainContentProps) {
  // 主内容滚动容器，用于在切换视图/公式时回到顶部
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  // 为每个公式独立存储参数（key是formula.id）
  const [formulaParameters, setFormulaParameters] = useState<Record<string, Record<string, number | undefined>>>({})
  const [formulaRawInputs, setFormulaRawInputs] = useState<Record<string, Record<string, string>>>({})
  const [formulaResults, setFormulaResults] = useState<Record<string, CalculationResult | null>>({})
  const [formulaLockedVc, setFormulaLockedVc] = useState<Record<string, number | null>>({})
  const [kronodzeStep2ReadyMap, setKronodzeStep2ReadyMap] = useState<Record<string, boolean>>({})
  const [kronodzeStep3VisibleMap, setKronodzeStep3VisibleMap] = useState<Record<string, boolean>>({})
  
  // 当前公式的参数（从formulaParameters中获取）
  const parameters = formula ? (formulaParameters[formula.id] || {}) : {}
  const rawInputs = formula ? (formulaRawInputs[formula.id] || {}) : {}
  const result = formula ? (formulaResults[formula.id] || null) : null
  const lockedVc = formula ? (formulaLockedVc[formula.id] || null) : null
  const kronodzeStep2Ready = formula ? (kronodzeStep2ReadyMap[formula.id] || false) : false
  const kronodzeStep3Visible = formula ? (kronodzeStep3VisibleMap[formula.id] || false) : false
  const isSlurryAccelFormula = formula?.id === 'slurry_accel_energy'
  // 名称「浆体消能」作为兜底：防止列表顺序/旧数据导致 id 异常时仍走加速流接口
  /** 缩径消能（原浆体消能计算） */
  const isSlurryDissipationReducer =
    formula?.id === 'slurry_dissipation' || formula?.id === 'slurry_energy_dissipation'
  const isSlurryDissipationOrifice = formula?.id === 'slurry_dissipation_orifice'
  /** 与历史代码兼容：仅缩径消能走消能计算链 */
  const isSlurryDissipationFormula = isSlurryDissipationReducer
  const isSlurryEnergyPlaceholder = false
  const isClearWaterFrictionLoss = formula?.id === 'clear_water_friction_loss'
  const isSlurryFrictionWorkflow = formula?.id === 'slurry_friction_workflow'
  const isPumpHeadPlaceholder =
    formula?.id === 'centrifugal_pump_total_head' ||
    formula?.id === 'positive_displacement_pump_outlet_pressure'
  const isTotalHeadFormula =
    formula?.id === 'slurry_total_head' || formula?.id === 'clear_water_total_head'
  
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  // 锁定临界流速功能
  const [autoCalculateRef, setAutoCalculateRef] = useState<boolean>(false) // 是否自动计算（锁定后参数改变时）
  const [selectedCase, setSelectedCase] = useState<number | null>(null) // 选中的案例分析
  /** 市政事业部页：手册 / 业绩配图点击放大 */
  const [municipalLightbox, setMunicipalLightbox] = useState<{ src: string; alt: string } | null>(null)
  const [zoomPlatformImageUrl, setZoomPlatformImageUrl] = useState<string | null>(null) // 科研平台：弹层内加载的高清图 URL
  const [researchZoomLightboxReady, setResearchZoomLightboxReady] = useState(false)
  /** 缩略图 404 或损坏时回退为高清路径（仅影响列表小图，弹层始终高清） */
  const [researchThumbFallbackByKey, setResearchThumbFallbackByKey] = useState<Record<string, boolean>>({})
  /** 科研平台图按中心分别记录是否已解码，避免切换标签时重复「加载中」闪烁（缓存命中即秒显） */
  const [researchPlatformImageLoadedByKey, setResearchPlatformImageLoadedByKey] = useState<
    Record<string, boolean>
  >({})
  const [isAnimationFullscreen, setIsAnimationFullscreen] = useState(false) // 动画全屏展示（弹层）
  const [fullscreenAnimationType, setFullscreenAnimationType] = useState<string | null>(null)
  const [fullscreenStatusText, setFullscreenStatusText] = useState<string>('')
  const [fullscreenStatusColor, setFullscreenStatusColor] = useState<string>('')
  /** 浆体消能：步骤1 成功后自动写入的 K_QL（按 formula.id），用于提示是否与步骤1同步 */
  const dissipationAutoKqlRef = useRef<Record<string, number | null>>({})
  /** 与 ref 同步的状态，便于根据「是否与步骤1一致」刷新 UI */
  const [dissipationStep1AutoKqlByFormula, setDissipationStep1AutoKqlByFormula] = useState<
    Record<string, number>
  >({})
  /** 步骤1 成功后锁定分子/分母等展示，避免第二步响应带 K_QL 时后端标记 direct 导致中间项消失 */
  const [dissipationStep1IxCacheByFormula, setDissipationStep1IxCacheByFormula] = useState<
    Record<
      string,
      {
        numerator: number
        denominator: number
        ld: number
        Ls: number
        d: number
        fromBackend: boolean
      }
    >
  >({})

  // 更新检查相关状态
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'>('idle')
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; releaseNotes?: string } | null>(null)
  const [updateProgress, setUpdateProgress] = useState<number>(0)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string>('')

  // 与公式计算页一致：主栏用 w-full 对齐侧栏边界，勿用 100vw（与侧栏不同步会产生错位/假边距）
  const mainScrollClassName = `flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`
  const contentWrapperClassName = 'w-full max-w-[1440px] mx-auto box-border px-6 py-6'
  const mainPanelCardClassName = `rounded-lg shadow-sm border p-5 mb-5 ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'}`
  
  // 更新当前公式参数的辅助函数
  const updateParameters = (updater: (prev: Record<string, number | undefined>) => Record<string, number | undefined>) => {
    if (!formula) return
    setFormulaParameters(prev => ({
      ...prev,
      [formula.id]: updater(prev[formula.id] || {})
    }))
  }
  
  const updateRawInputs = (updater: (prev: Record<string, string>) => Record<string, string>) => {
    if (!formula) return
    setFormulaRawInputs(prev => ({
      ...prev,
      [formula.id]: updater(prev[formula.id] || {})
    }))
  }
  
  const updateResult = (value: CalculationResult | null) => {
    if (!formula) return
    setFormulaResults(prev => ({
      ...prev,
      [formula.id]: value
    }))
  }
  
  const updateLockedVc = (value: number | null) => {
    if (!formula) return
    setFormulaLockedVc(prev => ({
      ...prev,
      [formula.id]: value
    }))
  }

  const updateKronodzeStep2Ready = (value: boolean) => {
    if (!formula) return
    setKronodzeStep2ReadyMap(prev => ({
      ...prev,
      [formula.id]: value
    }))
  }

  const updateKronodzeStep3Visible = (value: boolean) => {
    if (!formula) return
    setKronodzeStep3VisibleMap(prev => ({
      ...prev,
      [formula.id]: value
    }))
  }

  // 切换 Sidebar 视图、公司介绍/科研中心或公式时，主内容滚动回顶部，避免从中间位置开始显示
  useEffect(() => {
    const el = scrollContainerRef.current
    if (el) {
      el.scrollTop = 0
    }
  }, [currentView, formula?.id, aboutDepartment])

  useEffect(() => {
    if (currentView !== 'about' || aboutDepartment !== 'municipal') {
      setMunicipalLightbox(null)
    }
  }, [currentView, aboutDepartment])

  // 渲染包含LaTeX数学符号的描述文本（$...$ 内为 KaTeX，与中文混排）
  const renderDescriptionWithMath = (text: string): JSX.Element => {
    const parts: (string | JSX.Element)[] = []
    const regex = /\$([^$]+)\$/g
    let lastIndex = 0
    let match
    let key = 0

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index))
      }
      parts.push(<InlineMath key={`m${key++}`} math={match[1]} />)
      lastIndex = regex.lastIndex
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex))
    }

    if (parts.length === 0) {
      return <span className="param-label-math param-label-math--prose">{text}</span>
    }

    return (
      <span className="param-label-math param-label-math--prose">
        {parts.map((p, i) => (typeof p === 'string' ? <span key={`t${i}`}>{p}</span> : p))}
      </span>
    )
  }

  // 将中间计算结果的key转换为中文显示名称（使用LaTeX数学符号）
  // formulaId 用于区分不同公式中同名key的不同数学形式（如 bracket_term 在费祥俊与瓦斯普中不同）
  const getIntermediateLabel = (key: string, formulaId?: string): JSX.Element | string => {
    const labelMap: Record<string, string> = {
      // 通用项
      'delta_rho_ratio': '相对密度差',
      'density_ratio': '密度比',
      'coefficient': '经验系数',
      'g': '重力加速度',
      
      // 刘德忠公式
      'core_term': '核心项',
      'concentration_term': '浓度修正项',
      'velocity_ratio_term': '速度比修正项',
      
      // E.J.瓦斯普公式
      'bracket_term': '核心项',
      'size_ratio_term': '粒径比修正项',
      
      // 费祥俊公式
      'conc_term': '浓度修正项',
      'size_term': '粒径比修正项',
      'leading_coef': '核心系数',
      'coefficient_2_26': '经验系数',
      'lambda_coef': '达西摩阻系数',
      
      // 克诺罗兹法（公式中间项）
      'term_cd': '浓度修正项',
      'term_dl': '管径修正项',
      'sqrt_term': '平方根项',
      'sin_theta': 'sin(θ)',
      'step_A_Qk': '矿浆流量',
      'step_B_DL_mm': '临界管径',
      'Cd': '重量砂水比 C_d',
      'step_C_V_L': '步骤C 临界流速 V_L',
      
      // 沿程摩阻损失：i_k = λ·(V²·ρ_k)/(2gD·ρ_s)
      'numerator': '流速平方与浆体密度项',
      'denominator': '重力与管径项',
      
      // 密度混合公式：ρ_k = 1/(Cw/ρg+(1-Cw)/ρs)，混合项为浓度与密度加权倒数
      'denom': '浓度与密度加权倒数项',
      
      // 达西摩阻系数公式
      'Re': '雷诺数',
      'flow_regime': '流态',
      'eps_D': '相对粗糙度 ε/D',
      
      // 浆体加速流
      'head_diff': '左侧总水头差',
      'friction_loss_total': '右侧摩阻损失 iL',

      // 浆体消能（与通用中间结果网格共用 getIntermediateLabel）
      'dissipation_kql_numerator': '分子',
      'dissipation_kql_denominator': '分母',
      'dissipation_q_squared': '流量平方',
      'clear_hw_ch_pow': '海澄系数幂项',
      'clear_hw_dj_pow': '内径幂项',
      'clear_hw_qg_pow': '流量幂项',
    }
    
    let label = labelMap[key] || key
    if (key === 'bracket_term' && formulaId === 'kronodze_pressure') label = '综合修正项'

    // 根据key返回对应的数学公式显示（bracket_term 在费祥俊、瓦斯普、克诺罗兹中形式不同）
    const bracketFormula = formulaId === 'kronodze_pressure'
      ? '1+2.48\\sqrt[3]{C_d}\\sqrt[4]{D_L}'
      : formulaId === 'fei_xiangjun'
        ? '[g \\cdot D \\cdot \\frac{\\Delta\\rho}{\\rho} \\cdot \\omega]^{1/2}'  // 费祥俊：含 ω
        : '[2 \\cdot g \\cdot D \\cdot \\frac{\\Delta\\rho}{\\rho}]^{1/2}';       // E.J.瓦斯普
    const mathFormulas: Record<string, string> = {
      'delta_rho_ratio': '\\frac{\\Delta\\rho}{\\rho}',
      'density_ratio': '\\frac{\\Delta\\rho}{\\rho}',
      'g': 'g',
      'core_term': '[g \\cdot D \\cdot \\frac{\\Delta\\rho}{\\rho} \\cdot \\omega]^{1/3}',
      // E.J.瓦斯普公式：浓度修正项为 Cv^0.1858（根据后端计算）
      'concentration_term': 'C_v^{0.1858}',
      'velocity_ratio_term': '(\\frac{\\omega_s}{\\omega})^{1/6}',
      'bracket_term': bracketFormula,
      'size_ratio_term': '(\\frac{d_{85}}{D})^{1/6}',
      'conc_term': 'C_v^{0.25}',
      'size_term': '(\\frac{d_{90}}{D})^{1/3}',
      'leading_coef': '\\frac{2.26}{\\sqrt{\\lambda}}',
      'coefficient_2_26': '2.26',
      'lambda_coef': '\\lambda',
      'term_cd': '\\sqrt[3]{C_d}',
      'term_dl': '\\sqrt[4]{D_L}',
      'step_A_Qk': 'Q_k',
      'step_B_DL_mm': 'D_L',
      'sqrt_term': '\\sqrt{gD \\cdot \\frac{\\Delta\\rho}{\\rho}}',
      'sin_theta': '\\sin(\\theta)',
      'numerator': 'V^2 \\cdot \\rho_k',
      'denominator': '2gD \\cdot \\rho_s',
      'denom': '\\frac{C_w}{\\rho_g} + \\frac{1-C_w}{\\rho_s}',
      'dissipation_kql_numerator': '(6.3755\\times10^{-9})\\lambda_d L_s',
      'dissipation_kql_denominator': 'd^5',
      'clear_hw_ch_pow': 'C_h^{-1.85}',
      'clear_hw_dj_pow': 'd_j^{-4.87}',
      'clear_hw_qg_pow': 'q_g^{1.85}',
    }
    
    let mathFormula = mathFormulas[key]
    // 刘德忠公式的浓度修正项为 C_v^{1/6}，瓦斯普公式为 C_v^{0.1858}
    if (key === 'concentration_term') {
      mathFormula = formulaId === 'liu_dezhong' ? 'C_v^{1/6}' : 'C_v^{0.1858}'
    }
    
    if (mathFormula) {
      return (
        <span className="inline-flex items-baseline gap-x-1">
          <span>{label}:</span>
          <InlineMath math={mathFormula} />
        </span>
      )
    }
    
    // 没有数学公式的项，返回不带冒号的字符串（冒号会在显示时统一添加）
    return label
  }

  // 将公式文本转换为LaTeX格式
  const convertFormulaToLatex = (formulaText: string): string => {
    let latex = formulaText
      // 先处理复杂的替换，避免被后续规则覆盖
      .replace(/ω_s/g, '\\omega_s')
      .replace(/ωs/g, '\\omega_s')
      .replace(/Δρ/g, '\\Delta\\rho')
      .replace(/\(Δρ\/ρ\)/g, '\\frac{\\Delta\\rho}{\\rho}')
      .replace(/ρg/g, '\\rho_g')
      .replace(/ρk/g, '\\rho_k')
      .replace(/ρ/g, '\\rho')
      .replace(/ω/g, '\\omega')
      .replace(/λ/g, '\\lambda')
      .replace(/β/g, '\\beta')
      .replace(/·/g, ' \\cdot ')
      .replace(/√/g, '\\sqrt')
      .replace(/\bQk\b/g, 'Q_k')
      .replace(/\bCd\b/g, 'C_d')
      .replace(/\bDL\b/g, 'D_L')
      .replace(/\bV_L\b/g, 'V_L')
      // 处理分数形式 (a/b) 或 (ps - pl)/pl
      .replace(/\(([^()]+)\/([^()]+)\)/g, '\\frac{$1}{$2}')
      // 处理次方：先处理分数次方 ^(1/3) 或 ^(1/6) 或 ^(1/2)
      .replace(/\^\((\d+)\/(\d+)\)/g, '^{\\frac{$1}{$2}}')
      // 处理小数次方（如 ^0.1858），必须在整数次方之前处理
      .replace(/\^(\d+\.\d+)/g, '^{$1}')
      // 处理整数次方（如 ^2, ^3）
      .replace(/\^(\d+)/g, '^{$1}')
      // 替换 Cv（必须在次方处理之后，避免影响 Cv^0.1858）
      .replace(/Cv/g, 'C_v')
      // 替换 d85, d90（必须在次方处理之后）
      .replace(/d85/g, 'd_{85}')
      .replace(/d90/g, 'd_{90}')
      // 替换乘法符号
      .replace(/\*\s*/g, ' \\cdot ')
      // 处理sqrt函数
      .replace(/sqrt\(([^)]+)\)/g, '\\sqrt{$1}')
      // 处理sin函数
      .replace(/sin\(([^)]+)\)/g, '\\sin($1)')
      // 确保等号两边有空格
      .replace(/=/g, ' = ')
      // 清理多余空格
      .replace(/\s+/g, ' ')
      .trim()
    
    return latex
  }

  // 获取当前版本号
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.update) {
      (window as any).electronAPI.update.getAppVersion().then((version: string) => {
        setCurrentVersion(version)
      }).catch(() => {
        setCurrentVersion('1.0.0')
      })
    } else {
      setCurrentVersion('1.0.0')
    }
  }, [])

  // 了解我们-科研：仅预加载缩略图，避免启动时拉满幅高清拖慢首屏（高清在点击放大时再请求）
  useEffect(() => {
    const urls = [
      './info1-thumb.jpg',
      './info2-thumb.jpg',
      './info3-thumb.jpg',
      './info4-thumb.jpg',
      './info5-thumb.jpg',
    ]
    urls.forEach((src) => {
      const img = new Image()
      img.src = src
    })
  }, [])

  useEffect(() => {
    if (zoomPlatformImageUrl) setResearchZoomLightboxReady(false)
  }, [zoomPlatformImageUrl])

  // 设置更新事件监听器
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.update) {
      return
    }

    const electronAPI = (window as any).electronAPI.update

    electronAPI.onUpdateChecking(() => {
      setUpdateStatus('checking')
      setUpdateError(null)
    })

    electronAPI.onUpdateAvailable((info: any) => {
      setUpdateStatus('available')
      setUpdateInfo({
        version: info.version,
        releaseNotes: info.releaseNotes
      })
    })

    electronAPI.onUpdateNotAvailable((info: any) => {
      setUpdateStatus('idle')
      setUpdateInfo({ version: info.version })
    })

    electronAPI.onUpdateError((error: any) => {
      setUpdateStatus('error')
      setUpdateError(error.message || '更新检查失败')
    })

    electronAPI.onUpdateDownloadProgress((progress: any) => {
      setUpdateStatus('downloading')
      setUpdateProgress(progress.percent || 0)
    })

    electronAPI.onUpdateDownloaded((info: any) => {
      setUpdateStatus('downloaded')
      setUpdateInfo({ version: info.version })
    })

    return () => {
      // 清理监听器
      electronAPI.removeAllListeners('update-checking')
      electronAPI.removeAllListeners('update-available')
      electronAPI.removeAllListeners('update-not-available')
      electronAPI.removeAllListeners('update-error')
      electronAPI.removeAllListeners('update-download-progress')
      electronAPI.removeAllListeners('update-downloaded')
    }
  }, [])

  // 动画全屏：Esc 退出
  useEffect(() => {
    if (!isAnimationFullscreen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAnimationFullscreen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isAnimationFullscreen])

  // 检查更新
  const handleCheckForUpdates = async () => {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.update) {
      setUpdateError('当前环境不支持自动更新')
      setUpdateStatus('error')
      return
    }

    try {
      setUpdateStatus('checking')
      setUpdateError(null)
      const result = await (window as any).electronAPI.update.checkForUpdates()
      if (result.error) {
        setUpdateStatus('error')
        setUpdateError(result.error)
      }
    } catch (error: any) {
      setUpdateStatus('error')
      setUpdateError(error.message || '检查更新失败')
    }
  }

  const renderFlowAnimation = (animationType: string, statusColor: string, size: 'small' | 'full') => {
    const boxBase =
      size === 'full'
        ? 'w-full h-[60vh] sm:h-[70vh] rounded-xl border-2 relative overflow-hidden'
        : 'w-full h-20 rounded border-2 relative overflow-hidden'

    const borderCls =
      animationType === 'settle-30'
        ? 'border-red-500'
        : animationType === 'settle-20'
        ? 'border-orange-400'
        : animationType === 'settle-10-flow'
        ? 'border-yellow-400'
        : animationType === 'still-flow'
        ? 'border-blue-400'
        : 'border-green-500'

    const bgCls =
      animationType === 'settle-30'
        ? 'bg-red-50'
        : animationType === 'settle-20'
        ? 'bg-orange-50'
        : animationType === 'settle-10-flow'
        ? 'bg-yellow-50'
        : animationType === 'still-flow'
        ? 'bg-blue-50'
        : 'bg-green-50'

    const label =
      animationType === 'settle-30'
        ? '严重沉降'
        : animationType === 'settle-20'
        ? '中度沉降'
        : animationType === 'settle-10-flow'
        ? '轻度沉降'
        : animationType === 'still-flow'
        ? '临界状态'
        : animationType === 'medium-flow'
        ? '正常流动'
        : '快速流动'

    const scale = size === 'full' ? 1.8 : 1
    const particleCount = animationType === 'settle-30' ? 25 : 20

    return (
      <div className="flex flex-col items-center w-full">
        <div className={`${boxBase} ${bgCls} ${borderCls}`}>
          <div className="absolute inset-0">
            {animationType === 'settle-30' ? (
              <>
                <div className="absolute inset-0 bg-gradient-to-b from-red-400 via-red-500 to-red-600 z-0"></div>
                <div
                  className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-700 via-amber-600 to-amber-500 z-10"
                  style={{ height: '30%', opacity: 0.7 }}
                ></div>
                {[...Array(particleCount)].map((_, i) => {
                  const sizePx = (0.8 + (i % 3) * 0.4) * 3 * scale
                  const seed1 = (i * 13 + 19) % 97
                  const seed2 = (i * 23 + 29) % 89
                  const seed3 = (i * 17 + 31) % 73
                  const startLeft = 3 + ((seed1 * seed2) % 94)
                  const heightSeed = (seed1 * seed2 * seed3) % 100
                  let particleBottom: number
                  if (heightSeed < 50) particleBottom = (heightSeed / 50) * 10
                  else if (heightSeed < 80) particleBottom = 10 + ((heightSeed - 50) / 30) * 10
                  else particleBottom = 20 + ((heightSeed - 80) / 20) * 10
                  return (
                    <div
                      key={`settled-${i}`}
                      className="absolute bg-amber-800 rounded-full z-20"
                      style={{
                        width: `${sizePx}px`,
                        height: `${sizePx}px`,
                        left: `${startLeft}%`,
                        bottom: `${particleBottom}%`,
                      }}
                    ></div>
                  )
                })}
              </>
            ) : animationType === 'settle-20' ? (
              <>
                <div
                  className="absolute inset-0 bg-gradient-to-b from-orange-200 via-orange-300 to-orange-400"
                  style={{
                    animation: 'flow-vertical 3s linear infinite',
                    backgroundSize: '100% 200%',
                  }}
                ></div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-700 via-amber-600 to-amber-500" style={{ height: '20%' }}></div>
                {[...Array(20)].map((_, i) => {
                  const sizePx = (0.8 + (i % 4) * 0.3) * 3 * scale
                  const seed1 = (i * 17 + 23 + Math.floor(i / 3) * 7) % 97
                  const seed2 = (i * 31 + 41 + Math.floor(i / 5) * 11) % 89
                  const seed3 = (i * 13 + 19) % 73
                  const startLeft = 2 + ((seed1 * seed3) % 96)
                  const startTop = 2 + ((seed2 * seed3) % 93)
                  const animationDuration = 3.5
                  return (
                    <div
                      key={i}
                      className="absolute bg-blue-800 rounded-full"
                      style={{
                        width: `${sizePx}px`,
                        height: `${sizePx}px`,
                        left: `${startLeft}%`,
                        top: `${startTop}%`,
                        animation: `particle-settle-medium ${animationDuration}s ease-in-out infinite`,
                        animationDelay: `${i * 0.05}s`,
                      }}
                    ></div>
                  )
                })}
              </>
            ) : animationType === 'settle-10-flow' ? (
              <>
                <div
                  className="absolute inset-0 bg-gradient-to-b from-yellow-200 via-yellow-300 to-yellow-200"
                  style={{
                    animation: 'flow-vertical 4s linear infinite',
                    backgroundSize: '100% 200%',
                  }}
                ></div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-700 via-amber-600 to-amber-500" style={{ height: '10%' }}></div>
                {[...Array(20)].map((_, i) => {
                  const sizePx = (0.8 + (i % 4) * 0.3) * 3 * scale
                  const seed1 = (i * 17 + 23 + Math.floor(i / 3) * 7) % 97
                  const seed2 = (i * 31 + 41 + Math.floor(i / 5) * 11) % 89
                  const seed3 = (i * 13 + 19) % 73
                  const startLeft = 2 + ((seed1 * seed3) % 96)
                  const startTop = 2 + ((seed2 * seed3) % 93)
                  const animationDuration = 4
                  return (
                    <div
                      key={i}
                      className="absolute bg-blue-800 rounded-full"
                      style={{
                        width: `${sizePx}px`,
                        height: `${sizePx}px`,
                        left: `${startLeft}%`,
                        top: `${startTop}%`,
                        animation: `particle-settle-light ${animationDuration}s ease-in-out infinite`,
                        animationDelay: `${i * 0.05}s`,
                      }}
                    ></div>
                  )
                })}
              </>
            ) : animationType === 'still-flow' ? (
              <>
                <div className="absolute inset-0 bg-gradient-to-b from-blue-300 via-blue-400 to-blue-300"></div>
                {[...Array(20)].map((_, i) => {
                  const sizePx = (0.8 + (i % 4) * 0.3) * 3 * scale
                  const seed1 = (i * 17 + 23 + Math.floor(i / 3) * 7) % 97
                  const seed2 = (i * 31 + 41 + Math.floor(i / 5) * 11) % 89
                  const seed3 = (i * 13 + 19) % 73
                  const startLeft = 2 + ((seed1 * seed3) % 96)
                  const startTop = 2 + ((seed2 * seed3) % 93)
                  const animationDuration = 4 + (i % 5) * 0.4
                  return (
                    <div
                      key={i}
                      className="absolute bg-blue-800 rounded-full"
                      style={{
                        width: `${sizePx}px`,
                        height: `${sizePx}px`,
                        left: `${startLeft}%`,
                        top: `${startTop}%`,
                        animation: `particle-flow-still ${animationDuration}s ease-in-out infinite`,
                        animationDelay: `${i * 0.2}s`,
                      }}
                    ></div>
                  )
                })}
              </>
            ) : animationType === 'medium-flow' ? (
              <>
                {/* 正常流动：液体整体由左向右流动 */}
                <div
                  className="absolute inset-0 bg-gradient-to-r from-green-300 via-green-400 to-green-300"
                  style={{ animation: 'flow-slow 2s linear infinite', backgroundSize: '200% 100%' }}
                ></div>
                {[...Array(20)].map((_, i) => {
                  const sizePx = (0.8 + (i % 4) * 0.3) * 3 * scale
                  const seed1 = (i * 17 + 23 + Math.floor(i / 3) * 7) % 97
                  const seed2 = (i * 31 + 41 + Math.floor(i / 5) * 11) % 89
                  const seed3 = (i * 13 + 19) % 73
                  const startLeft = 2 + ((seed1 * seed3) % 96)
                  const startTop = 2 + ((seed2 * seed3) % 93)
                  const animationDuration = 2.5 + (i % 5) * 0.25
                  return (
                    <div
                      key={i}
                      className="absolute bg-blue-800 rounded-full"
                      style={{
                        width: `${sizePx}px`,
                        height: `${sizePx}px`,
                        left: `${startLeft}%`,
                        top: `${startTop}%`,
                        animation: `particle-flow-medium ${animationDuration}s ease-in-out infinite`,
                        animationDelay: `${i * 0.15}s`,
                      }}
                    ></div>
                  )
                })}
              </>
            ) : (
              <>
                {/* 快速流动：液体更快由左向右流动 */}
                <div
                  className="absolute inset-0 bg-gradient-to-r from-green-300 via-green-400 to-green-300"
                  style={{ animation: 'flow-fast 1.5s linear infinite', backgroundSize: '200% 100%' }}
                ></div>
                {[...Array(20)].map((_, i) => {
                  const sizePx = (0.8 + (i % 4) * 0.3) * 3 * scale
                  const seed1 = (i * 17 + 23 + Math.floor(i / 3) * 7) % 97
                  const seed2 = (i * 31 + 41 + Math.floor(i / 5) * 11) % 89
                  const seed3 = (i * 13 + 19) % 73
                  const startLeft = 2 + ((seed1 * seed3) % 96)
                  const startTop = 2 + ((seed2 * seed3) % 93)
                  const animationDuration = 2.0 + (i % 5) * 0.2
                  return (
                    <div
                      key={i}
                      className="absolute bg-blue-800 rounded-full"
                      style={{
                        width: `${sizePx}px`,
                        height: `${sizePx}px`,
                        left: `${startLeft}%`,
                        top: `${startTop}%`,
                        animation: `particle-flow-fast ${animationDuration}s ease-in-out infinite`,
                        animationDelay: `${i * 0.12}s`,
                      }}
                    ></div>
                  )
                })}
              </>
            )}
          </div>
        </div>
        <span className={`text-xs font-medium ${statusColor} mt-2`}>{label}</span>
      </div>
    )
  }

  // 下载更新
  const handleDownloadUpdate = async () => {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.update) {
      return
    }

    try {
      setUpdateStatus('downloading')
      setUpdateProgress(0)
      await (window as any).electronAPI.update.downloadUpdate()
    } catch (error: any) {
      setUpdateStatus('error')
      setUpdateError(error.message || '下载更新失败')
    }
  }

  // 安装更新
  const handleInstallUpdate = async () => {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.update) {
      return
    }

    try {
      await (window as any).electronAPI.update.installUpdate()
    } catch (error: any) {
      setUpdateError(error.message || '安装更新失败')
    }
  }

  // 初始化参数值（切换公式时只清除计算结果和锁定状态，保留用户输入的参数）
  useEffect(() => {
    if (formula) {
      const formulaId = formula.id
      
      // 如果该公式还没有参数记录，初始化它
      setFormulaParameters(prev => {
        if (prev[formulaId]) {
          // 如果已有记录，只设置新公式中还没有值的参数的默认值
          const currentParams = prev[formulaId]
          const newParams = { ...currentParams }
          formula.parameters.forEach(param => {
            if (param.default !== undefined && (newParams[param.name] === undefined || newParams[param.name] === null)) {
              newParams[param.name] = param.default
            }
          })
          if (formulaId === 'kronodze_pressure' && (newParams['dp'] === undefined || newParams['dp'] === null || isNaN(newParams['dp'] as number))) {
            newParams['dp'] = 0.07
          }
          if (formulaId === 'clear_water_friction_loss') {
            if (newParams['C_h'] === undefined || newParams['C_h'] === null || isNaN(newParams['C_h'] as number)) {
              newParams['C_h'] = 100
            }
            if (newParams['K_hw'] === undefined || newParams['K_hw'] === null || isNaN(newParams['K_hw'] as number)) {
              newParams['K_hw'] = 105
            }
          }
          return { ...prev, [formulaId]: newParams }
        } else {
          // 如果没有记录，初始化所有默认值
          const initialParams: Record<string, number | undefined> = {}
          formula.parameters.forEach(param => {
            if (param.default !== undefined) {
              initialParams[param.name] = param.default
            }
          })
          if (formulaId === 'kronodze_pressure') {
            initialParams['dp'] = 0.07
          }
          if (formulaId === 'clear_water_friction_loss') {
            initialParams['C_h'] = 100
            if (initialParams['K_hw'] === undefined || initialParams['K_hw'] === null) {
              initialParams['K_hw'] = 105
            }
          }
          return { ...prev, [formulaId]: initialParams }
        }
      })
      
      setFormulaRawInputs(prev => {
        if (prev[formulaId]) {
          // 如果已有记录，只设置新公式中还没有值的参数的默认值
          const currentRaw = prev[formulaId]
          const newRaw = { ...currentRaw }
          formula.parameters.forEach(param => {
            if (param.default !== undefined && !newRaw[param.name]) {
              newRaw[param.name] = String(param.default)
            }
          })
          if (formulaId === 'kronodze_pressure' && !newRaw['dp']) {
            newRaw['dp'] = '0.07'
          }
          if (formulaId === 'clear_water_friction_loss') {
            if (!newRaw['ch_preset']) newRaw['ch_preset'] = 'steel100'
            if (!newRaw['C_h']) newRaw['C_h'] = '100'
            if (!newRaw['K_hw']) newRaw['K_hw'] = '105'
          }
          return { ...prev, [formulaId]: newRaw }
        } else {
          // 如果没有记录，初始化所有默认值
          const initialRaw: Record<string, string> = {}
          formula.parameters.forEach(param => {
            if (param.default !== undefined) {
              initialRaw[param.name] = String(param.default)
            }
          })
          if (formulaId === 'kronodze_pressure') {
            initialRaw['dp'] = '0.07'
          }
          if (formulaId === 'clear_water_friction_loss') {
            initialRaw['C_h'] = '100'
            initialRaw['ch_preset'] = 'steel100'
            if (!initialRaw['K_hw']) initialRaw['K_hw'] = '105'
            initialRaw['d_j'] = initialRaw['d_j'] ?? ''
            initialRaw['q_g'] = initialRaw['q_g'] ?? ''
          }
          return { ...prev, [formulaId]: initialRaw }
        }
      })
      
      // 切换公式时清除锁定状态，但保留用户输入的参数和计算结果
      updateLockedVc(null)
      setAutoCalculateRef(false)
      if (formula.id === 'kronodze_pressure') {
        updateKronodzeStep2Ready(false)
        updateKronodzeStep3Visible(false)
      }
    }
    // 仅随公式 id 变化初始化，避免父组件传入的 formula 对象引用变化时误清锁定状态
  }, [formula?.id])

  // 当参数改变且已锁定时，自动重新计算并比较
  useEffect(() => {
    if (lockedVc !== null && formula && autoCalculateRef) {
      // 检查所有必填参数是否已填写
      const allParamsFilled = formula.parameters.every(param => {
        const value = parameters[param.name]
        return param.default !== undefined || (value !== undefined && value !== null && !isNaN(value))
      })
      
      if (allParamsFilled) {
        // 延迟一下，避免频繁计算
        const timer = setTimeout(() => {
          handleCalculate(true).catch(err => {
            console.error('自动计算失败:', err)
          })
        }, 500)
        return () => clearTimeout(timer)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parameters, lockedVc, formula, autoCalculateRef])

  const normalizeDecimalInput = (value: string) => {
    // 兼容中文/欧式小数分隔符：将 “，” 或 “,” 统一为 “.”
    return value.replace(/，/g, ',').replace(/,/g, '.')
  }

  const showAppAlert = async (message: string, detail?: string) => {
    const electronAPI = (window as any).electronAPI
    if (electronAPI?.showAlert) {
      await electronAPI.showAlert({
        title: 'CINF Flow Calculation Tool',
        message,
        detail: detail || ''
      })
      return
    }
    alert(detail ? `${message}\n\n${detail}` : message)
  }

  const handleParameterChange = (name: string, value: string) => {
    // 先保存原始文本，避免 type="number" 在部分系统下不接受 “.”
    if (!formula) return
    updateRawInputs(prev => ({ ...prev, [name]: value }))

    if (value === '') {
      updateParameters(prev => ({ ...prev, [name]: undefined }))
      if (formula.id === 'kronodze_pressure') {
        updateKronodzeStep2Ready(false)
        updateKronodzeStep3Visible(false)
        updateLockedVc(null)
        setAutoCalculateRef(false)
      }
      return
    }

    const normalized = normalizeDecimalInput(value.trim())

    // 允许用户输入中间态：比如 "-"、"."、"1."，这时不立刻覆盖数值
    if (normalized === '-' || normalized === '.' || normalized === '-.') return

    // 只接受标准数字格式
    if (!/^-?\d+(\.\d*)?$/.test(normalized)) return

    const numValue = parseFloat(normalized)
    if (isNaN(numValue)) return

    // 保留最多 6 位小数
    const rounded = Math.round(numValue * 1e6) / 1e6
    updateParameters(prev => ({ ...prev, [name]: rounded }))
    if (formula.id === 'kronodze_pressure') {
      updateKronodzeStep2Ready(false)
      updateKronodzeStep3Visible(false)
      updateLockedVc(null)
      setAutoCalculateRef(false)
    }
  }

  const handleParameterBlur = (name: string) => {
    if (!formula) return
    
    const raw = rawInputs[name]
    if (raw === undefined) return
    if (raw.trim() === '') {
      updateRawInputs(prev => ({ ...prev, [name]: '' }))
      return
    }

    const normalized = normalizeDecimalInput(raw.trim())
    const numValue = parseFloat(normalized)
    if (isNaN(numValue)) return

    const rounded = Math.round(numValue * 1e6) / 1e6
    updateRawInputs(prev => ({ ...prev, [name]: String(rounded) }))
    updateParameters(prev => ({ ...prev, [name]: rounded }))
  }

  /** 浆体摩阻工作流：子步骤参数写入 formulaParameters[subId] */
  const handleSubParameterChange = (subId: string, name: string, value: string) => {
    setFormulaRawInputs((prev) => ({
      ...prev,
      [subId]: { ...(prev[subId] || {}), [name]: value }
    }))
    if (value === '') {
      setFormulaParameters((prev) => ({
        ...prev,
        [subId]: { ...(prev[subId] || {}), [name]: undefined }
      }))
      return
    }
    const normalized = normalizeDecimalInput(value.trim())
    if (normalized === '-' || normalized === '.' || normalized === '-.') return
    if (!/^-?\d+(\.\d*)?$/.test(normalized)) return
    const numValue = parseFloat(normalized)
    if (isNaN(numValue)) return
    const rounded = Math.round(numValue * 1e6) / 1e6
    setFormulaParameters((prev) => ({
      ...prev,
      [subId]: { ...(prev[subId] || {}), [name]: rounded }
    }))
  }

  const handleSubParameterBlur = (subId: string, name: string) => {
    const raw = formulaRawInputs[subId]?.[name]
    if (raw === undefined) return
    if (raw.trim() === '') return
    const normalized = normalizeDecimalInput(raw.trim())
    const numValue = parseFloat(normalized)
    if (isNaN(numValue)) return
    const rounded = Math.round(numValue * 1e6) / 1e6
    setFormulaRawInputs((prev) => ({
      ...prev,
      [subId]: { ...(prev[subId] || {}), [name]: String(rounded) }
    }))
    setFormulaParameters((prev) => ({
      ...prev,
      [subId]: { ...(prev[subId] || {}), [name]: rounded }
    }))
  }

  const validateFrictionSubStep = (subId: string): string | null => {
    const p = formulaParameters[subId] || {}
    if (subId === 'density_mixing') {
      const Cw = p['C_w']
      if (Cw == null || isNaN(Cw) || Cw < 0 || Cw > 1) return '步骤1：固体质量浓度 C_w 应在 0～1 之间'
      if (p['rho_g'] == null || isNaN(p['rho_g']!) || p['rho_g']! <= 0) return '步骤1：请填写 ρ_g'
      if (p['rho_s'] == null || isNaN(p['rho_s']!) || p['rho_s']! <= 0) return '步骤1：请填写 ρ_s'
      return null
    }
    if (subId === 'darcy_friction') {
      const rho1 = p['rho_1']
      const hasRho1 = rho1 != null && !isNaN(rho1) && rho1 > 0
      const hasStepA = [p['rho_g'], p['rho_s'], p['C1v']].every((v) => v != null && !isNaN(v!))
      if (!hasRho1 && !hasStepA) return '步骤2：请输入 ρ₁，或填写 ρ_g、ρ_s、C1v'
      const ReB = p['Re_B']
      const hasReB = ReB != null && !isNaN(ReB) && ReB > 0
      const hasStepB = [p['V'], p['D_n'], p['eta_1']].every((v) => v != null && !isNaN(v!))
      if (!hasReB && !hasStepB) return '步骤2：请输入 Re_B，或填写 V、D_n、η₁'
      const Dn = p['D_n']
      if (Dn == null || isNaN(Dn) || Dn <= 0) return '步骤2：请填写管道内径 D_n'
      return null
    }
    if (subId === 'slurry_friction_loss') {
      const rhoK = p['rho_k']
      if (rhoK == null || isNaN(rhoK) || rhoK <= 0) return '步骤3：请填写 ρ_k（可由步骤1结果联动）'
      for (const name of ['lambda_coef', 'V', 'D', 'rho_s', 'g'] as const) {
        const v = p[name]
        if (v == null || isNaN(v)) return `步骤3：请填写 ${name}`
        if (name === 'D' && v === 0) return '步骤3：管道内径 D 不能为 0'
        if (name === 'lambda_coef' && v <= 0) return '步骤3：λ 必须大于 0'
      }
      return null
    }
    return null
  }

  const runFrictionWorkflowStep = async (subId: (typeof SLURRY_FRICTION_CHAIN_IDS)[number]) => {
    const err = validateFrictionSubStep(subId)
    if (err) {
      await showAppAlert('参数校验', err)
      return
    }
    const p = formulaParameters[subId] || {}
    const validParameters: Record<string, number> = {}
    for (const [key, value] of Object.entries(p)) {
      if (value !== undefined && value !== null && !isNaN(value)) validParameters[key] = value as number
    }
    if (subId === 'darcy_friction' && validParameters['epsilon'] === undefined) {
      validParameters['epsilon'] = 0.0002
    }
    if (subId === 'slurry_friction_loss' && validParameters['g'] === undefined) {
      validParameters['g'] = 9.81
    }
    setLoading(true)
    try {
      const response = await axios.post(
        `${API_BASE_URL}/calculate`,
        { formula_id: subId, parameters: validParameters },
        { timeout: API_TIMEOUT }
      )
      const data = response.data as CalculationResult
      setFormulaResults((prev) => ({ ...prev, [subId]: data }))
      if (!data.success) return
      const res = data.result
      if (subId === 'density_mixing' && res?.rho_k != null) {
        const rk = Number(res.rho_k)
        const rhoG = p['rho_g']
        const rhoS = p['rho_s']
        const r6 = (x: number) => Math.round(x * 1e6) / 1e6
        setFormulaParameters((prev) => {
          const sfl = { ...(prev.slurry_friction_loss || {}) }
          sfl.rho_k = rk
          if ((sfl.rho_s == null || isNaN(sfl.rho_s)) && rhoS != null && !isNaN(rhoS)) {
            sfl.rho_s = r6(rhoS)
          }
          const darcy = { ...(prev.darcy_friction || {}) }
          if ((darcy.rho_g == null || isNaN(darcy.rho_g)) && rhoG != null && !isNaN(rhoG)) {
            darcy.rho_g = r6(rhoG * 1000)
          }
          if ((darcy.rho_s == null || isNaN(darcy.rho_s)) && rhoS != null && !isNaN(rhoS)) {
            darcy.rho_s = r6(rhoS * 1000)
          }
          return { ...prev, slurry_friction_loss: sfl, darcy_friction: darcy }
        })
        setFormulaRawInputs((prev) => {
          const sfl = { ...(prev.slurry_friction_loss || {}) }
          sfl.rho_k = String(rk)
          if ((sfl.rho_s == null || sfl.rho_s === '') && rhoS != null && !isNaN(rhoS)) {
            sfl.rho_s = String(r6(rhoS))
          }
          const darcyR = { ...(prev.darcy_friction || {}) }
          if ((darcyR.rho_g == null || darcyR.rho_g === '') && rhoG != null && !isNaN(rhoG)) {
            darcyR.rho_g = String(r6(rhoG * 1000))
          }
          if ((darcyR.rho_s == null || darcyR.rho_s === '') && rhoS != null && !isNaN(rhoS)) {
            darcyR.rho_s = String(r6(rhoS * 1000))
          }
          return { ...prev, slurry_friction_loss: sfl, darcy_friction: darcyR }
        })
      }
      if (subId === 'darcy_friction' && res?.lambda_coef != null) {
        const lam = Number(res.lambda_coef)
        const r6 = (x: number) => Math.round(x * 1e6) / 1e6
        setFormulaParameters((prev) => {
          const darcy = prev.darcy_friction || {}
          const sfl = { ...(prev.slurry_friction_loss || {}) }
          sfl.lambda_coef = lam
          if ((sfl.V == null || isNaN(sfl.V)) && darcy.V != null && !isNaN(darcy.V)) {
            sfl.V = r6(darcy.V)
          }
          if ((sfl.D == null || isNaN(sfl.D)) && darcy.D_n != null && !isNaN(darcy.D_n)) {
            sfl.D = r6(darcy.D_n)
          }
          if ((sfl.rho_s == null || isNaN(sfl.rho_s)) && darcy.rho_s != null && !isNaN(darcy.rho_s)) {
            sfl.rho_s = r6(darcy.rho_s / 1000)
          }
          return { ...prev, slurry_friction_loss: sfl }
        })
        setFormulaRawInputs((prev) => {
          const darcyR = prev.darcy_friction || {}
          const sfl = { ...(prev.slurry_friction_loss || {}) }
          sfl.lambda_coef = String(lam)
          if ((sfl.V == null || sfl.V === '') && darcyR.V != null && darcyR.V !== '') {
            sfl.V = String(r6(Number(darcyR.V)))
          }
          if ((sfl.D == null || sfl.D === '') && darcyR.D_n != null && darcyR.D_n !== '') {
            sfl.D = String(r6(Number(darcyR.D_n)))
          }
          if ((sfl.rho_s == null || sfl.rho_s === '') && darcyR.rho_s != null && darcyR.rho_s !== '') {
            sfl.rho_s = String(r6(Number(darcyR.rho_s) / 1000))
          }
          return { ...prev, slurry_friction_loss: sfl }
        })
      }
    } catch (e: any) {
      await showAppAlert('计算失败', e.response?.data?.error || '请检查输入参数')
    } finally {
      setLoading(false)
    }
  }

  /** 将步骤1的 ρ_g、ρ_s（t/m³）换算为 kg/m³ 写入达西页（用户主动同步） */
  const applyDensityMixingToDarcyKg = async () => {
    const dm = formulaParameters['density_mixing'] || {}
    const rhoG = dm['rho_g']
    const rhoS = dm['rho_s']
    if (rhoG == null || isNaN(rhoG) || rhoS == null || isNaN(rhoS)) {
      await showAppAlert('提示', '请先在当前步填写 ρ_g、ρ_s（t/m³）')
      return
    }
    const r6 = (x: number) => Math.round(x * 1e6) / 1e6
    const gk = r6(rhoG * 1000)
    const sk = r6(rhoS * 1000)
    setFormulaParameters((prev) => ({
      ...prev,
      darcy_friction: { ...(prev.darcy_friction || {}), rho_g: gk, rho_s: sk },
    }))
    setFormulaRawInputs((prev) => ({
      ...prev,
      darcy_friction: { ...(prev.darcy_friction || {}), rho_g: String(gk), rho_s: String(sk) },
    }))
  }

  const validateOrificeSubStep = (step: 1 | 2 | 3): string | null => {
    const subId = `orifice_step${step}` as const
    const p = formulaParameters[subId] || {}
    if (step === 1) {
      const d = p['d']
      const D = p['D']
      if (d == null || isNaN(d) || d <= 0) return '步骤1：孔板开孔直径 d（m）须为有效正数'
      if (D == null || isNaN(D) || D <= 0) return '步骤1：管道内径 D（m）须为有效正数'
      if (d > D) return '步骤1：孔板直径 d 不应大于管道内径 D'
      return null
    }
    if (step === 2) {
      const d = p['d']
      const beta = p['beta']
      if (d == null || isNaN(d) || d <= 0) return '步骤2：孔板开孔直径 d（m）须为有效正数（可手填或与步骤1联动）'
      if (beta == null || isNaN(beta) || beta <= 0 || beta > 1) return '步骤2：孔径比 β 须在 (0, 1]（可手填或与步骤1联动）'
      return null
    }
    const KQk = p['K_Qk']
    const Q = p['Q']
    if (KQk == null || isNaN(KQk) || KQk < 0) return '步骤3：K_{Qk} 须为有效非负数（可手填或与步骤2联动）'
    if (Q == null || isNaN(Q)) return '步骤3：请填写浆体流量 Q（m³/h）'
    if (Q < 0) return '步骤3：流量 Q 不能为负'
    return null
  }

  const runOrificeWorkflowStep = async (step: 1 | 2 | 3): Promise<CalculationResult | null> => {
    const err = validateOrificeSubStep(step)
    if (err) {
      await showAppAlert('参数校验', err)
      return null
    }
    const subId = `orifice_step${step}` as (typeof ORIFICE_WORKFLOW_SUB_IDS)[number]
    const p = formulaParameters[subId] || {}
    const validParameters: Record<string, number> = { step }
    if (step === 1) {
      validParameters.d = p.d as number
      validParameters.D = p.D as number
    } else if (step === 2) {
      validParameters.d = p.d as number
      validParameters.beta = p.beta as number
    } else {
      validParameters.K_Qk = p.K_Qk as number
      validParameters.Q = p.Q as number
    }
    setLoading(true)
    try {
      const response = await axios.post(
        `${API_BASE_URL}/calculate`,
        { formula_id: 'slurry_dissipation_orifice', parameters: validParameters },
        { timeout: API_TIMEOUT }
      )
      const data = response.data as CalculationResult
      setFormulaResults((prev) => ({ ...prev, [subId]: data }))
      if (!data.success) {
        if (step === 3) {
          updateResult({ success: false, error: data.error || '计算失败' })
        }
        return data
      }
      const res = data.result
      if (step === 3) {
        updateResult(data)
      } else {
        updateResult(null)
      }
      if (step === 1 && res?.beta != null) {
        const beta = Number(res.beta)
        const d = p.d as number
        setFormulaParameters((prev) => ({
          ...prev,
          orifice_step2: { ...(prev.orifice_step2 || {}), beta, d },
        }))
        setFormulaRawInputs((prev) => ({
          ...prev,
          orifice_step2: {
            ...(prev.orifice_step2 || {}),
            beta: String(beta),
            d: String(d),
          },
        }))
      }
      if (step === 2 && res?.K_Qk != null) {
        const k = Number(res.K_Qk)
        setFormulaParameters((prev) => ({
          ...prev,
          orifice_step3: { ...(prev.orifice_step3 || {}), K_Qk: k },
        }))
        setFormulaRawInputs((prev) => ({
          ...prev,
          orifice_step3: { ...(prev.orifice_step3 || {}), K_Qk: String(k) },
        }))
      }
      return data
    } catch (e: any) {
      await showAppAlert('计算失败', e.response?.data?.error || '请检查输入参数')
      if (step === 3) {
        updateResult({ success: false, error: e.response?.data?.error || '计算失败' })
      }
      return null
    } finally {
      setLoading(false)
    }
  }

  // 渲染"了解我们"页面
  const renderAboutPage = () => {

    const caseStudies = {
      research: [
        {
          title: '科技创新与平台建设成效',
          description:
            '中心在重大科研项目布局、省部级与国家级科技奖励、标准制修订以及「科研—设计—应用」闭环落地等方面取得显著进展：新签各级科研合同额持续增长，获省部级科技进步奖、全国优秀工程勘察设计奖等多项荣誉，多项技术入选国家和省级绿色先进适用技术目录；新疆、贵州、湖北等地多项示范工程实现从设计到应用的转化。',
          highlights: ['重大科研项目批量落地', '省部级及国家级奖励', '闭环创新链示范应用']
        },
        {
          title: '标准体系与知识产权',
          description:
            '围绕有色冶金、矿山安全与智能制造，持续参与国家、行业及团体标准制修订，布局专利与软件著作权，支撑设计标准化与成果推广。',
          highlights: ['标准制修订', '专利与软著布局', '服务主业设计']
        },
        {
          title: '国际合作与重大专项',
          description:
            '承担国家、省部级重大科技计划及国际合作项目，在欧盟「地平线欧洲」等框架下开展联合技术攻关，推动关键技术引进来与走出去。',
          highlights: ['国际合作项目', '省部级重大专项', '联合技术攻关']
        }
      ]
    }

    const departmentNames = {
      cinf: '长沙有色冶金设计研究院',
      municipal: '市政事业部',
      research: '科研创新中心'
    }

    const cases = caseStudies[aboutDepartment as keyof typeof caseStudies] || []
    const deptName = departmentNames[aboutDepartment as keyof typeof departmentNames] || ''

    // 科研创新中心：顶栏介绍 + 与市政「工程业绩」相同的交替图文板块，单页展示各中心平台图与简介（正文可后续替换）
    if (aboutDepartment === 'research') {
      const researchCenters: Record<string, { name: string; image: string; placeholder: string }> = {
        recycling: {
          name: '湖南省再生金属资源循环利用工程技术研究中心',
          image: './info1.jpg',
          placeholder:
            '湖南省再生金属资源循环利用工程技术研究中心成立于2019年，为省级工程研究中心，由长沙有色冶金设计研究院组建。中心聚焦再生金属资源循环利用，研究方向涵盖多金属复杂物料熔炼、含砷固废治理、废旧动力电池回收等六大关键技术。成果方面，已获得多项省部级优秀设计奖及荣誉证书，技术研发与应用成效显著。',
        },
        leadZinc: {
          name: '湖南省铅锌清洁冶炼工程技术研究中心',
          image: './info2.jpg',
          placeholder:
            '湖南省铅锌清洁冶炼工程技术研究中心依托长沙有色冶金设计研究院成立，致力于锌、铜等有色金属的清洁冶炼与智能化关键技术研发，重点方向包括加压浸出、流态化熔炼等。中心承担多项国家及省级重大科研项目，取得显著成效，其中包括国家科技进步二等奖及多项省部级科技一等奖。',
        },
        deepMining: {
          name: '深井矿山安全高效开采技术湖南省工程研究中心',
          image: './info3.jpg',
          placeholder:
            '深井矿山安全高效开采技术湖南省工程研究中心由长沙有色冶金设计研究院与中南大学共建，聚焦深地资源绿色开发、矿山固废高值化利用、复杂难采矿体安全开采三大方向。中心团队成果丰硕，已取得多项技术突破与重大工程项目经验，致力于推动深井矿山安全、高效、绿色开采技术发展。',
        },
        safetyMonitor: {
          name: '湖南省矿山安全智能化监控技术与装备工程技术研究中心',
          image: './info4.jpg',
          placeholder:
            '湖南省矿山安全智能化监控技术与装备工程技术研究中心聚焦矿山灾害智能监测预警、无人自动巡检及大数据AI分析等方向。成果丰硕，获多项省部级科技奖，如"空天地"一体化监测技术获湖南省科技进步奖二等奖，Online SAR雷达系统获中国有色金属工业科学技术奖一等奖，并入选国家工信部安全应急装备推广案例。',
        },
        smartSmelting: {
          name: '湖南省有色冶金智能制造工程技术研究中心',
          image: './info5.jpg',
          placeholder:
            '湖南省有色冶金智能制造工程技术研究中心依托长沙有色冶金设计研究院，专注于数字化交付、大数据分析、智能装备与集成控制等方向。成果丰硕，获国家科技进步二等奖、多项省部级科技一等奖，授权发明专利40余项，制定标准13项，并发表多篇高水平论文。',
        },
      }

      const centerOrder = ['recycling', 'leadZinc', 'deepMining', 'safetyMonitor', 'smartSmelting'] as const
      const panelCls = `rounded-2xl border overflow-hidden shadow-sm ${
        darkMode ? 'border-gray-600 bg-gray-700/40' : 'border-slate-200 bg-white'
      }`
      const sectionTitleCls = `text-lg font-bold tracking-tight mb-3 ${darkMode ? 'text-white' : 'text-slate-900'}`
      const bodyCls = `text-sm leading-relaxed space-y-3 ${darkMode ? 'text-gray-300' : 'text-slate-700'}`
      const capCls = `px-3 py-2 text-[11px] shrink-0 ${darkMode ? 'text-gray-400 bg-gray-800/60' : 'text-slate-600 bg-slate-50'}`
      const researchKickerCls = `text-[11px] font-semibold uppercase tracking-[0.2em] mb-3 ${darkMode ? 'text-blue-400' : 'text-blue-700'}`
      /** 科研创新中心职能与导读；具体平台技术内容见下方各分块，避免与单中心介绍重复 */
      const researchIntroP1 =
        '科研创新中心负责统筹长沙有色院科技创新与成果转化，对接主业设计咨询、工程总承包与生产运营中的技术需求，在采矿、选矿、冶炼、环保与节能降碳等领域组织课题攻关、标准与知识产权布局。中心与国家企业技术中心、博士后科研工作站及院研发中心、大师工作室、试验基地等协同联动，完善项目策划、过程管理与产学研用衔接，推动科研与工程实践相互支撑。'
      const researchIntroP2 =
        '以下按板块介绍我院牵头或共建的省级工程技术研究中心及工程研究中心，涵盖再生金属循环利用、铅锌清洁冶炼、深井矿山安全高效开采、矿山安全智能监控、有色冶金智能制造等方向；各平台研究方向与代表性成果见分块正文及展示资料。'

      return (
        <div ref={scrollContainerRef} className={mainScrollClassName}>
          <div className={contentWrapperClassName}>
            <div className="mb-5">
              <h1 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>长沙院浆体管道计算工具</h1>
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {APP_TAGLINE_ZH}
              </p>
            </div>

            <div className={`${mainPanelCardClassName} mb-10`}>
              <p className={researchKickerCls}>长沙有色冶金设计研究院有限公司 · 科研创新中心</p>
              <h2 className={`text-2xl font-bold mb-4 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>科研创新中心</h2>
              <div
                className={`space-y-3 text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
              >
                <p>{researchIntroP1}</p>
                <p>{researchIntroP2}</p>
              </div>
            </div>

            {centerOrder.map((key, idx) => {
              const item = researchCenters[key]
              const imgLoaded = researchPlatformImageLoadedByKey[key] === true
              const useFullInList = researchThumbFallbackByKey[key] === true
              const listSrc = useFullInList ? item.image : researchThumbFromFull(item.image)
              const isOdd = idx % 2 === 1
              const imgCol = (
                <div
                  className={`flex flex-col ${
                    isOdd
                      ? 'order-1 lg:order-2 border-b lg:border-b-0 lg:border-l'
                      : 'border-b lg:border-b-0 lg:border-r'
                  } ${darkMode ? 'border-gray-600' : 'border-slate-200'}`}
                >
                  <div className="relative flex min-h-[200px] items-center justify-center overflow-hidden bg-black/[0.03] p-4 dark:bg-black/20">
                    {!imgLoaded && (
                      <div
                        className={`absolute inset-0 z-[1] flex items-center justify-center ${
                          darkMode ? 'bg-gray-800/60 text-gray-400' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        <span className="text-sm">加载中...</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="relative z-[2] w-full max-w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={() => setZoomPlatformImageUrl(item.image)}
                      aria-label={`放大查看：${item.name}`}
                    >
                      <img
                        src={listSrc}
                        alt={item.name}
                        loading={idx === 0 ? 'eager' : 'lazy'}
                        decoding="async"
                        className={`mx-auto max-h-[min(480px,65vh)] w-auto max-w-full cursor-zoom-in object-contain transition-opacity duration-200 ${
                          imgLoaded ? 'opacity-100' : 'opacity-0'
                        }`}
                        onLoad={() =>
                          setResearchPlatformImageLoadedByKey((prev) => ({ ...prev, [key]: true }))
                        }
                        onError={() => {
                          if (!useFullInList) {
                            setResearchThumbFallbackByKey((prev) => ({ ...prev, [key]: true }))
                          } else {
                            setResearchPlatformImageLoadedByKey((prev) => ({ ...prev, [key]: true }))
                          }
                        }}
                      />
                    </button>
                  </div>
                  <p className={capCls}>平台展示 · 点击可放大</p>
                </div>
              )
              const textCol = (
                <div
                  className={`flex flex-col justify-center p-6 sm:p-8 ${
                    isOdd ? 'order-2 lg:order-1' : ''
                  }`}
                >
                  <h3 className={sectionTitleCls}>{item.name}</h3>
                  <div className={bodyCls}>
                    <p>{item.placeholder}</p>
                  </div>
                </div>
              )
              return (
                <div key={key} className={`mb-10 ${panelCls}`}>
                  <div className="grid grid-cols-1 lg:grid-cols-2">
                    {imgCol}
                    {textCol}
                  </div>
                </div>
              )
            })}

            {/* 图片放大弹层 */}
            {zoomPlatformImageUrl && (
              <div
                className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4"
                onClick={() => setZoomPlatformImageUrl(null)}
                role="dialog"
                aria-modal="true"
                aria-label="放大查看图片"
              >
                <button
                  type="button"
                  className="absolute top-4 right-4 z-[2] w-10 h-10 rounded-full bg-white/20 text-white hover:bg-white/30 flex items-center justify-center text-xl"
                  onClick={() => setZoomPlatformImageUrl(null)}
                  aria-label="关闭"
                >
                  ×
                </button>
                {!researchZoomLightboxReady && (
                  <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 text-white text-sm pointer-events-none">
                    <span className="inline-block h-8 w-8 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden />
                    <span>加载中…</span>
                  </div>
                )}
                <img
                  src={zoomPlatformImageUrl}
                  alt="放大查看"
                  className={`relative z-[1] max-w-full max-h-[90vh] w-auto h-auto object-contain cursor-pointer transition-opacity duration-200 ${
                    researchZoomLightboxReady ? 'opacity-100' : 'opacity-0'
                  }`}
                  onLoad={() => setResearchZoomLightboxReady(true)}
                  onError={() => setResearchZoomLightboxReady(true)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
          </div>
        </div>
      )
    }

    // 如果是长沙有色冶金设计研究院，显示公司介绍和联系信息
    if (aboutDepartment === 'cinf') {
      return (
        <div ref={scrollContainerRef} className={mainScrollClassName}>
          <div className={contentWrapperClassName}>
            {/* Header */}
            <div className="mb-5">
              <h1 className={`text-2xl font-bold mb-2 ${
                darkMode ? 'text-gray-100' : 'text-gray-900'
              }`}>
                长沙院浆体管道计算工具
              </h1>
              <p className={`text-xs ${
                darkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                {APP_TAGLINE_ZH}
              </p>
            </div>

            {/* Frame - 公司介绍：左图右文，下方信息栏（与公式页外层卡片一致） */}
            <div className={`${mainPanelCardClassName} overflow-hidden`}>
              {/* 上区：图片左侧 + 文字右侧 */}
              <div className="flex flex-row gap-6 pb-4">
                <div className="flex-shrink-0 w-64 sm:w-72">
                  <img 
                    src="./pic1.png" 
                    alt="长沙有色冶金设计研究院有限公司" 
                    className="w-full h-48 sm:h-56 object-cover rounded-lg"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className={`text-xl font-bold tracking-tight mb-2 ${
                    darkMode ? 'text-gray-100' : 'text-gray-900'
                  }`}>
                    公司简介
                  </h2>
                  <div className={`text-sm font-medium mb-3 ${
                    darkMode ? 'text-gray-300' : 'text-gray-600'
                  }`}>
                    长沙有色冶金设计研究院有限公司
                  </div>
                  <p className={`text-base leading-relaxed ${
                    darkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    <strong className={darkMode ? 'text-gray-200' : 'text-gray-800'}>
                      长沙有色冶金设计研究院有限公司
                    </strong>
                    {' '}（简称长沙有色院）于1953年正式成立，国家高新技术企业，国家技术创新示范企业，国家企业技术中心，是我国最早成立的大型综合性设计研究单位之一，隶属于中国铝业集团有限公司，为中铝国际工程股份有限公司的子公司。
                  </p>
                </div>
              </div>

              {/* 下区：信息栏（发展历程、核心优势等） */}
              <div className="pt-2">
                <div className={`space-y-6 text-base leading-relaxed ${
                  darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {/* 发展历程 */}
                  <div>
                    <h3 className={`text-lg font-semibold mb-3 ${
                      darkMode ? 'text-gray-200' : 'text-gray-900'
                    }`}>
                      发展历程
                    </h3>
                    <p className={`leading-relaxed ${
                      darkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      1954年，长沙有色院由赣州迁至长沙，先后隶属于重工业部、冶金工业部、中国有色金属工业总公司、国家有色金属工业局、中国稀有稀土集团。2000年7月由中央下放到湖南省管理，2007年6月加入中国铝业公司。2011年3月，长沙有色院改制为中铝国际出资设立的一人有限责任公司，名称变更为"长沙有色冶金设计研究院有限公司"。2015年3月，中铝国际将山东建设（后更名为南方工程）划转到长沙有色院。2024年3月，中铝国际将长勘院划转到长沙有色院。
                    </p>
                  </div>
                  
                  {/* 核心优势 - 使用卡片布局 */}
                  <div>
                    <h3 className={`text-lg font-semibold mb-4 ${
                      darkMode ? 'text-gray-200' : 'text-gray-900'
                    }`}>
                      核心优势
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <div className={`p-4 rounded-lg ${
                        darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'
                      }`}>
                        <div className={`text-2xl font-bold mb-1 ${
                          darkMode ? 'text-blue-400' : 'text-blue-600'
                        }`}>
                          11项
                        </div>
                        <div className={`text-sm ${
                          darkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          甲级资质
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg ${
                        darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'
                      }`}>
                        <div className={`text-2xl font-bold mb-1 ${
                          darkMode ? 'text-blue-400' : 'text-blue-600'
                        }`}>
                          1200+
                        </div>
                        <div className={`text-sm ${
                          darkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          在册职工
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg ${
                        darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'
                      }`}>
                        <div className={`text-2xl font-bold mb-1 ${
                          darkMode ? 'text-blue-400' : 'text-blue-600'
                        }`}>
                          1300+
                        </div>
                        <div className={`text-sm ${
                          darkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          获奖项目
                        </div>
                      </div>
                      <div className={`p-4 rounded-lg ${
                        darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'
                      }`}>
                        <div className={`text-2xl font-bold mb-1 ${
                          darkMode ? 'text-blue-400' : 'text-blue-600'
                        }`}>
                          500+
                        </div>
                        <div className={`text-sm ${
                          darkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          有效专利
                        </div>
                      </div>
                    </div>
                    <p className={`leading-relaxed ${
                      darkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      经过70余年的励精图治，长沙有色院已发展成为有色金属行业全产业链和项目全生命周期的技术和服务提供商，拥有冶金行业、市政行业（排水工程、热力工程、载人索道工程）专业、建筑行业（建筑工程）专业、化工石化医药行业（化工工程）专业、环境工程设计专项（水污染防治工程、大气污染防治工程、固体废物处理处置工程）、工程勘察综合类、测绘、地质灾害治理工程勘查、地质灾害治理工程设计、地质灾害治理工程施工及地质灾害评估等11项甲级资质，业务领域涵盖工程咨询、设计、总承包、监理、勘察、测绘、检验检测、施工、环境治理、生态修复、装备制造、科学研究和技术开发等。
                    </p>
                  </div>
                  
                  {/* 技术实力 */}
                  <div>
                    <h3 className={`text-lg font-semibold mb-3 ${
                      darkMode ? 'text-gray-200' : 'text-gray-900'
                    }`}>
                      技术实力
                    </h3>
                    <p className={`leading-relaxed ${
                      darkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      长沙有色院技术实力雄厚，现有在册职工1200余人，拥有专业技术人员900余人，其中，全国工程勘察设计大师1人，全国有色金属行业勘察设计大师10人，湖南省科技创新领军人才1人，湖南省优秀青年工程勘察设计师12人，中铝集团首席工程师3人，享受国务院政府特殊津贴专家2人，高级职称478人（含正高级工程师67人），各类国家注册工程师474人。
                    </p>
                  </div>
                  
                  {/* 成就与荣誉 */}
                  <div>
                    <h3 className={`text-lg font-semibold mb-3 ${
                      darkMode ? 'text-gray-200' : 'text-gray-900'
                    }`}>
                      成就与荣誉
                    </h3>
                    <p className={`leading-relaxed mb-4 ${
                      darkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      建院70余年来，长沙有色院在设计研究领域硕果累累，为40余个国家提供了技术服务，完成各类工程咨询设计项目万余项，其中国家大、中型重点建设项目千余项，获国家、省、部级科技进步奖、优秀工程设计咨询奖1300余项，拥有有效专利500余件，形成了一批具有自主知识产权的核心技术，在矿山、冶炼和环境保护方面处于国际领先水平，尤其是自主研发的"高、深、难"矿山采选技术，创新研发的氧压浸出、CSCC熔池熔炼和闪速熔炼等新型绿色冶炼技术，为我国打造矿业强国，推动有色金属冶炼行业发展提供了强有力的技术支撑。
                    </p>
                    <div className={`flex flex-wrap gap-2 ${
                      darkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      <span className={`px-3 py-1 rounded-full text-sm ${
                        darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-blue-50 border border-blue-200'
                      }`}>
                        AAA级信用企业
                      </span>
                      <span className={`px-3 py-1 rounded-full text-sm ${
                        darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-blue-50 border border-blue-200'
                      }`}>
                        优秀勘察设计企业
                      </span>
                      <span className={`px-3 py-1 rounded-full text-sm ${
                        darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-blue-50 border border-blue-200'
                      }`}>
                        百强企业
                      </span>
                    </div>
                  </div>
                  
                  {/* 愿景 */}
                  <div className={`p-6 rounded-lg ${
                    darkMode ? 'bg-gradient-to-r from-gray-800 to-gray-700 border border-gray-600' : 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200'
                  }`}>
                    <p className={`text-base leading-relaxed ${
                      darkMode ? 'text-gray-200' : 'text-gray-800'
                    }`}>
                      面对新的经济形势和竞争环境，长沙有色院将秉承<strong className={darkMode ? 'text-white' : 'text-gray-900'}>创新驱动，诚信服务，持续为客户创造价值</strong>的理念，致力成为有色行业创新型领军企业。
                    </p>
                  </div>
                </div>

                {/* 公司信息 - 横向展示 */}
                <div className={`pt-8 border-t ${
                  darkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                  <h3 className={`text-xl font-bold mb-4 ${
                    darkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                    公司信息
                  </h3>
                  <div className={`p-6 rounded-xl mb-8 flex flex-wrap gap-6 ${
                    darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'
                  }`}>
                    <div className="flex items-start min-w-0 flex-1 basis-40">
                      <div className={`w-1 h-6 rounded-full mr-3 mt-1 shrink-0 ${
                        darkMode ? 'bg-blue-500' : 'bg-blue-600'
                      }`}></div>
                      <div className="min-w-0">
                        <div className={`text-xs font-medium mb-1 uppercase tracking-wide ${
                          darkMode ? 'text-gray-400' : 'text-gray-500'
                        }`}>联系地址</div>
                        <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>湖南省长沙市雨花区木莲东路299号</div>
                      </div>
                    </div>
                    <div className="flex items-start min-w-0 flex-1 basis-24">
                      <div className={`w-1 h-6 rounded-full mr-3 mt-1 shrink-0 ${
                        darkMode ? 'bg-blue-500' : 'bg-blue-600'
                      }`}></div>
                      <div className="min-w-0">
                        <div className={`text-xs font-medium mb-1 uppercase tracking-wide ${
                          darkMode ? 'text-gray-400' : 'text-gray-500'
                        }`}>邮政编码</div>
                        <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>410019</div>
                      </div>
                    </div>
                    <div className="flex items-start min-w-0 flex-1 basis-32">
                      <div className={`w-1 h-6 rounded-full mr-3 mt-1 shrink-0 ${
                        darkMode ? 'bg-blue-500' : 'bg-blue-600'
                      }`}></div>
                      <div className="min-w-0">
                        <div className={`text-xs font-medium mb-1 uppercase tracking-wide ${
                          darkMode ? 'text-gray-400' : 'text-gray-500'
                        }`}>办公室</div>
                        <a href="tel:0731-84397032" className={`text-sm hover:opacity-80 transition-opacity ${
                          darkMode ? 'text-blue-400' : 'text-blue-600'
                        }`}>0731-84397032</a>
                      </div>
                    </div>
                    <div className="flex items-start min-w-0 flex-1 basis-32">
                      <div className={`w-1 h-6 rounded-full mr-3 mt-1 shrink-0 ${
                        darkMode ? 'bg-blue-500' : 'bg-blue-600'
                      }`}></div>
                      <div className="min-w-0">
                        <div className={`text-xs font-medium mb-1 uppercase tracking-wide ${
                          darkMode ? 'text-gray-400' : 'text-gray-500'
                        }`}>传真</div>
                        <div className={`text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>0731-82228112</div>
                      </div>
                    </div>
                    <div className="flex items-start min-w-0 flex-1 basis-48">
                      <div className={`w-1 h-6 rounded-full mr-3 mt-1 shrink-0 ${
                        darkMode ? 'bg-blue-500' : 'bg-blue-600'
                      }`}></div>
                      <div className="min-w-0">
                        <div className={`text-xs font-medium mb-1 uppercase tracking-wide ${
                          darkMode ? 'text-gray-400' : 'text-gray-500'
                        }`}>Email</div>
                        <a href="mailto:cinf@chinalco.com.cn" className={`text-sm hover:opacity-80 transition-opacity ${
                          darkMode ? 'text-blue-400' : 'text-blue-600'
                        }`}>cinf@chinalco.com.cn</a>
                      </div>
                    </div>
                  </div>

                  {/* 业务联系 - 各部门 */}
                  <h3 className={`text-xl font-bold mb-4 ${
                    darkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                    业务联系
                  </h3>
                  <div className="space-y-4">
                        <div className={`p-5 rounded-lg ${
                          darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-white border border-gray-200 shadow-sm'
                        }`}>
                          <div className={`font-semibold mb-3 text-sm ${
                            darkMode ? 'text-gray-200' : 'text-gray-900'
                          }`}>
                            生产运营中心（市场开发部）
                          </div>
                          <div className="space-y-2 ml-4">
                            <div className="flex items-center">
                              <span className={`text-xs font-medium w-16 ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                电话：
                              </span>
                              <a 
                                href="tel:0731-84397070"
                                className={`text-sm hover:opacity-80 transition-opacity ${
                                  darkMode ? 'text-blue-400' : 'text-blue-600'
                                }`}
                              >
                                0731-84397070
                              </a>
                            </div>
                            <div className="flex items-center">
                              <span className={`text-xs font-medium w-16 ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                Email：
                              </span>
                              <a 
                                href="mailto:cinf_scjy@chinalco.com.cn" 
                                className={`text-sm hover:opacity-80 transition-opacity ${
                                  darkMode ? 'text-blue-400' : 'text-blue-600'
                                }`}
                              >
                                cinf_scjy@chinalco.com.cn
                              </a>
                            </div>
                          </div>
                        </div>

                        <div className={`p-5 rounded-lg ${
                          darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-white border border-gray-200 shadow-sm'
                        }`}>
                          <div className={`font-semibold mb-3 text-sm ${
                            darkMode ? 'text-gray-200' : 'text-gray-900'
                          }`}>
                            海外业务中心（海外发展中心）
                          </div>
                          <div className="space-y-2 ml-4">
                            <div className="flex items-center">
                              <span className={`text-xs font-medium w-16 ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                电话：
                              </span>
                              <a 
                                href="tel:0086-731-84397078"
                                className={`text-sm hover:opacity-80 transition-opacity ${
                                  darkMode ? 'text-blue-400' : 'text-blue-600'
                                }`}
                              >
                                0086-731-84397078 / 0086-731-84397079
                              </a>
                            </div>
                            <div className="flex items-center">
                              <span className={`text-xs font-medium w-16 ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                Email：
                              </span>
                              <a 
                                href="mailto:cinf_intl@chinalco.com.cn" 
                                className={`text-sm hover:opacity-80 transition-opacity ${
                                  darkMode ? 'text-blue-400' : 'text-blue-600'
                                }`}
                              >
                                cinf_intl@chinalco.com.cn
                              </a>
                            </div>
                          </div>
                        </div>

                        <div className={`p-5 rounded-lg ${
                          darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-white border border-gray-200 shadow-sm'
                        }`}>
                          <div className={`font-semibold mb-3 text-sm ${
                            darkMode ? 'text-gray-200' : 'text-gray-900'
                          }`}>
                            人力资源部（党委组织部）
                          </div>
                          <div className="ml-4">
                            <div className="flex items-center">
                              <span className={`text-xs font-medium w-16 ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                电话：
                              </span>
                              <a 
                                href="tel:0731-84397022"
                                className={`text-sm hover:opacity-80 transition-opacity ${
                                  darkMode ? 'text-blue-400' : 'text-blue-600'
                                }`}
                              >
                                0731-84397022
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // 市政事业部：总述与手册轮播（1:1）+ 四类业绩（图+文 1:1）+ 资质
    if (aboutDepartment === 'municipal') {
      const muniClickImg = (n: number, alt: string, imgCls: string) => (
        <button
          type="button"
          className="block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
          onClick={() => setMunicipalLightbox({ src: municipalDocSrc(n), alt })}
          aria-label={`放大查看：${alt}`}
        >
          <img
            src={municipalDocSrc(n)}
            alt={alt}
            loading="lazy"
            className={`${imgCls} cursor-zoom-in transition duration-500 ease-out hover:brightness-105`}
          />
        </button>
      )
      const sectionTitleCls = `text-lg font-bold tracking-tight mb-1 ${darkMode ? 'text-white' : 'text-slate-900'}`
      const sectionKickerCls = `text-[11px] font-semibold uppercase tracking-[0.2em] mb-3 ${darkMode ? 'text-blue-400' : 'text-blue-700'}`
      const bodyCls = `text-sm leading-relaxed space-y-3 ${darkMode ? 'text-gray-300' : 'text-slate-700'}`
      const panelCls = `rounded-2xl border overflow-hidden shadow-sm ${darkMode ? 'border-gray-600 bg-gray-700/40' : 'border-slate-200 bg-white'}`
      const handbookSpecs: MunicipalHandbookSpec[] = [
        { n: 1, title: '《重金属污水处理设计标准》' },
        { n: 2, title: '《铅锌选矿废水生物法处理与回用技术规程》' },
        { n: 3, title: '《浆体长距离管道输送工程设计标准》' },
      ]
      const capCls = `px-3 py-2 text-[11px] shrink-0 ${darkMode ? 'text-gray-400 bg-gray-800/60' : 'text-slate-600 bg-slate-50'}`

      return (
        <>
          <MunicipalImageLightbox
            open={municipalLightbox != null}
            src={municipalLightbox?.src ?? null}
            alt={municipalLightbox?.alt ?? ''}
            onClose={() => setMunicipalLightbox(null)}
          />
          <div ref={scrollContainerRef} className={mainScrollClassName}>
            <div className={contentWrapperClassName}>
              <div className="mb-5">
                <h1 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>长沙院浆体管道计算工具</h1>
                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {APP_TAGLINE_ZH}
                </p>
              </div>

              {/* 顶栏 kicker → 下一行左：标题 + 标题下正文；右：手册轮播与标题顶对齐、整体靠右 */}
              <div
                className={`mb-10 rounded-2xl border px-5 py-7 sm:px-10 sm:py-9 ${
                  darkMode
                    ? 'border-gray-600 bg-gradient-to-br from-slate-900/95 via-gray-900 to-slate-950'
                    : 'border-slate-200/90 bg-gradient-to-br from-white via-slate-50/80 to-blue-50/50 shadow-sm'
                }`}
              >
                <p className={sectionKickerCls}>长沙有色冶金设计研究院有限公司 · 市政事业部</p>
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10 xl:gap-12 lg:items-start">
                  <div className="min-w-0">
                    <h2
                      className={`text-2xl sm:text-3xl font-bold tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}
                    >
                      市政工程 · 废水处理及矿浆输送技术
                    </h2>
                    <div
                      className={`mt-4 leading-relaxed text-[15px] sm:text-base ${
                        darkMode ? 'text-gray-200' : 'text-slate-800'
                      }`}
                    >
                      <p className="font-medium">
                        长沙有色院依托行业优势，在采选废水处理、冶炼废水处理、市政污水处理、矿浆输送等领域技术实力雄厚，处于国内外领先水平；研究开发了铜冶炼废水「零排放」关键技术、
                        <InlineMath math="\mathrm{CO_2}" />
                        协同生物法处理铅锌选矿废水成套技术、磷酸铁生产废水资源化处理与循环利用成套技术、高海拔高浓度长距离粗颗粒尾矿管道输送技术；主持编制了《重金属污水处理设计标准》《铅锌选矿废水生物法处理与回用技术规程》《浆体长距离管道输送工程设计标准》等标准。在长期工程实践中积累了大量采选废水、冶炼废水治理与矿浆输送数据，并拥有丰富的{' '}
                        <span className="whitespace-nowrap">
                          <InlineMath math="\mathrm{EPC}" />
                        </span>
                        工程实践经验，支撑设计标准化与成果推广。
                      </p>
                    </div>
                  </div>
                  <div className="min-w-0 flex w-full flex-col items-end">
                    <h3
                      className={`mb-2 w-full text-right text-sm font-semibold tracking-wide ${darkMode ? 'text-gray-200' : 'text-slate-800'}`}
                    >
                      主持编制标准
                    </h3>
                    <MunicipalHandbookCarousel
                      align="end"
                      darkMode={darkMode}
                      specs={handbookSpecs}
                      onImageClick={(p) => setMunicipalLightbox(p)}
                    />
                  </div>
                </div>
              </div>

            {/* Ⅰ 采选废水：大屏 1:1 图左文右，配图 16:9 */}
            <div className={`mb-10 ${panelCls}`}>
              <div className="grid grid-cols-1 lg:grid-cols-2">
                <div className={`flex flex-col border-b lg:border-b-0 lg:border-r ${darkMode ? 'border-gray-600' : 'border-slate-200'}`}>
                  <div className="aspect-video w-full overflow-hidden bg-black/[0.03] dark:bg-black/20">
                    {muniClickImg(4, '采选废水治理工程资料配图', 'h-full w-full object-cover')}
                  </div>
                  <p className={capCls}>图 1　采选废水治理 · 点击配图可放大</p>
                </div>
                <div className="flex flex-col justify-center p-6 sm:p-8">
                  <p className={sectionKickerCls}>工程业绩 · Ⅰ</p>
                  <h3 className={sectionTitleCls}>采选废水治理</h3>
                  <div className={bodyCls}>
                    <div>
                      <div className={`font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                        中金岭南凡口铅锌矿选矿厂前回水净化系统
                      </div>
                      <p>
                        全国首个大规模生物法处理选矿废水示范，设计规模{' '}
                        <InlineMath math="Q=30000\ \mathrm{m^3/d}" />
                        。工艺路线含 <InlineMath math="\mathrm{CO_2}" /> 调节{' '}
                        <InlineMath math="\mathrm{pH}" />
                        、沉淀与 DAT-IAT 池，出水回用于选矿；较传统物化法节省运行费用{' '}
                        <InlineMath math=">70\%" />
                        ，获中国有色金属工业科学技术一等奖。
                      </p>
                    </div>
                    <div>
                      <div className={`font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>
                        广东大宝山凡洞村尾矿库外排水处理厂扩容升级
                      </div>
                      <p>
                        生化深度处理规模 <InlineMath math="Q=36000\ \mathrm{m^3/d}" />
                        ，解决外排水 <InlineMath math="\mathrm{COD}" /> 污染；多级物化 + CASS + 斜板沉淀，出水可回用选矿，实现外排水资源化。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ⅱ 冶炼废水：大屏 1:1 图右文左，配图 16:9 */}
            <div className={`mb-10 ${panelCls}`}>
              <div className="grid grid-cols-1 lg:grid-cols-2">
                <div className="order-2 lg:order-1 flex flex-col justify-center p-6 sm:p-8">
                  <p className={sectionKickerCls}>工程业绩 · Ⅱ</p>
                  <h3 className={sectionTitleCls}>冶炼废水治理</h3>
                  <div className={bodyCls}>
                    <div>
                      <div className={`font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>五矿铜业（湖南）水处理站</div>
                      <p>
                        铜冶炼废水分类收集、分质处理与回用；多子项流量如酸性{' '}
                        <InlineMath math="1200\ \mathrm{m^3/d}" />
                        、生产 <InlineMath math="2200\ \mathrm{m^3/d}" />
                        等。硫化—石灰—铁盐—硫化除重组合，出水砷可降至{' '}
                        <InlineMath math="0.1\ \mathrm{mg/L}" />
                        量级，获行业科学技术二等奖等。
                      </p>
                    </div>
                    <div>
                      <div className={`font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>云南驰宏铅锌冶炼综合废水盐硝分离</div>
                      <p>
                        <InlineMath math="Q=800\ \mathrm{m^3/d}" />
                        ，脱钙软化 + 膜浓缩 + 蒸发结晶；膜系统回收率{' '}
                        <InlineMath math="\geq 85\%" />
                        ，结晶盐质量分数 <InlineMath math="\geq 92\%" />
                        ，达国际领先水平。
                      </p>
                    </div>
                    <div>
                      <div className={`font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>东南铜业回用水脱盐 · 南方总站 · 新能源废水</div>
                      <p>
                        回用水脱盐 <InlineMath math="3000\ \mathrm{m^3/d}" />
                        ，<InlineMath math="\mathrm{RO}" /> 梯级浓缩，回收率 <InlineMath math="\geq 90\%" />
                        ；南方总站多系统零排放；温州/四川锂电废水高盐高重金属，树脂 + 臭氧 +{' '}
                        <InlineMath math="\mathrm{MVR}" /> 等组合工艺。
                      </p>
                    </div>
                  </div>
                </div>
                <div
                  className={`order-1 lg:order-2 flex flex-col border-b lg:border-b-0 lg:border-l ${
                    darkMode ? 'border-gray-600' : 'border-slate-200'
                  }`}
                >
                  <div className="aspect-video w-full overflow-hidden bg-black/[0.03] dark:bg-black/20">
                    {muniClickImg(8, '冶炼废水治理工程资料配图', 'h-full w-full object-cover')}
                  </div>
                  <p className={capCls}>图 2　冶炼废水零排放与深度处理 · 点击配图可放大</p>
                </div>
              </div>
            </div>

            {/* Ⅲ 市政污水：大屏 1:1 图左文右，配图 16:9 */}
            <div className={`mb-10 ${panelCls}`}>
              <div className="grid grid-cols-1 lg:grid-cols-2">
                <div className={`flex flex-col border-b lg:border-b-0 lg:border-r ${darkMode ? 'border-gray-600' : 'border-slate-200'}`}>
                  <div className="aspect-video w-full overflow-hidden bg-black/[0.03] dark:bg-black/20">
                    {muniClickImg(12, '市政污水处理工程资料配图', 'h-full w-full object-cover')}
                  </div>
                  <p className={capCls}>图 3　市政污水厂提标与工业废水 · 点击配图可放大</p>
                </div>
                <div className="flex flex-col justify-center p-6 sm:p-8">
                  <p className={sectionKickerCls}>工程业绩 · Ⅲ</p>
                  <h3 className={sectionTitleCls}>市政污水处理</h3>
                  <div className={bodyCls}>
                    <div>
                      <div className={`font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>长沙经开区城南污水处理厂</div>
                      <p>
                        一期 <InlineMath math="Q=7\times 10^{4}\ \mathrm{m^3/d}" />
                        ，二期同规模提标，合计{' '}
                        <InlineMath math="14\times 10^{4}\ \mathrm{m^3/d}" />
                        至准地表 Ⅳ 类；Carrousel、深床反硝化与浸没式超滤等组合，吨水电耗显著节约，获省、行业优秀设计/咨询奖。
                      </p>
                    </div>
                    <div>
                      <div className={`font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>永州下河线 · 洞口县城污水厂</div>
                      <p>
                        永州分期 <InlineMath math="5/10/20\times 10^{4}\ \mathrm{m^3/d}" />
                        ，改良 <InlineMath math="\mathrm{A^2O}" />
                        ；洞口一期 <InlineMath math="Q=1.5\times 10^{4}\ \mathrm{m^3/d}" />
                        、总规模 <InlineMath math="3\times 10^{4}\ \mathrm{m^3/d}" />
                        ，<InlineMath math="\mathrm{CAST}" />
                        ，一级 <InlineMath math="\mathrm{B}" /> 排放。
                      </p>
                    </div>
                    <div>
                      <div className={`font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>张家界奥威科技制药废水</div>
                      <p>
                        <InlineMath math="Q=1000\ \mathrm{m^3/d}" />
                        ，高 <InlineMath math="\mathrm{COD}" />、高氮，多段物化—生化—活性炭（专利 ZL201010281679.8），达行业一级排放。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ⅳ 矿浆输送：大屏 1:1 图右文左，配图 16:9 */}
            <div className={`mb-10 ${panelCls}`}>
              <div className="grid grid-cols-1 lg:grid-cols-2">
                <div className="order-2 lg:order-1 flex flex-col justify-center p-6 sm:p-8">
                  <p className={sectionKickerCls}>工程业绩 · Ⅳ</p>
                  <h3 className={sectionTitleCls}>矿浆输送</h3>
                  <div className={bodyCls}>
                    <div>
                      <div className={`font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>普朗铜矿尾矿输送系统</div>
                      <p>
                        尾矿质量浓度 <InlineMath math="55\%" />
                        ，管长 <InlineMath math="L\approx 30\ \mathrm{km}" />
                        ，几何高差 <InlineMath math="\Delta H\approx 240\ \mathrm{m}" />
                        ，规模 <InlineMath math="1230\times 10^{4}\ \mathrm{t/a}" />
                        ，国际示范级高海拔高浓度粗颗粒尾矿管道技术。
                      </p>
                    </div>
                    <div>
                      <div className={`font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>李家沟锂辉石矿 · 大宝山铜硫精矿 · 教美铝土矿等</div>
                      <p>
                        高落差、高压力管道：如设计压力 <InlineMath math="16.8\ \mathrm{MPa}" />
                        、自流高差 <InlineMath math="1200\ \mathrm{m}" />
                        量级；铝土矿排泥管长 <InlineMath math="32\ \mathrm{km}" />
                        、主泵压力 <InlineMath math="16\ \mathrm{MPa}" />
                        ；另含粉煤灰、钼业及西藏高海拔尾矿回水等浆体业绩。
                      </p>
                    </div>
                  </div>
                </div>
                <div
                  className={`order-1 lg:order-2 flex flex-col border-b lg:border-b-0 lg:border-l ${
                    darkMode ? 'border-gray-600' : 'border-slate-200'
                  }`}
                >
                  <div className="aspect-video w-full overflow-hidden bg-black/[0.03] dark:bg-black/20">
                    {muniClickImg(16, '矿浆管道输送工程资料配图', 'h-full w-full object-cover')}
                  </div>
                  <p className={capCls}>图 4　长距离浆体 / 尾矿管道 · 点击配图可放大</p>
                </div>
              </div>
            </div>

            {/* 资质条 */}
            <div
              className={`mb-8 rounded-xl border px-5 py-5 ${
                darkMode ? 'border-gray-600 bg-gray-700/30' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <h3 className={`text-sm font-semibold mb-2 ${darkMode ? 'text-gray-200' : 'text-slate-800'}`}>设计资质与协同</h3>
              <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-400' : 'text-slate-600'}`}>
                市政行业甲级（排水、热力、载人索道等），可与冶金、建筑、环境等甲级资质组合，承担城镇与工业片区给水排水、热力与索道等基础设施全过程咨询设计。
              </p>
              <div className="flex flex-wrap gap-2">
                {['市政行业甲级', '排水工程', '热力工程', '载人索道工程', '多专业协同'].map((tag) => (
                  <span
                    key={tag}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      darkMode ? 'border-gray-500 text-gray-300' : 'border-blue-200 bg-white text-blue-900'
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        </>
      )
    }

    // 其他部门显示案例分析
    return (
      <div ref={scrollContainerRef} className={mainScrollClassName}>
        <div className={contentWrapperClassName}>
          {/* Header */}
          <div className="mb-5">
            <h1 className={`text-2xl font-bold mb-2 ${
              darkMode ? 'text-gray-100' : 'text-gray-900'
            }`}>
              长沙院浆体管道计算工具
            </h1>
            <p className={`text-xs ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>
              {APP_TAGLINE_ZH}
            </p>
          </div>

          {/* Frame - 了解我们 */}
          <div className={mainPanelCardClassName}>
            <h2 className={`text-xl font-semibold mb-4 ${
              darkMode ? 'text-gray-100' : 'text-gray-900'
            }`}>
              {deptName} - 案例分析
            </h2>
            
            <div className="space-y-4">
              {cases.map((caseStudy, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedCase === index
                      ? darkMode
                        ? 'border-blue-500 bg-gray-600'
                        : 'border-blue-500 bg-blue-50'
                      : darkMode
                      ? 'border-gray-600 hover:border-gray-500 bg-gray-600'
                      : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                  }`}
                  onClick={() => setSelectedCase(selectedCase === index ? null : index)}
                >
                  <h3 className={`text-lg font-semibold mb-2 ${
                    darkMode ? 'text-gray-100' : 'text-gray-900'
                  }`}>
                    {caseStudy.title}
                  </h3>
                  <p className={`text-sm mb-3 leading-relaxed ${
                    darkMode ? 'text-gray-300' : 'text-gray-600'
                  }`}>
                    {caseStudy.description}
                  </p>
                  {selectedCase === index && (
                    <div className={`mt-3 pt-3 border-t ${
                      darkMode ? 'border-gray-500' : 'border-gray-200'
                    }`}>
                      <div className={`text-sm font-semibold mb-2 ${
                        darkMode ? 'text-gray-200' : 'text-gray-700'
                      }`}>
                        项目亮点：
                      </div>
                      <ul className="space-y-1">
                        {caseStudy.highlights.map((highlight, i) => (
                          <li key={i} className={`text-sm flex items-start ${
                            darkMode ? 'text-gray-300' : 'text-gray-600'
                          }`}>
                            <span className="mr-2">•</span>
                            <span>{highlight}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 渲染设置页面
  const renderSettingsPage = () => {
    const cardCls = `rounded-xl border p-5 ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-white border-gray-200'}`
    const sectionTitleCls = `text-sm font-semibold mb-4 flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`
    const accentBorder = darkMode ? 'border-l-blue-500' : 'border-l-blue-600'
    const t = (language === 'en'
      ? {
          title: 'Settings',
          subtitle: 'Manage appearance and language, check for updates, view notices, and contact support.',
          appName: 'Slurry Pipeline Calculator (CINF)',
          appOrg: 'China ENFI Engineering Corporation (CINF)',
          appearancePref: 'Appearance & Preferences',
          displayMode: 'Theme',
          light: 'Light',
          lightHint: 'Day',
          dark: 'Dark',
          darkHint: 'Comfort',
          uiLanguage: 'Language',
          feedbackUpdates: 'Feedback & Updates',
          feedbackTitle: 'Feedback',
          feedbackDesc: 'Feature suggestions, issue reports, or collaboration inquiries—feel free to contact the team.',
          contactDev: 'Contact the Team',
          mailSubject: '[Slurry Pipeline Calculator] Feedback',
          mailBody:
            'App: Slurry Pipeline Calculator (CINF)\n\nType: □ Feature request  □ Bug report  □ Other\n\nDetails:\n\n\n\n',
          updatesTitle: 'App Update',
          currentVersion: 'Current version',
          checkUpdates: 'Check for updates',
          checking: 'Checking for updates...',
          newVersion: 'New version available',
          downloadUpdate: 'Download update',
          downloading: 'Downloading',
          downloaded: 'Update downloaded. Install after restart.',
          installNow: 'Restart & Install',
          updateFailed: 'Update check failed',
          retry: 'Retry',
          versionTitle: 'App Version',
          noAutoUpdateBrowser: '(Auto-update is unavailable in browser mode)',
          legalNotices: 'Legal & Notices',
          disclaimerTitle: 'Disclaimer',
          disclaimerP1:
            'The formulas and results provided by this software are for engineering reference only and do not constitute any guarantee or final design basis. Decisions must be made with applicable standards, site conditions, and professional judgment.',
          disclaimerP2:
            'The developer/provider assumes no liability for any direct or indirect consequences arising from the use of this software or its results. When in doubt, refer to current national/industry standards and formally issued design documents from qualified organizations.',
          privacyTitle: 'Data & Privacy',
          privacyP:
            'All calculations are performed locally. The app does not collect or upload your input data or results. Exporting to Word is also done on your machine without sending content to external servers.',
        }
      : {
          title: '设置',
          subtitle: '管理显示与语言、检查更新、查看声明与反馈方式',
          appName: '长沙院浆体管道计算工具',
          appOrg: '长沙有色冶金设计研究院有限公司',
          appearancePref: '外观与偏好',
          displayMode: '显示模式',
          light: '浅色',
          lightHint: '日间',
          dark: '暗色',
          darkHint: '护眼',
          uiLanguage: '界面语言',
          feedbackUpdates: '反馈与更新',
          feedbackTitle: '建议与反馈',
          feedbackDesc: '功能建议、问题反馈或合作意向，欢迎联系开发团队。',
          contactDev: '联系开发团队',
          mailSubject: '【长沙院浆体管道计算工具】软件建议与反馈',
          mailBody: '软件名称：长沙院浆体管道计算工具\n\n建议/反馈类型：□ 功能建议  □ 问题反馈  □ 其他\n\n内容说明：\n\n\n\n',
          updatesTitle: '应用更新',
          currentVersion: '当前版本',
          checkUpdates: '检查更新',
          checking: '正在检查更新...',
          newVersion: '发现新版本',
          downloadUpdate: '下载更新',
          downloading: '正在下载',
          downloaded: '更新已下载，重启后安装',
          installNow: '立即重启并安装',
          updateFailed: '更新检查失败',
          retry: '重试',
          versionTitle: '应用版本',
          noAutoUpdateBrowser: '（浏览器环境下无自动更新）',
          legalNotices: '法律与声明',
          disclaimerTitle: '免责声明',
          disclaimerP1: '本软件所提供的计算公式及计算结果仅供工程设计参考，不构成任何设计依据或保证。实际工程须结合现行规范、现场条件及专业判断综合决策。',
          disclaimerP2: '使用本软件及其结果所产生的任何直接或间接后果，开发与提供方不承担责任。如有疑问，请以现行国家标准、行业规范及有资质单位出具的正式设计文件为准。',
          privacyTitle: '数据与隐私',
          privacyP: '本软件在本地完成计算，不收集、不上传您的输入数据或计算结果。导出 Word 等操作均在您本机完成，不会将内容发送至外部服务器。',
        })

    return (
      <div ref={scrollContainerRef} className={mainScrollClassName}>
        <div className={contentWrapperClassName}>
          {/* 顶部：标题 + 关于本软件 横幅 */}
          <div className="mb-8">
            <h1 className={`text-2xl sm:text-3xl font-bold mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
              {t.title}
            </h1>
            <p className={`text-xs leading-relaxed mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {language === 'en' ? APP_TAGLINE_EN : APP_TAGLINE_ZH}
            </p>
            <p className={`text-sm mb-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {t.subtitle}
            </p>
            <div className={`rounded-xl border-l-4 ${accentBorder} ${darkMode ? 'bg-gray-700/60 border-gray-600' : 'bg-white border-gray-200'} px-5 py-4`}>
              <div className={`font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                {t.appName}
              </div>
              <div className={`text-sm mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {t.currentVersion} {currentVersion || '—'} · {t.appOrg}
              </div>
            </div>
          </div>

          {/* 一、外观与偏好：两列 */}
          <section className="mb-8">
            <h2 className={`${sectionTitleCls} border-l-4 ${accentBorder} pl-3`}>
              {t.appearancePref}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={cardCls}>
                <h3 className={`text-base font-semibold mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {t.displayMode}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => onDarkModeChange && onDarkModeChange(false)}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      !darkModeValue ? 'bg-blue-600 text-white shadow' : darkMode ? 'bg-gray-600/80 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span className="font-medium">{t.light}</span>
                    <span className={`block text-xs mt-0.5 ${!darkModeValue ? 'opacity-90' : 'opacity-70'}`}>{t.lightHint}</span>
                  </button>
                  <button
                    onClick={() => onDarkModeChange && onDarkModeChange(true)}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      darkModeValue ? 'bg-blue-600 text-white shadow' : darkMode ? 'bg-gray-600/80 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span className="font-medium">{t.dark}</span>
                    <span className={`block text-xs mt-0.5 ${darkModeValue ? 'opacity-90' : 'opacity-70'}`}>{t.darkHint}</span>
                  </button>
                </div>
              </div>
              <div className={cardCls}>
                <h3 className={`text-base font-semibold mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {t.uiLanguage}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => onLanguageChange && onLanguageChange('zh')}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      language === 'zh' ? 'bg-blue-600 text-white shadow' : darkMode ? 'bg-gray-600/80 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    中文
                  </button>
                  <button
                    onClick={() => onLanguageChange && onLanguageChange('en')}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      language === 'en' ? 'bg-blue-600 text-white shadow' : darkMode ? 'bg-gray-600/80 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* 二、反馈与更新：两列（或建议单列 + 更新单列） */}
          <section className="mb-8">
            <h2 className={`${sectionTitleCls} border-l-4 ${accentBorder} pl-3`}>
              {t.feedbackUpdates}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={cardCls}>
                <h3 className={`text-base font-semibold mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {t.feedbackTitle}
                </h3>
                <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t.feedbackDesc}
                </p>
                <a
                  href={`mailto:xuqianglai@outlook.com?subject=${encodeURIComponent(t.mailSubject)}&body=${encodeURIComponent(t.mailBody)}`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  {t.contactDev}
                </a>
              </div>
              {typeof window !== 'undefined' && (window as any).electronAPI?.update ? (
                <div className={cardCls}>
                  <h3 className={`text-base font-semibold mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    {t.updatesTitle}
                  </h3>
                  <div className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {t.currentVersion} <span className="font-semibold text-blue-600">{currentVersion || '—'}</span>
                  </div>
                  <div className="space-y-3">
                    {updateStatus === 'idle' && (
                      <button onClick={handleCheckForUpdates} className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors">
                        {t.checkUpdates}
                      </button>
                    )}
                    {updateStatus === 'checking' && (
                      <div className={`text-center py-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        <span className="inline-block animate-spin mr-2">⟳</span> {t.checking}
                      </div>
                    )}
                    {updateStatus === 'available' && updateInfo && (
                      <div className="space-y-3">
                        <div className={`p-3 rounded-lg text-sm ${darkMode ? 'bg-green-900/30 border border-green-700 text-green-300' : 'bg-green-50 border border-green-200 text-green-800'}`}>
                          <div className="font-medium">{t.newVersion} {updateInfo.version}</div>
                          {updateInfo.releaseNotes && <div className={`mt-1 text-xs ${darkMode ? 'text-green-400' : 'text-green-700'}`}>{updateInfo.releaseNotes}</div>}
                        </div>
                        <button onClick={handleDownloadUpdate} className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors">{t.downloadUpdate}</button>
                      </div>
                    )}
                    {updateStatus === 'downloading' && (
                      <div className="space-y-2">
                        <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{t.downloading} {updateProgress}%</div>
                        <div className={`w-full h-2 rounded-full overflow-hidden ${darkMode ? 'bg-gray-600' : 'bg-gray-200'}`}>
                          <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${updateProgress}%` }} />
                        </div>
                      </div>
                    )}
                    {updateStatus === 'downloaded' && (
                      <div className="space-y-3">
                        <div className={`p-3 rounded-lg text-sm ${darkMode ? 'bg-green-900/30 border border-green-700 text-green-300' : 'bg-green-50 border border-green-200 text-green-800'}`}>
                          {t.downloaded}
                        </div>
                        <button onClick={handleInstallUpdate} className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors">{t.installNow}</button>
                      </div>
                    )}
                    {updateStatus === 'error' && (
                      <div className="space-y-3">
                        <div className={`p-3 rounded-lg text-sm ${darkMode ? 'bg-red-900/30 border border-red-700 text-red-300' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                          {updateError || t.updateFailed}
                        </div>
                        <button onClick={handleCheckForUpdates} className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors">{t.retry}</button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className={cardCls}>
                  <h3 className={`text-base font-semibold mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    {t.versionTitle}
                  </h3>
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {t.currentVersion} <span className="font-semibold">{currentVersion || '—'}</span>{t.noAutoUpdateBrowser}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 三、法律与声明：两列 */}
          <section>
            <h2 className={`${sectionTitleCls} border-l-4 ${accentBorder} pl-3`}>
              {t.legalNotices}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={cardCls}>
                <h3 className={`text-base font-semibold mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {t.disclaimerTitle}
                </h3>
                <div className={`text-sm leading-relaxed space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  <p>{t.disclaimerP1}</p>
                  <p>{t.disclaimerP2}</p>
                </div>
              </div>
              <div className={cardCls}>
                <h3 className={`text-base font-semibold mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {t.privacyTitle}
                </h3>
                <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {t.privacyP}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    )
  }

  // 验证参数
  const validateParameters = (): string | null => {
    if (!formula) return '请选择公式'

    if (formula.id === 'slurry_dissipation_orifice') {
      return validateOrificeSubStep(3)
    }

    // 达西摩阻系数：ρ₁ 与 (ρ_g,ρ_s,C1v) 二选一；ReB 与 (V,D_n,η₁) 二选一；D_n、ε 必填
    if (formula.id === 'darcy_friction') {
      const rho1 = parameters['rho_1']
      const hasRho1 = rho1 != null && !isNaN(rho1) && rho1 > 0
      const hasStepAParams = [parameters['rho_g'], parameters['rho_s'], parameters['C1v']].every(v => v != null && !isNaN(v))
      if (!hasRho1 && !hasStepAParams) return '请输入 ρ₁，或填写 ρ_g、ρ_s、C1v'
      if (!hasRho1 && (parameters['rho_g'] === 0 || parameters['rho_s'] === 0)) return 'ρ_g、ρ_s 必须大于 0'
      if (parameters['C1v'] != null && !isNaN(parameters['C1v']) && (parameters['C1v'] < 0 || parameters['C1v'] > 1)) return 'C1v 应在 0～1 之间'

      const ReB = parameters['Re_B']
      const hasReB = ReB != null && !isNaN(ReB) && ReB > 0
      const hasStepBParams = [parameters['V'], parameters['D_n'], parameters['eta_1']].every(v => v != null && !isNaN(v))
      const hasRho1ForB = hasRho1 || hasStepAParams
      if (!hasReB && (!hasStepBParams || !hasRho1ForB)) return '请输入 ReB，或填写 V、D_n、η₁ 及步骤 A 参数（或直接输入 ρ₁）'
      if (!hasReB && (parameters['D_n'] === 0 || parameters['eta_1'] === 0)) return 'D_n、η₁ 必须大于 0'

      const Dn = parameters['D_n']
      if (Dn == null || isNaN(Dn) || Dn <= 0) return '请填写管道内径 D_n'
      return null
    }

    // 浆体摩阻损失：ρ_k、λ 为前置量，需直接输入；沿程参数必填
    if (formula.id === 'slurry_friction_loss') {
      const rhoK = parameters['rho_k']
      if (rhoK == null || isNaN(rhoK) || rhoK <= 0) return '请填写 ρ_k（可由「密度混合公式」计算或直接输入）'
      const step2Params = ['lambda_coef', 'V', 'D', 'rho_s', 'g'] as const
      for (const name of step2Params) {
        const v = parameters[name]
        if (v == null || isNaN(v)) return `请填写参数：${formula.parameters.find(p => p.name === name)?.label || name}`
        if (name === 'D' && v === 0) return '管道内径 D 不能为 0'
        if (name === 'lambda_coef' && v <= 0) return 'λ 必须大于 0'
      }
      return null
    }

    // 密度混合公式：C_w、ρ_g、ρ_s 必填
    if (formula.id === 'density_mixing') {
      const Cw = parameters['C_w']
      if (Cw == null || isNaN(Cw) || Cw < 0 || Cw > 1) return '固体质量浓度 C_w 应在 0～1 之间'
      if (parameters['rho_g'] == null || isNaN(parameters['rho_g']) || parameters['rho_g'] <= 0) return '请填写 ρ_g'
      if (parameters['rho_s'] == null || isNaN(parameters['rho_s']) || parameters['rho_s'] <= 0) return '请填写 ρ_s'
      return null
    }

    // 清水摩阻损失：海澄–威廉，C_h、d_j、q_g 必填且为正；自定义 C_h 时需有效数值
    if (formula.id === 'clear_water_friction_loss') {
      const preset = rawInputs['ch_preset']
      const chRaw = rawInputs['C_h']?.trim() ?? ''
      if (preset === 'custom' && chRaw === '') return '选择「用户自定义」时请填写 Hazen–Williams 系数 C_h'
      const Ch = parameters['C_h']
      if (Ch == null || isNaN(Ch)) return '请填写 C_h（海澄–威廉系数）'
      if (Ch <= 0) return 'C_h 须为大于 0 的实数'
      const dj = parameters['d_j']
      if (dj == null || isNaN(dj) || dj <= 0) return '计算内径 d_j 须大于 0（单位 m）'
      const qg = parameters['q_g']
      if (qg == null || isNaN(qg) || qg <= 0) return '设计流量 q_g 须大于 0（单位 m³/s）'
      const kHw = parameters['K_hw']
      if (kHw == null || isNaN(kHw) || kHw <= 0) return '式前系数 K_hw 须大于 0（默认 105，可按规范调整）'
      return null
    }

    // 浆体消能：与步骤2相同规则（Q + K_QL 或 Q + λ_d/L_s/d）
    if (isSlurryDissipationFormula) {
      return validateSlurryDissipationStep(2)
    }
    
    const paramsToCheck = formula.parameters

    for (const param of paramsToCheck) {
      const value = parameters[param.name]
      
      // 如果参数没有默认值且未填写
      if (param.default === undefined && (value === undefined || value === null || isNaN(value))) {
        return `请填写参数：${param.label || param.name}`
      }
      
      // 特殊验证规则
      if (value !== undefined && !isNaN(value)) {
        // D不能为0
        if (param.name === 'D' && value === 0) {
          return '管道内径D不能为0'
        }
        // omega不能为0（刘德忠公式）
        if (param.name === 'omega' && formula.id === 'liu_dezhong' && value === 0) {
          return '速度参数ω不能为0'
        }
        // lambda_coef必须大于0（费祥俊公式）
        if (param.name === 'lambda_coef' && value <= 0) {
          return 'λ系数必须大于0'
        }
        // Cv体积浓度应该在0-1之间
        if (param.name === 'Cv' && (value < 0 || value > 1)) {
          return '体积浓度Cv应该在0-1之间'
        }
        // C_w质量浓度应该在0-1之间（浆体摩阻损失）
        if (param.name === 'C_w' && (value < 0 || value > 1)) {
          return '固体质量浓度C_w应在0～1之间'
        }
      }
    }
    
    return null
  }

  const validateKronodzeStep = (step: 1 | 2): string | null => {
    if (!formula || formula.id !== 'kronodze_pressure') return null
    const G = parameters['G']
    const W = parameters['W']
    const rhoG = parameters['rho_g']
    if (G == null || isNaN(G)) return '步骤1 需要填写 G（矿浆中水重）'
    if (W == null || isNaN(W)) return '步骤1 需要填写 W（干尾矿重量）'
    if (rhoG == null || isNaN(rhoG)) return '步骤1 需要填写 ρg（尾矿相对密度）'
    if (W <= 0) return '干尾矿重量 W 必须大于 0'
    if (G <= 0) return '矿浆中水重 G 必须大于 0'
    if (rhoG <= 0) return '尾矿相对密度 ρg 必须大于 0'

    if (step === 2) {
      const dp = parameters['dp']
      if (dp == null || isNaN(dp)) return '参数校验未通过：请选择 dp 粒径区间'
      if (dp <= 0 || dp > 0.15) return '参数校验未通过：dp 应满足 0 < dp ≤ 0.15 mm'
      const beta = parameters['beta']
      if (beta != null && !isNaN(beta) && beta <= 0) return '步骤2 的 β 必须大于 0'
    }

    return null
  }

  /** 浆体消能：数值有限性 + 工程合理范围，减少乱输入导致溢出/无意义结果 */
  const validateSlurryDissipationStep = (step: 1 | 2): string | null => {
    if (!formula || !isSlurryDissipationFormula) return null

    const fin = (name: string, v: number | undefined): string | null => {
      if (v === undefined || v === null || (typeof v === 'number' && isNaN(v))) return null
      if (!Number.isFinite(v)) return `${name} 须为有限数值（不能为无穷或非数）`
      return null
    }

    if (step === 1) {
      const lambdaD = parameters['lambda_d']
      const Ls = parameters['L_s']
      const d = parameters['d']
      if (lambdaD == null || isNaN(lambdaD)) return '步骤1 请填写达西摩阻系数 λ_d'
      const e1 = fin('λ_d', lambdaD)
      if (e1) return e1
      if (lambdaD <= 0) return '步骤1：λ_d 须大于 0'
      if (lambdaD > 2) return '步骤1：λ_d 过大（一般远小于 1），请检查是否误填单位或小数点'

      if (Ls == null || isNaN(Ls)) return '步骤1 请填写缩径管段长度 L_s'
      const e2 = fin('L_s', Ls)
      if (e2) return e2
      if (Ls < 0) return '步骤1：L_s 不能为负数'
      if (Ls > 5e5) return '步骤1：L_s 过大（> 500 km），请检查单位是否为 m'

      if (d == null || isNaN(d)) return '步骤1 请填写消能管内径 d'
      const e3 = fin('管径 d', d)
      if (e3) return e3
      if (d <= 0) return '步骤1：d 须大于 0'
      if (d > 200) return '步骤1：d 过大（> 200 m），请检查单位是否为 m'
      if (d < 1e-6) return '步骤1：d 过小，易导致数值异常，请检查单位是否为 m'

      return null
    }

    const Q = parameters['Q']
    if (Q == null || isNaN(Q)) return '步骤2 请填写浆体流量 Q'
    const eQ = fin('Q', Q)
    if (eQ) return eQ
    if (Q <= 0) return '步骤2：Q 须大于 0'
    if (Q > 1e8) return '步骤2：Q 过大（> 1×10⁸ m³/h），请检查单位与数量级'

    const KQL = parameters['K_QL']
    const hasKQL = KQL != null && !isNaN(KQL)
    if (hasKQL) {
      const eK = fin('K_QL', KQL as number)
      if (eK) return eK
      if ((KQL as number) <= 0) return '步骤2：K_QL 须大于 0'
      if ((KQL as number) > 1e30) return '步骤2：K_QL 过大，Δh 可能数值溢出，请检查输入'
      return null
    }

    const lambdaD = parameters['lambda_d']
    const Ls = parameters['L_s']
    const d = parameters['d']
    if (lambdaD == null || isNaN(lambdaD)) {
      return '步骤2：请在上方填写「流量消能系数」，或完成步骤1，或填写 λ_d、L_s、d'
    }
    const ea = fin('λ_d', lambdaD)
    if (ea) return ea
    if (lambdaD <= 0) return '步骤2：λ_d 须大于 0'
    if (lambdaD > 2) return '步骤2：λ_d 过大，请检查输入'

    if (Ls == null || isNaN(Ls)) return '步骤2：缺少 L_s，请补全步骤1参数或直接填写 K_QL'
    const eb = fin('L_s', Ls)
    if (eb) return eb
    if (Ls < 0) return '步骤2：L_s 不能为负数'
    if (Ls > 5e5) return '步骤2：L_s 过大，请检查单位'

    if (d == null || isNaN(d)) return '步骤2：缺少 d，请补全步骤1参数或直接填写 K_QL'
    const ec = fin('d', d)
    if (ec) return ec
    if (d <= 0) return '步骤2：d 须大于 0'
    if (d > 200 || d < 1e-6) return '步骤2：d 不合理，请检查单位是否为 m'

    return null
  }

  const handleKronodzeStepCalculate = async (step: 1 | 2) => {
    const validationError = validateKronodzeStep(step)
    if (validationError) {
      await showAppAlert('步骤计算条件不满足', validationError)
      return
    }

    if (step === 1) {
      // 步骤1：只算矿浆流量 Qk，不传 dp/beta 以防后端连算步骤2、3
      if (!formula) return
      setLoading(true)
      try {
        const step1Params: Record<string, number> = {}
        for (const key of ['K', 'G', 'W', 'rho_g']) {
          const v = parameters[key]
          if (v !== undefined && v !== null && !isNaN(v)) step1Params[key] = v
        }
        const response = await axios.post(`${API_BASE_URL}/calculate`, {
          formula_id: formula.id,
          parameters: step1Params,
        }, { timeout: API_TIMEOUT })
        updateResult(response.data)
      } catch (error: any) {
        await showAppAlert('计算失败', error.response?.data?.error || '请检查输入参数后重试。')
      } finally {
        setLoading(false)
      }
      updateKronodzeStep2Ready(false)
      updateKronodzeStep3Visible(false)
      updateLockedVc(null)
      setAutoCalculateRef(false)
      return
    }

    // 步骤2：传全部参数（含 dp、beta），后端算到步骤 B
    const calcResult = await handleCalculate(false, true, true)
    const hasStep2Result = calcResult?.success && calcResult.result?.intermediate?.step_B_DL_mm != null
    updateKronodzeStep2Ready(Boolean(hasStep2Result))
    updateKronodzeStep3Visible(false)
    updateLockedVc(null)
    setAutoCalculateRef(false)
  }

  const handleKronodzeStartCalculate = async () => {
    if (!formula || formula.id !== 'kronodze_pressure') return
    if (!kronodzeStep2Ready) {
      await showAppAlert('流程条件未满足', '请先完成步骤2（计算临界管径），再点击「开始计算」。')
      return
    }
    const calcResult = await handleCalculate(false, false, true)
    const hasStep3Result = Boolean(
      calcResult?.success && (
        calcResult.result?.Vc !== undefined ||
        calcResult.result?.intermediate?.term_cd !== undefined
      )
    )
    updateKronodzeStep3Visible(Boolean(hasStep3Result))
  }

  const handleSlurryDissipationStepCalculate = async (step: 1 | 2) => {
    const validationError = validateSlurryDissipationStep(step)
    if (validationError) {
      await showAppAlert('参数校验', validationError)
      return
    }
    const calcResult = await handleCalculate(false, true, true)
    if (!formula || step !== 1 || !calcResult?.success) return
    const kqlRaw = calcResult.result?.K_QL ?? calcResult.result?.intermediate?.step_1_kql
    if (kqlRaw == null || !Number.isFinite(Number(kqlRaw))) return
    const kqlNum = Number(kqlRaw)
    const int1 = calcResult.result?.intermediate
    const ld = parameters['lambda_d']
    const Ls = parameters['L_s']
    const d = parameters['d']
    if (
      ld != null &&
      Ls != null &&
      d != null &&
      !isNaN(ld) &&
      !isNaN(Ls) &&
      !isNaN(d)
    ) {
      const ldN = Number(ld)
      const LsN = Number(Ls)
      const dN = Number(d)
      const bn = int1?.kql_numerator
      const bd = int1?.kql_denominator_d5
      if (
        bn != null &&
        bd != null &&
        !isNaN(Number(bn)) &&
        !isNaN(Number(bd))
      ) {
        setDissipationStep1IxCacheByFormula((prev) => ({
          ...prev,
          [formula.id]: {
            numerator: Number(bn),
            denominator: Number(bd),
            ld: ldN,
            Ls: LsN,
            d: dN,
            fromBackend: true,
          },
        }))
      } else {
        setDissipationStep1IxCacheByFormula((prev) => ({
          ...prev,
          [formula.id]: {
            numerator: 6.3755e-9 * ldN * LsN,
            denominator: dN ** 5,
            ld: ldN,
            Ls: LsN,
            d: dN,
            fromBackend: false,
          },
        }))
      }
    }
    dissipationAutoKqlRef.current[formula.id] = kqlNum
    setDissipationStep1AutoKqlByFormula((prev) => ({ ...prev, [formula.id]: kqlNum }))
    const kqlStr = (() => {
      const r = Math.round(kqlNum * 1e12) / 1e12
      if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-6)) return r.toExponential(8)
      const s = r.toFixed(12).replace(/\.?0+$/, '')
      return s || '0'
    })()
    updateParameters((prev) => ({ ...prev, K_QL: kqlNum }))
    updateRawInputs((prev) => ({ ...prev, K_QL: kqlStr }))
  }

  const handleCalculate = async (
    isAutoCalculate: boolean = false,
    skipValidation: boolean = false,
    preserveResultOnError: boolean = false
  ): Promise<CalculationResult | null> => {
    if (!formula) return null

    // 孔板消能：第 3 步与底部「开始计算」统一，避免重复维护两套请求
    if (formula.id === 'slurry_dissipation_orifice') {
      if (!skipValidation) {
        const validationError = validateParameters()
        if (validationError) {
          if (!preserveResultOnError) {
            updateResult({ success: false, error: validationError })
          }
          return null
        }
      }
      return await runOrificeWorkflowStep(3)
    }

    // 消能界面一律请求 slurry_dissipation，防止公式对象 id 异常时误走加速流
    const effectiveFormulaId = isSlurryDissipationFormula ? 'slurry_dissipation' : formula.id

    // 验证参数
    if (!skipValidation) {
      const validationError = validateParameters()
      if (validationError) {
        if (!preserveResultOnError) {
          updateResult({
            success: false,
            error: validationError
          })
        }
        return null
      }
    }

    // 如果是自动计算，不显示loading状态
    if (!isAutoCalculate) {
      setLoading(true)
    }
    try {
      // 过滤掉undefined值，只发送有效参数
      const validParameters: Record<string, number> = {}
      for (const [key, value] of Object.entries(parameters)) {
        if (value !== undefined && value !== null && !isNaN(value)) {
          validParameters[key] = value as number
        }
      }
      
      const response = await axios.post(`${API_BASE_URL}/calculate`, {
        formula_id: effectiveFormulaId,
        parameters: validParameters,
        locked_vc: lockedVc // 发送锁定的临界流速到后端
      }, {
        timeout: API_TIMEOUT
      })
      updateResult(response.data)
      return response.data as CalculationResult
    } catch (error: any) {
      if (!preserveResultOnError) {
        updateResult({
          success: false,
          error: error.response?.data?.error || '计算失败，请检查输入参数'
        })
      } else {
        await showAppAlert('计算失败', error.response?.data?.error || '请检查输入参数后重试。')
      }
      return null
    } finally {
      if (!isAutoCalculate) {
        setLoading(false)
      }
    }
  }

  const handleExport = async () => {
    if (!formula || !result?.success) return
    const effectiveFormulaId = isSlurryDissipationFormula ? 'slurry_dissipation' : formula.id

    const validParameters: Record<string, number> = {}
    if (formula.id === 'slurry_dissipation_orifice') {
      const s1 = formulaParameters['orifice_step1'] || {}
      const s2 = formulaParameters['orifice_step2'] || {}
      const s3 = formulaParameters['orifice_step3'] || {}
      const add = (k: string, v: number | undefined) => {
        if (v != null && !isNaN(v)) validParameters[k] = v
      }
      add('d', s1.d ?? s2.d)
      add('D', s1.D)
      add('beta', s2.beta)
      add('K_Qk', s3.K_Qk)
      add('Q', s3.Q)
    } else {
      for (const [key, value] of Object.entries(parameters)) {
        if (value !== undefined && value !== null && !isNaN(value)) {
          validParameters[key] = value as number
        }
      }
    }

    let exportResult = result.result
    if (formula.id === 'slurry_dissipation_orifice' && exportResult) {
      const r1 = formulaResults['orifice_step1']?.result
      const r2 = formulaResults['orifice_step2']?.result
      exportResult = {
        ...exportResult,
        intermediate: {
          ...(exportResult.intermediate || {}),
          ...(r1?.beta != null ? { orifice_beta: r1.beta } : {}),
          ...(r2?.K_Qk != null ? { orifice_K_Qk_step2: r2.K_Qk } : {}),
        },
      }
    }

    const payload = {
      formula_id: formula.id === 'slurry_dissipation_orifice' ? 'slurry_dissipation_orifice' : effectiveFormulaId,
      formula_info: { ...formula, id: formula.id === 'slurry_dissipation_orifice' ? 'slurry_dissipation_orifice' : effectiveFormulaId },
      parameters: validParameters,
      result: exportResult,
    }

    const electronAPI = (window as any).electronAPI
    const useSaveDialog = electronAPI?.showSaveDialogForExport

    setExporting(true)
    try {
      let savePath: string | null = null
      if (useSaveDialog) {
        const defaultName = `长沙院浆体计算_${formula.name.replace(/\s+/g, '')}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.docx`
        savePath = await electronAPI.showSaveDialogForExport(defaultName)
        if (savePath == null) {
          setExporting(false)
          return
        }
      }

      if (savePath != null) {
        // 用户已选路径：后端直接写入该路径，返回 JSON
        const response = await axios.post(`${API_BASE_URL}/export`, { ...payload, save_path: savePath }, {
          timeout: API_TIMEOUT,
          validateStatus: (s) => s >= 200 && s < 300
        })
        if (response.data?.success) {
          await showAppAlert('导出成功', '计算书已保存到您选择的位置。')
          return
        }
        throw new Error((response.data as any)?.error || '导出失败')
      }

      // 非 Electron 或未选路径：原有下载方式（后端返回 blob）
      const response = await axios.post(`${API_BASE_URL}/export`, payload, {
        responseType: 'blob',
        timeout: API_TIMEOUT,
        validateStatus: (status) => status >= 200 && status < 300
      })

      if (response.data instanceof Blob) {
        const contentType = response.headers['content-type'] || ''
        if (contentType.includes('application/json')) {
          const text = await response.data.text()
          try {
            const errorData = JSON.parse(text)
            throw new Error(errorData.error || '导出失败')
          } catch (e) {
            if (e instanceof Error && e.message !== '导出失败') throw e
            throw new Error('导出失败：服务器返回错误')
          }
        }
        const url = window.URL.createObjectURL(response.data)
        const link = document.createElement('a')
        link.href = url
        let filename = `长沙院浆体计算_${formula.name.replace(/\s+/g, '')}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}_001.docx`
        const contentDisposition = response.headers['content-disposition']
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
          if (filenameMatch?.[1]) {
            filename = filenameMatch[1].replace(/['"]/g, '')
            if (filename.startsWith('UTF-8\'\'')) {
              filename = decodeURIComponent(filename.replace(/^UTF-8''/, ''))
            }
          }
        }
        link.setAttribute('download', filename)
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(url)
      } else {
        throw new Error('服务器返回了无效的响应格式')
      }
    } catch (error: any) {
      console.error('导出失败:', error)
      let errorMessage = '导出失败'
      
      if (error.code === 'ECONNABORTED') {
        errorMessage = '请求超时，请检查后端服务是否正常运行'
      } else if (error.message && (error.message.includes('Network Error') || error.message.includes('Failed to fetch'))) {
        errorMessage = '网络错误：无法连接到后端服务器。请确保后端服务已启动（运行 python backend/app.py）'
      } else if (error.response) {
        // 服务器返回了响应
        if (error.response.data instanceof Blob) {
          // 如果是blob响应，尝试读取错误信息
          try {
            const text = await error.response.data.text()
            try {
              const errorData = JSON.parse(text)
              errorMessage = errorData.error || errorMessage
            } catch {
              errorMessage = `导出失败: ${error.response.status} ${error.response.statusText}`
            }
          } catch {
            errorMessage = `导出失败: ${error.response.status} ${error.response.statusText}`
          }
        } else {
          // 尝试解析JSON错误响应
          try {
            const errorData = typeof error.response.data === 'string' 
              ? JSON.parse(error.response.data) 
              : error.response.data
            errorMessage = errorData.error || errorMessage
          } catch {
            errorMessage = error.response.statusText || errorMessage
          }
        }
      } else if (error.message) {
        errorMessage = error.message
      }
      
      await showAppAlert('导出失败', errorMessage)
    } finally {
      setExporting(false)
    }
  }

  // 如果当前视图不是公式计算，显示对应的页面
  if (currentView === 'about' && aboutDepartment) {
    return renderAboutPage()
  }

  if (currentView === 'settings') {
    return renderSettingsPage()
  }

  if (!formula) {
    return (
      <div className={`flex-1 flex items-center justify-center ${
        darkMode ? 'bg-gray-900' : 'bg-gray-50'
      }`}>
        <div className={darkMode ? 'text-gray-400' : 'text-gray-500'}>
          请从左侧选择一个公式
        </div>
      </div>
    )
  }

  const dissipationAutoKqlSnapshot =
    formula && isSlurryDissipationFormula
      ? dissipationStep1AutoKqlByFormula[formula.id]
      : undefined
  const dissipationKqlHintStatus: 'none' | 'synced' | 'edited' =
    dissipationAutoKqlSnapshot == null ||
    parameters['K_QL'] == null ||
    isNaN(parameters['K_QL'] as number)
      ? 'none'
      : Math.abs((parameters['K_QL'] as number) - dissipationAutoKqlSnapshot) <=
          1e-8 * Math.max(1, Math.abs(dissipationAutoKqlSnapshot))
        ? 'synced'
        : 'edited'

  const dissipationStep2ValidateMsg = isSlurryDissipationFormula
    ? validateSlurryDissipationStep(2)
    : null

  /** 浆体消能等：尽量多显有效数字，与后端高精度输出一致 */
  const fmtDissipation = (x: number) => {
    if (!Number.isFinite(x)) return '—'
    const a = Math.abs(x)
    if (a === 0) return '0'
    if (a >= 1e7 || (a > 0 && a < 1e-4)) return x.toExponential(12)
    const t = Math.round(x * 1e14) / 1e14
    let s = t.toString()
    if (s.includes('e') || s.includes('E')) return x.toExponential(12)
    if (s.includes('.')) s = s.replace(/\.?0+$/, '')
    return s || '0'
  }

  let dissipationStep1Parts: {
    numerator: number
    denominator: number
    ld: number
    Ls: number
    d: number
    fromBackend: boolean
  } | null = null
  if (
    isSlurryDissipationFormula &&
    result?.success &&
    (result.result?.intermediate?.step_1_kql != null || result.result?.K_QL != null)
  ) {
    const int = result.result?.intermediate
    const ld = parameters['lambda_d']
    const Ls = parameters['L_s']
    const d = parameters['d']
    const hasThree =
      ld != null &&
      Ls != null &&
      d != null &&
      !isNaN(ld) &&
      !isNaN(Ls) &&
      !isNaN(d)
    if (hasThree) {
      const bn = int?.kql_numerator
      const bd = int?.kql_denominator_d5
      if (
        bn != null &&
        bd != null &&
        !isNaN(Number(bn)) &&
        !isNaN(Number(bd))
      ) {
        dissipationStep1Parts = {
          numerator: Number(bn),
          denominator: Number(bd),
          ld: Number(ld),
          Ls: Number(Ls),
          d: Number(d),
          fromBackend: true,
        }
      } else {
        const ldN = Number(ld)
        const LsN = Number(Ls)
        const dN = Number(d)
        dissipationStep1Parts = {
          numerator: 6.3755e-9 * ldN * LsN,
          denominator: dN ** 5,
          ld: ldN,
          Ls: LsN,
          d: dN,
          fromBackend: false,
        }
      }
    }
  }

  const dissipationStep1IxForUi =
    dissipationStep1Parts ??
    (formula ? dissipationStep1IxCacheByFormula[formula.id] ?? null : null)

  const dissipationDeltaHDisplay =
    result?.success && isSlurryDissipationFormula
      ? (() => {
          const dh =
            result.result?.delta_h ?? result.result?.intermediate?.step_2_delta_h
          return dh != null && dh !== undefined && !isNaN(Number(dh))
            ? `${fmtDissipation(Number(dh))} m`
            : null
        })()
      : null

  /** 与刘德忠等公式底部「中间计算结果」相同的版式（灰底卡片 + 四列网格 + getIntermediateLabel） */
  const renderIntermediateResultsBlock = (
    entries: [string, unknown][],
    formulaIdForLabel?: string
  ) => {
    if (entries.length === 0) return null
    return (
      <div className={`mt-4 p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <div
          className={`text-sm font-medium mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}
        >
          中间计算结果:
        </div>
        <div
          className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm ${
            darkMode ? 'text-gray-300' : 'text-gray-600'
          }`}
        >
          {entries.map(([key, value]) => {
            const labelElement = getIntermediateLabel(key, formulaIdForLabel)
            const isReactElement = typeof labelElement !== 'string'
            return (
              <div key={key} className="flex flex-col">
                <div className="text-gray-500 text-xs mb-1">
                  {isReactElement ? labelElement : `${labelElement}:`}
                </div>
                <span className="font-mono font-semibold">{value as ReactNode}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={scrollContainerRef}
      className={mainScrollClassName}
    >
      {/* 动画全屏弹层 */}
      {isAnimationFullscreen && fullscreenAnimationType && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-2 sm:p-4"
          onClick={() => setIsAnimationFullscreen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="全屏展示动画"
        >
          <div
            className={`w-[95vw] h-[92vh] max-w-none rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
              darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between px-4 py-3 border-b ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
              <div className={`text-sm font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                {fullscreenStatusText || '动画展示'}
              </div>
              <button
                type="button"
                className={`w-9 h-9 rounded-full flex items-center justify-center text-xl ${
                  darkMode ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                onClick={() => setIsAnimationFullscreen(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="p-3 sm:p-4 flex-1 min-h-0 overflow-hidden flex flex-col">
              {renderFlowAnimation(fullscreenAnimationType, fullscreenStatusColor || (darkMode ? 'text-gray-200' : 'text-gray-700'), 'full')}
              <div className={`mt-3 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                提示：按 Esc 可退出全屏展示。
              </div>
            </div>
          </div>
        </div>
      )}
      <div className={contentWrapperClassName}>
        {/* Header：大标题下副标题与全站一致，不随视图切换改写 */}
        <div className="mb-5">
          <h1 className={`text-2xl font-bold mb-2 ${
            darkMode ? 'text-gray-100' : 'text-gray-900'
          }`}>
            长沙院浆体管道计算工具
          </h1>
          <p className={`text-xs ${
            darkMode ? 'text-gray-400' : 'text-gray-500'
          }`}>
            {APP_TAGLINE_ZH}
          </p>
        </div>

        {/* Formula Section with Input Parameters */}
        <div className={mainPanelCardClassName}>
          <h2 className={`text-xl font-semibold mb-3 ${
            darkMode ? 'text-gray-100' : 'text-gray-900'
          }`}>
            {(formula?.id === 'slurry_accel_energy' ? '浆体加速流' : formula.name)}：
          </h2>
          
          {isPumpHeadPlaceholder ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath(formula.description)}
              </p>
              <div className={`rounded-xl border-2 p-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  公式、参数与算例正在整理中，后续版本发布后即可在本页直接计算与导出。
                </p>
              </div>
            </>
          ) : isSlurryFrictionWorkflow ? (
            <>
              <div className="mb-6">
                <div className={`text-sm font-semibold mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>公式说明</div>
                <div className="space-y-3">
                  {formula.description
                    .split(/\n\n+/)
                    .map((para) => para.trim())
                    .filter(Boolean)
                    .map((para, idx) => (
                      <p
                        key={idx}
                        className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}
                      >
                        {renderDescriptionWithMath(para)}
                      </p>
                    ))}
                </div>
              </div>

              <p className={`text-xs mb-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                以下在同一页内自上而下完成：① 准备 <InlineMath math="\rho_k" />（可选）→ ② 达西摩阻 <InlineMath math="\lambda" />（关键）→ ③ 水力坡降 <InlineMath math="i_k" />（核心）。不必每步都算，有现成量可直接在下面填写。计算成功时仅在目标格为空时自动传递，避免覆盖已改动的数。
              </p>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  第 1 步（可选）— 浆体当量密度 <InlineMath math="\rho_k" />
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath(SLURRY_FRICTION_WF_STEP_INTROS.step1)}
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="\rho_k = \frac{1}{\frac{C_w}{\rho_g}+\frac{1-C_w}{\rho_s}}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {SLURRY_FRICTION_WF_STEP1_FIELDS.map(({ name, label, unit, placeholder }) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(label)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={placeholder}
                          value={
                            formulaRawInputs['density_mixing']?.[name] ??
                            (formulaParameters['density_mixing']?.[name] != null &&
                            !isNaN(formulaParameters['density_mixing']![name]!)
                              ? String(formulaParameters['density_mixing']![name])
                              : '')
                          }
                          onChange={(e) => handleSubParameterChange('density_mixing', name, e.target.value)}
                          onBlur={() => handleSubParameterBlur('density_mixing', name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                            darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                          }`}
                        />
                        <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => void applyDensityMixingToDarcyKg()}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                      darkMode
                        ? 'border-gray-500 text-gray-200 hover:bg-gray-500/30'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    将 ρ_g、ρ_s 换算填入达西页（×1000 → kg/m³）
                  </button>
                  <button
                    type="button"
                    onClick={() => runFrictionWorkflowStep('density_mixing')}
                    disabled={loading}
                    className="px-6 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    计算本步
                  </button>
                </div>
                {formulaResults['density_mixing']?.success && (
                  <div className={`p-3 rounded-lg text-sm ${darkMode ? 'bg-blue-900/30 text-gray-200' : 'bg-blue-50 text-gray-800'}`}>
                    <InlineMath math="\rho_k" /> ={' '}
                    <span className="font-mono font-bold text-lg">
                      {String(formulaResults['density_mixing']?.result?.rho_k ?? '—')}
                    </span>{' '}
                    t/m³；已写入最终式；达西页 ρ_g、ρ_s 若为空已按 ×1000 尝试填入（可改）
                  </div>
                )}
              </div>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  第 2 步 — 达西摩阻系数 <InlineMath math="\lambda" />
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath(SLURRY_FRICTION_WF_STEP_INTROS.step2)}
                </p>
                <div className={`mb-4 space-y-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="\rho_1 = \rho_g \cdot C_{1v} + (1 - C_{1v}) \cdot \rho_s" />
                  <BlockMath math="Re_B = \frac{V \cdot D_n \cdot \rho_1}{\eta_1}" />
                  <BlockMath math="\lambda = \begin{cases} \dfrac{64}{Re_B}, & Re_B < 2000 \\[0.6em] \dfrac{1.33036}{\left[\ln\left(\dfrac{\varepsilon}{3.7 D_n} + \dfrac{5.7385}{Re_B^{0.9}}\right)\right]^2}, & Re_B \ge 2000 \end{cases}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {SLURRY_FRICTION_WF_STEP2_FIELDS.map(({ name, label, unit, placeholder }) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(label)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={placeholder}
                          value={
                            formulaRawInputs['darcy_friction']?.[name] ??
                            (formulaParameters['darcy_friction']?.[name] != null &&
                            !isNaN(formulaParameters['darcy_friction']![name]!)
                              ? String(formulaParameters['darcy_friction']![name])
                              : name === 'epsilon'
                                ? '0.0002'
                                : '')
                          }
                          onChange={(e) => handleSubParameterChange('darcy_friction', name, e.target.value)}
                          onBlur={() => handleSubParameterBlur('darcy_friction', name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                            darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                          }`}
                        />
                        <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => runFrictionWorkflowStep('darcy_friction')}
                    disabled={loading}
                    className="px-6 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    计算本步
                  </button>
                </div>
                {formulaResults['darcy_friction']?.success && (
                  <div className={`p-3 rounded-lg text-sm ${darkMode ? 'bg-blue-900/30 text-gray-200' : 'bg-blue-50 text-gray-800'}`}>
                    <InlineMath math="\lambda" /> ={' '}
                    <span className="font-mono font-bold text-lg">
                      {String(formulaResults['darcy_friction']?.result?.lambda_coef ?? '—')}
                    </span>
                    ；已写入最终式；V、D、ρ_s（t/m³）若为空已尝试从本步同步（可改）
                  </div>
                )}
              </div>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  第 3 步（核心）— 达西–魏斯巴赫水力坡降 <InlineMath math="i_k" />
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath(SLURRY_FRICTION_WF_STEP_INTROS.step3)}
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="i_k = \lambda \cdot \frac{V^2 \rho_k}{2 g D \rho_s}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {SLURRY_FRICTION_WF_STEP3_FIELDS.map(({ name, label, unit, placeholder }) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(label)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={placeholder}
                          value={
                            formulaRawInputs['slurry_friction_loss']?.[name] ??
                            (formulaParameters['slurry_friction_loss']?.[name] != null &&
                            !isNaN(formulaParameters['slurry_friction_loss']![name]!)
                              ? String(formulaParameters['slurry_friction_loss']![name])
                              : name === 'g'
                                ? '9.81'
                                : '')
                          }
                          onChange={(e) => handleSubParameterChange('slurry_friction_loss', name, e.target.value)}
                          onBlur={() => handleSubParameterBlur('slurry_friction_loss', name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                            darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                          }`}
                        />
                        <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => runFrictionWorkflowStep('slurry_friction_loss')}
                    disabled={loading}
                    className="px-6 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    计算 i_k
                  </button>
                </div>

                <div className={`rounded-xl border-2 p-4 ${darkMode ? 'bg-blue-900/30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                  <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>本步结果（沿程水力坡降）</div>
                  {formulaResults['slurry_friction_loss']?.success ? (
                    <div className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      <InlineMath math="i_k" /> = {String(formulaResults['slurry_friction_loss']?.result?.i_k ?? '—')} mH₂O/m
                    </div>
                  ) : formulaResults['slurry_friction_loss']?.error ? (
                    <span className={`text-base font-normal ${darkMode ? 'text-red-300' : 'text-red-600'}`}>
                      {formulaResults['slurry_friction_loss']!.error}
                    </span>
                  ) : (
                    <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                  )}
                </div>
              </div>
            </>
          ) : isClearWaterFrictionLoss ? (
            <>
              <div className={`mb-4 p-3 rounded-lg overflow-x-auto ${darkMode ? 'bg-gray-600' : 'bg-gray-50'}`}>
                <BlockMath math="i = 105 \cdot C_h^{-1.85} \cdot d_j^{-4.87} \cdot q_g^{1.85}" />
              </div>
              <div className="mb-6 space-y-3">
                {formula.description
                  .split(/\n\n+/)
                  .map((para) => para.trim())
                  .filter(Boolean)
                  .map((para, idx) => (
                    <p
                      key={idx}
                      className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}
                    >
                      {renderDescriptionWithMath(para)}
                    </p>
                  ))}
              </div>
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-3 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>参数输入</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      {renderDescriptionWithMath(
                        formula.parameters.find((p) => p.name === 'C_h')?.label ||
                          '$C_h$：海澄–威廉系数（Hazen–Williams），无量纲'
                      )}
                    </label>
                    <div className="min-w-0">
                      <ClearWaterChPresetMenu
                        darkMode={darkMode}
                        presetKey={rawInputs['ch_preset'] ?? 'steel100'}
                        onPick={(key) => {
                          if (key === 'custom') {
                            updateRawInputs((prev) => ({ ...prev, ch_preset: 'custom' }))
                            return
                          }
                          const n = CLEAR_WATER_CH_PRESET_VALUES[key]
                          if (n != null) {
                            updateParameters((prev) => ({ ...prev, C_h: n }))
                            updateRawInputs((prev) => ({ ...prev, ch_preset: key, C_h: String(n) }))
                          }
                        }}
                      />
                    </div>
                  </div>
                  {(rawInputs['ch_preset'] ?? 'steel100') === 'custom' && (
                    <div className="md:col-span-2">
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(
                          '$C_h$：自定义海澄–威廉系数，无量纲'
                        )}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          spellCheck={false}
                          value={
                            rawInputs['C_h'] ??
                            (parameters['C_h'] != null && !isNaN(parameters['C_h']!) ? String(parameters['C_h']) : '')
                          }
                          onChange={(e) => handleParameterChange('C_h', e.target.value)}
                          onBlur={() => handleParameterBlur('C_h')}
                          placeholder="按管材或试验取值，如 130"
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                            darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                          }`}
                        />
                      </div>
                    </div>
                  )}
                  {(['K_hw', 'd_j', 'q_g'] as const).map((name) => {
                    const param = formula.parameters.find((p) => p.name === name)
                    const ph =
                      name === 'K_hw'
                        ? '默认 105，与公式书写一致，可按规范调整'
                        : name === 'd_j'
                          ? '管道计算内径，如 0.20'
                          : '管段设计流量，如 0.05'
                    const suffixText =
                      name === 'K_hw'
                        ? '经验参数'
                        : param?.unit != null && param.unit !== ''
                          ? param.unit
                          : null
                    return (
                      <div key={name}>
                        <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                          {param ? renderDescriptionWithMath(param.label || name) : name}
                        </label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            spellCheck={false}
                            value={
                              rawInputs[name] ??
                              (parameters[name] != null && !isNaN(parameters[name]!) ? String(parameters[name]) : '')
                            }
                            onChange={(e) => handleParameterChange(name, e.target.value)}
                            onBlur={() => handleParameterBlur(name)}
                            placeholder={ph}
                            className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                              darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                            }`}
                          />
                          {suffixText != null && (
                            <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              {suffixText}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className={`rounded-xl border-2 p-5 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果</div>
                {result?.success ? (
                  <div className={`space-y-1 text-base ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <InlineMath math="i" />
                      <span>（单位管长水头损失）</span>
                      <span className="font-medium">=</span>
                      <span className={`text-xl font-bold font-mono ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                        {result.result?.i != null ? String(result.result.i) : '—'}
                      </span>
                      <InlineMath math="\mathrm{kPa}/\mathrm{m}" />
                    </div>
                    {result.result?.intermediate &&
                      renderIntermediateResultsBlock(
                        Object.entries(result.result.intermediate),
                        'clear_water_friction_loss'
                      )}
                  </div>
                ) : (
                  <div className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {result?.error ? (
                      <span className={`text-base font-normal ${darkMode ? 'text-red-300' : 'text-red-600'}`}>{result.error}</span>
                    ) : (
                      '—'
                    )}
                  </div>
                )}
              </div>
            </>
          ) : isTotalHeadFormula ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath(formula.description)}
              </p>

              {/* 浆体总扬程：完整公式页面 */}
              {formula?.id === 'slurry_total_head' ? (
                <>
                  <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                    <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>浆体管道输送压力</div>
                    <div className={`mb-4 overflow-x-auto ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      <BlockMath math="P_k = \rho_k g H + \rho_s g \cdot i_k L + P_j + P_n + P_z" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {formula.parameters.map((param) => {
                        const placeholders: Record<string, string> = {
                          rho_k: '浆体密度 t/m³', g: '9.81', H: '几何扬送高度',
                          rho_s: '固体颗粒密度 t/m³', i_k: '沿程摩阻损失系数', L: '管道总长度',
                          P_j: '沿程摩阻 5%~10%', P_n: '每座泵取30~50 kPa', P_z: '每个排出口取30~50 kPa',
                        }
                        return (
                          <div key={param.name}>
                            <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                              {renderDescriptionWithMath(param.label || param.name)}
                            </label>
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                                onChange={(e) => handleParameterChange(param.name, e.target.value)}
                                onBlur={() => handleParameterBlur(param.name)}
                                className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                                placeholder={param.default !== undefined ? String(param.default) : (placeholders[param.name] || '请输入数值')}
                              />
                              {param.unit != null && param.unit !== '' && (
                                <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* 计算结果 + 中间量 */}
                  <div className={`rounded-xl border-2 p-5 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                    <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果：</div>
                    <div className={`space-y-1 text-base ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                      {result?.success ? (
                        <>
                          <div>
                            <InlineMath math="P_k" /> = <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.H_total ?? '—'}</span> kPa
                            {result.result?.H_total != null &&
                              parameters['rho_k'] != null &&
                              !isNaN(Number(parameters['rho_k'])) &&
                              !isNaN(Number(result.result.H_total)) && (
                                <span className={`block text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  折合浆体液柱高度（<InlineMath math="P_k/(\rho_k g)" />
                                  ）：约{' '}
                                  {kPaToFluidHeadM(
                                    Number(result.result.H_total),
                                    Number(parameters['rho_k']),
                                    Number(parameters['g'] ?? 9.81)
                                  )}{' '}
                                  m
                                </span>
                              )}
                          </div>
                          {result.result?.intermediate && (
                            <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-blue-700' : 'border-blue-200'}`}>
                              <div className={`text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>中间计算结果</div>
                              <div className={`grid grid-cols-2 md:grid-cols-3 gap-3 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                <div className="flex flex-col">
                                  <div className="text-gray-500 text-xs mb-1 flex items-center gap-1">
                                    <svg className="w-3.5 h-3.5 shrink-0 text-sky-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                      <path d="M12 3L4 9v12h16V9l-8-6zm0 2.18l6 4.5V19H6v-9.32l6-4.5zM11 10h2v8h-2v-8z" />
                                    </svg>
                                    重力势能压力 <InlineMath math="\rho_k g H" />
                                  </div>
                                  <span className="font-mono font-semibold">{String(result.result.intermediate.gravity_pressure ?? '—')} kPa</span>
                                </div>
                                <div className="flex flex-col">
                                  <div className="text-gray-500 text-xs mb-1 flex items-center gap-1">
                                    <svg className="w-3.5 h-3.5 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                      <path d="M4 15h2V9H4v6zm4 0h2V5H8v10zm4 0h2v-4h-2v4zm4 0h2V7h-2v8z" />
                                    </svg>
                                    沿程压力损失 <InlineMath math="\rho_s g i_k L" />
                                  </div>
                                  <span className="font-mono font-semibold">{String(result.result.intermediate.friction_pressure ?? '—')} kPa</span>
                                  {result.result.intermediate.friction_pressure != null &&
                                    parameters['rho_s'] != null &&
                                    !isNaN(Number(parameters['rho_s'])) &&
                                    !isNaN(Number(result.result.intermediate.friction_pressure)) && (
                                      <span className="text-xs opacity-80 mt-0.5">
                                        ≈{' '}
                                        {kPaToFluidHeadM(
                                          Number(result.result.intermediate.friction_pressure),
                                          Number(parameters['rho_s']),
                                          Number(parameters['g'] ?? 9.81)
                                        )}{' '}
                                        m（<InlineMath math="\rho_s" />）
                                      </span>
                                    )}
                                </div>
                                <div className="flex flex-col">
                                  <div className="text-gray-500 text-xs mb-1">局部摩阻 <InlineMath math="P_j" /></div>
                                  <span className="font-mono font-semibold">{String(result.result.intermediate.P_j ?? '—')} kPa</span>
                                </div>
                                <div className="flex flex-col">
                                  <div className="text-gray-500 text-xs mb-1">泵站零件损失 <InlineMath math="P_n" /></div>
                                  <span className="font-mono font-semibold">{String(result.result.intermediate.P_n ?? '—')} kPa</span>
                                </div>
                                <div className="flex flex-col">
                                  <div className="text-gray-500 text-xs mb-1">出口余压 <InlineMath math="P_z" /></div>
                                  <span className="font-mono font-semibold">{String(result.result.intermediate.P_z ?? '—')} kPa</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      ) : result?.error ? (
                        <span className={darkMode ? 'text-red-300' : 'text-red-600'}>{result.error}</span>
                      ) : (
                        <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                      )}
                    </div>
                  </div>

                  {/* Pk-L 特性曲线 */}
                  {result?.success && result.result?.hl_curve && result.result.hl_curve.length > 0 && (() => {
                    const curveData = result.result!.hl_curve!
                    const clearOther = formulaResults['clear_water_total_head']?.success
                      ? formulaResults['clear_water_total_head']!.result!.hl_curve
                      : undefined
                    const dual = mergePressureCurvesForDualChart(curveData, clearOther)
                    const chartRows =
                      dual.length > 0
                        ? dual
                        : curveData.map((d) => ({ L: d.L, Pk: d.H }))
                    const maxL = chartRows[chartRows.length - 1]?.L ?? 0
                    const maxPk = Math.max(...chartRows.map((d) => Number((d as { Pk?: number }).Pk ?? 0)))
                    const maxPw =
                      dual.length > 0 ? Math.max(...dual.map((d) => Number(d.Pw ?? 0))) : 0
                    const chartId = 'pk-l-chart-container'
                    const showDual = dual.length > 0

                    const handleExportChartPNG = () => {
                      const dateStr = new Date().toISOString().slice(0, 10)
                      downloadScientificHlChartPng({
                        curveData: chartRows.map((r) => ({ L: r.L, H: Number((r as { Pk?: number }).Pk ?? 0) })),
                        darkMode,
                        title: showDual ? '浆体 Pk 与清水 Pw–L 对比' : '浆体管道 Pk–L 特性曲线',
                        subtitle: `Lmax = ${maxL} m，Pk,max = ${maxPk.toFixed(2)} kPa${showDual ? `，Pw,max = ${maxPw.toFixed(2)} kPa` : ''}`,
                        xAxisLabel: 'L (m)',
                        yAxisLabel: 'P (kPa)',
                        lineColor: '#F59E0B',
                        legendText: showDual ? '浆体 Pk / 清水 Pw' : 'Pk = ρk·g·H + ρs·g·ik·L + Pj + Pn + Pz',
                        filename: `Pk-L_slurry_curve_${dateStr}.png`,
                      })
                    }

                    return (
                      <div className={`rounded-xl border-2 p-5 mt-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className={`text-lg font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                            <InlineMath math="P_k" />–<InlineMath math="L" />
                            {showDual ? '（含清水 Pw 对比）' : ''}
                          </div>
                          <button
                            type="button"
                            onClick={handleExportChartPNG}
                            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                              darkMode ? 'border-gray-500 text-gray-300 hover:bg-gray-500' : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            导出图片
                          </button>
                        </div>
                        <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          横轴 <InlineMath math="L" /> 为累计管长（m），纵轴为输送压力（kPa）。
                          {showDual
                            ? ' 橙色为浆体 Pk，蓝色为已在「清水总扬程」中计算得到的 Pw（管长离散点一致时叠加）。'
                            : ' 纵轴为浆体泵站需提供的输送压力 Pk。若另行完成清水总扬程计算且管长分段一致，将自动叠加清水曲线。'}
                        </div>
                        <div className={`flex flex-wrap gap-x-5 gap-y-1 text-xs mb-4 px-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          <span><InlineMath math="L_{max}" /> = {maxL} m</span>
                          <span><InlineMath math="P_{k,max}" /> = {maxPk.toFixed(2)} kPa</span>
                          {showDual ? <span><InlineMath math="P_{w,max}" /> = {maxPw.toFixed(2)} kPa</span> : null}
                          <span><InlineMath math="\rho_k" /> = {parameters['rho_k'] ?? '—'} t/m³</span>
                          <span><InlineMath math="i_k" /> = {parameters['i_k'] ?? '—'}</span>
                          <span><InlineMath math="H" /> = {parameters['H'] ?? '—'} m</span>
                        </div>
                        <div id={chartId}>
                          <ResponsiveContainer width="100%" height={380}>
                            <LineChart data={chartRows} margin={{ top: 10, right: 30, left: 20, bottom: 25 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#4B5563' : '#E5E7EB'} />
                              <XAxis
                                dataKey="L"
                                label={{ value: 'L (m)', position: 'insideBottom', offset: -15, style: { fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 12, fontStyle: 'italic' } }}
                                tick={{ fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                                stroke={darkMode ? '#6B7280' : '#9CA3AF'}
                              />
                              <YAxis
                                label={{ value: '压力 (kPa)', angle: -90, position: 'insideLeft', offset: -5, style: { fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 12, fontStyle: 'italic' } }}
                                tick={{ fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                                stroke={darkMode ? '#6B7280' : '#9CA3AF'}
                                domain={showDual ? [0, Math.max(maxPk, maxPw) * 1.05] : undefined}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: darkMode ? '#374151' : '#FFFFFF',
                                  borderColor: darkMode ? '#4B5563' : '#E5E7EB',
                                  color: darkMode ? '#F3F4F6' : '#111827',
                                  borderRadius: 8,
                                  fontSize: 12,
                                }}
                                formatter={(value, name) => {
                                  if (value == null) return ['—', String(name)]
                                  const n = typeof value === 'number' ? value : Number(value)
                                  if (Number.isNaN(n)) return ['—', String(name)]
                                  return [`${n.toFixed(2)} kPa`, String(name)]
                                }}
                                labelFormatter={(label) => `L = ${label} m`}
                              />
                              <Legend
                                verticalAlign="top"
                                height={36}
                                wrapperStyle={{ fontSize: 12, color: darkMode ? '#D1D5DB' : '#374151' }}
                              />
                              <Line
                                type="monotone"
                                dataKey="Pk"
                                name="浆体 Pk"
                                stroke="#F59E0B"
                                strokeWidth={2.5}
                                dot={false}
                                connectNulls
                                activeDot={{ r: 5, strokeWidth: 2, fill: '#F59E0B' }}
                              />
                              {showDual ? (
                                <Line
                                  type="monotone"
                                  dataKey="Pw"
                                  name="清水 Pw"
                                  stroke="#3B82F6"
                                  strokeWidth={2}
                                  dot={false}
                                  connectNulls
                                  activeDot={{ r: 5, strokeWidth: 2, fill: '#3B82F6' }}
                                />
                              ) : null}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <div className={`mt-3 pt-3 border-t text-xs leading-relaxed ${darkMode ? 'border-gray-500 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
                          <strong>图注：</strong>浆体曲线含义同前。若显示清水 Pw，便于在相同管长坐标下对比清水与浆体输送压力随长度的增长差异（需两侧均完成计算且离散点数量一致）。
                        </div>
                      </div>
                    )
                  })()}
                </>
              ) : (
                /* 清水总扬程：独立算法，rho_k=rho_s=rho_w */
                <>
                  <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                    <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>清水管道输送压力</div>
                    <div className={`mb-4 overflow-x-auto ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      <BlockMath math="P_w = \rho_w g (H + i_w L) + P_j + P_n + P_z" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {formula.parameters.map((param) => {
                        const placeholders: Record<string, string> = {
                          rho_w: '1（清水约 1 t/m³）', g: '9.81', H: '几何扬送高度',
                          i_w: '清水摩阻损失系数', L: '管道总长度',
                          P_j: '沿程摩阻 5%~10%', P_n: '每座泵取30~50 kPa', P_z: '每个排出口取30~50 kPa',
                        }
                        return (
                          <div key={param.name}>
                            <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                              {renderDescriptionWithMath(param.label || param.name)}
                            </label>
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                                onChange={(e) => handleParameterChange(param.name, e.target.value)}
                                onBlur={() => handleParameterBlur(param.name)}
                                className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                                placeholder={param.default !== undefined ? String(param.default) : (placeholders[param.name] || '请输入数值')}
                              />
                              {param.unit != null && param.unit !== '' && (
                                <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* 计算结果 + 中间量 */}
                  <div className={`rounded-xl border-2 p-5 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                    <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果：</div>
                    <div className={`space-y-1 text-base ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                      {result?.success ? (
                        <>
                          <div>
                            <InlineMath math="P_w" /> = <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.H_total ?? '—'}</span> kPa
                            {result.result?.H_total != null &&
                              parameters['rho_w'] != null &&
                              !isNaN(Number(parameters['rho_w'])) &&
                              !isNaN(Number(result.result.H_total)) && (
                                <span className={`block text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  折合清水液柱高度（<InlineMath math="P_w/(\rho_w g)" />
                                  ）：约{' '}
                                  {kPaToFluidHeadM(
                                    Number(result.result.H_total),
                                    Number(parameters['rho_w']),
                                    Number(parameters['g'] ?? 9.81)
                                  )}{' '}
                                  m
                                </span>
                              )}
                          </div>
                          {result.result?.intermediate && (
                            <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-blue-700' : 'border-blue-200'}`}>
                              <div className={`text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>中间计算结果</div>
                              <div className={`grid grid-cols-2 md:grid-cols-3 gap-3 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                <div className="flex flex-col">
                                  <div className="text-gray-500 text-xs mb-1 flex items-center gap-1">
                                    <svg className="w-3.5 h-3.5 shrink-0 text-sky-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                      <path d="M12 3L4 9v12h16V9l-8-6zm0 2.18l6 4.5V19H6v-9.32l6-4.5zM11 10h2v8h-2v-8z" />
                                    </svg>
                                    重力势能压力 <InlineMath math="\rho_w g H" />
                                  </div>
                                  <span className="font-mono font-semibold">{String(result.result.intermediate.gravity_pressure ?? '—')} kPa</span>
                                </div>
                                <div className="flex flex-col">
                                  <div className="text-gray-500 text-xs mb-1 flex items-center gap-1">
                                    <svg className="w-3.5 h-3.5 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                                      <path d="M4 15h2V9H4v6zm4 0h2V5H8v10zm4 0h2v-4h-2v4zm4 0h2V7h-2v8z" />
                                    </svg>
                                    沿程压力损失 <InlineMath math="\rho_w g i_w L" />
                                  </div>
                                  <span className="font-mono font-semibold">{String(result.result.intermediate.friction_pressure ?? '—')} kPa</span>
                                  {result.result.intermediate.friction_pressure != null &&
                                    parameters['rho_w'] != null &&
                                    !isNaN(Number(parameters['rho_w'])) &&
                                    !isNaN(Number(result.result.intermediate.friction_pressure)) && (
                                      <span className="text-xs opacity-80 mt-0.5">
                                        ≈{' '}
                                        {kPaToFluidHeadM(
                                          Number(result.result.intermediate.friction_pressure),
                                          Number(parameters['rho_w']),
                                          Number(parameters['g'] ?? 9.81)
                                        )}{' '}
                                        m（<InlineMath math="\rho_w" />）
                                      </span>
                                    )}
                                </div>
                                <div className="flex flex-col">
                                  <div className="text-gray-500 text-xs mb-1">局部摩阻 <InlineMath math="P_j" /></div>
                                  <span className="font-mono font-semibold">{String(result.result.intermediate.P_j ?? '—')} kPa</span>
                                </div>
                                <div className="flex flex-col">
                                  <div className="text-gray-500 text-xs mb-1">泵站零件损失 <InlineMath math="P_n" /></div>
                                  <span className="font-mono font-semibold">{String(result.result.intermediate.P_n ?? '—')} kPa</span>
                                </div>
                                <div className="flex flex-col">
                                  <div className="text-gray-500 text-xs mb-1">出口余压 <InlineMath math="P_z" /></div>
                                  <span className="font-mono font-semibold">{String(result.result.intermediate.P_z ?? '—')} kPa</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      ) : result?.error ? (
                        <span className={darkMode ? 'text-red-300' : 'text-red-600'}>{result.error}</span>
                      ) : (
                        <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                      )}
                    </div>
                  </div>

                  {/* Pw-L 特性曲线 */}
                  {result?.success && result.result?.hl_curve && result.result.hl_curve.length > 0 && (() => {
                    const curveData = result.result!.hl_curve!
                    const slurryOther = formulaResults['slurry_total_head']?.success
                      ? formulaResults['slurry_total_head']!.result!.hl_curve
                      : undefined
                    const dual = mergePressureCurvesForDualChart(slurryOther, curveData)
                    const chartRows =
                      dual.length > 0
                        ? dual
                        : curveData.map((d) => ({ L: d.L, Pw: d.H }))
                    const maxL = chartRows[chartRows.length - 1]?.L ?? 0
                    const maxPw = Math.max(...chartRows.map((d) => Number((d as { Pw?: number }).Pw ?? 0)))
                    const maxPk =
                      dual.length > 0 ? Math.max(...dual.map((d) => Number(d.Pk ?? 0))) : 0
                    const chartId = 'pw-l-chart-container'
                    const showDual = dual.length > 0

                    const handleExportChartPNG = () => {
                      const dateStr = new Date().toISOString().slice(0, 10)
                      downloadScientificHlChartPng({
                        curveData: chartRows.map((r) => ({ L: r.L, H: Number((r as { Pw?: number }).Pw ?? 0) })),
                        darkMode,
                        title: showDual ? '清水 Pw 与浆体 Pk–L 对比' : '清水管道 Pw–L 特性曲线',
                        subtitle: `Lmax = ${maxL} m，Pw,max = ${maxPw.toFixed(2)} kPa${showDual ? `，Pk,max = ${maxPk.toFixed(2)} kPa` : ''}`,
                        xAxisLabel: 'L (m)',
                        yAxisLabel: 'P (kPa)',
                        lineColor: '#3B82F6',
                        legendText: showDual ? '清水 Pw / 浆体 Pk' : 'Pw = ρw·g·H + ρw·g·iw·L + Pj + Pn + Pz',
                        filename: `Pw-L_clear_water_curve_${dateStr}.png`,
                      })
                    }

                    return (
                      <div className={`rounded-xl border-2 p-5 mt-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className={`text-lg font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                            <InlineMath math="P_w" />–<InlineMath math="L" />
                            {showDual ? '（含浆体 Pk 对比）' : ''}
                          </div>
                          <button
                            type="button"
                            onClick={handleExportChartPNG}
                            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                              darkMode ? 'border-gray-500 text-gray-300 hover:bg-gray-500' : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            导出图片
                          </button>
                        </div>
                        <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          横轴 <InlineMath math="L" /> 为累计管长（m），纵轴为压力（kPa）。
                          {showDual
                            ? ' 蓝色为清水 Pw，橙色为已在「浆体总扬程」中计算得到的 Pk。'
                            : ' 完成浆体总扬程计算且管长分段一致时，可叠加浆体曲线对比。'}
                        </div>
                        <div className={`flex flex-wrap gap-x-5 gap-y-1 text-xs mb-4 px-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          <span><InlineMath math="L_{max}" /> = {maxL} m</span>
                          <span><InlineMath math="P_{w,max}" /> = {maxPw.toFixed(2)} kPa</span>
                          {showDual ? <span><InlineMath math="P_{k,max}" /> = {maxPk.toFixed(2)} kPa</span> : null}
                          <span><InlineMath math="\rho_w" /> = {parameters['rho_w'] ?? 1} t/m³</span>
                          <span><InlineMath math="i_w" /> = {parameters['i_w'] ?? '—'}</span>
                          <span><InlineMath math="H" /> = {parameters['H'] ?? '—'} m</span>
                        </div>
                        <div id={chartId}>
                          <ResponsiveContainer width="100%" height={380}>
                            <LineChart data={chartRows} margin={{ top: 10, right: 30, left: 20, bottom: 25 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#4B5563' : '#E5E7EB'} />
                              <XAxis
                                dataKey="L"
                                label={{ value: 'L (m)', position: 'insideBottom', offset: -15, style: { fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 12, fontStyle: 'italic' } }}
                                tick={{ fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                                stroke={darkMode ? '#6B7280' : '#9CA3AF'}
                              />
                              <YAxis
                                label={{ value: '压力 (kPa)', angle: -90, position: 'insideLeft', offset: -5, style: { fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 12, fontStyle: 'italic' } }}
                                tick={{ fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                                stroke={darkMode ? '#6B7280' : '#9CA3AF'}
                                domain={showDual ? [0, Math.max(maxPk, maxPw) * 1.05] : undefined}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: darkMode ? '#374151' : '#FFFFFF',
                                  borderColor: darkMode ? '#4B5563' : '#E5E7EB',
                                  color: darkMode ? '#F3F4F6' : '#111827',
                                  borderRadius: 8,
                                  fontSize: 12,
                                }}
                                formatter={(value, name) => {
                                  if (value == null) return ['—', String(name)]
                                  const n = typeof value === 'number' ? value : Number(value)
                                  if (Number.isNaN(n)) return ['—', String(name)]
                                  return [`${n.toFixed(2)} kPa`, String(name)]
                                }}
                                labelFormatter={(label) => `L = ${label} m`}
                              />
                              <Legend
                                verticalAlign="top"
                                height={36}
                                wrapperStyle={{ fontSize: 12, color: darkMode ? '#D1D5DB' : '#374151' }}
                              />
                              <Line
                                type="monotone"
                                dataKey="Pw"
                                name="清水 Pw"
                                stroke="#3B82F6"
                                strokeWidth={2.5}
                                dot={false}
                                connectNulls
                                activeDot={{ r: 5, strokeWidth: 2, fill: '#3B82F6' }}
                              />
                              {showDual ? (
                                <Line
                                  type="monotone"
                                  dataKey="Pk"
                                  name="浆体 Pk"
                                  stroke="#F59E0B"
                                  strokeWidth={2}
                                  dot={false}
                                  connectNulls
                                  activeDot={{ r: 5, strokeWidth: 2, fill: '#F59E0B' }}
                                />
                              ) : null}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <div className={`mt-3 pt-3 border-t text-xs leading-relaxed ${darkMode ? 'border-gray-500 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
                          <strong>图注：</strong>清水曲线含义同前。若叠加浆体 Pk，便于相同管长坐标下对比两种介质的累计输送压力（需两侧均完成计算且离散点数量一致）。
                        </div>
                      </div>
                    )
                  })()}
                </>
              )}
            </>
          ) : isSlurryDissipationReducer ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath(formula.description)}
              </p>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  1. 计算流量消能系数 <InlineMath math="K_{QL}" />
                </div>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="K_{QL}=\frac{(6.3755\times10^{-9})\lambda_dL_s}{d^5}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {[
                    { name: 'lambda_d', label: '$\\lambda_d$：沿程缩径增阻管道达西摩阻系数', unit: '' },
                    { name: 'L_s', label: '$L_s$：沿程缩径增阻管道长度', unit: 'm' },
                    { name: 'd', label: '$d$：消能管径内径', unit: 'm' },
                  ].map((param) => (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(param.label || param.name)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={
                            rawInputs[param.name] ??
                            (parameters[param.name] != null && !isNaN(parameters[param.name]!)
                              ? String(parameters[param.name])
                              : '')
                          }
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onBlur={() => handleParameterBlur(param.name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                            darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                          }`}
                          placeholder={param.name === 'lambda_d' ? '如 0.025' : param.name === 'L_s' ? '管段长度' : '内径 m'}
                        />
                        {param.unit != null && param.unit !== '' && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mb-4">
                  <button
                    type="button"
                    onClick={() => handleSlurryDissipationStepCalculate(1)}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}
                  >
                    计算
                  </button>
                </div>
                {/* 与刘德忠等公式一致：蓝色主结果区 + 灰色「中间计算结果」网格（共用 renderIntermediateResultsBlock） */}
                <div className={`p-3 rounded-lg ${darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-50'}`}>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    流量消能系数:
                  </div>
                  <div className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                    {result?.success && (result.result?.intermediate?.step_1_kql != null || result.result?.K_QL != null)
                      ? (() => {
                          const v =
                            result.result?.intermediate?.step_1_kql ?? result.result?.K_QL
                          return v != null && v !== '' && !isNaN(Number(v))
                            ? fmtDissipation(Number(v))
                            : String(v)
                        })()
                      : '—'}
                  </div>
                  <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>单位 h²/m⁵</div>
                </div>
                {result?.success &&
                  (result.result?.intermediate?.step_1_kql != null || result.result?.K_QL != null) && (
                    <>
                      {dissipationStep1IxForUi &&
                        renderIntermediateResultsBlock(
                          [
                            [
                              'dissipation_kql_numerator',
                              fmtDissipation(dissipationStep1IxForUi.numerator),
                            ],
                            [
                              'dissipation_kql_denominator',
                              fmtDissipation(dissipationStep1IxForUi.denominator),
                            ],
                          ],
                          formula?.id
                        )}
                      {!dissipationStep1IxForUi &&
                        result.result?.intermediate?.kql_from_direct_input === true && (
                          <p
                            className={`mt-3 text-xs leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                          >
                            已直接输入 <InlineMath math="K_{QL}" />，未展开分子与分母。
                          </p>
                        )}
                      {!dissipationStep1IxForUi &&
                        result.result?.intermediate?.kql_from_direct_input !== true && (
                          <p
                            className={`mt-3 text-xs leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
                          >
                            当前无法列出分子/分母：请确认仍保留步骤1所用的 <InlineMath math="\lambda_d" />、
                            <InlineMath math="L_s" />、<InlineMath math="d" />；或升级后端以返回分解项。
                          </p>
                        )}
                    </>
                  )}
              </div>

              <div className={`rounded-xl border-2 p-5 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  2. 计算消能水头 <InlineMath math="\Delta h" />
                </div>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="\Delta h=K_{QL}Q^2" />
                </div>
                {dissipationKqlHintStatus === 'synced' && (
                  <div
                    className={`mb-3 p-3 rounded-lg text-xs border ${
                      darkMode ? 'bg-gray-800/80 text-gray-200 border-gray-600' : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    系数已与步骤1结果一致，可在输入框中修改；第二步使用框内当前数值。
                  </div>
                )}
                {dissipationKqlHintStatus === 'edited' && dissipationAutoKqlSnapshot != null && (
                  <div
                    className={`mb-3 p-3 rounded-lg text-xs border ${
                      darkMode ? 'bg-gray-800/80 text-amber-100 border-amber-900/40' : 'bg-white text-amber-900 border-amber-200'
                    }`}
                  >
                    已手动修改系数：当前{' '}
                    <span className="font-mono font-semibold">
                      {parameters['K_QL'] != null && !isNaN(parameters['K_QL'] as number) ? String(parameters['K_QL']) : '—'}
                    </span>
                    ；步骤1上次为 <span className="font-mono font-semibold">{String(dissipationAutoKqlSnapshot)}</span>。
                  </div>
                )}
                {dissipationKqlHintStatus === 'none' && dissipationAutoKqlSnapshot == null && (
                  <div
                    className={`mb-3 p-3 rounded-lg text-xs ${darkMode ? 'bg-gray-800/50 text-gray-400' : 'bg-white/70 text-gray-600 border border-gray-200'}`}
                  >
                    可先做步骤1自动填系数，或在本卡直接手填系数。
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {[
                    { name: 'Q', label: '$Q$：浆体流量', unit: 'm³/h', id: 'slurry-dissipation-input-Q' },
                    {
                      name: 'K_QL',
                      label: '$K_{QL}$：流量消能系数（步骤1完成后自动填入，可修改）',
                      unit: 'h²/m⁵',
                    },
                  ].map((param) => (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(param.label || param.name)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          id={'id' in param ? param.id : undefined}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={
                            rawInputs[param.name] ??
                            (parameters[param.name] != null && !isNaN(parameters[param.name]!)
                              ? String(parameters[param.name])
                              : '')
                          }
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onBlur={() => handleParameterBlur(param.name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                            darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                          }`}
                          placeholder={param.name === 'Q' ? '流量 m³/h' : '系数或等待步骤1填入'}
                        />
                        {param.unit != null && param.unit !== '' && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={`p-3 rounded-lg ${darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-50'}`}>
                  <div className={`text-xs mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    消能水头:
                  </div>
                  <div className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                    {dissipationDeltaHDisplay ?? '—'}
                  </div>
                </div>
                {result?.success &&
                  (result.result?.intermediate?.step_2_delta_h != null || result.result?.delta_h != null) &&
                  result.result?.intermediate?.Q_squared != null &&
                  renderIntermediateResultsBlock(
                    [
                      [
                        'dissipation_q_squared',
                        fmtDissipation(Number(result.result.intermediate.Q_squared)),
                      ],
                    ],
                    formula?.id
                  )}
              </div>
            </>
          ) : isSlurryDissipationOrifice ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath(
                  '孔板在管道内形成局部收缩，将多余机械能以水头损失形式耗散。本模块按工程经验式分三步：由开孔直径 $d$ 与管道内径 $D$ 求孔径比 $\\beta$，再求孔板流量消能系数 $K_{Qk}$，最后由 $K_{Qk}$ 与流量 $Q$ 求消能水头 $\\Delta h$。与侧栏「缩径消能」所用沿程 $K_{QL}$ 模型适用场景不同。顺算时上一步结果会写入下一步输入框，亦可任一步单独使用并手改数值。'
                )}
              </p>

              {/* 1. 孔径比 */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  {renderDescriptionWithMath('1. 计算孔径比 $\\beta$')}
                </div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  开孔直径与管道内径反映几何收缩程度，其比值即为孔径比。若只需本步结果，直接填写两项并计算即可。
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="\beta = \frac{d}{D}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {(
                    [
                      ['d', '$d$：孔板开孔直径', '开孔直径，单位 m'],
                      ['D', '$D$：管道内径', '管道内径，单位 m'],
                    ] as const
                  ).map(([name, lab, ph]) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(lab)}
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={
                          formulaRawInputs['orifice_step1']?.[name] ??
                          (formulaParameters['orifice_step1']?.[name] != null &&
                          !isNaN(formulaParameters['orifice_step1']![name]!)
                            ? String(formulaParameters['orifice_step1']![name])
                            : '')
                        }
                        onChange={(e) => handleSubParameterChange('orifice_step1', name, e.target.value)}
                        onBlur={() => handleSubParameterBlur('orifice_step1', name)}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                          darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                        placeholder={ph}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mb-4">
                  <button
                    type="button"
                    onClick={() => void runOrificeWorkflowStep(1)}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}
                  >
                    计算
                  </button>
                </div>
                {formulaResults['orifice_step1']?.success && (
                  <div className={`p-3 rounded-lg ${darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-50'}`}>
                    <div className={`text-xs mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>孔径比 β：</div>
                    <div className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      {formulaResults['orifice_step1']?.result?.beta != null
                        ? fmtDissipation(Number(formulaResults['orifice_step1']!.result!.beta))
                        : '—'}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. K_Qk */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  {renderDescriptionWithMath('2. 计算孔板流量消能系数 $K_{Qk}$')}
                </div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  在已知孔径比与开孔直径时，由下式求系数。参数可由步骤 1 联动填入，也可在本步手填后单独计算。
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="K_{Qk} = 6.3755\times10^{-9}\cdot\frac{(1-\beta^2)(1.142-\beta^2)}{d^4}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {(
                    [
                      ['beta', '$\\beta$：孔径比', '0～1，无量纲'],
                      ['d', '$d$：孔板开孔直径', '开孔直径，单位 m'],
                    ] as const
                  ).map(([name, lab, ph]) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(lab)}
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={
                          formulaRawInputs['orifice_step2']?.[name] ??
                          (formulaParameters['orifice_step2']?.[name] != null &&
                          !isNaN(formulaParameters['orifice_step2']![name]!)
                            ? String(formulaParameters['orifice_step2']![name])
                            : '')
                        }
                        onChange={(e) => handleSubParameterChange('orifice_step2', name, e.target.value)}
                        onBlur={() => handleSubParameterBlur('orifice_step2', name)}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                          darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                        placeholder={ph}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mb-4">
                  <button
                    type="button"
                    onClick={() => void runOrificeWorkflowStep(2)}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}
                  >
                    计算
                  </button>
                </div>
                {formulaResults['orifice_step2']?.success && (
                  <div className={`p-3 rounded-lg ${darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-50'}`}>
                    <div className={`text-xs mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>孔板流量消能系数：</div>
                    <div className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      {formulaResults['orifice_step2']?.result?.K_Qk != null
                        ? fmtDissipation(Number(formulaResults['orifice_step2']!.result!.K_Qk))
                        : '—'}
                    </div>
                    <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>单位 h²/m⁵</div>
                  </div>
                )}
              </div>

              {/* 3. 消能水头 */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  {renderDescriptionWithMath('3. 计算消能水头 $\\Delta h$')}
                </div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  将流量与系数代入下式得到消能水头。若已掌握 <InlineMath math="K_{Qk}" />
                  ，可跳过前两步在本步直接输入；第 3 步请使用页面底部「开始计算」提交。
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="\Delta h = K_{Qk} \cdot Q^2" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {(
                    [
                      ['K_Qk', '$K_{Qk}$：孔板流量消能系数', '系数，单位 h²/m⁵'],
                      ['Q', '$Q$：浆体体积流量', '流量，单位 m³/h'],
                    ] as const
                  ).map(([name, lab, ph]) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(lab)}
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={
                          formulaRawInputs['orifice_step3']?.[name] ??
                          (formulaParameters['orifice_step3']?.[name] != null &&
                          !isNaN(formulaParameters['orifice_step3']![name]!)
                            ? String(formulaParameters['orifice_step3']![name])
                            : '')
                        }
                        onChange={(e) => handleSubParameterChange('orifice_step3', name, e.target.value)}
                        onBlur={() => handleSubParameterBlur('orifice_step3', name)}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                          darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                        placeholder={ph}
                      />
                    </div>
                  ))}
                </div>
                {result?.success === false && result?.error && formula?.id === 'slurry_dissipation_orifice' && (
                  <div
                    className={`mb-4 rounded-lg border px-3 py-3 text-sm ${
                      darkMode ? 'border-red-500/50 bg-red-950/40 text-red-200' : 'border-red-200 bg-red-50 text-red-800'
                    }`}
                  >
                    {result.error}
                  </div>
                )}
                {result?.success && result?.result?.delta_h != null && formula?.id === 'slurry_dissipation_orifice' ? (
                  <>
                    <div className={`p-3 rounded-lg ${darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-50'}`}>
                      <div className={`text-xs mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>消能水头：</div>
                      <div className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                        {fmtDissipation(Number(result.result.delta_h))} m
                      </div>
                    </div>
                    {result.result?.intermediate?.Q_squared != null &&
                      renderIntermediateResultsBlock(
                        [
                          [
                            'dissipation_q_squared',
                            fmtDissipation(Number(result.result.intermediate.Q_squared)),
                          ],
                        ],
                        formula?.id
                      )}
                  </>
                ) : (
                  !(result?.success === false && result?.error) && (
                    <div className={`p-3 rounded-lg ${darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-50'}`}>
                      <div className={`text-xs mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>消能水头：</div>
                      <div className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</div>
                    </div>
                  )
                )}
              </div>
            </>
          ) : isSlurryEnergyPlaceholder ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath('浆体消能模块用于评估输送过程中的能量衰减与消耗特征。当前界面为占位版本，后续将补充完整的模型说明、参数定义、计算过程与结果判据。')}
              </p>
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>参数输入</div>
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  当前版本暂未开放参数配置。
                </p>
              </div>
              <div className={`rounded-xl border-2 p-5 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果：</div>
                <div className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</div>
              </div>
            </>
          ) : formula?.id === 'density_mixing' ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath('本部分为沿程摩阻损失的前置计算，用于由固体质量浓度及液相、固相密度求得浆体当量密度 $\\rho_k$。所得 $\\rho_k$ 将作为达西-魏斯巴赫型浆体摩阻损失公式的输入，可在侧栏「浆体摩阻损失」模块中使用。')}
              </p>
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>计算浆体当量密度</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('由固体质量浓度 $C_w$ 及液相、固相密度 $\\rho_g$、$\\rho_s$ 求浆体当量密度 $\\rho_k$，用于后续达西-魏斯巴赫型浆体摩阻损失计算。')}
                </p>
                <div className={`mb-4 text-xl ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  <BlockMath math="\rho_k = \frac{1}{\frac{C_w}{\rho_g} + \frac{1-C_w}{\rho_s}}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formula.parameters.map((param) => {
                    const placeholders: Record<string, string> = { C_w: '0～1，固体质量浓度', rho_g: '载体/液相密度 t/m³', rho_s: '固体颗粒密度 t/m³' }
                    return (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(param.label || param.name)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onBlur={() => handleParameterBlur(param.name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                          placeholder={placeholders[param.name] || ''}
                        />
                        {param.unit != null && param.unit !== '' && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </div>
              <div className={`rounded-xl border-2 p-5 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果：</div>
                <div className={`space-y-1 text-base ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {result?.success ? (
                    <div><InlineMath math="\rho_k" /> = <span className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.rho_k ?? '—'}</span> t/m³</div>
                  ) : result?.error ? (
                    <span className={darkMode ? 'text-red-300' : 'text-red-600'}>{result.error}</span>
                  ) : (
                    <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                  )}
                </div>
              </div>
            </>
          ) : formula?.id === 'darcy_friction' ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath('本部分用于计算管道内流体流动的沿程阻力系数 $\\lambda$，该系数是计算管道摩阻损失、选择泵型和确定输送能耗的关键参数。')}
              </p>

              {/* 1. 计算混合物密度 ρ₁ */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>{renderDescriptionWithMath('1) 计算混合物密度 ($\\rho_1$)')}</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('管道内流动的矿浆为固液两相混合物，其密度由固体颗粒和液相（通常为水）的体积分数加权平均计算。')}
                </p>
                <div className={`mb-4 text-lg ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  <BlockMath math="\rho_1 = \rho_g \cdot C_{1v} + (1 - C_{1v}) \cdot \rho_s" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formula.parameters.filter((p) => ['rho_1', 'rho_g', 'rho_s', 'C1v'].includes(p.name)).map((param) => {
                    const placeholders: Record<string, string> = { rho_1: '下方计算或直接输入', rho_g: '液相密度 kg/m³', rho_s: '固体颗粒密度 kg/m³', C1v: '0～1，液相体积分数' }
                    return (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(param.label || param.name)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onBlur={() => handleParameterBlur(param.name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                          placeholder={param.default !== undefined ? String(param.default) : placeholders[param.name] || ''}
                        />
                        {param.unit != null && param.unit !== '' && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </div>

              {/* 2. 计算雷诺数 ReB */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>{renderDescriptionWithMath('2) 计算雷诺数 ($Re_B$)')}</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('雷诺数是判断流体流动状态（层流或湍流）的无量纲数，其大小直接影响摩阻系数的计算方法。')}
                </p>
                <div className={`mb-4 text-lg ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  <BlockMath math="Re_B = \frac{V \cdot D_n \cdot \rho_1}{\eta_1}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formula.parameters.filter((p) => ['Re_B', 'V', 'D_n', 'eta_1'].includes(p.name)).map((param) => {
                    const placeholders: Record<string, string> = { Re_B: '下方计算或直接输入', V: '管道内矿浆平均流速', D_n: '管道内径', eta_1: '动力粘度，实验或经验公式' }
                    return (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(param.label || param.name)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onBlur={() => handleParameterBlur(param.name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                          placeholder={param.default !== undefined ? String(param.default) : placeholders[param.name] || ''}
                        />
                        {param.unit != null && param.unit !== '' && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </div>

              {/* 3. 计算达西摩阻系数 λ */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>{renderDescriptionWithMath('3) 计算达西摩阻系数 ($\\lambda$)')}</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('采用显式科尔布鲁克-怀特公式，适用于水力光滑区、过渡区和完全粗糙区（湍流）。当 $Re_B < 2000$ 时采用层流解析解 $\\lambda = 64/Re_B$。所得 $\\lambda$ 可代入达西-魏斯巴赫公式 $h_f = \\lambda \\cdot (L/D_n) \\cdot (V^2/(2g))$ 计算沿程水头损失。在本软件中，可通过侧栏选择「沿程摩阻损失 → 浆体摩阻损失」模块，基于 $\\lambda$ 进行水力坡降与单位管长摩阻损失 $i_k$ 的计算。')}
                </p>
                <div className={`mb-4 text-lg ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  <BlockMath math="\lambda = \frac{1.33036}{\left[\ln\left(\frac{\varepsilon}{3.7 D_n} + \frac{5.7385}{Re_B^{0.9}}\right)\right]^2}" />
                </div>
                <div className={`text-xs mb-2 opacity-80 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{renderDescriptionWithMath('层流 ($Re_B < 2000$) 时：$\\lambda = 64/Re_B$')}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formula.parameters.filter((p) => ['epsilon', 'D_n', 'Re_B'].includes(p.name)).map((param) => {
                    const placeholders: Record<string, string> = { epsilon: '可查工程手册', D_n: '下方计算或直接输入', Re_B: '下方计算或直接输入' }
                    return (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(param.label || param.name)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onBlur={() => handleParameterBlur(param.name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                          placeholder={param.default !== undefined ? String(param.default) : placeholders[param.name] || ''}
                        />
                        {param.unit != null && param.unit !== '' && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </div>

              {/* 底部结果区（计算由右下角「开始计算」统一触发） */}
              <div className={`rounded-xl border-2 p-5 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果：</div>
                <div className={`space-y-1 text-base ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {result?.success ? (
                    <>
                      <div><InlineMath math="\rho_1" /> = <span className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.intermediate?.step_A_rho_1 ?? result.result?.rho_1 ?? '—'}</span> kg/m³</div>
                      <div><InlineMath math="Re_B" /> = <span className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.intermediate?.step_B_Re_B ?? result.result?.Re_B ?? '—'}</span></div>
                      <div><InlineMath math="\lambda" /> = <span className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.lambda_coef ?? '—'}</span> {result.result?.intermediate?.flow_regime ? `（${result.result.intermediate.flow_regime}）` : ''}</div>
                    </>
                  ) : result?.error ? (
                    <span className={darkMode ? 'text-red-300' : 'text-red-600'}>{result.error}</span>
                  ) : (
                    <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                  )}
                </div>
              </div>
            </>
          ) : formula?.id === 'slurry_friction_loss' ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath(formula.description)}
              </p>

              {/* 达西-魏斯巴赫公式：浆体摩阻损失 i_k */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>达西-魏斯巴赫公式（浆体摩阻损失）</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('本模型通过引入当量密度 $\\rho_k$ 的概念，将达西-魏斯巴赫公式扩展应用于气-固-液多相流的摩阻损失计算。公式 $i_k$ 在经典形式的基础上，乘以密度比 $\\rho_k/\\rho_s$，以校正由于固体颗粒存在导致的附加能量损失。计算结果 $i_k$ 可直接用于计算给定管长 $L$ 下的总沿程水头损失：$h_f = i_k \\cdot L$。本方法适用于固体浓度适中、颗粒均匀悬浮的浆体或气力输送系统。当固体浓度极高或流动状态异常时，需结合经验系数进行修正。')}
                </p>
                <div className={`mb-4 text-lg ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  <BlockMath math="i_k = \lambda \cdot \frac{V^2}{2gD} \cdot \frac{\rho_k}{\rho_s}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formula.parameters.filter((p) => ['rho_k', 'lambda_coef', 'V', 'D', 'rho_s', 'g'].includes(p.name)).map((param) => {
                    const placeholders: Record<string, string> = { rho_k: '可由「密度混合公式」计算或直接输入', lambda_coef: '可由「达西摩阻系数」计算或直接输入', V: '管道内平均流速', D: '管道内径', rho_s: '固体颗粒密度', g: '9.81' }
                    return (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(param.label || param.name)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onBlur={() => handleParameterBlur(param.name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                          placeholder={param.default !== undefined ? String(param.default) : placeholders[param.name] || ''}
                        />
                        {param.unit != null && param.unit !== '' && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </div>

              {/* 底部结果区（计算由右下角「开始计算」统一触发） */}
              <div className={`rounded-xl border-2 p-5 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果：</div>
                <div className={`space-y-1 text-base ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {result?.success ? (
                    <div><InlineMath math="i_k" /> = <span className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.intermediate?.step_B_i_k ?? result.result?.i_k ?? '—'}</span> mH₂O/m</div>
                  ) : result?.error ? (
                    <span className={darkMode ? 'text-red-300' : 'text-red-600'}>{result.error}</span>
                  ) : (
                    <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                  )}
                </div>
              </div>
            </>
          ) : formula?.id === 'kronodze_pressure' ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath('本模型主要用于计算流体输送系统中压力管道的临界流速和摩阻损失，其计算结果可运用于管材和泵选型。该模型适用于：1、有压隧洞泥沙运输，管道内悬浮液处于第一、第二临界流速情况下；2、适用于固体密度小于 $3$、颗粒粒径小于 $0.4$ mm 的浆体。在重力流管道情况下，该模型的应用价值有限。当体积浓度 $C_v>30\\%$ 时，该模型计算得出的数据与实际情况偏差较大。本方法采用三步顺序计算，每步可独立执行，结果将作为下一步的输入。')}
              </p>

              {/* 1. 计算矿浆流量：公式 → 本步参数 → 计算 → 结果 */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>1. 计算矿浆流量</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('根据干尾矿重量 $W$、矿浆中水重 $G$、尾矿相对密度 $\\rho_g$ 及波动系数 $K$，计算矿浆流量 $Q_k$。$Q_k$ 为后续步骤的基础，单位 m^3/s。')}
                </p>
                <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="Q_k = K \cdot W \cdot \left(\frac{1}{\rho_g}+\frac{G}{W}\right)" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {formula.parameters.filter((p) => ['K', 'G', 'W', 'rho_g'].includes(p.name)).map((param) => (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(
                          param.name === 'K'
                            ? 'K：波动系数（默认 1.1，无量纲）'
                            : param.name === 'W'
                            ? 'W：干尾矿重量'
                            : param.name === 'G'
                            ? 'G：矿浆中水重'
                            : '$\\rho_g$：尾矿相对密度'
                        )}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onBlur={() => handleParameterBlur(param.name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                          placeholder={param.default !== undefined ? String(param.default) : '请输入数值'}
                        />
                        {param.name !== 'K' && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            {param.name === 'rho_g' ? 't/m³' : 't/h'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mb-4">
                  <button
                    type="button"
                    onClick={() => handleKronodzeStepCalculate(1)}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}
                  >
                    计算
                  </button>
                </div>
                <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>计算结果：</div>
                <div className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                  {result?.success && result.result?.intermediate?.step_A_Qk != null ? result.result.intermediate.step_A_Qk : '—'}
                </div>
                <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>单位 m³/s</div>
              </div>

              {/* 2. 计算临界管径：公式(按dp) → 本步参数 → 计算 → 结果 */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>2. 计算临界管径</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('需先完成步骤1得到矿浆流量 $Q_k$。输入尾矿加权平均粒径 $d_p$（mm）和固体物料相对密度修正系数 $\\beta$，根据 $d_p$ 取值范围自动选用对应公式，由 $Q_k$ 反解得到临界管径 $D_L$（mm）。')}
                </p>
                {(() => {
                  const dpRaw = parameters['dp'] ?? rawInputs['dp']
                  const dpNum = typeof dpRaw === 'number' && !isNaN(dpRaw) ? dpRaw : (typeof dpRaw === 'string' ? parseFloat(dpRaw) : NaN)
                  if (dpNum <= 0.07 && !isNaN(dpNum)) {
                    return (
                      <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{renderDescriptionWithMath('当 $d_p\\le0.07$ mm 时使用：')}</span>
                        <BlockMath math="Q_k = 0.157\beta \cdot D_L \cdot (1 + 3.434 \cdot \sqrt[4]{C_d \cdot D_L^{0.15}})" />
                        <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{renderDescriptionWithMath('由 $Q_k$ 反解 $D_L$（$C_d=W/G\\times100$ 由步骤1自动得到）')}</div>
                      </div>
                    )
                  }
                  if (dpNum > 0.07 && dpNum <= 0.15) {
                    return (
                      <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{renderDescriptionWithMath('当 $0.07<d_p\\le0.15$ mm 时使用：')}</span>
                        <BlockMath math="Q_k = 0.2\beta \cdot D_L \cdot (1 + 2.48 \cdot \sqrt[3]{C_d \cdot \sqrt[4]{D_L}})" />
                        <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{renderDescriptionWithMath('由 $Q_k$ 反解 $D_L$（$C_d=W/G\\times100$ 由步骤1自动得到）')}</div>
                      </div>
                    )
                  }
                  return <div className={`mb-3 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{renderDescriptionWithMath('请输入 $d_p$（$\\le0.07$ 或 $0.07\\sim0.15$ mm）以选择对应公式')}</div>
                })()}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      粒径区间选择
                    </label>
                    <select
                      value={(parameters['dp'] != null && !isNaN(parameters['dp']!) && parameters['dp']! <= 0.07) ? 'small' : 'medium'}
                      onChange={(e) => {
                        const nextDp = e.target.value === 'small' ? 0.07 : 0.15
                        updateRawInputs(prev => ({ ...prev, dp: String(nextDp) }))
                        updateParameters(prev => ({ ...prev, dp: nextDp }))
                        updateKronodzeStep2Ready(false)
                        updateKronodzeStep3Visible(false)
                        updateLockedVc(null)
                        setAutoCalculateRef(false)
                      }}
                      className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                    >
                      <option value="small">dp ≤ 0.07 mm</option>
                      <option value="medium">0.07 &lt; dp ≤ 0.15 mm</option>
                    </select>
                  </div>
                  {formula.parameters.filter((p) => p.name === 'beta').map((param) => (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(param.label || param.name)}
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onBlur={() => handleParameterBlur(param.name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                          placeholder={param.default !== undefined ? String(param.default) : '请输入数值'}
                        />
                        {param.unit != null && param.unit !== '' && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mb-4">
                  <button
                    type="button"
                    onClick={() => handleKronodzeStepCalculate(2)}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}
                  >
                    计算
                  </button>
                </div>
                <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>计算结果：</div>
                <div className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                  {result?.success && result.result?.intermediate?.step_B_DL_mm != null ? `${result.result.intermediate.step_B_DL_mm} mm` : '—'}
                </div>
              </div>

              {/* 3. 计算临界流速：公式 → 由步骤1、2结果计算，无额外参数 → 计算 → 结果 + 动画 */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>3. 计算临界流速</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('需先完成步骤1、2。由步骤1得到的 $C_d$（重量砂水比 $=W/G\\times100$）、步骤2得到的 $D_L$（临界管径 mm）及 $\\beta$，计算临界流速 $V_L$（m/s）。无需额外输入。')}
                </p>
                <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="V_L = 0.255\beta(1+2.48\sqrt[3]{C_d}\sqrt[4]{D_L})" />
                </div>
                <div className="mb-2">
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>计算结果：</div>
                </div>
                <div className={`text-xl font-bold ${kronodzeStep3Visible ? (darkMode ? 'text-blue-400' : 'text-blue-600') : (darkMode ? 'text-gray-500' : 'text-gray-400')}`}>
                  {kronodzeStep3Visible && result?.success && result.result?.Vc !== undefined ? `${result.result.Vc} m/s` : '—'}
                </div>
              </div>

              {/* 克诺罗兹法中间计算结果 */}
              {kronodzeStep3Visible && result?.success && result.result?.intermediate && (() => {
                const inter = result.result.intermediate as Record<string, unknown>
                const formulaKeys = ['term_cd', 'term_dl', 'bracket_term', 'step_A_Qk', 'step_B_DL_mm'] as const
                const entries = formulaKeys.filter(k => inter[k] != null).map(k => [k, inter[k]] as const)
                if (entries.length === 0) return null
                return (
                  <div className={`mt-4 p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                    <div className={`text-sm font-medium mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>中间计算结果</div>
                    <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      {entries.map(([key, value]) => {
                        const label = getIntermediateLabel(key, formula?.id)
                        const isReactElement = typeof label !== 'string'
                        const displayValue = typeof value === 'number'
                          ? (key === 'step_A_Qk'
                              ? `${value} m³/s`
                              : key === 'step_B_DL_mm'
                                ? `${value} mm`
                                : String(value))
                          : String(value)
                        return (
                          <div key={key} className="flex flex-col">
                            <div className="text-gray-500 text-xs mb-1">
                              {isReactElement ? label : `${label}:`}
                            </div>
                            <span className="font-mono font-semibold">{displayValue}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </>
          ) : (
            <>
              <div className={`mb-4 p-3 rounded-lg overflow-x-auto ${
                darkMode ? 'bg-gray-600' : 'bg-gray-50'
              }`}>
                {isSlurryAccelFormula ? (
                  <BlockMath math="\left(Z_1 + \frac{P_1}{\rho k g}\right) - \left(Z_2 + \frac{P_2}{\rho k g}\right) > iL" />
                ) : (
                  <BlockMath math={convertFormulaToLatex(formula.formula)} />
                )}
              </div>
              <p className={`text-sm leading-relaxed mb-4 ${
                darkMode ? 'text-gray-300' : 'text-gray-600'
              }`}>
                {formula?.id === 'slurry_accel_energy'
                  ? renderDescriptionWithMath('本公式为浆体加速流判据，用于分析管道输送系统中浆体能否维持或形成加速流动状态。其核心原理是对比管道两断面间的机械能差与流动过程中的沿程阻力损耗。具体而言，公式左侧 $(Z_1+H_1)-(Z_2+H_2)$代表了系统的总驱动水头，由位置水头 $(Z)$与压能水头 $(H)$共同构成；右侧 $iL$ 代表了浆体流过长度为 $L$ 的管道所消耗的沿程摩阻水头。当驱动水头大于摩阻损失时，富余的能量将转化为浆体的动能，从而满足加速流的条件。')
                  : renderDescriptionWithMath(formula.description)}
              </p>
            </>
          )}

          {/* Input Parameters - 非 B.C.克诺罗兹法、非浆体摩阻损失、非达西摩阻系数、非密度混合 时显示统一参数区 */}
          {formula?.id !== 'kronodze_pressure' && formula?.id !== 'slurry_friction_loss' && formula?.id !== 'darcy_friction' && formula?.id !== 'density_mixing' && formula?.id !== 'slurry_friction_workflow' && !isSlurryDissipationFormula && !isSlurryEnergyPlaceholder && !isClearWaterFrictionLoss && !isTotalHeadFormula && !isPumpHeadPlaceholder && !isSlurryDissipationOrifice && (
          <div className={`border-t pt-4 ${
            darkMode ? 'border-gray-600' : 'border-gray-200'
          }`}>
            <h3 className={`text-base font-semibold mb-3 ${
              darkMode ? 'text-gray-100' : 'text-gray-900'
            }`}>
              参数输入
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {formula.parameters.map((param) => (
                <div key={param.name}>
                  <label className={`block text-sm font-medium mb-1 ${
                    darkMode ? 'text-gray-200' : 'text-gray-700'
                  }`}>
                    {renderDescriptionWithMath(param.label || param.name)}
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      min={param.name === 'Cv' ? 0 : undefined}
                      max={param.name === 'Cv' ? 1 : undefined}
                      value={(() => {
                        const raw = rawInputs[param.name]
                        if (raw !== undefined) return raw
                        const val = parameters[param.name]
                        return val !== undefined && val !== null && !isNaN(val) ? String(val) : ''
                      })()}
                      onChange={(e) => handleParameterChange(param.name, e.target.value)}
                      onBlur={() => handleParameterBlur(param.name)}
                      className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                        darkMode 
                          ? 'bg-gray-600 border-gray-500 text-gray-100 placeholder-gray-400' 
                          : 'bg-white border-gray-300 text-gray-900'
                      }`}
                      placeholder={param.default !== undefined ? String(param.default) : "请输入数值"}
                    />
                    {param.unit != null && param.unit !== '' && (
                      <span className={`text-sm shrink-0 ${
                        darkMode ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        {param.unit}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>

        {/* Results Section：克诺罗兹法在完成步骤3得到 V_L 后与本区联动（锁定/对比）；步骤未完成时不显示本区以免与步骤内结果重复 */}
        {(formula?.id !== 'kronodze_pressure' || kronodzeStep3Visible) &&
          formula?.id !== 'slurry_friction_loss' &&
          formula?.id !== 'darcy_friction' &&
          formula?.id !== 'density_mixing' &&
          formula?.id !== 'slurry_friction_workflow' &&
          !isSlurryDissipationFormula &&
          !isSlurryEnergyPlaceholder &&
          !isClearWaterFrictionLoss &&
          !isTotalHeadFormula &&
          !isPumpHeadPlaceholder &&
          !isSlurryDissipationOrifice && (
        <div className={mainPanelCardClassName}>
          <h3 className={`text-base font-semibold mb-3 ${
            darkMode ? 'text-gray-100' : 'text-gray-900'
          }`}>
            计算结果
          </h3>
          <div className="space-y-4">
            <div className={`p-3 rounded-lg ${
              darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-50'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className={`text-xs ${
                  darkMode ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {formula?.id === 'friction_loss'
                    ? '沿程摩阻损失:'
                    : formula?.id === 'density_mixing'
                    ? '浆体密度:'
                    : formula?.id === 'darcy_friction'
                    ? '达西摩阻系数 λ:'
                    : isSlurryAccelFormula
                    ? '条件判断:'
                    : '临界流速计算结果:'}
                </div>
                {result?.success && result.result?.Vc !== undefined && (
                  <button
                    onClick={() => {
                      if (lockedVc === null) {
                        // 锁定当前临界流速
                        updateLockedVc(result.result!.Vc ?? null)
                        setAutoCalculateRef(true) // 启用自动计算
                      } else {
                        // 解锁
                        updateLockedVc(null)
                        setAutoCalculateRef(false) // 禁用自动计算
                      }
                    }}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      lockedVc !== null
                        ? darkMode
                          ? 'bg-red-900 bg-opacity-50 text-red-300 hover:bg-red-800'
                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                        : darkMode
                        ? 'bg-green-900 bg-opacity-50 text-green-300 hover:bg-green-800'
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                    title={lockedVc !== null ? '点击解锁临界流速' : '点击锁定临界流速'}
                  >
                    {lockedVc !== null ? '🔒 已锁定' : '🔓 锁定'}
                  </button>
                )}
              </div>
              <div
                className={`text-xl font-bold ${
                  result?.success &&
                  (result.result?.condition_met !== undefined ||
                    result.result?.Vc !== undefined ||
                    result.result?.i_k !== undefined ||
                    result.result?.rho_k !== undefined ||
                    result.result?.lambda_coef !== undefined)
                    ? darkMode
                      ? 'text-blue-400'
                      : 'text-blue-600'
                    : result?.error
                      ? darkMode
                        ? 'text-red-300'
                        : 'text-red-600'
                      : darkMode
                        ? 'text-gray-400'
                        : 'text-gray-500'
                }`}
              >
                {result?.success && result.result?.condition_met !== undefined
                  ? (result.result.condition_met
                    ? '✅ 浆体加速流条件满足'
                    : '❌ 浆体加速流条件不满足')
                  : result?.success && (result.result?.Vc !== undefined || result.result?.i_k !== undefined || result.result?.rho_k !== undefined || result.result?.lambda_coef !== undefined)
                  ? `${result.result?.Vc ?? result.result?.i_k ?? result.result?.rho_k ?? result.result?.lambda_coef} ${result.result?.unit ?? ''}`
                  : result?.error || '—'}
              </div>
              {result?.success && result.result?.condition_met !== undefined && result.result?.intermediate && (
                <div className="mt-3">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className={`p-3 rounded-lg border ${darkMode ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-700'}`}>
                      <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>左侧总水头差</div>
                      <div className="text-sm leading-relaxed">
                        <InlineMath math="\left(Z_1 + \frac{P_1}{\rho k g}\right) - \left(Z_2 + \frac{P_2}{\rho k g}\right)" />
                      </div>
                      <div className={`mt-2 text-lg font-semibold ${darkMode ? 'text-blue-300' : 'text-blue-700'}`}>
                        {result.result.intermediate.head_diff} m
                      </div>
                    </div>
                    <div className={`p-3 rounded-lg border ${darkMode ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-700'}`}>
                      <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>右侧摩阻损失</div>
                      <div className="text-sm leading-relaxed">
                        <InlineMath math="iL" />
                      </div>
                      <div className={`mt-2 text-lg font-semibold ${darkMode ? 'text-blue-300' : 'text-blue-700'}`}>
                        {result.result.intermediate.friction_loss_total} m
                      </div>
                    </div>
                  </div>
                  {(() => {
                    const headDiff = Number(result.result.intermediate?.head_diff)
                    const frictionLoss = Number(result.result.intermediate?.friction_loss_total)
                    const hasNumeric = Number.isFinite(headDiff) && Number.isFinite(frictionLoss)
                    const margin = hasNumeric ? headDiff - frictionLoss : null
                    const marginRatio = hasNumeric && frictionLoss > 0 ? (headDiff / frictionLoss) : null
                    const met = result.result.condition_met
                    const hintTitle = met ? '运行建议' : '优化建议'
                    const hintText = !hasNumeric
                      ? '建议先核对输入参数，确保各项单位一致后再进行工况判断。'
                      : met
                      ? `当前工况已满足加速流条件，净水头裕度约 ${margin!.toFixed(3)} m。建议在运行中持续监测压力波动与流量变化，优先保证上游压头稳定，并预留 5%~10% 的设计裕度以应对工况扰动。`
                      : `当前工况未满足加速流条件，尚缺净水头约 ${Math.abs(margin!).toFixed(3)} m。建议优先提高上游有效压头（提高泵扬程或抬高上游液位），并同步降低沿程损失（减小摩阻系数 i、缩短等效管长 L、优化管径与局部构件）后复核。`

                    return (
                      <div className={`mt-2 p-3 rounded-lg border text-sm leading-relaxed ${
                        met
                          ? (darkMode ? 'bg-green-900/20 border-green-700 text-green-200' : 'bg-green-50 border-green-200 text-green-800')
                          : (darkMode ? 'bg-amber-900/20 border-amber-700 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800')
                      }`}>
                        <div className="font-semibold mb-1">{hintTitle}</div>
                        <div>{hintText}</div>
                        {hasNumeric && marginRatio !== null && (
                          <div className={`mt-1 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                            当前能量比（左侧/右侧）≈ {marginRatio.toFixed(3)}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}
              {lockedVc !== null && (
                <div className={`mt-2 pt-2 border-t ${
                  darkMode ? 'border-blue-700' : 'border-blue-200'
                }`}>
                  <div className={`text-xs mb-1 ${
                    darkMode ? 'text-gray-300' : 'text-gray-600'
                  }`}>
                    锁定的临界流速: <span className={`font-semibold ${
                      darkMode ? 'text-blue-400' : 'text-blue-700'
                    }`}>
                      {lockedVc} m/s
                    </span>
                  </div>
                  {result?.success && result.result?.Vc !== undefined && (() => {
                    const newVc = result.result.Vc
                    // 使用后端返回的动画类型和流速比例
                    const animationType = result.animation_type || 'still-flow'
                    const velocityRatio = result.velocity_ratio || (newVc / lockedVc)
                    
                    // 根据动画类型设置状态文本和颜色
                    let statusText: string
                    let statusColor: string
                    let bgColor: string
                    let borderColor: string
                    
                    if (animationType === 'settle-30') {
                      statusText = '⚠️ 严重沉降'
                      statusColor = darkMode ? 'text-red-300' : 'text-red-700'
                      bgColor = darkMode ? 'bg-red-900 bg-opacity-30' : 'bg-red-100'
                      borderColor = darkMode ? 'border-red-600' : 'border-red-300'
                    } else if (animationType === 'settle-20') {
                      statusText = '⚠️ 中度沉降'
                      statusColor = darkMode ? 'text-orange-300' : 'text-orange-700'
                      bgColor = darkMode ? 'bg-orange-900 bg-opacity-30' : 'bg-orange-100'
                      borderColor = darkMode ? 'border-orange-600' : 'border-orange-300'
                    } else if (animationType === 'settle-10-flow') {
                      statusText = '⚠️ 轻度沉降'
                      statusColor = darkMode ? 'text-yellow-300' : 'text-yellow-700'
                      bgColor = darkMode ? 'bg-yellow-900 bg-opacity-30' : 'bg-yellow-100'
                      borderColor = darkMode ? 'border-yellow-600' : 'border-yellow-300'
                    } else if (animationType === 'still-flow') {
                      statusText = '临界状态'
                      statusColor = darkMode ? 'text-blue-300' : 'text-blue-700'
                      bgColor = darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-100'
                      borderColor = darkMode ? 'border-blue-600' : 'border-blue-300'
                    } else if (animationType === 'medium-flow') {
                      statusText = '✅ 正常流动'
                      statusColor = darkMode ? 'text-green-300' : 'text-green-700'
                      bgColor = darkMode ? 'bg-green-900 bg-opacity-30' : 'bg-green-100'
                      borderColor = darkMode ? 'border-green-600' : 'border-green-300'
                    } else {
                      statusText = '✅ 快速流动'
                      statusColor = darkMode ? 'text-green-300' : 'text-green-700'
                      bgColor = darkMode ? 'bg-green-900 bg-opacity-30' : 'bg-green-100'
                      borderColor = darkMode ? 'border-green-600' : 'border-green-300'
                    }
                    
                    return (
                      <div className={`mt-1 py-2 px-3 rounded text-xs ${bgColor} border ${borderColor} ${
                        darkMode ? 'text-gray-200' : 'text-gray-800'
                      }`}>
                        <div className="flex items-start gap-3">
                          {/* 左侧文字区域 - 占据2/3 */}
                          <div className="flex-1 min-w-0" style={{ flex: '2', maxWidth: '66.666%' }}>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="font-semibold">{statusText}</div>
                              <button
                                type="button"
                                onClick={() => {
                                  setFullscreenAnimationType(animationType)
                                  setFullscreenStatusText(statusText)
                                  setFullscreenStatusColor(statusColor)
                                  setIsAnimationFullscreen(true)
                                }}
                                className={`shrink-0 px-2 py-1 rounded text-[11px] border transition-colors ${
                                  darkMode
                                    ? 'bg-gray-800/50 border-gray-500 text-gray-200 hover:bg-gray-800'
                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                全屏展示
                              </button>
                            </div>
                            <div className="space-y-1 text-xs leading-relaxed break-words">
                              <div>
                                当前计算的临界流速: <span className="font-semibold">{newVc} m/s</span>
                              </div>
                              <div>
                                锁定的临界流速: <span className="font-semibold">{lockedVc} m/s</span>
                              </div>
                              <div className="mt-1.5 break-words">
                                {animationType === 'settle-30' 
                                  ? `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，严重沉降风险`
                                  : animationType === 'settle-20'
                                  ? `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，中度沉降风险`
                                  : animationType === 'settle-10-flow'
                                  ? `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，轻度沉降风险`
                                  : animationType === 'still-flow'
                                  ? `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，临界状态，需要保持稳定流速`
                                  : animationType === 'medium-flow'
                                  ? `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，正常流动，安全`
                                  : `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，快速流动，安全`
                                }
                              </div>
                            </div>
                          </div>
                          
                          {/* 右侧动画区域 - 占据1/3 */}
                          <div className="flex-shrink-0" style={{ flex: '1', minWidth: '120px', maxWidth: '33.333%' }}>
                            <div className="flex flex-col items-center">
                              {animationType === 'settle-30' ? (
                                <>
                                  <div className="w-full h-20 bg-red-50 rounded border-2 border-red-500 relative overflow-hidden">
                                    <div className="absolute inset-0">
                                      {/* 液体层（亮红色，静止） */}
                                      <div className="absolute inset-0 bg-gradient-to-b from-red-400 via-red-500 to-red-600 z-0"></div>
                                      {/* 底部沉积层 - 30%高度（棕色，带透明度） */}
                                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-700 via-amber-600 to-amber-500 z-10"
                                           style={{ height: '30%', opacity: 0.7 }}></div>
                                      {/* 底部堆积的颗粒（从0%开始堆积，像小山一样，到30%处较少，形成凹凸不平的海底层） */}
                                      {[...Array(25)].map((_, i) => {
                                        const size = 0.8 + (i % 3) * 0.4 // 更小的颗粒
                                        // 使用更随机的分布算法
                                        const seed1 = (i * 13 + 19) % 97
                                        const seed2 = (i * 23 + 29) % 89
                                        const seed3 = (i * 17 + 31) % 73
                                        const startLeft = 3 + ((seed1 * seed2) % 94) // 随机分布在整个宽度
                                        
                                        // 从底部开始堆积，越往上颗粒越少
                                        // 使用随机高度分布，大部分在底部，少部分在顶部
                                        const heightSeed = (seed1 * seed2 * seed3) % 100
                                        let particleBottom: number
                                        if (heightSeed < 50) {
                                          // 50%的颗粒在底部0-10%
                                          particleBottom = (heightSeed / 50) * 10
                                        } else if (heightSeed < 80) {
                                          // 30%的颗粒在10-20%
                                          particleBottom = 10 + ((heightSeed - 50) / 30) * 10
                                        } else {
                                          // 20%的颗粒在20-30%
                                          particleBottom = 20 + ((heightSeed - 80) / 20) * 10
                                        }
                                        
                                        return (
                                          <div key={`settled-${i}`} 
                                               className="absolute bg-amber-800 rounded-full z-20"
                                               style={{
                                                 width: `${size * 3}px`,
                                                 height: `${size * 3}px`,
                                                 left: `${startLeft}%`,
                                                 bottom: `${particleBottom}%`
                                               }}></div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>严重沉降</span>
                                </>
                              ) : animationType === 'settle-20' ? (
                                <>
                                  <div className="w-full h-20 bg-orange-50 rounded border-2 border-orange-400 relative overflow-hidden">
                                    <div className="absolute inset-0">
                                      {/* 液体层（由上往下流动） */}
                                      <div className="absolute inset-0 bg-gradient-to-b from-orange-200 via-orange-300 to-orange-400"
                                           style={{
                                             animation: 'flow-vertical 3s linear infinite',
                                             backgroundSize: '100% 200%'
                                           }}></div>
                                      {/* 底部沉积层 - 20%高度 */}
                                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-700 via-amber-600 to-amber-500"
                                           style={{ height: '20%' }}></div>
                                      {/* 颗粒大小不一，使用临界状态的颗粒样式，在管道内随机分布，有规模的从上到下沉降 */}
                                      {[...Array(20)].map((_, i) => {
                                        const size = 0.8 + (i % 4) * 0.3 // 更小的颗粒
                                        // 使用更复杂的随机分布算法，增加随机性
                                        const seed1 = (i * 17 + 23 + Math.floor(i / 3) * 7) % 97
                                        const seed2 = (i * 31 + 41 + Math.floor(i / 5) * 11) % 89
                                        const seed3 = (i * 13 + 19) % 73 // 额外的随机因子
                                        const startLeft = 2 + ((seed1 * seed3) % 96) // 更随机的水平分布
                                        const startTop = 2 + ((seed2 * seed3) % 93) // 更随机的垂直分布
                                        const animationDuration = 3.5 // 统一的动画时长，让所有颗粒同时移动
                                        return (
                                          <div key={i} 
                                               className="absolute bg-blue-800 rounded-full"
                                               style={{
                                                 width: `${size * 3}px`,
                                                 height: `${size * 3}px`,
                                                 left: `${startLeft}%`,
                                                 top: `${startTop}%`,
                                                 animation: `particle-settle-medium ${animationDuration}s ease-in-out infinite`,
                                                 animationDelay: `${i * 0.05}s` // 很小的延迟，让颗粒几乎同时移动
                                               }}></div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>中度沉降</span>
                                </>
                              ) : animationType === 'settle-10-flow' ? (
                                <>
                                  <div className="w-full h-20 bg-yellow-50 rounded border-2 border-yellow-400 relative overflow-hidden">
                                    <div className="absolute inset-0">
                                      {/* 液体层（由上往下流动） */}
                                      <div className="absolute inset-0 bg-gradient-to-b from-yellow-200 via-yellow-300 to-yellow-200"
                                           style={{
                                             animation: 'flow-vertical 4s linear infinite',
                                             backgroundSize: '100% 200%'
                                           }}></div>
                                      {/* 底部沉积层 - 10%高度 */}
                                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-700 via-amber-600 to-amber-500"
                                           style={{ height: '10%' }}></div>
                                      {/* 颗粒大小不一，使用临界状态的颗粒样式，在管道内随机分布，小幅从上到下沉降 */}
                                      {[...Array(20)].map((_, i) => {
                                        const size = 0.8 + (i % 4) * 0.3 // 更小的颗粒
                                        // 使用更复杂的随机分布算法，增加随机性
                                        const seed1 = (i * 17 + 23 + Math.floor(i / 3) * 7) % 97
                                        const seed2 = (i * 31 + 41 + Math.floor(i / 5) * 11) % 89
                                        const seed3 = (i * 13 + 19) % 73 // 额外的随机因子
                                        const startLeft = 2 + ((seed1 * seed3) % 96) // 更随机的水平分布
                                        const startTop = 2 + ((seed2 * seed3) % 93) // 更随机的垂直分布
                                        const animationDuration = 4 // 统一的动画时长，让所有颗粒同时移动
                                        return (
                                          <div key={i} 
                                               className="absolute bg-blue-800 rounded-full"
                                               style={{
                                                 width: `${size * 3}px`,
                                                 height: `${size * 3}px`,
                                                 left: `${startLeft}%`,
                                                 top: `${startTop}%`,
                                                 animation: `particle-settle-light ${animationDuration}s ease-in-out infinite`,
                                                 animationDelay: `${i * 0.05}s` // 很小的延迟，让颗粒几乎同时移动
                                               }}></div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>轻度沉降</span>
                                </>
                              ) : animationType === 'still-flow' ? (
                                <>
                                  <div className="w-full h-20 bg-blue-50 rounded border-2 border-blue-400 relative overflow-hidden">
                                    <div className="absolute inset-0">
                                      {/* 液体（静止） */}
                                      <div className="absolute inset-0 bg-gradient-to-b from-blue-300 via-blue-400 to-blue-300"></div>
                                      {/* 颗粒大小不一，非常静止流动（极小幅度向右移动，消失后复位） */}
                                      {[...Array(20)].map((_, i) => {
                                        const size = 0.8 + (i % 4) * 0.3 // 更小的颗粒
                                        // 使用更复杂的随机分布算法，增加随机性
                                        const seed1 = (i * 17 + 23 + Math.floor(i / 3) * 7) % 97
                                        const seed2 = (i * 31 + 41 + Math.floor(i / 5) * 11) % 89
                                        const seed3 = (i * 13 + 19) % 73 // 额外的随机因子
                                        const startLeft = 2 + ((seed1 * seed3) % 96) // 更随机的水平分布
                                        const startTop = 2 + ((seed2 * seed3) % 93) // 更随机的垂直分布
                                        const animationDuration = 4 + (i % 5) * 0.4 // 更慢的动画时长（4-5.6秒）
                                        return (
                                          <div key={i} 
                                               className="absolute bg-blue-800 rounded-full"
                                               style={{
                                                 width: `${size * 3}px`,
                                                 height: `${size * 3}px`,
                                                 left: `${startLeft}%`,
                                                 top: `${startTop}%`,
                                                 animation: `particle-flow-still ${animationDuration}s ease-in-out infinite`,
                                                 animationDelay: `${i * 0.2}s`
                                               }}></div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>临界状态</span>
                                </>
                              ) : animationType === 'medium-flow' ? (
                                <>
                                  <div className="w-full h-20 bg-green-50 rounded border-2 border-green-400 relative overflow-hidden">
                                    <div className="absolute inset-0">
                                      {/* 液体（正常流动） */}
                                      <div className="absolute inset-0 bg-gradient-to-r from-green-300 via-green-400 to-green-300"
                                           style={{
                                             animation: 'flow-slow 2s linear infinite',
                                             backgroundSize: '200% 100%'
                                           }}></div>
                                      {/* 颗粒大小不一，正常流动（小幅度向右移动，消失后复位） */}
                                      {[...Array(20)].map((_, i) => {
                                        const size = 0.8 + (i % 4) * 0.3 // 更小的颗粒
                                        // 使用更随机的分布算法
                                        const seed1 = (i * 19 + 29) % 97
                                        const seed2 = (i * 37 + 43) % 89
                                        const startLeft = 3 + (seed1 * 0.94) % 94 // 随机分布在3%-97%之间
                                        const startTop = 3 + (seed2 * 0.92) % 92 // 随机分布在3%-95%之间
                                        const animationDuration = 2.5 + (i % 5) * 0.25 // 正常流动动画时长（2.5-3.5秒）
                                        return (
                                          <div key={i} 
                                               className="absolute bg-green-800 rounded-full"
                                               style={{
                                                 width: `${size * 3}px`,
                                                 height: `${size * 3}px`,
                                                 left: `${startLeft}%`,
                                                 top: `${startTop}%`,
                                                 animation: `particle-flow-medium ${animationDuration}s ease-in-out infinite`,
                                                 animationDelay: `${i * 0.12}s`
                                               }}></div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>正常流动</span>
                                </>
                              ) : (
                                <>
                                  <div className="w-full h-20 bg-green-50 rounded border-2 border-green-400 relative overflow-hidden">
                                    <div className="absolute inset-0">
                                      {/* 液体（快速流动） */}
                                      <div className="absolute inset-0 bg-gradient-to-r from-green-300 via-green-400 to-green-300"
                                           style={{
                                             animation: 'flow-fast 1.5s linear infinite',
                                             backgroundSize: '200% 100%'
                                           }}></div>
                                      {/* 颗粒大小不一，快速流动（大幅度快速向右移动，消失后复位） */}
                                      {[...Array(25)].map((_, i) => {
                                        const size = 0.8 + (i % 4) * 0.3 // 更小的颗粒
                                        // 使用更随机的分布算法
                                        const seed1 = (i * 23 + 31) % 97
                                        const seed2 = (i * 41 + 47) % 89
                                        const startLeft = 3 + (seed1 * 0.94) % 94 // 随机分布在3%-97%之间
                                        const startTop = 3 + (seed2 * 0.92) % 92 // 随机分布在3%-95%之间
                                        const animationDuration = 2.0 + (i % 5) * 0.2 // 快速动画时长（2.0-2.8秒）
                                        return (
                                          <div key={i} 
                                               className="absolute bg-green-800 rounded-full"
                                               style={{
                                                 width: `${size * 3}px`,
                                                 height: `${size * 3}px`,
                                                 left: `${startLeft}%`,
                                                 top: `${startTop}%`,
                                                 animation: `particle-flow-fast ${animationDuration}s ease-in-out infinite`,
                                                 animationDelay: `${i * 0.08}s`
                                               }}></div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>快速流动</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                  {(!result?.success || result.result?.Vc === undefined) && lockedVc !== null && (
                    <div className={`mt-2 p-2 rounded text-xs border ${
                      darkMode 
                        ? 'bg-yellow-900 bg-opacity-30 text-yellow-300 border-yellow-600' 
                        : 'bg-yellow-100 text-yellow-800 border-yellow-300'
                    }`}>
                      <div className="font-semibold mb-1">ℹ️ 提示</div>
                      <div>请调整参数，系统将自动计算并比较新的临界流速与锁定的临界流速</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {result?.success &&
              result.result?.intermediate &&
              formula?.id !== 'kronodze_pressure' &&
              !isSlurryAccelFormula &&
              !isSlurryDissipationFormula &&
              renderIntermediateResultsBlock(
                Object.entries(result.result.intermediate),
                formula?.id
              )}

            {result?.success === false && (
              <div className={`mt-4 p-4 rounded-lg text-sm ${
                darkMode 
                  ? 'bg-red-900 bg-opacity-30 text-red-300' 
                  : 'bg-red-50 text-red-700'
              }`}>
                {result.error}
              </div>
            )}
          </div>
        </div>
        )}

        {/* 操作区：计算与导出（卡片式布局） */}
        {!isSlurryEnergyPlaceholder && (
        <div
          className={`mt-2 rounded-2xl border shadow-md overflow-hidden ${
            darkMode
              ? 'border-gray-600 bg-gradient-to-b from-gray-800/80 to-gray-800/40'
              : 'border-gray-200/90 bg-gradient-to-br from-white via-slate-50/80 to-blue-50/40'
          }`}
        >
          <div
            className={`px-4 sm:px-5 py-3.5 flex items-start sm:items-center gap-3 border-b ${
              darkMode
                ? 'border-gray-600/80 bg-gray-900/25'
                : 'border-gray-100 bg-white/70 backdrop-blur-sm'
            }`}
          >
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-inner ${
                darkMode
                  ? 'bg-gradient-to-br from-blue-600/40 to-indigo-700/30 text-blue-200 ring-1 ring-white/10'
                  : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-blue-500/25'
              }`}
              aria-hidden
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-sm sm:text-base font-semibold tracking-tight ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                计算与导出
              </div>
              <div className={`text-xs sm:text-sm mt-0.5 leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                在取得有效计算结果后，可导出体例与表述符合行业技术文件习惯的结构化计算书，便于校核、存档与报审。
              </div>
            </div>
          </div>

          <div className="px-4 sm:px-5 py-4 sm:py-5">
            <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!formula) return

                    updateResult(null)
                    updateLockedVc(null)
                    setAutoCalculateRef(false)
                    if (formula.id === 'slurry_dissipation_orifice') {
                      setFormulaParameters((prev) => {
                        const n = { ...prev }
                        for (const id of ORIFICE_WORKFLOW_SUB_IDS) {
                          delete n[id]
                        }
                        return n
                      })
                      setFormulaRawInputs((prev) => {
                        const n = { ...prev }
                        for (const id of ORIFICE_WORKFLOW_SUB_IDS) {
                          delete n[id]
                        }
                        return n
                      })
                      setFormulaResults((prev) => {
                        const n = { ...prev }
                        for (const id of ORIFICE_WORKFLOW_SUB_IDS) {
                          delete n[id]
                        }
                        delete n[formula.id]
                        return n
                      })
                      return
                    }
                    if (isSlurryDissipationFormula) {
                      delete dissipationAutoKqlRef.current[formula.id]
                      setDissipationStep1AutoKqlByFormula((prev) => {
                        const next = { ...prev }
                        delete next[formula.id]
                        return next
                      })
                      setDissipationStep1IxCacheByFormula((prev) => {
                        const next = { ...prev }
                        delete next[formula.id]
                        return next
                      })
                    }

                    const initialParams: Record<string, number | undefined> = {}
                    const initialRaw: Record<string, string> = {}
                    formula.parameters.forEach((param) => {
                      if (param.default !== undefined) {
                        initialParams[param.name] = param.default
                        initialRaw[param.name] = String(param.default)
                      } else {
                        initialParams[param.name] = undefined
                        initialRaw[param.name] = ''
                      }
                    })
                    if (formula.id === 'clear_water_friction_loss') {
                      initialParams['C_h'] = 100
                      initialRaw['C_h'] = '100'
                      initialRaw['ch_preset'] = 'steel100'
                      initialParams['K_hw'] = 105
                      initialRaw['K_hw'] = '105'
                    }
                    updateParameters(() => initialParams)
                    updateRawInputs(() => initialRaw)
                    if (formula.id === 'kronodze_pressure') {
                      updateKronodzeStep2Ready(false)
                      updateKronodzeStep3Visible(false)
                    }
                  }}
                  disabled={
                    loading ||
                    (formula?.id === 'slurry_dissipation_orifice'
                      ? !ORIFICE_WORKFLOW_SUB_IDS.some((id) => formulaResults[id]?.success)
                      : !result)
                  }
                  title={
                    formula?.id === 'slurry_dissipation_orifice'
                      ? ORIFICE_WORKFLOW_SUB_IDS.some((id) => formulaResults[id]?.success)
                        ? '清除孔板三步的输入与分步结果'
                        : '暂无分步结果可重置'
                      : !result
                        ? '暂无计算结果可重置'
                        : '清除结果并将参数恢复为默认值'
                  }
                  className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-45 disabled:cursor-not-allowed shadow-sm border ${
                    darkMode
                      ? 'border-orange-500/40 bg-orange-600/90 text-white hover:bg-orange-500 hover:shadow-orange-900/20'
                      : 'border-orange-200/80 bg-gradient-to-b from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700 hover:shadow-md hover:shadow-orange-500/20'
                  }`}
                >
                  <svg className="w-4 h-4 shrink-0 opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  重新计算
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (formula?.id === 'kronodze_pressure') {
                      handleKronodzeStartCalculate()
                      return
                    }
                    if (isSlurryDissipationFormula) {
                      void handleSlurryDissipationStepCalculate(2)
                      return
                    }
                    handleCalculate(false)
                  }}
                  disabled={
                    loading
                    || (formula?.id === 'slurry_dissipation_orifice' && validateOrificeSubStep(3) !== null)
                    || (formula?.id === 'kronodze_pressure' && !kronodzeStep2Ready)
                    || (isSlurryDissipationFormula && dissipationStep2ValidateMsg !== null)
                    || (!isSlurryDissipationFormula && formula?.id !== 'kronodze_pressure' && lockedVc !== null)
                  }
                  title={
                    formula?.id === 'slurry_dissipation_orifice'
                      ? validateOrificeSubStep(3) || '计算第 3 步消能水头 Δh（需填写 K_Qk 与 Q）'
                      : isSlurryDissipationFormula
                        ? dissipationStep2ValidateMsg || '填写 Q 与系数后点击开始计算'
                        : lockedVc !== null
                          ? '已锁定临界流速，系统会自动计算'
                          : formula?.id === 'kronodze_pressure' && !kronodzeStep2Ready
                            ? '请先完成步骤2（计算临界管径）'
                            : '根据当前参数执行计算'
                  }
                  className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-45 disabled:cursor-not-allowed shadow-sm border ${
                    darkMode
                      ? 'border-blue-500/40 bg-blue-600 text-white hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-900/30'
                      : 'border-blue-200/80 bg-gradient-to-b from-blue-600 to-blue-700 text-white hover:from-blue-500 hover:to-blue-600 hover:shadow-md hover:shadow-blue-500/25'
                  }`}
                >
                  {loading ? (
                    <>
                      <svg className="w-4 h-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      计算中…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 shrink-0 opacity-95" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      开始计算
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={!result?.success || exporting}
                  title={
                    !result?.success
                      ? '请先成功完成计算后再导出'
                      : exporting
                        ? '正在生成 Word 文档…'
                        : '导出 Word 计算书'
                  }
                  className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-45 disabled:cursor-not-allowed shadow-sm border ${
                    darkMode
                      ? 'border-emerald-500/35 bg-gradient-to-b from-emerald-700/90 to-emerald-800 text-white hover:from-emerald-600 hover:to-emerald-700 hover:shadow-lg hover:shadow-emerald-900/40'
                      : 'border-emerald-200/90 bg-gradient-to-b from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 hover:shadow-md hover:shadow-emerald-500/20'
                  }`}
                >
                  {exporting ? (
                    <>
                      <svg className="w-4 h-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      导出中…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 shrink-0 opacity-95" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      导出计算书
                    </>
                  )}
                </button>
              </div>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
