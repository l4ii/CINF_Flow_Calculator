import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import type { FormulaInfo, CalculationResult, Parameter } from '../types';
import axios from 'axios';
import { API_BASE_URL, API_TIMEOUT } from '../config/api';
// @ts-ignore - react-katex types
import { BlockMath, InlineMath } from 'react-katex';
import 'katex/dist/katex.min.css';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  downloadScientificHlChartPng,
  formatHydraulicHeadTick,
  formatHydraulicLengthTick,
} from '../utils/chartExportCanvas'
import { formatUpdateError } from '../utils/formatUpdateError'
import { stripHtmlToPlain } from '../utils/stripHtmlToPlain'
import {
  APP_EXPORT_FILENAME_PREFIX,
  APP_NAME_EN,
  APP_NAME_ZH,
  APP_TAGLINE_MAIN_EN,
  APP_TAGLINE_ZH,
} from '../constants/appCopy';

/** API 中 unit 为 decimal 时表示无量纲小数：输入框后不再展示英文「decimal」 */
function isApiDecimalUnit(unit: string | undefined | null): boolean {
  if (unit == null || String(unit).trim() === '') return false
  return String(unit).trim().toLowerCase() === 'decimal'
}

/** 将标签里「单位为 decimal」改为中文填写说明（兼容未更新的后端文案） */
function displayParamLabelFromApi(label: string, unit: string | undefined | null): string {
  if (!label) return label
  let s = label.trim()

  if (isApiDecimalUnit(unit)) {
    s = s.replace(/\s*，\s*单位为\s*decimal\s*$/i, '，0~1小数')
    s = s.replace(/\s*单位为\s*decimal\s*$/i, '（请以小数填写）')
    s = s.replace(/单位为\s*decimal/gi, '请以小数填写（含小数点）')
    return s
  }

  // 统一输入参数命名样式：符号：中文名，单位为 xxx
  const m = s.match(/^(\$[^$]+\$)\s*[：:]\s*(.+)$/)
  if (!m) return s
  const symbol = m[1]
  let desc = m[2].trim()
  desc = desc.replace(/\s*，?\s*单位为\s*[^，。；)]*/gi, '').trim()
  desc = desc.replace(/[，,]\s*$/, '').trim()

  const u = unit == null ? '' : String(unit).trim()
  if (u) return `${symbol}：${desc}，单位为 ${u}`
  return `${symbol}：${desc}`
}

function shouldShowParameterUnitSuffix(unit: string | undefined | null): boolean {
  if (unit == null || String(unit).trim() === '') return false
  if (isApiDecimalUnit(unit)) return false
  return true
}

function paramUnitFromFormula(parameters: Parameter[] | undefined, name: string): string {
  return parameters?.find((p) => p.name === name)?.unit ?? ''
}

/** 与后端参数定义对应的「输入框右侧单位」；decimal 类不展示后缀 */
function paramUnitDisplaySuffix(parameters: Parameter[] | undefined, name: string): string {
  const u = paramUnitFromFormula(parameters, name)
  return shouldShowParameterUnitSuffix(u) ? u : ''
}

const PARAM_MEANINGFUL_EXAMPLE_BY_NAME: Record<string, string> = {
  D: '0.2',
  D_n: '0.2',
  L: '1000',
  H: '30',
  V: '2',
  g: '9.81',
  rho_g: '2.5',
  rho_s: '1',
  rho_k: '1.2',
  rho_w: '1',
  rho_1: '1.3',
  eta_1: '0.001',
  eta_j: '0.97',
  eta_b: '0.8',
  eta_v: '0.92',
  eta_c: '0.9',
  lambda_coef: '0.02',
  epsilon: '0.0002',
  i_k: '0.02',
  i_w: '0.01',
  C_w: '0.35',
  C1v: '0.15',
  Cv: '0.3',
  Q_k: '0.15',
  W: '60',
  G: '400',
  K: '1.1',
  K_1: '1.1',
  K_f: '0.85',
  K_p: '0.9',
  K_m: '0.95',
  beta: '1',
  Re_B: '100000',
  P_k: '300',
  P_j: '50',
  P_n: '40',
  P_z: '40',
}

function normalizePlaceholderSubject(rawName: string): string {
  let s = (rawName || '').trim()
  if (!s) return ''
  s = s.replace(/^默认\s*[-+]?\d+(?:\.\d+)?\s*/i, '')
  s = s.replace(/^默认值\s*[-+]?\d+(?:\.\d+)?\s*/i, '')
  s = s.replace(/[，,:：]\s*默认\s*[-+]?\d+(?:\.\d+)?(?:\s*[~～-]\s*[-+]?\d+(?:\.\d+)?)?/gi, '')
  s = s.replace(/[，,:：]\s*默认值\s*[-+]?\d+(?:\.\d+)?(?:\s*[~～-]\s*[-+]?\d+(?:\.\d+)?)?/gi, '')
  s = s.replace(/\s*（\s*默认[^）]*）/gi, '')
  s = s.replace(/\s*\(\s*默认[^)]*\)/gi, '')
  s = s.replace(/\s*（\s*默认值[^）]*）/gi, '')
  s = s.replace(/\s*\(\s*默认值[^)]*\)/gi, '')
  s = s.replace(/\s*（[^）]*(?:单位|无量纲)[^）]*）\s*$/gi, '')
  s = s.replace(/\s*\([^)]*(?:unit|dimensionless)[^)]*\)\s*$/gi, '')
  s = s.replace(/\s*[，,]\s*单位为\s*.+$/i, '')
  s = s.replace(/\s*单位为\s*.+$/i, '')
  s = s.replace(/^[：:，,\s]+|[：:，,\s]+$/g, '')
  if (s.includes('经验系数')) return '经验参数'
  return s
}

function paramZhNameFromFormula(parameters: Parameter[] | undefined, name: string): string {
  const p = parameters?.find((x) => x.name === name)
  const raw = (p?.label ?? '').trim()

  if (raw) {
    // 形如 "$D$：管道内径，单位为 m"
    const mathLead = raw.match(/^\$[^$]+\$\s*[：:]\s*(.+)$/)
    if (mathLead?.[1]) {
      const normalized = normalizePlaceholderSubject(mathLead[1])
      if (normalized) return normalized
    }

    // 形如 "经验系数：默认值9.5（无量纲）"：优先取冒号左侧作为名称
    const colonIdx = raw.search(/[：:]/)
    if (colonIdx >= 0) {
      const left = normalizePlaceholderSubject(raw.slice(0, colonIdx))
      const right = normalizePlaceholderSubject(raw.slice(colonIdx + 1))
      if (left && /默认值/.test(raw.slice(colonIdx + 1))) return left
      if (right) return right
      if (left) return left
    }

    const normalizedRaw = normalizePlaceholderSubject(raw)
    if (normalizedRaw) return normalizedRaw
  }

  const formattedLabel = paramLabelFromFormula(parameters, name)
  const m = formattedLabel.match(/^[^：:]+[：:]\s*([^，,（(]+)/)
  const zhName = normalizePlaceholderSubject((m?.[1] ?? '').trim())
  return zhName || name
}

function meaningfulExampleForParam(parameters: Parameter[] | undefined, name: string): string {
  const byName = PARAM_MEANINGFUL_EXAMPLE_BY_NAME[name]
  if (byName) return byName

  const unit = paramUnitFromFormula(parameters, name).trim().toLowerCase()
  if (unit === 'm') return '0.2'
  if (unit === 'm/s') return '2'
  if (unit === 'm/s²' || unit === 'm/s2') return '9.81'
  if (unit.includes('t/m')) return '1.2'
  if (unit.includes('pa')) return '0.001'
  if (unit === 'kpa') return '50'
  if (unit === 'decimal' || unit === '无量纲') return '0.3'
  return '1'
}

function defaultNumericPlaceholder(
  parameters: Parameter[] | undefined,
  name: string,
  defaultVal: number | string
): string {
  return `${paramZhNameFromFormula(parameters, name)}，默认值 ${defaultVal}`
}

function decimalParameterPlaceholder(
  parameters: Parameter[] | undefined,
  name: string,
  defaultVal: number | string | undefined,
  example: string | undefined
): string {
  const zhName = paramZhNameFromFormula(parameters, name)
  if (defaultVal !== undefined && defaultVal !== null && String(defaultVal).trim() !== '') {
    return `${zhName}，默认值 ${defaultVal}`
  }
  if (example && String(example).trim() !== '') return `${zhName}，如 ${example}`
  return `${zhName}，如 0.3`
}

/** 临界流速公式中 $C_V$ 占位符：仅提示展开辅助计算（0～1、小数等见标签） */
const CV_VOLUME_ASSIST_HINT = '点击输入框展开「体积浓度辅助计算」'

function cvParameterPlaceholder(): string {
  return CV_VOLUME_ASSIST_HINT
}

/** 与「浆体总扬程」页一致：参数行用侧栏 API 的 label（含符号+中文），占位符用中文提示 */
function paramLabelFromFormula(parameters: Parameter[] | undefined, name: string): string {
  const p = parameters?.find((x) => x.name === name)
  const raw = p?.label ?? name
  return displayParamLabelFromApi(raw, p?.unit)
}

function suggestedNumericPlaceholder(
  parameters: Parameter[] | undefined,
  name: string,
  fallbackExample?: string
): string {
  const example = fallbackExample ?? meaningfulExampleForParam(parameters, name)
  return `${paramZhNameFromFormula(parameters, name)}，如 ${example}`
}

function commonParamPlaceholder(parameters: Parameter[] | undefined, name: string): string {
  const p = parameters?.find((x) => x.name === name)
  if (name === 'Cv') return cvParameterPlaceholder()
  if (p && isApiDecimalUnit(p.unit)) {
    return decimalParameterPlaceholder(
      parameters,
      name,
      p.default as number | string | undefined,
      meaningfulExampleForParam(parameters, name)
    )
  }
  const d = p?.default
  if (d !== undefined) return defaultNumericPlaceholder(parameters, name, d)
  return suggestedNumericPlaceholder(parameters, name)
}

function paramPlaceholderFromFormula(
  parameters: Parameter[] | undefined,
  name: string,
  hintZh: Record<string, string>
): string {
  if (hintZh[name]) return hintZh[name]
  return commonParamPlaceholder(parameters, name)
}

/** 离心泵分步输入：占位中文说明（label 来自 app.py） */
const CENTRIFUGAL_PARAM_PLACEHOLDER_ZH: Record<string, string> = {
  C_w: '固相质量分数，如0.35',
  K_p: '扬程修正系数，如1.1',
  K_m: '主泵磨蚀折损系数，常用 0.85～0.98',
  rho_k: '浆体密度，如1.2',
  g: '重力加速度，默认值 9.81',
  Sigma_H_s: '装置所需液柱扬程，如120',
  H_b: '主泵扬程，如150',
  Q_k: '浆体体积流量，如0.05',
  K_1: '点击功率富余系数，常取1.1~1.2',
  eta_j: '传动效率，如0.95',
  eta_b: '泵扬送清水效率，如0.85',
}

/** 离心泵步骤3：η_j 下拉与手填同步（空值且非用户显式选「自定义」时视为联轴器缺省） */
function inferCentrifugalEtaJPreset(
  eta: number | undefined,
  userWantsCustom: boolean
): 'custom' | 'coupling' | 'belt' | 'gear' {
  if ((eta == null || isNaN(eta)) && userWantsCustom) return 'custom'
  if (eta == null || isNaN(eta)) return 'coupling'
  if (Math.abs(eta - 1) < 1e-5) return 'coupling'
  if (eta >= 0.9 - 1e-9 && eta <= 0.94 + 1e-9) return 'belt'
  if (eta >= 0.97 - 1e-9 && eta <= 0.98 + 1e-9) return 'gear'
  return 'custom'
}

/** 容积式泵分步输入 */
const POSITIVE_DISPLACEMENT_PARAM_PLACEHOLDER_ZH: Record<string, string> = {
  P_k: '输送压力，如1200',
  K_f: '压力富余系数，常用 0.75～0.95',
  rho_k: '浆体密度，如1.2',
  g: '重力加速度，默认值 9.81',
  P_b: '主泵总扬程压力，如1600',
  Q_k: '浆体体积流量，如0.05',
  K_1: '点击功率富余系数，常取1.1~1.2',
  eta_v: '泵容积效率，常用 0.90～0.95',
  eta_c: '机械总效率，常用 0.88～0.92',
}

/** 浆体加速流：统一参数提示，避免由公式标签自动提取导致占位符可读性差 */
const SLURRY_ACCEL_PARAM_PLACEHOLDER_ZH: Record<string, string> = {
  Z1: '起点位置水头，如0',
  Z2: '终点位置水头，如1000',
  H1: '起点压能浆体水头，如120',
  H2: '终点压能浆体水头，如80',
  i: '两点间沿程摩阻损失，如0.02',
  L: '管道长度，如1000',
}

/** 浆体摩阻工作流：界面内分步调用的后端 formula_id（共 5 步：ρ_k → ρ₁ → Re_B → λ → i_k） */
const SLURRY_FRICTION_CHAIN_IDS = [
  'density_mixing',
  'darcy_friction_step1_rho1',
  'darcy_friction_step2_re',
  'darcy_friction_step3_lambda',
  'slurry_friction_loss',
] as const

const SLURRY_FRICTION_WF_DARCY_RHO1_FIELDS = [
  {
    name: 'rho_g' as const,
    label: '$\\rho_g$：固体密度',
    unit: 't/m³',
    placeholder: '固体密度，如2.5',
  },
  {
    name: 'rho_s' as const,
    label: '$\\rho_s$：浆体密度',
    unit: 't/m³',
    placeholder: '浆体密度，如1.2',
  },
  {
    name: 'C1v' as const,
    label: '$C_{1V}$：全部浆体似均质体积浓度',
    unit: '无量纲',
    placeholder: '全部浆体似均质体积浓度，如0.15',
  },
]

const SLURRY_FRICTION_WF_DARCY_RE_FIELDS = [
  {
    name: 'rho_1' as const,
    label: '$\\rho_1$：混合物密度',
    unit: 't/m³',
    placeholder: '混合物密度，如1.35',
  },
  {
    name: 'V' as const,
    label: '$V$：断面平均流速',
    unit: 'm/s',
    placeholder: '断面平均流速，如2',
  },
  {
    name: 'D_n' as const,
    label: '$D_n$：管道内径',
    unit: 'm',
    placeholder: '管道内径，如0.2',
  },
  {
    name: 'eta_1' as const,
    label: '$\\eta_1$：混合物动力粘度',
    unit: 'Pa·s',
    placeholder: '混合物动力粘度，如0.001',
  },
]

const SLURRY_FRICTION_WF_DARCY_LAMBDA_FIELDS = [
  {
    name: 'Re_B' as const,
    label: '$Re_B$：雷诺数',
    unit: '无量纲',
    placeholder: '雷诺数，如300000',
  },
  {
    name: 'D_n' as const,
    label: '$D_n$：管道内径',
    unit: 'm',
    placeholder: '管道内径，如0.2',
  },
  {
    name: 'epsilon' as const,
    label: '$\\varepsilon$：管道内壁粗糙度',
    unit: 'm',
    placeholder: '管道内壁粗糙度，默认值 0.053',
  },
]

/** 浆体摩阻工作流：各步骤参数的标签、单位后缀；提示写在输入框 placeholder 内 */
const SLURRY_FRICTION_WF_STEP1_FIELDS = [
  {
    name: 'C_w' as const,
    label: '$C_w$：混合液体的含水率（水相体积分数）',
    unit: '无量纲',
    placeholder: '混合液体的含水率，取值范围0-1',
  },
  {
    name: 'rho_g' as const,
    label: '$\\rho_g$：固体密度',
    unit: 't/m³',
    placeholder: '固体密度，如2.5',
  },
  {
    name: 'rho_s' as const,
    label: '$\\rho_s$：清水密度',
    unit: 't/m³',
    placeholder: '清水密度，默认值1',
  },
]

const SLURRY_FRICTION_WF_STEP3_FIELDS = [
  {
    name: 'rho_k' as const,
    label: '$\\rho_k$：浆体密度',
    unit: 't/m³',
    placeholder: '浆体密度，如1.35',
  },
  {
    name: 'lambda_coef' as const,
    label: '$\\lambda$：达西摩阻系数',
    unit: '无量纲',
    placeholder: '达西摩阻系数，如0.018',
  },
  {
    name: 'V' as const,
    label: '$V$：断面平均流速',
    unit: 'm/s',
    placeholder: '断面平均流速，如2',
  },
  {
    name: 'D' as const,
    label: '$D$：管道内径',
    unit: 'm',
    placeholder: '管道内径，如0.2',
  },
  {
    name: 'rho_s' as const,
    label: '$\\rho_s$：水密度',
    unit: 't/m³',
    placeholder: '水密度，默认值1',
  },
  {
    name: 'g' as const,
    label: '$g$：重力加速度',
    unit: 'm/s²',
    placeholder: '重力加速度，默认值 9.81',
  },
]

const SLURRY_FRICTION_WF_STEP_INTROS: Record<
  'step1' | 'darcy_rho1' | 'darcy_re' | 'darcy_lambda' | 'step5_ik',
  string
> = {
  step1:
    '依据固体质量浓度 $C_w$ 与固体密度 $\\rho_g$、清水密度 $\\rho_s$，按质量加权关系求浆体密度 $\\rho_k$（t/m³）。若浆体密度（$\\rho_k$）已由设计或试验给定，可跳过本步并在「摩阻损失计算」→「浆体摩阻损失」→「5.水力坡降（$i_k$）」中直接输入。',
  darcy_rho1:
    '依据固体密度 $\\rho_g$、液体密度 $\\rho_s$ 与全部浆体似均质体积浓度 $C_{1V}$（即固体体积占总体体积的比例），按体积加权求混合物密度 $\\rho_1$（t/m³）。计算结果自动传递至后续雷诺数计算所需参数集；若混合物密度（$\\rho_1$）已由设计或试验给定，可跳过本步并在「摩阻损失计算」→「浆体摩阻损失」→「3 雷诺数（$Re_B$）」中直接输入。',
  darcy_re:
    '雷诺数是表征管道内流体流动状态的关键无量纲数，是计算摩阻损失的基础参数。该公式采用工程常用的显式近似形式（基于雷诺数定义 $Re=\\rho w D/\\mu$ 推导），直接求解流区的摩阻系数。同时体现了“密度、流速、管径、动力粘度”对流态的综合影响。若雷诺数（$Re_B$）已由设计或试验给定，可跳过本步并在「摩阻损失计算」→「浆体摩阻损失」→「4.达西摩阻系数（$\\lambda$）」中直接输入。',
  darcy_lambda:
    '达西摩阻系数（$\\lambda$）是描述管道内流体流动时阻力特性的无量纲参数，是计算浆体管道摩阻损失（水力坡降）的核心依据。其计算采用科尔布鲁克-怀特（Colebrook-White）公式的近似形式。若达西摩阻系数（$\\lambda$）已由设计或试验给定，可跳过本步并在「摩阻损失计算」→「浆体摩阻损失」→「5.水力坡降（$i_k$）」中直接输入。',
  step5_ik:
    '水力坡降 $i_k$ 计算采用达西-魏斯巴赫公式的多相流扩展形式，通过在经典公式中引入浆体密度与液体介质密度的比值，校正固体颗粒引起的附加能量损失，从而准确表征浆体管道单位管长的水头损失。计算所需的参数若已在前序步骤得出，系统会在当前栏位为空时自动带入，用户也可直接输入已知设计值。',
}
const SLURRY_FRICTION_WF_OVERVIEW_PARAGRAPHS = [
  '本模块通过引入当量密度（$\\rho_k$）的概念，将达西-魏斯巴赫公式扩展应用于气-固-液多相流的摩阻损失计算。公式$i_k$在经典形式的基础上，乘以密度比（$\\frac{\\rho_k}{\\rho_s}$），以校正由于固体颗粒存在导致的附加能量损失。计算结果$i_k$可直接用于计算给定管长$L$下的总沿程水头损失：$h_f = i_k \\cdot L$。本方法适用于固体浓度适中、颗粒均匀悬浮的浆体或气力输送系统。当固体浓度极高或流动状态异常时，需结合经验系数进行修正。',
  '计算步骤：本模块按五个步骤顺序计算 ① 浆体密度 $\\rho_k$；② 混合物密度 $\\rho_1$；③ 雷诺数 $Re_B$；④ 达西摩阻系数 $\\lambda$；⑤ 单位管长水力坡降 $i_k$。各步可单独执行；',
]

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

const SLURRY_EPSILON_PRESET_VALUES: Record<string, number> = {
  new_steel_pipe_053: 0.053,
  new_steel_pipe_055: 0.055,
}

type SlurryEpsilonPresetKey = 'new_steel_pipe_053' | 'new_steel_pipe_055' | 'custom'
const DEFAULT_SLURRY_EPSILON_PRESET: SlurryEpsilonPresetKey = 'new_steel_pipe_053'
const DEFAULT_SLURRY_EPSILON = SLURRY_EPSILON_PRESET_VALUES[DEFAULT_SLURRY_EPSILON_PRESET]

const SLURRY_EPSILON_MENU_ROWS: { key: SlurryEpsilonPresetKey; prose: string; math: string }[] = [
  { key: 'new_steel_pipe_053', prose: '直缝新钢管', math: '\\varepsilon = 0.053' },
  { key: 'new_steel_pipe_055', prose: '直缝新钢管 2', math: '\\varepsilon = 0.055' },
  { key: 'custom', prose: '用户可自定义输入', math: '\\varepsilon' },
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

function SlurryEpsilonPresetMenu({
  darkMode,
  presetKey,
  onPick,
}: {
  darkMode: boolean
  presetKey: string
  onPick: (key: SlurryEpsilonPresetKey) => void
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

  const current = SLURRY_EPSILON_MENU_ROWS.find((r) => r.key === presetKey) ?? SLURRY_EPSILON_MENU_ROWS[0]
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
          {SLURRY_EPSILON_MENU_ROWS.map((row) => (
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

/** 临界流速三公式：$C_V$ 与「体积浓度辅助计算」（C/C_A→C_V）合一 */
function CvVolumeConcentrationField({
  darkMode,
  inputValue,
  onInputChange,
  onInputBlur,
  placeholder,
  unit,
  onApplyCvFromRatio,
}: {
  darkMode: boolean
  inputValue: string
  onInputChange: (value: string) => void
  onInputBlur: () => void
  placeholder: string
  unit: ReactNode
  onApplyCvFromRatio: (cvDecimalString: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [cStr, setCStr] = useState('')
  const [caStr, setCaStr] = useState('')
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

  const norm = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
  const c = parseFloat(norm(cStr))
  const ca = parseFloat(norm(caStr))
  const ratioOk = Number.isFinite(c) && Number.isFinite(ca) && Math.abs(ca) > 1e-15
  const cvRaw = ratioOk ? c / ca : NaN
  const cvRounded = Number.isFinite(cvRaw) ? Math.round(cvRaw * 1e6) / 1e6 : NaN
  const outOfUnitRange = Number.isFinite(cvRounded) && (cvRounded < 0 || cvRounded > 1)

  const shellBorder = darkMode ? 'border-gray-500' : 'border-gray-300'
  const shellBg = darkMode ? 'bg-gray-600' : 'bg-white'
  const shellFocus = open ? 'ring-2 ring-blue-500 ring-offset-0 border-blue-500' : ''
  const innerInputCls = `min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-base focus:outline-none focus:ring-0 ${
    darkMode ? 'text-gray-100 placeholder-gray-400' : 'text-gray-900'
  }`
  const chevronBtnCls = `flex h-full shrink-0 items-center justify-center border-l px-2.5 transition-colors ${
    darkMode
      ? `border-gray-500 text-gray-300 hover:bg-gray-500/40 ${open ? 'bg-gray-500/30' : ''}`
      : `border-gray-300 text-gray-500 hover:bg-gray-50 ${open ? 'bg-gray-50' : ''}`
  }`
  const panelCls = `absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border shadow-lg ${
    darkMode ? 'border-gray-500 bg-gray-800 text-gray-100' : 'border-gray-200 bg-white text-gray-900'
  }`
  const panelInnerCls = darkMode ? 'border-gray-600' : 'border-gray-100'
  const subInputCls = `mt-1 w-full rounded-lg border px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    darkMode ? 'border-gray-500 bg-gray-700/80 text-gray-100' : 'border-gray-300 bg-gray-50 text-gray-900'
  }`
  const hintMuted = darkMode ? 'text-gray-400' : 'text-gray-600'
  const hintStrong = darkMode ? 'text-gray-200' : 'text-gray-800'

  return (
    <div className="relative min-w-0 flex-1" ref={wrapRef}>
      <div className="flex items-stretch space-x-2">
        <div
          className={`flex min-w-0 flex-1 overflow-hidden rounded-lg border ${shellBorder} ${shellBg} ${shellFocus}`}
        >
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onBlur={onInputBlur}
            onClick={() => setOpen(true)}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className={innerInputCls}
            aria-expanded={open}
            aria-controls="cv-ratio-panel"
            id="cv-volume-concentration-input"
          />
          <button
            type="button"
            tabIndex={-1}
            className={chevronBtnCls}
            aria-label={open ? '收起体积浓度辅助计算' : '展开体积浓度辅助计算'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen((v) => !v)}
          >
            <span className={`inline-block text-xs transition-transform ${open ? '-rotate-180' : ''}`} aria-hidden>
              ▼
            </span>
          </button>
        </div>
        {unit}
      </div>

      {open && (
        <div
          id="cv-ratio-panel"
          className={panelCls}
          role="region"
          aria-labelledby="cv-volume-concentration-input"
        >
          <div className={`border-b px-3 py-2.5 ${panelInnerCls}`}>
            <div className={`text-xs font-semibold tracking-wide ${hintStrong}`}>体积浓度辅助计算公式（<InlineMath math="C_V" />）</div>
            <p className={`mt-1 text-[11px] leading-relaxed ${hintMuted}`}>
              本页 <InlineMath math="C_V" /> 为<strong className="font-medium">体积浓度（小数 0～1）</strong>
              ，含义是<strong className="font-medium">固相所占体积</strong>与<strong className="font-medium">浆体混合物总体积</strong>
              之比。若资料给出的是两个体积（或同一量纲下的计量），可用下式换算后再写入上方输入框。
            </p>
            <div className={`mt-2 overflow-x-auto rounded-md py-1 text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              <BlockMath math="C_V = \dfrac{C}{C_A}" />
            </div>
          </div>

          <div className="space-y-3 px-3 py-3">
            <div>
              <div className={`text-xs font-medium ${hintStrong}`}>
                <InlineMath math="C" />
              </div>
              <p className={`mt-0.5 text-[11px] leading-snug ${hintMuted}`}>
                填<strong>固相体积</strong>：与 <InlineMath math="C_A" />{' '}
                <strong>必须用同一单位</strong>（如均为 m³、mL、L）。可取量筒读数、析水/沉降后固体体积，或报告给出的固体体积当量。
              </p>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={cStr}
                onChange={(e) => setCStr(e.target.value)}
                className={subInputCls}
                placeholder="固相体积，如15"
              />
              <p className={`mt-1 text-[11px] leading-snug ${hintMuted}`}>
                与 <InlineMath math="C_A" /> 同单位
              </p>
            </div>
            <div>
              <div className={`text-xs font-medium ${hintStrong}`}>
                <InlineMath math="C_A" />
              </div>
              <p className={`mt-0.5 text-[11px] leading-snug ${hintMuted}`}>
                填<strong>浆体混合物总体积</strong>（液相 + 固相在浆样中占据的总体积），与 <InlineMath math="C" />{' '}
                同单位。<strong>不可为 0</strong>。
              </p>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={caStr}
                onChange={(e) => setCaStr(e.target.value)}
                className={subInputCls}
                placeholder="浆体总体积，如100（与 C 同单位）"
              />
            </div>

            <div
              className={`rounded-lg border px-2.5 py-2 text-xs ${darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}
            >
              <InlineMath math="C_V" />
              <span className={hintMuted}> = </span>
              {ratioOk ? (
                <span className="font-mono text-sm font-semibold">{String(cvRounded)}</span>
              ) : (
                <span className={hintMuted}>—（请填写有效数值且分母非零）</span>
              )}
            </div>

            <p className={`text-[11px] leading-relaxed ${hintMuted}`}>
              <span className="font-medium text-inherit">示例：</span>
              量筒中浆样总体积 <InlineMath math="C_A=100\ \mathrm{mL}" />
              ，固体体积 <InlineMath math="C=15\ \mathrm{mL}" />
              ，则 <InlineMath math="C_V=0.15" />
              （再点「填入」写入上方）。
            </p>

            {outOfUnitRange && (
              <p className={`text-[11px] leading-snug ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                当前比值超出 0～1，临界流速计算通常要求 <InlineMath math="C_V" /> 为小数形式 0～1；请核对试验定义或单位是否一致。
              </p>
            )}

            <div className="flex justify-end gap-2 pt-0.5">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)}
              >
                收起
              </button>
              <button
                type="button"
                disabled={!ratioOk}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                  darkMode ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (!ratioOk) return
                  onApplyCvFromRatio(String(cvRounded))
                  setOpen(false)
                }}
              >
                填入上方 <InlineMath math="C_V" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 刘德忠公式：宾汉体（η）辅助推算似均质中加权平均沉速，挂在本页 ω 输入栏；ρ_g/ρ_k/g 与主表同步 */
/** 与规范 (C.0.3-1) 一致：N_ω = (4.53²/N_d)[√(1+N_d^{1.5}/(0.213^{0.5}×4.53²))−1]² */
const LIU_BINGHAM_REF = 4.53
const LIU_BINGHAM_NW_COEF = LIU_BINGHAM_REF ** 2
const LIU_BINGHAM_NW_INNER_DENOM = Math.sqrt(0.213) * LIU_BINGHAM_NW_COEF

function LiuDezhongOmegaBinghamField({
  darkMode,
  inputValue,
  onInputChange,
  onInputBlur,
  placeholder,
  unit,
  parameters,
  onApplyOmega,
  onDlComputed,
}: {
  darkMode: boolean
  inputValue: string
  onInputChange: (value: string) => void
  onInputBlur: () => void
  placeholder: string
  unit: ReactNode
  parameters: Record<string, number | undefined>
  onApplyOmega: (omegaStr: string) => void
  onDlComputed?: (dL: number | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [rhoGStr, setRhoGStr] = useState('')
  const [rhoKStr, setRhoKStr] = useState('')
  const [gStr, setGStr] = useState('9.81')
  const [gbStr, setGbStr] = useState('')
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const rg = parameters.rho_g
    const rk = parameters.rho_k
    const g0 = parameters.g
    if (rg != null && !isNaN(Number(rg))) setRhoGStr(String(rg))
    if (rk != null && !isNaN(Number(rk))) setRhoKStr(String(rk))
    if (g0 != null && !isNaN(Number(g0))) setGStr(String(g0))
  }, [parameters.rho_g, parameters.rho_k, parameters.g])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const norm = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
  const rho_g = parseFloat(norm(rhoGStr))
  const rho_k = parseFloat(norm(rhoKStr))
  const gVal = parseFloat(norm(gStr))
  const GB = parseFloat(norm(gbStr))

  const deltaOk =
    Number.isFinite(rho_g) &&
    Number.isFinite(rho_k) &&
    rho_k > 0 &&
    rho_g > rho_k &&
    Number.isFinite(GB) &&
    GB > 0 &&
    Number.isFinite(gVal) &&
    gVal > 0

  const delta = deltaOk ? rho_g / rho_k - 1 : NaN
  const D_L =
    deltaOk && delta > 0 ? (GB / rho_k) ** (2 / 3) / (gVal * delta) ** (1 / 3) : NaN
  const W_L = deltaOk && delta > 0 ? (gVal * delta * (GB / rho_k)) ** (1 / 3) : NaN
  /** 与文献一致：代表粒径取上式标准度量粒径 D_L，故 N_d 中 d_i = D_L */
  const d_i = Number.isFinite(D_L) && D_L > 0 ? D_L : NaN

  const ndOk =
    Number.isFinite(D_L) &&
    D_L > 0 &&
    Number.isFinite(d_i) &&
    d_i > 0 &&
    Number.isFinite(W_L) &&
    W_L > 0

  const N_d = ndOk ? d_i / D_L : NaN
  const innerRadicand = ndOk ? 1 + N_d ** 1.5 / LIU_BINGHAM_NW_INNER_DENOM : NaN
  const nwOk =
    ndOk &&
    Number.isFinite(innerRadicand) &&
    innerRadicand >= 0 &&
    N_d > 0 &&
    Number.isFinite(N_d)

  const N_omega = nwOk ? (LIU_BINGHAM_NW_COEF / N_d) * (Math.sqrt(innerRadicand) - 1) ** 2 : NaN
  const w_i = nwOk && Number.isFinite(W_L) ? N_omega * W_L : NaN
  const wRounded = Number.isFinite(w_i) ? Math.round(w_i * 1e6) / 1e6 : NaN
  useEffect(() => {
    onDlComputed?.(Number.isFinite(D_L) && D_L > 0 ? D_L : undefined)
  }, [D_L, onDlComputed])

  const shellBorder = darkMode ? 'border-gray-500' : 'border-gray-300'
  const shellBg = darkMode ? 'bg-gray-600' : 'bg-white'
  const shellFocus = open ? 'ring-2 ring-blue-500 ring-offset-0 border-blue-500' : ''
  const innerInputCls = `min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-base focus:outline-none focus:ring-0 ${
    darkMode ? 'text-gray-100 placeholder-gray-400' : 'text-gray-900'
  }`
  const chevronBtnCls = `flex h-full shrink-0 items-center justify-center border-l px-2.5 transition-colors ${
    darkMode
      ? `border-gray-500 text-gray-300 hover:bg-gray-500/40 ${open ? 'bg-gray-500/30' : ''}`
      : `border-gray-300 text-gray-500 hover:bg-gray-50 ${open ? 'bg-gray-50' : ''}`
  }`
  const panelCls = `absolute left-0 right-0 z-50 mt-1.5 max-h-[min(70vh,32rem)] overflow-y-auto overflow-x-hidden rounded-xl border shadow-lg ${
    darkMode ? 'border-gray-500 bg-gray-800 text-gray-100' : 'border-gray-200 bg-white text-gray-900'
  }`
  const panelInnerCls = darkMode ? 'border-gray-600' : 'border-gray-100'
  const subInputCls = `mt-1 w-full rounded-lg border px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    darkMode ? 'border-gray-500 bg-gray-700/80 text-gray-100' : 'border-gray-300 bg-gray-50 text-gray-900'
  }`
  const hintMuted = darkMode ? 'text-gray-400' : 'text-gray-600'
  const hintStrong = darkMode ? 'text-gray-200' : 'text-gray-800'

  return (
    <div className="relative min-w-0 flex-1" ref={wrapRef}>
      <div className="flex items-stretch space-x-2">
        <div
          className={`flex min-w-0 flex-1 overflow-hidden rounded-lg border ${shellBorder} ${shellBg} ${shellFocus}`}
        >
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onBlur={onInputBlur}
            onClick={() => setOpen(true)}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className={innerInputCls}
            aria-expanded={open}
            aria-controls="liu-omega-bingham-panel"
            id="liu-omega-bingham-input"
          />
          <button
            type="button"
            tabIndex={-1}
            className={chevronBtnCls}
            aria-label={open ? '收起宾汉体加权沉速辅助' : '展开宾汉体加权沉速辅助计算'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen((v) => !v)}
          >
            <span className={`inline-block text-xs transition-transform ${open ? '-rotate-180' : ''}`} aria-hidden>
              ▼
            </span>
          </button>
        </div>
        {unit}
      </div>

      {open && (
        <div id="liu-omega-bingham-panel" className={panelCls} role="region" aria-labelledby="liu-omega-bingham-input">
          <div className={`border-b px-3 py-2.5 ${panelInnerCls}`}>
            <div className={`text-xs font-semibold tracking-wide ${hintStrong}`}>似均质中加权平均沉速辅助计算（ <InlineMath math="\omega" />）</div>
            <div className={`mt-2 space-y-2 overflow-x-auto text-[11px] ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              <BlockMath math="d_L=\dfrac{\left(\eta/\rho_k\right)^{2/3}}{\left[g\left(\rho_g/\rho_k-1\right)\right]^{1/3}}" />
              <BlockMath math="\omega_L=\left[g\left(\dfrac{\rho_g}{\rho_k}-1\right)\dfrac{\eta}{\rho_k}\right]^{1/3}" />
              <BlockMath math="N_d=\dfrac{d_i}{d_L}" />
              <BlockMath math="N_w=\dfrac{\omega_i}{\omega_L}" />
              <BlockMath math="N_{\omega}=\dfrac{20.5209}{N_d}\left[\left(1+\dfrac{N_d^{1.5}}{0.213^{0.5}\times 4.53^2}\right)^{0.5}-1\right]^2" />
              <BlockMath math="\omega_i=N_{\omega}\omega_L" />
            </div>
          </div>

          <div className="space-y-3 px-3 py-3">
            <p className={`text-[10px] leading-snug ${hintMuted}`}>
              <InlineMath math="\rho_g" />、<InlineMath math="\rho_k" />、<InlineMath math="g" /> 已与本页主表同步；可在此修改。
            </p>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="\rho_g" />：固体密度 · t/m³
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={rhoGStr}
                  onChange={(e) => setRhoGStr(e.target.value)}
                  className={subInputCls}
                  placeholder="固体密度，如2.5"
                />
              </div>
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="\rho_k" />：浆体密度 · t/m³
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={rhoKStr}
                  onChange={(e) => setRhoKStr(e.target.value)}
                  className={subInputCls}
                  placeholder="浆体密度，如1.2"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="\eta" />：宾汉体刚度系数
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={gbStr}
                  onChange={(e) => setGbStr(e.target.value)}
                  className={subInputCls}
                  placeholder="宾汉体刚度系数，如0.01"
                />
              </div>
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="g" />：重力加速度 · m/s²
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={gStr}
                  onChange={(e) => setGStr(e.target.value)}
                  className={subInputCls}
                  placeholder="重力加速度，默认值 9.81"
                />
              </div>
            </div>

            <div
              className={`rounded-lg border px-2.5 py-2 text-[11px] ${darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}
            >
              <div className={`mb-1 text-xs font-semibold ${hintStrong}`}>计算结果：</div>
              <div className={hintMuted}>
                <InlineMath math="D_L" /> ={' '}
                {Number.isFinite(D_L) ? <span className="font-mono font-semibold text-inherit">{String(Math.round(D_L * 1e9) / 1e9)}</span> : '—'}{' '}
                m；<InlineMath math="d_i" /> = <InlineMath math="D_L" />；<InlineMath math="\omega_L" /> ={' '}
                {Number.isFinite(W_L) ? <span className="font-mono font-semibold text-inherit">{String(Math.round(W_L * 1e9) / 1e9)}</span> : '—'}{' '}
                m/s
              </div>
              <div className={`mt-1 ${hintMuted}`}>
                <InlineMath math="N_d" /> = {Number.isFinite(N_d) ? <span className="font-mono font-semibold">{String(Math.round(N_d * 1e6) / 1e6)}</span> : '—'}；<InlineMath math="N_{\omega}" /> ={' '}
                {Number.isFinite(N_omega) ? <span className="font-mono font-semibold">{String(Math.round(N_omega * 1e6) / 1e6)}</span> : '—'}
              </div>
              <div className={`mt-1 ${hintStrong}`}>
                <InlineMath math="\omega_i" />（供填入 <InlineMath math="\omega" />）={' '}
                {Number.isFinite(wRounded) ? <span className="font-mono text-sm font-semibold">{String(wRounded)}</span> : '—'}{' '}
                m/s
              </div>
            </div>

            {!deltaOk && (rhoGStr || rhoKStr || gbStr) && (
              <p className={`text-[11px] ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                需满足 <InlineMath math="\rho_g>\rho_k" />、<InlineMath math="\rho_k>0" />、<InlineMath math="\eta>0" />、<InlineMath math="g>0" />。
              </p>
            )}
            {deltaOk && !nwOk && gbStr && (
              <p className={`text-[11px] ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                请检查 <InlineMath math="D_L" />、<InlineMath math="W_L" /> 使 <InlineMath math="N_d" /> 有效，且根号内非负。
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-0.5">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)}
              >
                收起
              </button>
              <button
                type="button"
                disabled={!Number.isFinite(wRounded)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                  darkMode ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (!Number.isFinite(wRounded)) return
                  onApplyOmega(String(wRounded))
                  setOpen(false)
                }}
              >
                填入上方 <InlineMath math="\omega" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 刘德忠公式：ω_s 采用斯托克斯公式辅助估算（默认水密度 1 t/m³、重力加速度 9.81 m/s²） */
function LiuDezhongOmegaSStokesField({
  darkMode,
  inputValue,
  onInputChange,
  onInputBlur,
  placeholder,
  unit,
  parameters,
  dLFromOmega,
  onApplyOmegaS,
}: {
  darkMode: boolean
  inputValue: string
  onInputChange: (value: string) => void
  onInputBlur: () => void
  placeholder: string
  unit: ReactNode
  parameters: Record<string, number | undefined>
  dLFromOmega: number | null
  onApplyOmegaS: (omegaSStr: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [rhoGStr, setRhoGStr] = useState('')
  const [rhoWStr, setRhoWStr] = useState('1')
  const [gStr, setGStr] = useState('9.81')
  const [dStr, setDStr] = useState('')
  const [muWStr, setMuWStr] = useState('')
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const rg = parameters.rho_g
    const rw = parameters.rho_k
    const g0 = parameters.g
    if (rg != null && !isNaN(Number(rg))) setRhoGStr(String(rg))
    if (rw != null && !isNaN(Number(rw))) setRhoWStr(String(rw))
    if (g0 != null && !isNaN(Number(g0))) setGStr(String(g0))
    if (!muWStr) {
      const eta1 = parameters.eta_1
      if (eta1 != null && !isNaN(Number(eta1)) && Number(eta1) > 0) setMuWStr(String(eta1))
      else setMuWStr('0.001')
    }
  }, [parameters.rho_g, parameters.rho_k, parameters.g, parameters.eta_1, muWStr])

  useEffect(() => {
    if (dLFromOmega != null && Number.isFinite(dLFromOmega) && dLFromOmega > 0) {
      setDStr(String(Math.round(dLFromOmega * 1e9) / 1e9))
    }
  }, [dLFromOmega])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const norm = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
  const rhoG = parseFloat(norm(rhoGStr))
  const rhoW = parseFloat(norm(rhoWStr))
  const gVal = parseFloat(norm(gStr))
  const dVal = parseFloat(norm(dStr))
  const muW = parseFloat(norm(muWStr))

  const ok =
    Number.isFinite(rhoG) &&
    Number.isFinite(rhoW) &&
    rhoG > rhoW &&
    rhoW > 0 &&
    Number.isFinite(gVal) &&
    gVal > 0 &&
    Number.isFinite(dVal) &&
    dVal > 0 &&
    Number.isFinite(muW) &&
    muW > 0

  const rhoDiffKgM3 = ok ? (rhoG - rhoW) * 1000 : NaN
  const omegaS = ok ? (gVal * rhoDiffKgM3 * dVal ** 2) / (18 * muW) : NaN
  const omegaSRounded = Number.isFinite(omegaS) ? Math.round(omegaS * 1e6) / 1e6 : NaN

  const shellBorder = darkMode ? 'border-gray-500' : 'border-gray-300'
  const shellBg = darkMode ? 'bg-gray-600' : 'bg-white'
  const shellFocus = open ? 'ring-2 ring-blue-500 ring-offset-0 border-blue-500' : ''
  const innerInputCls = `min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-base focus:outline-none focus:ring-0 ${
    darkMode ? 'text-gray-100 placeholder-gray-400' : 'text-gray-900'
  }`
  const chevronBtnCls = `flex h-full shrink-0 items-center justify-center border-l px-2.5 transition-colors ${
    darkMode
      ? `border-gray-500 text-gray-300 hover:bg-gray-500/40 ${open ? 'bg-gray-500/30' : ''}`
      : `border-gray-300 text-gray-500 hover:bg-gray-50 ${open ? 'bg-gray-50' : ''}`
  }`
  const panelCls = `absolute left-0 right-0 z-50 mt-1.5 max-h-[min(70vh,32rem)] overflow-y-auto overflow-x-hidden rounded-xl border shadow-lg ${
    darkMode ? 'border-gray-500 bg-gray-800 text-gray-100' : 'border-gray-200 bg-white text-gray-900'
  }`
  const panelInnerCls = darkMode ? 'border-gray-600' : 'border-gray-100'
  const subInputCls = `mt-1 w-full rounded-lg border px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    darkMode ? 'border-gray-500 bg-gray-700/80 text-gray-100' : 'border-gray-300 bg-gray-50 text-gray-900'
  }`
  const hintMuted = darkMode ? 'text-gray-400' : 'text-gray-600'
  const hintStrong = darkMode ? 'text-gray-200' : 'text-gray-800'

  return (
    <div className="relative min-w-0 flex-1" ref={wrapRef}>
      <div className="flex items-stretch space-x-2">
        <div
          className={`flex min-w-0 flex-1 overflow-hidden rounded-lg border ${shellBorder} ${shellBg} ${shellFocus}`}
        >
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onBlur={onInputBlur}
            onClick={() => setOpen(true)}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className={innerInputCls}
            aria-expanded={open}
            aria-controls="liu-omega-s-stokes-panel"
            id="liu-omega-s-stokes-input"
          />
          <button
            type="button"
            tabIndex={-1}
            className={chevronBtnCls}
            aria-label={open ? '收起斯托克斯沉速辅助' : '展开斯托克斯沉速辅助计算'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen((v) => !v)}
          >
            <span className={`inline-block text-xs transition-transform ${open ? '-rotate-180' : ''}`} aria-hidden>
              ▼
            </span>
          </button>
        </div>
        {unit}
      </div>

      {open && (
        <div id="liu-omega-s-stokes-panel" className={panelCls} role="region" aria-labelledby="liu-omega-s-stokes-input">
          <div className={`border-b px-3 py-2.5 ${panelInnerCls}`}>
            <div className={`text-xs font-semibold tracking-wide ${hintStrong}`}>水中加权平均沉速辅助计算（斯托克斯）<InlineMath math="\omega_s" /></div>
            <div className={`mt-2 space-y-2 overflow-x-auto text-[11px] ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              <BlockMath math="\omega_s=\dfrac{g(\rho_g-\rho_w)d^2}{18\mu_w}" />
            </div>
          </div>

          <div className="space-y-3 px-3 py-3">
            <p className={`text-[10px] leading-snug ${hintMuted}`}>
              <InlineMath math="\rho_g" />、<InlineMath math="\rho_w" />、<InlineMath math="g" /> 与本页输入联动；<InlineMath math="d" /> 默认取上一步 <InlineMath math="d_L" />。
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="\rho_g" />：颗粒密度 · t/m³
                </span>
                <input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={rhoGStr} onChange={(e) => setRhoGStr(e.target.value)} className={subInputCls} placeholder="颗粒密度，如2.5" />
              </div>
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="\rho_w" />：水密度 · t/m³
                </span>
                <input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={rhoWStr} onChange={(e) => setRhoWStr(e.target.value)} className={subInputCls} placeholder="水密度，默认值1" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="d" />：颗粒粒径 · m
                </span>
                <input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={dStr} onChange={(e) => setDStr(e.target.value)} className={subInputCls} placeholder="颗粒粒径d（默认取d_L）" />
              </div>
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="\mu_w" />：水动力粘度 · Pa·s
                </span>
                <input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={muWStr} onChange={(e) => setMuWStr(e.target.value)} className={subInputCls} placeholder="水动力粘度，默认值0.001" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="g" />：重力加速度 · m/s²
                </span>
                <input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={gStr} onChange={(e) => setGStr(e.target.value)} className={subInputCls} placeholder="重力加速度，默认值 9.81" />
              </div>
            </div>
            <div
              className={`rounded-lg border px-2.5 py-2 text-[11px] ${darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}
            >
              <div className={`mb-1 text-xs font-semibold ${hintStrong}`}>计算结果：</div>
              <div className={hintMuted}>
                <InlineMath math="\omega_s" /> = {Number.isFinite(omegaSRounded) ? <span className="font-mono font-semibold">{String(omegaSRounded)}</span> : '—'} m/s
              </div>
            </div>
            {!ok && (rhoGStr || rhoWStr || dStr || muWStr) && (
              <p className={`text-[11px] ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                需满足 <InlineMath math="\rho_g>\rho_w>0" />、<InlineMath math="d>0" />、<InlineMath math="\mu_w>0" />、<InlineMath math="g>0" />。
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-0.5">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)}
              >
                收起
              </button>
              <button
                type="button"
                disabled={!Number.isFinite(omegaSRounded)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                  darkMode ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (!Number.isFinite(omegaSRounded)) return
                  onApplyOmegaS(String(omegaSRounded))
                  setOpen(false)
                }}
              >
                填入上方 <InlineMath math="\omega_s" />
              </button>
            </div>
          </div>
        </div>
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

/** 横轴刻度等分数（与 L_max 计算步长 L_max/10）；曲线本身用密集点折线便于悬停读数 */
const HYDRAULIC_GRADE_TICK_DIVISIONS = 10
const HYDRAULIC_GRADE_CURVE_POINTS = 240

/** 衍生计算结果区 BlockMath（与坡度图纵轴一致） */
const INTERMEDIATE_HYDRAULIC_SLURRY_HEAD =
  '\\begin{aligned}' +
  '\\Delta h_{\\mathrm{k}}(l) &= \\dfrac{\\rho_s g\\,i_k\\,l + P_j\\cdot l/L_{\\max}}{\\rho_k g} \\\\[0.35em]' +
  'H(l) &= H+\\Delta h_{\\mathrm{k}}(L_{\\max})-\\Delta h_{\\mathrm{k}}(l),\\quad H(L_{\\max})=H' +
  '\\end{aligned}'
const INTERMEDIATE_HYDRAULIC_CLEAR_WATER_HEAD =
  '\\begin{aligned}' +
  '\\Delta h_{\\mathrm{w}}(l) &= \\dfrac{\\rho_w g\\,i_w\\,l + P_j\\cdot l/L_{\\max}}{\\rho_w g} \\\\[0.35em]' +
  'H(l) &= H+\\Delta h_{\\mathrm{w}}(L_{\\max})-\\Delta h_{\\mathrm{w}}(l),\\quad H(L_{\\max})=H' +
  '\\end{aligned}'
/** 界面图注：坡度线包含范围（与总扬程完整式对比） */
function HydraulicSlopeScopeNote() {
  return (
    <>
      坡度线含几何扬程 <InlineMath math="H" />、沿程损失及按管长比例分摊的 <InlineMath math="P_j" />；总扬程式中的{' '}
      <InlineMath math="P_n" />（泵站零件）、<InlineMath math="P_z" />（出口余压）为集中项，未画入线内。
    </>
  )
}

/** 由用户输入的 L_max 与等分数得到精确步长字符串（非写死） */
function formatHydraulicGradeStep(Lmax: number, divisions: number): string {
  if (!Number.isFinite(Lmax) || !Number.isFinite(divisions) || divisions <= 0) return '—'
  const s = Lmax / divisions
  if (!Number.isFinite(s)) return '—'
  if (Number.isInteger(s)) return String(s)
  const t = s.toFixed(10).replace(/\.?0+$/, '')
  return t === '' ? '0' : t
}

/** 浆体：累计沿程损失压力（kPa），与总扬程式 ρ_s g i_k L + 按长分摊 P_j 一致 */
function slurryCumLossKpaAt(
  l: number,
  Lmax: number,
  rho_s: number,
  g: number,
  i_k: number,
  P_j: number
): number {
  return rho_s * g * i_k * l + (Lmax > 0 ? P_j * (l / Lmax) : 0)
}

/** 清水总扬程：沿程损失压力（kPa），与 clear_water_total_head 中 ρ_w g i_w L + 按长分摊 P_j 一致 */
function clearWaterCumLossKpaAt(
  l: number,
  Lmax: number,
  rho_w: number,
  g: number,
  i_w: number,
  P_j: number
): number {
  return rho_w * g * i_w * l + (Lmax > 0 ? P_j * (l / Lmax) : 0)
}

function buildDenseHydraulicGradeHead(
  Lmax: number,
  H: number,
  lossHeadMAt: (l: number) => number,
  numPoints: number
): { L: number; headM: number }[] {
  const totalLossHeadM = lossHeadMAt(Lmax)
  const rows: { L: number; headM: number }[] = []
  for (let i = 0; i <= numPoints; i++) {
    const L = (Lmax * i) / numPoints
    const lh = lossHeadMAt(L)
    rows.push({
      L: Number(L.toFixed(8)),
      headM: Number((H + totalLossHeadM - lh).toFixed(6)),
    })
  }
  return rows
}

function hydraulicGradeXTicks(Lmax: number, divisions: number): number[] {
  return Array.from({ length: divisions + 1 }, (_, i) => Number(((Lmax * i) / divisions).toPrecision(12)))
}

type MergedHydraulicRow = { L: number; headSlurry: number; headClear?: number }

/** 浆体页对比用「清水」水力坡度：与当前页浆体输入一致的几何扬程 H、管长 L、P_j、g，取 ρ_w=1 t/m³、i_w=i_k（清水总扬程同一损失模型，不读清水模块参数）。 */
const SLURRY_CHART_CLEAR_WATER_RHO = 1

function buildMergedSlurryClearHydraulicData(
  Lmax: number,
  slurryParams: Record<string, number | undefined>,
  numPoints: number
): { data: MergedHydraulicRow[]; slurryOk: boolean; clearOk: boolean } {
  const rho_s = Number(slurryParams.rho_s)
  const rho_k = Number(slurryParams.rho_k)
  const Hs = Number(slurryParams.H)
  const gS = Number(slurryParams.g ?? 9.81)
  const i_k = Number(slurryParams.i_k)
  const PjS = Number(slurryParams.P_j ?? 0)

  let slurryOk = true
  if (
    !Number.isFinite(Lmax) ||
    Lmax <= 0 ||
    !Number.isFinite(rho_s) ||
    rho_s <= 0 ||
    !Number.isFinite(rho_k) ||
    rho_k <= 0 ||
    !Number.isFinite(gS) ||
    gS <= 0 ||
    !Number.isFinite(i_k) ||
    !Number.isFinite(Hs)
  ) {
    slurryOk = false
  }

  const slurryLossHeadM = (l: number) =>
    slurryCumLossKpaAt(l, Lmax, rho_s, gS, i_k, PjS) / (rho_k * gS)
  const slurrySeries = slurryOk
    ? buildDenseHydraulicGradeHead(Lmax, Hs, slurryLossHeadM, numPoints)
    : []

  const clearOk = slurryOk
  if (!slurryOk) {
    return { data: [], slurryOk: false, clearOk: false }
  }

  const rho_w = SLURRY_CHART_CLEAR_WATER_RHO
  const clearLossHeadM = (l: number) =>
    clearWaterCumLossKpaAt(l, Lmax, rho_w, gS, i_k, PjS) / (rho_w * gS)
  const clearSeries = buildDenseHydraulicGradeHead(Lmax, Hs, clearLossHeadM, numPoints)
  const data: MergedHydraulicRow[] = slurrySeries.map((row, i) => ({
    L: row.L,
    headSlurry: row.headM,
    headClear: clearSeries[i]?.headM,
  }))
  return { data, slurryOk, clearOk }
}

/** 地形折线顶点：L 为沿管距离，z 为高度 (m)；id 用于编辑区稳定挂载 */
type TerrainVertex = { L: number; z: number; id?: string }

function newTerrainMiddleId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m-${Date.now()}-${Math.random()}`
}

function parseTerrainMiddleBulk(
  text: string,
  Lmax: number
): { ok: true; pts: TerrainVertex[] } | { ok: false; err: string } {
  const pts: TerrainVertex[] = []
  const lines = text.split(/\r?\n/)
  let skippedHeader = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/[,，\s;；\t]+/).filter(Boolean)
    if (parts.length < 2) continue
    const L = Number(parts[0])
    const z = Number(parts[1])
    if (!Number.isFinite(L) || !Number.isFinite(z)) {
      if (!skippedHeader && pts.length === 0) {
        skippedHeader = true
        continue
      }
      return { ok: false, err: `第 ${i + 1} 行无法解析为数字：${line}` }
    }
    if (L <= 0 || L >= Lmax) {
      return { ok: false, err: `第 ${i + 1} 行：管长须满足 0 < L < L_max（当前 L_max=${Lmax}）：${L}` }
    }
    pts.push({ L, z, id: newTerrainMiddleId() })
  }
  pts.sort((a, b) => a.L - b.L)
  const dedup: TerrainVertex[] = []
  for (const p of pts) {
    if (dedup.length && Math.abs(dedup[dedup.length - 1].L - p.L) < 1e-9) dedup[dedup.length - 1] = p
    else dedup.push(p)
  }
  return { ok: true, pts: dedup }
}

function mergeTerrainVertices(Lmax: number, z0: number, z1: number, middles: TerrainVertex[]): TerrainVertex[] {
  const interior = middles.filter((p) => p.L > 0 && p.L < Lmax)
  const verts: TerrainVertex[] = [
    { L: 0, z: z0 },
    ...interior,
    { L: Lmax, z: z1 },
  ]
  verts.sort((a, b) => a.L - b.L)
  const out: TerrainVertex[] = []
  for (const v of verts) {
    if (out.length && Math.abs(out[out.length - 1].L - v.L) < 1e-9) out[out.length - 1] = v
    else out.push(v)
  }
  return out
}

function interpolateTerrainZ(L: number, verts: TerrainVertex[]): number {
  if (verts.length === 0) return NaN
  const lo = verts[0].L
  const hi = verts[verts.length - 1].L
  const x = Math.min(Math.max(L, lo), hi)
  let i = 0
  while (i < verts.length - 1 && verts[i + 1].L < x - 1e-12) i++
  const a = verts[i]
  const b = verts[i + 1] ?? a
  if (!b || Math.abs(a.L - b.L) < 1e-12) return a.z
  const t = (x - a.L) / (b.L - a.L)
  return a.z + t * (b.z - a.z)
}

function computeSlurryHydraulicDerivativeValues(
  params: Record<string, number | undefined>
): null | { H: number; deltaHk: number; H0_slurry: number } {
  const Lmax = Number(params.L)
  const rho_s = Number(params.rho_s)
  const rho_k = Number(params.rho_k)
  const g = Number(params.g ?? 9.81)
  const i_k = Number(params.i_k)
  const P_j = Number(params.P_j ?? 0)
  const H = Number(params.H)
  if (
    !Number.isFinite(Lmax) ||
    Lmax <= 0 ||
    !Number.isFinite(rho_s) ||
    rho_s <= 0 ||
    !Number.isFinite(rho_k) ||
    rho_k <= 0 ||
    !Number.isFinite(g) ||
    g <= 0 ||
    !Number.isFinite(i_k) ||
    !Number.isFinite(H)
  ) {
    return null
  }
  const deltaHk = slurryCumLossKpaAt(Lmax, Lmax, rho_s, g, i_k, P_j) / (rho_k * g)
  return {
    H,
    deltaHk,
    H0_slurry: H + deltaHk,
  }
}

function computeClearWaterHydraulicDerivativeValues(
  params: Record<string, number | undefined>
): null | { H: number; deltaHw: number; H0: number } {
  const Lmax = Number(params.L)
  const rho_w = Number(params.rho_w ?? 1)
  const g = Number(params.g ?? 9.81)
  const i_w = Number(params.i_w)
  const P_j = Number(params.P_j ?? 0)
  const H = Number(params.H)
  if (
    !Number.isFinite(Lmax) ||
    Lmax <= 0 ||
    !Number.isFinite(rho_w) ||
    rho_w <= 0 ||
    !Number.isFinite(g) ||
    g <= 0 ||
    !Number.isFinite(i_w) ||
    !Number.isFinite(H)
  ) {
    return null
  }
  const deltaHw = clearWaterCumLossKpaAt(Lmax, Lmax, rho_w, g, i_w, P_j) / (rho_w * g)
  return { H, deltaHw, H0: H + deltaHw }
}

function fmtHeadM3(x: number): string {
  return Number.isFinite(x) ? x.toFixed(3) : '—'
}

/**
 * 与「中间计算结果」同卡片样式；先公式再按上式代入的数值，用语与式中 H(l)、l 一致。
 */
function HydraulicDerivativeResultsSection({
  variant,
  darkMode,
  parameters,
}: {
  variant: 'slurry' | 'clear_water'
  darkMode: boolean
  parameters: Record<string, number | undefined>
}) {
  const surfaceCls = darkMode
    ? 'mt-3 p-4 rounded-lg border border-gray-600 bg-gray-800/90'
    : 'mt-3 p-4 rounded-lg border border-gray-200 bg-white'
  const titleCls = darkMode ? 'text-gray-200' : 'text-gray-700'
  const bodyCls = darkMode ? 'text-gray-300' : 'text-gray-600'
  const secCls = darkMode ? 'text-gray-200' : 'text-gray-800'
  const numCls = 'font-mono font-semibold tabular-nums'

  if (variant === 'slurry') {
    const v = computeSlurryHydraulicDerivativeValues(parameters)
    if (!v) return null
    return (
      <div className={surfaceCls}>
        <div className={`text-sm font-medium mb-3 ${titleCls}`}>衍生计算结果：</div>
        <div className={`text-sm font-medium mb-2 ${titleCls}`}>水头</div>
        <p className={`text-sm mb-4 leading-relaxed ${bodyCls}`}>
          输入 <InlineMath math="H" /> 为<strong>扬送浆体的几何高度</strong>，与 <InlineMath math="l=L_{\max}" /> 处纵坐标一致；下式为浆体坡度线 <InlineMath math="H(l)" />。含{' '}
          <InlineMath math="H" />、沿程与分摊 <InlineMath math="P_j" />，不含 <InlineMath math="P_n" />、<InlineMath math="P_z" />。
        </p>

        <div className={`text-sm font-medium mb-2 ${secCls}`}>浆体 · <InlineMath math="\rho_k" /> 浆柱</div>
        <div className="min-w-0 overflow-x-auto mb-2">
          <BlockMath math={INTERMEDIATE_HYDRAULIC_SLURRY_HEAD} />
        </div>
        <div className={`text-sm font-medium mb-2 ${secCls}`}>代入当前参数</div>
        <ol className={`text-sm space-y-2 pl-5 list-decimal ${bodyCls}`}>
          <li>
            式第一行令 <InlineMath math="l=L_{\max}" />：<InlineMath math="\Delta h_{\mathrm{k}}(L_{\max})" /> ={' '}
            <span className={numCls}>{fmtHeadM3(v.deltaHk)}</span> m
          </li>
          <li>
            式第二行令 <InlineMath math="l=0" />，且 <InlineMath math="\Delta h_{\mathrm{k}}(0)=0" />：<InlineMath math="H(0)=H+\Delta h_{\mathrm{k}}(L_{\max})" /> ={' '}
            <span className={numCls}>{fmtHeadM3(v.H0_slurry)}</span> m
          </li>
          <li>
            式第二行令 <InlineMath math="l=L_{\max}" />：<InlineMath math="H(L_{\max})=H" /> ={' '}
            <span className={numCls}>{fmtHeadM3(v.H)}</span> m
          </li>
        </ol>
      </div>
    )
  }

  const v = computeClearWaterHydraulicDerivativeValues(parameters)
  if (!v) return null
  return (
    <div className={surfaceCls}>
      <div className={`text-sm font-medium mb-3 ${titleCls}`}>衍生计算结果：</div>
      <div className={`text-sm font-medium mb-2 ${titleCls}`}>水头</div>
      <p className={`text-sm mb-4 leading-relaxed ${bodyCls}`}>
        输入 <InlineMath math="H" /> 为<strong>扬送清水的几何高度</strong>，与 <InlineMath math="l=L_{\max}" /> 处纵坐标一致；下式为清水坡度线 <InlineMath math="H(l)" />。
      </p>
      <div className="min-w-0 overflow-x-auto mb-2">
        <BlockMath math={INTERMEDIATE_HYDRAULIC_CLEAR_WATER_HEAD} />
      </div>
      <div className={`text-sm font-medium mb-2 ${secCls}`}>代入当前参数</div>
      <ol className={`text-sm space-y-2 pl-5 list-decimal ${bodyCls}`}>
        <li>
          式第一行令 <InlineMath math="l=L_{\max}" />：<InlineMath math="\Delta h_{\mathrm{w}}(L_{\max})" /> ={' '}
          <span className={numCls}>{fmtHeadM3(v.deltaHw)}</span> m
        </li>
        <li>
          式第二行令 <InlineMath math="l=0" />，且 <InlineMath math="\Delta h_{\mathrm{w}}(0)=0" />：<InlineMath math="H(0)=H+\Delta h_{\mathrm{w}}(L_{\max})" /> ={' '}
          <span className={numCls}>{fmtHeadM3(v.H0)}</span> m
        </li>
        <li>
          式第二行令 <InlineMath math="l=L_{\max}" />：<InlineMath math="H(L_{\max})=H" /> ={' '}
          <span className={numCls}>{fmtHeadM3(v.H)}</span> m
        </li>
      </ol>
    </div>
  )
}

const SLURRY_HYDRAULIC_LINE = '#F59E0B'
const CLEAR_HYDRAULIC_LINE = '#3B82F6'
/** 地形线：普通绿色（主图 / 预览 / 导出一致） */
const TERRAIN_EXPORT_LINE = '#22c55e'
const MAX_PRESS_HYDRAULIC_LINE = '#DC2626'

type SlurryHydraulicChartRow = MergedHydraulicRow & { terrainZ?: number; maxPressZ?: number }

type AppliedTerrainState = {
  z0Str: string
  z1Str: string
  middlePts: TerrainVertex[]
}

function TerrainPreviewHoverSync({
  active,
  payload,
  onHover,
}: {
  active?: boolean
  payload?: { payload: { L: number; terrainZ: number } }[]
  onHover: (v: { L: number; z: number } | null) => void
}) {
  useEffect(() => {
    if (active && payload?.[0]?.payload) {
      const p = payload[0].payload
      if (Number.isFinite(p.L) && Number.isFinite(p.terrainZ)) onHover({ L: p.L, z: p.terrainZ })
      else onHover(null)
    } else onHover(null)
  }, [active, payload, onHover])
  return null
}

function SlurryClearHydraulicGradeChartBlock({
  darkMode,
  Lmax,
  slurryParams,
}: {
  darkMode: boolean
  Lmax: number
  slurryParams: Record<string, number | undefined>
}) {
  const [showSlurry, setShowSlurry] = useState(true)
  const [showClear, setShowClear] = useState(true)
  /** 主图上的地形数据：仅「应用到主图」后写入 */
  const [appliedTerrain, setAppliedTerrain] = useState<AppliedTerrainState | null>(null)
  /** 编辑区草稿（未应用前不影响主图） */
  const [draftZ0Str, setDraftZ0Str] = useState('0')
  const [draftZ1Str, setDraftZ1Str] = useState('0')
  const [draftMiddlePts, setDraftMiddlePts] = useState<TerrainVertex[]>([])
  const [bulkText, setBulkText] = useState('')
  const [editorErr, setEditorErr] = useState<string | null>(null)
  const [manualLStr, setManualLStr] = useState('')
  const [manualZStr, setManualZStr] = useState('')
  const [previewHover, setPreviewHover] = useState<{ L: number; z: number } | null>(null)
  const [showTerrainLine, setShowTerrainLine] = useState(true)
  const [showMaxPressLine, setShowMaxPressLine] = useState(true)

  const { data: chartData, slurryOk, clearOk } = useMemo(
    () => buildMergedSlurryClearHydraulicData(Lmax, slurryParams, HYDRAULIC_GRADE_CURVE_POINTS),
    [Lmax, slurryParams]
  )

  const stepStr = formatHydraulicGradeStep(Lmax, HYDRAULIC_GRADE_TICK_DIVISIONS)
  const xTicks = useMemo(() => hydraulicGradeXTicks(Lmax, HYDRAULIC_GRADE_TICK_DIVISIONS), [Lmax])

  const appZ0 = appliedTerrain ? Number(appliedTerrain.z0Str) : NaN
  const appZ1 = appliedTerrain ? Number(appliedTerrain.z1Str) : NaN
  const terrainVerts = useMemo(
    () =>
      appliedTerrain
        ? mergeTerrainVertices(Lmax, appZ0, appZ1, appliedTerrain.middlePts)
        : [],
    [Lmax, appZ0, appZ1, appliedTerrain]
  )
  const terrainDrawOk =
    appliedTerrain != null &&
    Number.isFinite(Lmax) &&
    Lmax > 0 &&
    Number.isFinite(appZ0) &&
    Number.isFinite(appZ1) &&
    terrainVerts.length >= 2

  const dz0 = Number(draftZ0Str)
  const dz1 = Number(draftZ1Str)
  const draftVerts = useMemo(
    () => mergeTerrainVertices(Lmax, dz0, dz1, draftMiddlePts),
    [Lmax, dz0, dz1, draftMiddlePts]
  )
  const draftPreviewOk =
    Number.isFinite(Lmax) && Lmax > 0 && Number.isFinite(dz0) && Number.isFinite(dz1) && draftVerts.length >= 2

  const chartRows: SlurryHydraulicChartRow[] = useMemo(() => {
    if (!terrainDrawOk) return chartData.map((r) => ({ ...r }))
    return chartData.map((r) => {
      const tz = interpolateTerrainZ(r.L, terrainVerts)
      const maxPressZ = Number.isFinite(tz) && Number.isFinite(r.headSlurry) ? r.headSlurry - tz : undefined
      return {
        ...r,
        terrainZ: tz,
        maxPressZ,
      }
    })
  }, [chartData, terrainDrawOk, terrainVerts])

  const hasVisibleTerrain = terrainDrawOk && showTerrainLine
  const hasVisibleMaxPress = terrainDrawOk && showMaxPressLine

  const rho_k = Number(slurryParams.rho_k)
  const rho_w_clear = SLURRY_CHART_CLEAR_WATER_RHO
  const gSlurry = Number(slurryParams.g ?? 9.81)
  const gClear = gSlurry
  const H_in = Number(slurryParams.H)
  const rho_s = Number(slurryParams.rho_s)
  const i_k = Number(slurryParams.i_k)
  const P_j_s = Number(slurryParams.P_j ?? 0)
  const totalLossHeadM =
    slurryOk && Number.isFinite(rho_k) && rho_k > 0 && gSlurry > 0
      ? slurryCumLossKpaAt(Lmax, Lmax, rho_s, gSlurry, i_k, P_j_s) / (rho_k * gSlurry)
      : 0

  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const d of chartRows) {
      if (showSlurry && slurryOk && Number.isFinite(d.headSlurry)) {
        lo = Math.min(lo, d.headSlurry)
        hi = Math.max(hi, d.headSlurry)
      }
      if (showClear && clearOk && d.headClear != null && Number.isFinite(d.headClear)) {
        lo = Math.min(lo, d.headClear)
        hi = Math.max(hi, d.headClear)
      }
      if (hasVisibleTerrain && d.terrainZ != null && Number.isFinite(d.terrainZ)) {
        lo = Math.min(lo, d.terrainZ)
        hi = Math.max(hi, d.terrainZ)
      }
      if (hasVisibleMaxPress && d.maxPressZ != null && Number.isFinite(d.maxPressZ)) {
        lo = Math.min(lo, d.maxPressZ)
        hi = Math.max(hi, d.maxPressZ)
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return { yMin: 0, yMax: 1 }
    }
    const span = Math.max(hi - lo, 1e-6)
    const pad = Math.max(span * 0.06, 0.5)
    return { yMin: lo - pad, yMax: hi + pad }
  }, [chartRows, showSlurry, showClear, slurryOk, clearOk, hasVisibleTerrain, hasVisibleMaxPress])

  const hydraulicExportYDomain = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const d of chartData) {
      if (slurryOk && Number.isFinite(d.headSlurry)) {
        lo = Math.min(lo, d.headSlurry)
        hi = Math.max(hi, d.headSlurry)
      }
      if (clearOk && d.headClear != null && Number.isFinite(d.headClear)) {
        lo = Math.min(lo, d.headClear)
        hi = Math.max(hi, d.headClear)
      }
    }
    if (terrainDrawOk) {
      for (const d of chartData) {
        const tz = interpolateTerrainZ(d.L, terrainVerts)
        if (Number.isFinite(tz)) {
          lo = Math.min(lo, tz)
          hi = Math.max(hi, tz)
        }
        const maxPressZ = Number.isFinite(tz) && Number.isFinite(d.headSlurry) ? d.headSlurry - tz : NaN
        if (Number.isFinite(maxPressZ)) {
          lo = Math.min(lo, maxPressZ)
          hi = Math.max(hi, maxPressZ)
        }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
    const span = Math.max(hi - lo, 1e-6)
    const pad = Math.max(span * 0.06, 0.5)
    return { yMin: lo - pad, yMax: hi + pad }
  }, [chartData, slurryOk, clearOk, terrainDrawOk, terrainVerts])

  const minSepL = Math.max(Lmax * 0.008, 1e-6)

  const handleApplyBulkTerrain = () => {
    const r = parseTerrainMiddleBulk(bulkText, Lmax)
    if (!r.ok) {
      setEditorErr(r.err)
      return
    }
    setEditorErr(null)
    setDraftMiddlePts(r.pts)
  }

  const handleAddManualMiddle = () => {
    const L = Number(manualLStr)
    const z = Number(manualZStr)
    if (!Number.isFinite(L) || !Number.isFinite(z)) {
      setEditorErr('请输入有效的管长 L 与高度')
      return
    }
    if (L <= 0 || L >= Lmax) {
      setEditorErr(`管长须满足 0 < L < L_max（${Lmax}）`)
      return
    }
    setEditorErr(null)
    setDraftMiddlePts((prev) => {
      const next = [...prev, { L, z, id: newTerrainMiddleId() }].sort((a, b) => a.L - b.L)
      const dedup: TerrainVertex[] = []
      for (const p of next) {
        if (dedup.length && Math.abs(dedup[dedup.length - 1].L - p.L) < minSepL) dedup[dedup.length - 1] = p
        else dedup.push(p)
      }
      return dedup
    })
  }

  const handleApplyTerrainToMainChart = () => {
    if (!draftPreviewOk) {
      setEditorErr('请填写有效的起点、终点水头高度，且 L_max 有效。')
      return
    }
    setEditorErr(null)
    const middlesWithIds = draftMiddlePts.map((p) => ({
      L: p.L,
      z: p.z,
      id: p.id ?? newTerrainMiddleId(),
    }))
    setAppliedTerrain({
      z0Str: draftZ0Str,
      z1Str: draftZ1Str,
      middlePts: middlesWithIds,
    })
    setDraftMiddlePts(middlesWithIds)
    setShowTerrainLine(true)
    setShowMaxPressLine(true)
  }

  const handleUndoMainTerrain = () => {
    setAppliedTerrain(null)
    setShowTerrainLine(true)
    setShowMaxPressLine(true)
    setEditorErr(null)
  }

  const handleRemoveMiddle = (id: string | undefined) => {
    if (!id) return
    setDraftMiddlePts((prev) => prev.filter((p) => p.id !== id))
  }

  const sortedDraftMiddles = useMemo(
    () => [...draftMiddlePts].sort((a, b) => a.L - b.L),
    [draftMiddlePts]
  )

  const terrainPreviewRows = useMemo(() => {
    if (!draftPreviewOk) return []
    return chartData.map((r) => {
      const terrainZ = interpolateTerrainZ(r.L, draftVerts)
      const maxPressZ = Number.isFinite(terrainZ) && Number.isFinite(r.headSlurry) ? r.headSlurry - terrainZ : undefined
      return { L: r.L, terrainZ, maxPressZ }
    })
  }, [draftPreviewOk, chartData, draftVerts])

  const { previewYMin, previewYMax } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const r of terrainPreviewRows) {
      if (Number.isFinite(r.terrainZ)) {
        lo = Math.min(lo, r.terrainZ)
        hi = Math.max(hi, r.terrainZ)
      }
      if (r.maxPressZ != null && Number.isFinite(r.maxPressZ)) {
        lo = Math.min(lo, r.maxPressZ)
        hi = Math.max(hi, r.maxPressZ)
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { previewYMin: 0, previewYMax: 1 }
    const span = Math.max(hi - lo, 1e-6)
    const pad = Math.max(span * 0.06, 0.5)
    return { previewYMin: lo - pad, previewYMax: hi + pad }
  }, [terrainPreviewRows])

  const handleExportChartPNG = () => {
    if (!hydraulicExportYDomain) return
    const dateStr = new Date().toISOString().slice(0, 10)
    const slurryPts = chartData.map((r: MergedHydraulicRow) => ({ L: r.L, H: r.headSlurry }))
    const clearPts: { L: number; H: number }[] =
      clearOk && chartData.every((r: MergedHydraulicRow) => r.headClear != null)
        ? chartData.map((r: MergedHydraulicRow) => ({ L: r.L, H: r.headClear as number }))
        : []
    const extra: { curve: { L: number; H: number }[]; color: string; legend: string }[] = []
    if (terrainDrawOk && showTerrainLine) {
      extra.push({
        curve: chartData.map((r) => ({ L: r.L, H: interpolateTerrainZ(r.L, terrainVerts) })),
        color: TERRAIN_EXPORT_LINE,
        legend: '地形线（高度）',
      })
    }
    if (terrainDrawOk && showMaxPressLine) {
      extra.push({
        curve: chartData.map((r) => {
          const terrainZ = interpolateTerrainZ(r.L, terrainVerts)
          const maxPressZ = Number.isFinite(terrainZ) && Number.isFinite(r.headSlurry) ? r.headSlurry - terrainZ : NaN
          return { L: r.L, H: maxPressZ }
        }),
        color: MAX_PRESS_HYDRAULIC_LINE,
        legend: '最大允许运行压力线',
      })
    }
    downloadScientificHlChartPng({
      curveData: slurryPts,
      secondCurve: clearPts.length > 1 ? clearPts : undefined,
      secondLineColor: CLEAR_HYDRAULIC_LINE,
      secondLegendText: '清水对比水力坡度线',
      extraHydraulicCurves: extra.length ? extra : undefined,
      darkMode,
      title: '浆体与清水对比 · 管道水力坡度线',
      subtitle: `几何扬程与沿程水头分布：L_max = ${Lmax} m，主刻度间隔 ${stepStr} m（${HYDRAULIC_GRADE_TICK_DIVISIONS} 等分）`,
      xAxisLabel: `管长 L (m)\n范围 [0，${Lmax}]；均匀主刻度，步长 ${stepStr} m`,
      yAxisLabel: `水头 H (m)\n测压管水头；浆体 ρ_k、ρ_s、i_k；清水对比 ρ_w=1 t/m³、i_w=i_k`,
      lineColor: SLURRY_HYDRAULIC_LINE,
      legendText: '浆体水力坡度线',
      filename: `slurry_clear_hydraulic_grade_${dateStr}.png`,
      hydraulicLayout: {
        lMax: Lmax,
        yMin: hydraulicExportYDomain.yMin,
        yMax: hydraulicExportYDomain.yMax,
        xTickDivisions: HYDRAULIC_GRADE_TICK_DIVISIONS,
      },
    })
  }

  if (!slurryOk || chartData.length === 0) return null

  return (
    <div className={`rounded-xl border-2 p-5 mt-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className={`text-lg font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
          水力坡度线 – <InlineMath math="L" />
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
        横轴刻度步长由当前输入的 <InlineMath math="L_{\max}" /> 与 {HYDRAULIC_GRADE_TICK_DIVISIONS}{' '}
        等分计算，为 <span className="font-mono">{stepStr}</span> m。横轴 <InlineMath math="[0,L_{\max}]" />，悬停可读水头与折算压力。
        <strong className="text-amber-600 dark:text-amber-400"> 浆体</strong>线按浆体总扬程（<InlineMath math="\rho_s,\rho_k,i_k" />
        ）；<strong className="text-blue-600 dark:text-blue-400"> 清水对比线</strong>按与当前页相同的 <InlineMath math="H,L,P_j,g" />，取{' '}
        <InlineMath math="\rho_w=1\ \mathrm{t/m^3}" />、<InlineMath math="i_w=i_k" />，与清水总扬程模块同一水力坡度模型。
        <strong className="text-emerald-700 dark:text-emerald-400"> 地形线</strong>与
        <strong className="text-red-700 dark:text-red-400"> 最大允许压力线</strong>
        在<strong>图注下方编辑区</strong>配置起终点水头与中间点后点击「应用到主图」；预览区可悬停读数。
      </div>
      <div className={`flex flex-wrap gap-x-5 gap-y-1 text-xs mb-3 px-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        <span>
          <InlineMath math="L_{\max}" /> = {Lmax} m
        </span>
        <span>
          刻度步长 = {stepStr} m
        </span>
        <span>
          浆体终点水头 <InlineMath math="H" /> = {Number.isFinite(H_in) ? H_in.toFixed(3) : '—'} m
        </span>
        {clearOk ? (
          <span className={darkMode ? 'text-blue-300' : 'text-blue-700'}>
            清水对比线终点水头 <InlineMath math="H" /> = {Number.isFinite(H_in) ? H_in.toFixed(3) : '—'} m（与浆体几何扬程相同）
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <div id="slurry-hydraulic-grade-chart" className="min-h-[380px] min-w-0 w-full">
          <ResponsiveContainer width="100%" height={550}>
            <LineChart data={chartRows} margin={{ top: 8, right: 12, left: 8, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#4B5563' : '#E5E7EB'} />
              <XAxis
                type="number"
                dataKey="L"
                domain={[0, Lmax]}
                ticks={xTicks}
                allowDecimals
                label={{
                  value: '管长 L (m)',
                  position: 'insideBottom',
                  offset: -12,
                  style: { fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 12, fontStyle: 'italic' },
                }}
                tick={{ fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                tickFormatter={(v) => formatHydraulicLengthTick(Number(v))}
                stroke={darkMode ? '#6B7280' : '#9CA3AF'}
              />
              <YAxis
                label={{
                  value: '水头 H (m)',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 2,
                  style: { fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 12, fontStyle: 'italic' },
                }}
                tick={{ fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                tickFormatter={(v) => formatHydraulicHeadTick(Number(v), yMin, yMax)}
                stroke={darkMode ? '#6B7280' : '#9CA3AF'}
                domain={[yMin, yMax]}
              />
              <Tooltip
                shared
                content={(tipProps) => {
                  const { active, label, payload } = tipProps
                  if (!active || payload == null || payload.length === 0) return null
                  const Lv = Number(label)
                  const boxCls = darkMode
                    ? 'rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-xs text-gray-100 shadow-lg'
                    : 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 shadow-lg'
                  return (
                    <div className={boxCls}>
                      <div className="mb-1 font-medium">L = {Number.isFinite(Lv) ? Lv.toFixed(3) : String(label)} m</div>
                      {showSlurry &&
                        payload
                          .filter((p) => p.dataKey === 'headSlurry')
                          .map((p) => {
                            const hm = Number(p.value)
                            const pk =
                              Number.isFinite(hm) && Number.isFinite(rho_k) && rho_k > 0 && gSlurry > 0
                                ? hm * rho_k * gSlurry
                                : NaN
                            return (
                              <div key="s" className="text-amber-600 dark:text-amber-400">
                                浆体水力坡度：水头 {Number.isFinite(hm) ? hm.toFixed(3) : '—'} m
                                {Number.isFinite(pk) ? `，折算压力 ${pk.toFixed(2)} kPa（ρ_k·g·H）` : null}
                              </div>
                            )
                          })}
                      {showClear &&
                        clearOk &&
                        payload
                          .filter((p) => p.dataKey === 'headClear')
                          .map((p) => {
                            const hm = Number(p.value)
                            const pk =
                              Number.isFinite(hm) && Number.isFinite(rho_w_clear) && rho_w_clear > 0 && gClear > 0
                                ? hm * rho_w_clear * gClear
                                : NaN
                            return (
                              <div key="c" className="text-blue-600 dark:text-blue-400">
                                清水水力坡度：水头 {Number.isFinite(hm) ? hm.toFixed(3) : '—'} m
                                {Number.isFinite(pk) ? `，折算压力 ${pk.toFixed(2)} kPa（ρ_w·g·H）` : null}
                              </div>
                            )
                          })}
                      {hasVisibleTerrain &&
                        payload
                          .filter((p) => p.dataKey === 'terrainZ')
                          .map((p) => {
                            const zv = Number(p.value)
                            return (
                              <div key="t" className="text-emerald-600 dark:text-emerald-400">
                                地形高度： {Number.isFinite(zv) ? zv.toFixed(3) : '—'} m
                              </div>
                            )
                          })}
                      {hasVisibleMaxPress &&
                        payload
                          .filter((p) => p.dataKey === 'maxPressZ')
                          .map((p) => {
                            const mv = Number(p.value)
                            return (
                              <div key="m" className="text-red-600 dark:text-red-400">
                                最大允许压力线：{Number.isFinite(mv) ? mv.toFixed(3) : '—'} m
                              </div>
                            )
                          })}
                    </div>
                  )
                }}
              />
              <Line
                type="linear"
                dataKey="headSlurry"
                name="浆体水力坡度线"
                stroke={SLURRY_HYDRAULIC_LINE}
                strokeWidth={2.5}
                dot={false}
                connectNulls
                hide={!showSlurry}
                isAnimationActive={false}
              />
              {clearOk ? (
                <Line
                  type="linear"
                  dataKey="headClear"
                  name="清水对比水力坡度线"
                  stroke={CLEAR_HYDRAULIC_LINE}
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                  hide={!showClear}
                  isAnimationActive={false}
                />
              ) : null}
              {terrainDrawOk ? (
                <Line
                  type="linear"
                  dataKey="terrainZ"
                  name="地形线"
                  stroke={TERRAIN_EXPORT_LINE}
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                  hide={!showTerrainLine}
                  isAnimationActive={false}
                />
              ) : null}
              {terrainDrawOk ? (
                <Line
                  type="linear"
                  dataKey="maxPressZ"
                  name="最大允许运行压力线"
                  stroke={MAX_PRESS_HYDRAULIC_LINE}
                  strokeWidth={2.2}
                  dot={false}
                  connectNulls
                  hide={!showMaxPressLine}
                  isAnimationActive={false}
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div
          className={`flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t pt-3 ${
            darkMode ? 'border-gray-500' : 'border-gray-200'
          }`}
        >
          <label
            className={`flex cursor-pointer items-center gap-2 text-sm ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}
          >
            <input
              type="checkbox"
              className="rounded border-gray-400"
              checked={showSlurry}
              onChange={() => {
                setShowSlurry((s) => {
                  if (!s) return true
                  const otherVisible =
                    (showClear && clearOk) ||
                    (terrainDrawOk && showTerrainLine) ||
                    (terrainDrawOk && showMaxPressLine)
                  if (!otherVisible) return s
                  return false
                })
              }}
            />
            <span className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: SLURRY_HYDRAULIC_LINE }} />
            浆体水力坡度线
          </label>
          <label
            className={`flex cursor-pointer items-center gap-2 text-sm ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}
          >
            <input
              type="checkbox"
              className="rounded border-gray-400"
              checked={showClear && clearOk}
              disabled={!clearOk}
              onChange={() => {
                if (!clearOk) return
                setShowClear((c) => {
                  if (!c) return true
                  const otherVisible =
                    showSlurry || (terrainDrawOk && showTerrainLine) || (terrainDrawOk && showMaxPressLine)
                  if (!otherVisible) return c
                  return false
                })
              }}
            />
            <span className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: CLEAR_HYDRAULIC_LINE }} />
            清水对比水力坡度线
          </label>
          {terrainDrawOk ? (
            <>
              <label
                className={`flex cursor-pointer items-center gap-2 text-sm ${
                  darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                <input
                  type="checkbox"
                  className="rounded border-gray-400"
                  checked={showTerrainLine}
                  onChange={() => {
                    setShowTerrainLine((t) => {
                      if (!t) return true
                      const otherVisible = showSlurry || (showClear && clearOk) || (terrainDrawOk && showMaxPressLine)
                      if (!otherVisible) return t
                      return false
                    })
                  }}
                />
                <span className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: TERRAIN_EXPORT_LINE }} />
                地形线
              </label>
              <label
                className={`flex cursor-pointer items-center gap-2 text-sm ${
                  darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                <input
                  type="checkbox"
                  className="rounded border-gray-400"
                  checked={showMaxPressLine}
                  onChange={() => {
                    setShowMaxPressLine((m) => {
                      if (!m) return true
                      const otherVisible = showSlurry || (showClear && clearOk) || (terrainDrawOk && showTerrainLine)
                      if (!otherVisible) return m
                      return false
                    })
                  }}
                />
                <span className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: MAX_PRESS_HYDRAULIC_LINE }} />
                最大允许运行压力线
              </label>
            </>
          ) : null}
        </div>
      </div>


      <div className={`mt-3 pt-3 border-t text-xs leading-relaxed ${darkMode ? 'border-gray-500 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
        <span className={`font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>图注：</span>
        <HydraulicSlopeScopeNote /> 浆体进口端总水头约{' '}
        <InlineMath math="H+\Delta h_{\mathrm{k}}(L_{\max})" /> ≈{' '}
        {Number.isFinite(H_in + totalLossHeadM) ? (H_in + totalLossHeadM).toFixed(1) : '—'} m（含 <InlineMath math="P_j" /> 分摊损失水头{' '}
        {totalLossHeadM.toFixed(1)} m）。悬停折算压力按 <InlineMath math="\rho_k g H" />（浆体）、<InlineMath math="\rho_w g H" />（清水对比）换算。
        {terrainDrawOk ? (
          <>
            {' '}
            红线按各点“浆体总扬程（m）−地形高度（m）”计算，随地形线沿程变化。
          </>
        ) : null}
      </div>

      <div
        className={`mt-4 overflow-hidden rounded-xl border ${
          darkMode ? 'border-gray-500 bg-gray-800/90' : 'border-gray-200 bg-white'
        }`}
      >
        <div
          className={`border-b px-4 py-3 ${darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}
        >
          <h3 className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            添加地形线与最大允许压力线
          </h3>
        </div>
        <div className="space-y-4 px-4 py-4">
          <ul className={`grid gap-2 text-xs sm:grid-cols-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            <li className="flex gap-2">
              <span
                className="mt-0.5 h-3 w-8 shrink-0 rounded-sm"
                style={{ background: TERRAIN_EXPORT_LINE }}
                aria-hidden
              />
              <span>
                <strong className={darkMode ? 'text-gray-200' : 'text-gray-800'}>地形线</strong>
                ：地面高度沿管长折线；端点对应 <InlineMath math="L=0" /> 与 <InlineMath math="L=L_{\max}" />。
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 h-3 w-8 shrink-0 rounded-sm bg-red-600" aria-hidden />
              <span>
                <strong className={darkMode ? 'text-red-300' : 'text-red-800'}>最大允许运行压力线</strong>
                ：与地形同一沿程采样；按“浆体总扬程（m）−该点地形高度（m）”计算。
              </span>
            </li>
          </ul>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className={`mb-1 block text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                起点水头高度：
              </span>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={draftZ0Str}
                  onChange={(e) => setDraftZ0Str(e.target.value)}
                  placeholder="起点水头高度，如12.5"
                  className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm tabular-nums ${
                    darkMode
                      ? 'border-gray-500 bg-gray-900 text-gray-100 placeholder:text-gray-500'
                      : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400'
                  }`}
                />
                <span className={`shrink-0 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>m</span>
              </div>
            </label>
            <label className="block min-w-0">
              <span className={`mb-1 block text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                终点水头高度：
              </span>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={draftZ1Str}
                  onChange={(e) => setDraftZ1Str(e.target.value)}
                  placeholder="终点水头高度，如11.8"
                  className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm tabular-nums ${
                    darkMode
                      ? 'border-gray-500 bg-gray-900 text-gray-100 placeholder:text-gray-500'
                      : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400'
                  }`}
                />
                <span className={`shrink-0 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>m</span>
              </div>
            </label>
          </div>

          <div className={`rounded-lg border ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
            <div
              className={`border-b px-3 py-2 text-xs font-medium ${darkMode ? 'border-gray-600 text-gray-400' : 'border-gray-200 text-gray-600'}`}
            >
              预览
            </div>
            <div className="p-2 sm:p-3">
              <div
                className={`mb-2 flex min-h-[1.25rem] flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
              >
                <p className={`tabular-nums ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {appliedTerrain ? (
                    <>主图已叠加（{appliedTerrain.middlePts.length} 个中间点）。</>
                  ) : (
                    <>未叠加到主图。</>
                  )}
                </p>
                <div className={`text-right text-xs tabular-nums sm:shrink-0 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {previewHover ? (
                    <span>
                      L = {previewHover.L.toFixed(3)} m，高度 = {previewHover.z.toFixed(3)} m
                    </span>
                  ) : (
                    <span className="opacity-60">悬停预览</span>
                  )}
                </div>
              </div>
              {draftPreviewOk ? (
                <div className="h-[280px] w-full min-h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={terrainPreviewRows}
                      margin={{ top: 8, right: 14, left: 12, bottom: 28 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#4B5563' : '#E5E7EB'} />
                      <XAxis
                        type="number"
                        dataKey="L"
                        domain={[0, Lmax]}
                        ticks={xTicks}
                        allowDecimals
                        label={{
                          value: '管长 L (m)',
                          position: 'insideBottom',
                          offset: -14,
                          style: {
                            fill: darkMode ? '#9CA3AF' : '#6B7280',
                            fontSize: 12,
                            fontStyle: 'italic',
                          },
                        }}
                        tick={{ fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                        tickFormatter={(v) => formatHydraulicLengthTick(Number(v))}
                        stroke={darkMode ? '#6B7280' : '#9CA3AF'}
                      />
                      <YAxis
                        domain={[previewYMin, previewYMax]}
                        label={{
                          value: '高度 (m)',
                          angle: -90,
                          position: 'insideLeft',
                          offset: 2,
                          style: {
                            fill: darkMode ? '#9CA3AF' : '#6B7280',
                            fontSize: 12,
                            fontStyle: 'italic',
                          },
                        }}
                        tick={{ fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
                        tickFormatter={(v) =>
                          formatHydraulicHeadTick(Number(v), previewYMin, previewYMax)
                        }
                        stroke={darkMode ? '#6B7280' : '#9CA3AF'}
                      />
                      <Tooltip
                        cursor={{ stroke: darkMode ? '#9CA3AF' : '#6B7280', strokeWidth: 1 }}
                        content={(tipProps) => {
                          const { active, payload } = tipProps
                          return (
                            <div>
                              <TerrainPreviewHoverSync
                                active={active}
                                payload={
                                  payload as unknown as
                                    | { payload: { L: number; terrainZ: number } }[]
                                    | undefined
                                }
                                onHover={setPreviewHover}
                              />
                              {active && payload?.[0] ? (
                                <div
                                  className={`rounded-lg border px-2 py-1.5 text-xs shadow ${
                                    darkMode
                                      ? 'border-gray-600 bg-gray-800 text-gray-100'
                                      : 'border-gray-200 bg-white text-gray-900'
                                  }`}
                                >
                                  <div>
                                    L ={' '}
                                    {Number((payload[0].payload as { L: number }).L).toFixed(3)} m
                                  </div>
                                  <div>
                                    高度 ={' '}
                                    {Number((payload[0].payload as { terrainZ: number }).terrainZ).toFixed(
                                      3
                                    )}{' '}
                                    m
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )
                        }}
                      />
                      <Line
                        type="linear"
                        dataKey="terrainZ"
                        name="地形"
                        stroke={TERRAIN_EXPORT_LINE}
                        strokeWidth={2.5}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                      <Line
                        type="linear"
                        dataKey="maxPressZ"
                        name="最大允许运行压力线"
                        stroke={MAX_PRESS_HYDRAULIC_LINE}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className={`py-8 text-center text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  请输入有效的起点、终点水头高度。
                </p>
              )}
              {draftPreviewOk ? (
                <div
                  className={`mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t pt-2 ${
                    darkMode ? 'border-gray-600' : 'border-gray-200'
                  }`}
                >
                  <div className={`flex items-center gap-2 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    <span className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: TERRAIN_EXPORT_LINE }} />
                    地形线
                  </div>
                  <div className={`flex items-center gap-2 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    <span className="h-2.5 w-6 shrink-0 rounded-full" style={{ background: MAX_PRESS_HYDRAULIC_LINE }} />
                    最大允许运行压力线
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block min-w-0 flex-1">
              <span className={`mb-1 block text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>管长 L</span>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualLStr}
                  onChange={(e) => setManualLStr(e.target.value)}
                  className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm tabular-nums ${
                    darkMode
                      ? 'border-gray-500 bg-gray-900 text-gray-100'
                      : 'border-gray-200 bg-white text-gray-900'
                  }`}
                />
                <span className={`shrink-0 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>m</span>
              </div>
            </label>
            <label className="block min-w-0 flex-1">
              <span className={`mb-1 block text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>高度</span>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualZStr}
                  onChange={(e) => setManualZStr(e.target.value)}
                  className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm tabular-nums ${
                    darkMode
                      ? 'border-gray-500 bg-gray-900 text-gray-100'
                      : 'border-gray-200 bg-white text-gray-900'
                  }`}
                />
                <span className={`shrink-0 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>m</span>
              </div>
            </label>
            <button
              type="button"
              onClick={handleAddManualMiddle}
              className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              添加中间点
            </button>
          </div>

          {sortedDraftMiddles.length > 0 ? (
            <ul
              className={`divide-y overflow-hidden rounded-lg border text-xs ${
                darkMode ? 'divide-gray-600 border-gray-600' : 'divide-gray-200 border-gray-200'
              }`}
            >
              {sortedDraftMiddles.map((p) => (
                <li
                  key={p.id ?? `${p.L}-${p.z}`}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className={`tabular-nums ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    L = {p.L.toFixed(2)} m，高度 = {p.z.toFixed(3)} m
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveMiddle(p.id)}
                    className="shrink-0 text-red-500 hover:underline"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {editorErr ? <p className="text-sm text-red-500 dark:text-red-400">{editorErr}</p> : null}

          <details
            className={`rounded-lg border text-sm ${darkMode ? 'border-gray-600 bg-gray-900/30' : 'border-gray-200 bg-gray-50'}`}
          >
            <summary
              className={`cursor-pointer select-none px-3 py-2 font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
            >
              批量粘贴
            </summary>
            <div className={`space-y-2 border-t px-3 py-3 ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
              <p className={`text-[11px] leading-relaxed ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                每行两列，管长 L、高度；可从表格直接复制粘贴；首行若为文字表头会自动跳过；
              </p>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={3}
                placeholder={'L\tz\n500\t12.5\n1200\t11.8'}
                className={`w-full rounded-md border px-2 py-2 font-mono text-xs ${
                  darkMode ? 'border-gray-500 bg-gray-800 text-gray-100' : 'border-gray-300 bg-white'
                }`}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleApplyBulkTerrain}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  添加
                </button>
              </div>
            </div>
          </details>

          <div className="flex flex-col items-end gap-2 border-t pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {appliedTerrain ? (
              <button
                type="button"
                onClick={handleUndoMainTerrain}
                className={`rounded-lg border px-4 py-2 text-sm ${
                  darkMode
                    ? 'border-gray-500 text-gray-300 hover:bg-gray-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                撤回
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleApplyTerrainToMainChart}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              应用到主图
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClearWaterHydraulicGradeChartBlock({
  darkMode,
  Lmax,
  clearParams,
}: {
  darkMode: boolean
  Lmax: number
  clearParams: Record<string, number | undefined>
}) {
  const rho_w = Number(clearParams.rho_w ?? 1)
  const g = Number(clearParams.g ?? 9.81)
  const H = Number(clearParams.H)
  const i_w = Number(clearParams.i_w)
  const P_j = Number(clearParams.P_j ?? 0)

  const chartData = useMemo(() => {
    if (
      !Number.isFinite(Lmax) ||
      Lmax <= 0 ||
      !Number.isFinite(rho_w) ||
      rho_w <= 0 ||
      !Number.isFinite(g) ||
      g <= 0 ||
      !Number.isFinite(i_w) ||
      !Number.isFinite(H)
    ) {
      return []
    }
    const lossHeadM = (l: number) => clearWaterCumLossKpaAt(l, Lmax, rho_w, g, i_w, P_j) / (rho_w * g)
    return buildDenseHydraulicGradeHead(Lmax, H, lossHeadM, HYDRAULIC_GRADE_CURVE_POINTS).map((r) => ({
      L: r.L,
      headClear: r.headM,
    }))
  }, [Lmax, rho_w, g, H, i_w, P_j])

  const stepStr = formatHydraulicGradeStep(Lmax, HYDRAULIC_GRADE_TICK_DIVISIONS)
  const xTicks = useMemo(() => hydraulicGradeXTicks(Lmax, HYDRAULIC_GRADE_TICK_DIVISIONS), [Lmax])

  const heads = chartData.map((d) => d.headClear)
  const minHead = heads.length ? Math.min(...heads) : 0
  const maxHead = heads.length ? Math.max(...heads) : 1
  const span = Math.max(maxHead - minHead, 1e-6)
  const yPad = Math.max(span * 0.06, 0.5)
  const yMin = minHead - yPad
  const yMax = maxHead + yPad
  const totalLossHeadM =
    chartData.length && Number.isFinite(rho_w) && rho_w > 0 && g > 0
      ? clearWaterCumLossKpaAt(Lmax, Lmax, rho_w, g, i_w, P_j) / (rho_w * g)
      : 0

  const handleExportChartPNG = () => {
    const dateStr = new Date().toISOString().slice(0, 10)
    downloadScientificHlChartPng({
      curveData: chartData.map((r) => ({ L: r.L, H: r.headClear })),
      darkMode,
      title: '清水管道 · 水力坡度线',
      subtitle: `清水输送水头分布：L_max = ${Lmax} m，主刻度间隔 ${stepStr} m；ρ_w = ${rho_w} t/m³，g = ${g} m/s²`,
      xAxisLabel: `管长 L (m)\n范围 [0，${Lmax}]；均匀主刻度，步长 ${stepStr} m`,
      yAxisLabel: `水头 H (m)\n测压管水头（清水柱）；含 H、ρ_w g i_w L 与按管长分摊的 P_j`,
      lineColor: CLEAR_HYDRAULIC_LINE,
      legendText: '清水水力坡度线',
      filename: `clear_water_hydraulic_grade_${dateStr}.png`,
      hydraulicLayout: {
        lMax: Lmax,
        yMin,
        yMax,
        xTickDivisions: HYDRAULIC_GRADE_TICK_DIVISIONS,
      },
    })
  }

  if (chartData.length === 0) return null

  return (
    <div className={`rounded-xl border-2 p-5 mt-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className={`text-lg font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
          清水水力坡度线 – <InlineMath math="L" />
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
        横轴刻度步长由当前输入的 <InlineMath math="L_{\max}" /> 与 {HYDRAULIC_GRADE_TICK_DIVISIONS}{' '}
        等分计算，为 <span className="font-mono">{stepStr}</span> m。横轴 <InlineMath math="[0,L_{\max}]" />，悬停可读水头与折算压力。
        <strong className="text-blue-600 dark:text-blue-400"> 清水</strong>线按本页清水总扬程：<InlineMath math="\rho_w" />、<InlineMath math="g" />、<InlineMath math="i_w" />
        与扬送清水的几何高度 <InlineMath math="H" />、管长 <InlineMath math="L_{\max}" />、<InlineMath math="P_j" />；沿程损失按{' '}
        <InlineMath math="\rho_w g i_w l + P_j\cdot(l/L_{\max})" /> 折合为清水柱高后画入纵坐标，与上方「衍生计算结果」公式一致。
      </div>
      <div className={`flex flex-wrap gap-x-5 gap-y-1 text-xs mb-3 px-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        <span>
          <InlineMath math="L_{\max}" /> = {Lmax} m
        </span>
        <span>刻度步长 = {stepStr} m</span>
        <span>
          清水终点水头 <InlineMath math="H" /> = {Number.isFinite(H) ? H.toFixed(3) : '—'} m
        </span>
        <span>
          <InlineMath math="\rho_w" /> = {clearParams.rho_w ?? 1} t/m³
        </span>
      </div>
      <div id="clear-hydraulic-grade-chart" className="min-h-[380px] w-full">
        <ResponsiveContainer width="100%" height={550}>
          <LineChart data={chartData} margin={{ top: 8, right: 20, left: 8, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#4B5563' : '#E5E7EB'} />
            <XAxis
              type="number"
              dataKey="L"
              domain={[0, Lmax]}
              ticks={xTicks}
              allowDecimals
              label={{
                value: '管长 L (m)',
                position: 'insideBottom',
                offset: -12,
                style: { fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 12, fontStyle: 'italic' },
              }}
              tick={{ fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
              tickFormatter={(v) => formatHydraulicLengthTick(Number(v))}
              stroke={darkMode ? '#6B7280' : '#9CA3AF'}
            />
            <YAxis
              label={{
                value: '水头 H (m)',
                angle: -90,
                position: 'insideLeft',
                offset: 2,
                style: { fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 12, fontStyle: 'italic' },
              }}
              tick={{ fill: darkMode ? '#9CA3AF' : '#6B7280', fontSize: 11 }}
              tickFormatter={(v) => formatHydraulicHeadTick(Number(v), yMin, yMax)}
              stroke={darkMode ? '#6B7280' : '#9CA3AF'}
              domain={[yMin, yMax]}
            />
            <Tooltip
              content={(tipProps) => {
                const { active, label, payload } = tipProps
                if (!active || !payload?.length) return null
                const Lv = Number(label)
                const p0 = payload[0]
                const hm = Number(p0?.value)
                const pk =
                  Number.isFinite(hm) && Number.isFinite(rho_w) && rho_w > 0 && g > 0 ? hm * rho_w * g : NaN
                const boxCls = darkMode
                  ? 'rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-xs text-gray-100 shadow-lg'
                  : 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 shadow-lg'
                return (
                  <div className={boxCls}>
                    <div className="mb-1 font-medium">L = {Number.isFinite(Lv) ? Lv.toFixed(3) : String(label)} m</div>
                    <div className="text-blue-600 dark:text-blue-400">
                      清水水力坡度：水头 {Number.isFinite(hm) ? hm.toFixed(3) : '—'} m
                      {Number.isFinite(pk) ? `，折算压力 ${pk.toFixed(2)} kPa（ρ_w·g·H）` : null}
                    </div>
                  </div>
                )
              }}
            />
            <Line
              type="linear"
              dataKey="headClear"
              name="清水水力坡度线"
              stroke={CLEAR_HYDRAULIC_LINE}
              strokeWidth={2.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={`mt-3 pt-3 border-t text-xs leading-relaxed ${darkMode ? 'border-gray-500 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
        <span className={`font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>图注：</span>
        <HydraulicSlopeScopeNote /> 进口端总水头 <InlineMath math="H+\Delta h_{\mathrm{w}}(L_{\max})" /> ≈{' '}
        {Number.isFinite(H + totalLossHeadM) ? (H + totalLossHeadM).toFixed(1) : '—'} m。
      </div>
    </div>
  )
}

type MunicipalHandbookSpec = { n: number; title: string }

function municipalDocSrc(n: number): string {
  return `./municipal/doc-image${String(n).padStart(2, '0')}.jpeg`
}

/** 列表用缩略路径：info1.jpg → info1-thumb.jpg。请将低分辨率小图放在 frontend/public/ 与高清同名带 -thumb，可显著缩短「科研创新中心」首屏加载；缺失时自动回退高清原图。 */
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
  /** 在「设置」中完成离线授权后通知父组件更新门禁状态 */
  onLicenseResolved?: () => void
}

export default function MainContent({ 
  formula, 
  darkMode = false,
  currentView = 'formula',
  aboutDepartment = null,
  language = 'zh',
  darkModeValue = false,
  onDarkModeChange,
  onLanguageChange,
  onLicenseResolved
}: MainContentProps) {
  // 主内容滚动容器，用于在切换视图/公式时回到顶部
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  // 为每个公式独立存储参数（key是formula.id）
  const [formulaParameters, setFormulaParameters] = useState<Record<string, Record<string, number | undefined>>>({})
  const [formulaRawInputs, setFormulaRawInputs] = useState<Record<string, Record<string, string>>>({})
  const [formulaResults, setFormulaResults] = useState<Record<string, CalculationResult | null>>({})
  const [formulaLockedVc, setFormulaLockedVc] = useState<Record<string, number | null>>({})
  const [liuOmegaDLByFormula, setLiuOmegaDLByFormula] = useState<Record<string, number | null>>({})
  const [kronodzeStep2ReadyMap, setKronodzeStep2ReadyMap] = useState<Record<string, boolean>>({})
  const [kronodzeStep3VisibleMap, setKronodzeStep3VisibleMap] = useState<Record<string, boolean>>({})
  
  // 当前公式的参数（从formulaParameters中获取）
  const parameters = formula ? (formulaParameters[formula.id] || {}) : {}
  const rawInputs = formula ? (formulaRawInputs[formula.id] || {}) : {}
  const result = formula ? (formulaResults[formula.id] || null) : null
  const lockedVc = formula ? (formulaLockedVc[formula.id] ?? null) : null
  const liuOmegaDL = formula ? (liuOmegaDLByFormula[formula.id] ?? null) : null
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
  const isCentrifugalPumpTotalHead = formula?.id === 'centrifugal_pump_total_head'
  const isPositiveDisplacementPumpFormula = formula?.id === 'positive_displacement_pump_outlet_pressure'
  const isKronodzeFormula = formula?.id === 'kronodze_pressure'
  const isTotalHeadFormula =
    formula?.id === 'slurry_total_head' || formula?.id === 'clear_water_total_head'
  const densityMixingRawRhoS = formulaRawInputs['density_mixing']?.['rho_s']
  const densityMixingRhoS = formulaParameters['density_mixing']?.['rho_s']
  const darcyRawEpsilonPreset = formulaRawInputs['darcy_friction']?.['epsilon_preset']
  const darcyEpsilon = formulaParameters['darcy_friction']?.['epsilon']
  
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
  /** 容积式泵 P_k：是否展开「其他模块压力」下拉 */
  const [pkSuggestOpen, setPkSuggestOpen] = useState(false)
  /** 浆体总扬程 i_k：跨页面结果下拉导入 */
  const [slurryTotalHeadIkSuggestOpen, setSlurryTotalHeadIkSuggestOpen] = useState(false)
  /** 清水总扬程 i_w：跨页面结果下拉导入 */
  const [clearWaterTotalHeadIwSuggestOpen, setClearWaterTotalHeadIwSuggestOpen] = useState(false)
  /** 缩径消能 λ_d：引用已计算达西摩阻系数下拉 */
  const [slurryDissipationLambdaSuggestOpen, setSlurryDissipationLambdaSuggestOpen] = useState(false)

  // 浆体摩阻工作流步骤1：ρ_s（清水密度）默认显示为 1
  useEffect(() => {
    if (!isSlurryFrictionWorkflow) return
    const hasRaw = densityMixingRawRhoS != null && densityMixingRawRhoS.trim() !== ''
    const hasParsed = densityMixingRhoS != null && !isNaN(densityMixingRhoS)
    if (hasRaw || hasParsed) return
    setFormulaRawInputs((prev) => ({
      ...prev,
      density_mixing: { ...(prev.density_mixing || {}), rho_s: '1' }
    }))
    setFormulaParameters((prev) => ({
      ...prev,
      density_mixing: { ...(prev.density_mixing || {}), rho_s: 1 }
    }))
  }, [isSlurryFrictionWorkflow, densityMixingRawRhoS, densityMixingRhoS])

  // 浆体摩阻工作流步骤4：ε 默认显示并使用「直缝新钢管 0.053」
  useEffect(() => {
    if (!isSlurryFrictionWorkflow) return
    const hasPreset = darcyRawEpsilonPreset != null && darcyRawEpsilonPreset.trim() !== ''
    const hasEpsilon = darcyEpsilon != null && !isNaN(darcyEpsilon)
    if (hasPreset && hasEpsilon) return
    setFormulaRawInputs((prev) => ({
      ...prev,
      darcy_friction: {
        ...(prev.darcy_friction || {}),
        epsilon_preset: prev.darcy_friction?.epsilon_preset || DEFAULT_SLURRY_EPSILON_PRESET,
        epsilon: prev.darcy_friction?.epsilon || String(DEFAULT_SLURRY_EPSILON),
      }
    }))
    setFormulaParameters((prev) => ({
      ...prev,
      darcy_friction: {
        ...(prev.darcy_friction || {}),
        epsilon: prev.darcy_friction?.epsilon ?? DEFAULT_SLURRY_EPSILON,
      }
    }))
  }, [isSlurryFrictionWorkflow, darcyRawEpsilonPreset, darcyEpsilon])
  /** 浆体摩阻损失（单页）ρ_k：跨页面结果下拉导入 */
  const [slurryFrictionRhoKSuggestOpen, setSlurryFrictionRhoKSuggestOpen] = useState(false)
  /** 浆体摩阻损失（单页）λ：跨页面结果下拉导入 */
  const [slurryFrictionLambdaSuggestOpen, setSlurryFrictionLambdaSuggestOpen] = useState(false)
  /** 浆体加速流 L：按起终点自动计算候选下拉 */
  const [slurryAccelLSuggestOpen, setSlurryAccelLSuggestOpen] = useState(false)
  /** 离心泵步骤2：$H_s$ 引用「清水总扬程」结果 */
  const [centrifugalSigmaHsSuggestOpen, setCentrifugalSigmaHsSuggestOpen] = useState(false)
  /** 离心泵步骤3：$\rho_k$ 引用「密度混合 / 浆体摩阻」结果 */
  const [centrifugalRhoKSuggestOpen, setCentrifugalRhoKSuggestOpen] = useState(false)
  /** 离心泵步骤3：$\eta_j$ 传动方式下拉（须用 KaTeX 渲染选项，不能用原生 select） */
  const [centrifugalEtaJSelectOpen, setCentrifugalEtaJSelectOpen] = useState(false)
  const centrifugalEtaJSelectRef = useRef<HTMLDivElement | null>(null)
  /** 用户是否显式点了「自定义」；未点选时空 η_j 仍按联轴器缺省展示并写入 1 */
  const [centrifugalEtaJWantsCustom, setCentrifugalEtaJWantsCustom] = useState(false)
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
  const [centrifugalStep1SnapshotByFormula, setCentrifugalStep1SnapshotByFormula] = useState<
    Record<string, { K_p: number; intermediate: Record<string, unknown> }>
  >({})
  const [centrifugalStep2SnapshotByFormula, setCentrifugalStep2SnapshotByFormula] = useState<
    Record<string, { H_total: number; intermediate: Record<string, unknown> }>
  >({})
  const [positiveDisplacementStep1SnapshotByFormula, setPositiveDisplacementStep1SnapshotByFormula] = useState<
    Record<string, { P_b: number; intermediate: Record<string, unknown> }>
  >({})

  // 更新检查相关状态
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'>('idle')
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; releaseNotes?: string } | null>(null)
  const [updateProgress, setUpdateProgress] = useState<number>(0)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateUpToDateNotice, setUpdateUpToDateNotice] = useState(false)
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const [licenseInfo, setLicenseInfo] = useState<{ machineId: string; ok: boolean; expiresAtMs: number | null } | null>(null)
  const [licenseInput, setLicenseInput] = useState('')
  const [licenseMsg, setLicenseMsg] = useState<string | null>(null)
  const [licenseBusy, setLicenseBusy] = useState(false)
  const [licenseCopyOk, setLicenseCopyOk] = useState(false)

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

  useEffect(() => {
    if (currentView !== 'settings') return
    const api =
      typeof window !== 'undefined' &&
      (window as { electronAPI?: { license?: { getStatus: () => Promise<{ ok: boolean; machineId?: string; expiresAtMs?: number | null }> } } }).electronAPI?.license
    if (!api) {
      setLicenseInfo(null)
      return
    }
    api.getStatus().then((s) => {
      setLicenseInfo({
        machineId: s.machineId || '',
        ok: !!s.ok,
        expiresAtMs: s.expiresAtMs != null ? s.expiresAtMs : null,
      })
    })
  }, [currentView])

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
    if (formulaId === 'centrifugal_pump_total_head') {
      const step2Zh: Record<string, { zh: string; math: string }> = {
        Sigma_H_s: { zh: '装置所需液柱扬程累计', math: '\\sum H_s' },
        K_p: { zh: '主泵输送浆体的扬程降低率', math: 'K_p' },
        K_m: { zh: '主泵磨蚀后扬程折损率', math: 'K_m' },
        K_p_K_m: { zh: '分母连乘项', math: 'K_p\\cdot K_m' },
      }
      const s2 = step2Zh[key]
      if (s2) {
        return (
          <span className="flex flex-col gap-0.5 items-start text-left min-w-0">
            <span
              className={`text-xs leading-snug font-normal ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
            >
              {s2.zh}
            </span>
            <InlineMath math={s2.math} />
          </span>
        )
      }
      const step3Motor: Record<string, { zh: string; math: string }> = {
        H_b_m: { zh: '主泵扬送清水的总扬程（液柱）', math: 'H_b' },
        H_m: { zh: '式中液柱项（数值同 H_b）', math: 'H_b' },
        rho_k_t_m3: { zh: '浆体密度（t/m³）', math: '\\rho_k\\ \\mathrm{(t/m^3)}' },
        rho_si_kg_m3: { zh: '参与功率计算的 SI 密度（kg/m³）', math: '\\rho_k\\ \\mathrm{(kg/m^3)}' },
        Q_k: { zh: '浆体体积流量', math: 'Q_k' },
        K_1: { zh: '电机功率富余系数', math: 'K_1' },
        eta_j: { zh: '机组传动效率', math: '\\eta_j' },
        eta_b: { zh: '泵扬送清水时的效率', math: '\\eta_b' },
      }
      const ms = step3Motor[key]
      if (ms) {
        return (
          <span className="flex flex-col gap-0.5 items-start text-left min-w-0">
            <span
              className={`text-xs leading-snug font-normal ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
            >
              {ms.zh}
            </span>
            <InlineMath math={ms.math} />
          </span>
        )
      }
    }
    if (formulaId === 'positive_displacement_pump_outlet_pressure') {
      const pdStep2: Record<string, { zh: string; math: string }> = {
        P_b: { zh: '容积泵总扬程（步骤1，kPa）', math: 'P_b' },
        Q_k: { zh: '浆体计算体积流量（m³/s）', math: 'Q_k' },
        K_1: { zh: '电机功率富余系数', math: 'K_1' },
        eta_v: { zh: '泵容积效率', math: '\\eta_v' },
        eta_c: { zh: '总机械效率', math: '\\eta_c' },
        numerator_K1_Q_Pb: { zh: '功率式分子（三者乘积）', math: 'K_1 \\cdot Q_k \\cdot P_b' },
        denom_eta_v_eta_c: { zh: '功率式分母（两效率之积）', math: '\\eta_v \\cdot \\eta_c' },
      }
      const pd = pdStep2[key]
      if (pd) {
        return (
          <span className="flex flex-col gap-0.5 items-start text-left min-w-0">
            <span
              className={`text-xs leading-snug font-normal ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
            >
              {pd.zh}
            </span>
            <InlineMath math={pd.math} />
          </span>
        )
      }
    }
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

      // 浆体摩阻工作流（达西分步）中间量
      'term_rho_g_C1v': '固相体积项',
      'term_1minusC1v_rho_s': '固相体积项',
      'rho_1_kg_m3': 'SI 密度',
      're_numerator_V_D_rho_kg': '雷诺分子项',
      'mixture_rho_1': '所用混合物密度',
      're_B_used': '所用雷诺数',
      
      // 达西摩阻系数公式
      'Re': '雷诺数',
      'Re_B': '雷诺数',
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

      // 浆体/清水总扬程中间项
      'gravity_pressure': '重力势能压力',
      'friction_pressure': '沿程压力损失',
      'P_j': '局部摩阻',
      'P_n': '泵站零件损失',
      'P_z': '出口余压',

      // 离心泵总扬程
      'term_0p25_Cw': '项 0.25·C_w',
      'Sigma_H_s': 'ΣH_s（m）',
      'K_p_K_m': 'K_p·K_m',
      'K_f': '压力富余系数 K_f',
      'P_k': '管道输送压力 P_k',

    }
    
    let label = labelMap[key] || key
    if (key === 'bracket_term' && formulaId === 'kronodze_pressure') label = '综合修正项'

    // 根据key返回对应的数学公式显示（bracket_term 在费祥俊、瓦斯普、克诺罗兹中形式不同）
    const bracketFormula = formulaId === 'kronodze_pressure'
      ? '1+2.48\\sqrt[3]{C_d}\\sqrt[4]{D_L}'
      : formulaId === 'fei_xiangjun'
        ? '[g \\cdot D \\cdot \\frac{\\Delta\\rho}{\\rho}]^{1/2}'
        : '[2 \\cdot g \\cdot D \\cdot \\frac{\\Delta\\rho}{\\rho}]^{1/2}';       // E.J.瓦斯普
    const mathFormulas: Record<string, string> = {
      'delta_rho_ratio': '\\frac{\\Delta\\rho}{\\rho}',
      'density_ratio': '\\frac{\\Delta\\rho}{\\rho}',
      'g': 'g',
      'core_term': '[g \\cdot D \\cdot \\frac{\\Delta\\rho}{\\rho} \\cdot \\omega]^{1/3}',
      // E.J.瓦斯普公式：浓度修正项为 Cv^0.1858（根据后端计算）
      'concentration_term': 'C_V^{0.1858}',
      'velocity_ratio_term': '(\\frac{\\omega_s}{\\omega})^{1/6}',
      'bracket_term': bracketFormula,
      'size_ratio_term': '(\\frac{d_{85}}{D})^{1/6}',
      'conc_term': 'C_V^{0.25}',
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
      'term_rho_g_C1v': '\\rho_g \\cdot C_{1v}',
      'term_1minusC1v_rho_s': '(1-C_{1v})\\cdot\\rho_s',
      'rho_1_kg_m3': '1000\\rho_1\\ \\mathrm{(kg/m^3)}',
      're_numerator_V_D_rho_kg': 'V \\cdot D_n \\cdot 1000\\rho_1',
      'mixture_rho_1': '\\rho_1',
      're_B_used': '\\mathrm{Re}_B',
      'Re_B': '\\mathrm{Re}_B',
      'dissipation_kql_numerator': '(6.3755\\times10^{-9})\\lambda_d L_s',
      'dissipation_kql_denominator': 'd^5',
      'clear_hw_ch_pow': 'C_h^{-1.85}',
      'clear_hw_dj_pow': 'd_j^{-4.87}',
      'clear_hw_qg_pow': 'q_g^{1.85}',
      'P_j': 'P_j',
      'P_n': 'P_n',
      'P_z': 'P_z',
    }
    
    if (key === 'gravity_pressure') {
      const latex =
        formulaId === 'clear_water_total_head' ? '\\rho_w g H' : '\\rho_k g H'
      return (
        <span className="inline-flex items-baseline gap-x-1 flex-wrap">
          <span>{label}:</span>
          <InlineMath math={latex} />
        </span>
      )
    }
    if (key === 'friction_pressure') {
      const latex =
        formulaId === 'clear_water_total_head'
          ? '\\rho_w g i_w L'
          : '\\rho_s g i_k L'
      return (
        <span className="inline-flex items-baseline gap-x-1 flex-wrap">
          <span>{label}:</span>
          <InlineMath math={latex} />
        </span>
      )
    }
    
    let mathFormula = mathFormulas[key]
    // 刘德忠公式的浓度修正项为 C_V^{1/6}，瓦斯普公式为 C_V^{0.1858}
    if (key === 'concentration_term') {
      mathFormula = formulaId === 'liu_dezhong' ? 'C_V^{1/6}' : 'C_V^{0.1858}'
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
      // 替换 Cv（必须在次方处理之后，避免影响 Cv^0.1858）；体积浓度下标用大写 V
      .replace(/Cv/g, 'C_V')
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
        setCurrentVersion('1.0.3')
      })
    } else {
      setCurrentVersion('1.0.3')
    }
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
      setUpdateUpToDateNotice(false)
      setUpdateStatus('checking')
      setUpdateError(null)
    })

    electronAPI.onUpdateAvailable((info: any) => {
      setUpdateUpToDateNotice(false)
      setUpdateStatus('available')
      setUpdateInfo({
        version: info.version,
        releaseNotes: info.releaseNotes
      })
    })

    electronAPI.onUpdateNotAvailable((info: any) => {
      setUpdateStatus('idle')
      setUpdateInfo({ version: info.version })
      setUpdateUpToDateNotice(true)
    })

    electronAPI.onUpdateError((error: any) => {
      setUpdateUpToDateNotice(false)
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
      setUpdateUpToDateNotice(false)
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

  // 下载更新（主进程以 { error } 返回错误而非抛错，需显式判断）
  const handleDownloadUpdate = async () => {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.update) {
      return
    }

    try {
      setUpdateStatus('downloading')
      setUpdateProgress(0)
      setUpdateError(null)
      const result = (await (window as any).electronAPI.update.downloadUpdate()) as { success?: boolean; error?: string }
      if (result?.error) {
        setUpdateStatus('error')
        setUpdateError(result.error)
        return
      }
    } catch (error: any) {
      setUpdateStatus('error')
      setUpdateError(error?.message || '下载更新失败')
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
          formula.parameters.forEach((param) => {
            if (param.default === undefined) return
            if (formulaId === 'centrifugal_pump_total_head' && param.name !== 'g') return
            if (newParams[param.name] === undefined || newParams[param.name] === null) {
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
          if (formulaId === 'fei_xiangjun') {
            delete newParams['omega']
          }
          return { ...prev, [formulaId]: newParams }
        } else {
          // 如果没有记录，初始化所有默认值
          const initialParams: Record<string, number | undefined> = {}
          formula.parameters.forEach((param) => {
            if (param.default === undefined) return
            if (formulaId === 'centrifugal_pump_total_head' && param.name !== 'g') return
            initialParams[param.name] = param.default
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
          if (formulaId === 'fei_xiangjun') {
            delete initialParams['omega']
          }
          return { ...prev, [formulaId]: initialParams }
        }
      })
      
      setFormulaRawInputs(prev => {
        if (prev[formulaId]) {
          // 如果已有记录，只设置新公式中还没有值的参数的默认值
          const currentRaw = prev[formulaId]
          const newRaw = { ...currentRaw }
          formula.parameters.forEach((param) => {
            if (param.default === undefined) return
            if (formulaId === 'centrifugal_pump_total_head' && param.name !== 'g') return
            if (!newRaw[param.name]) {
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
          if (formulaId === 'fei_xiangjun') {
            delete newRaw['omega']
          }
          return { ...prev, [formulaId]: newRaw }
        } else {
          // 如果没有记录，初始化所有默认值
          const initialRaw: Record<string, string> = {}
          formula.parameters.forEach((param) => {
            if (param.default === undefined) return
            if (formulaId === 'centrifugal_pump_total_head' && param.name !== 'g') return
            initialRaw[param.name] = String(param.default)
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

  /** 离心泵步骤3：清除可能被误合并的 K_1、ρ_k、η_b；η_j 默认联轴器 1.0（每浏览器会话首次进入本公式时执行一次） */
  useEffect(() => {
    if (formula?.id !== 'centrifugal_pump_total_head') return
    const k = 'flow_calc_cen_step3_autofill_scrub_v2'
    try {
      if (sessionStorage.getItem(k)) return
      sessionStorage.setItem(k, '1')
    } catch {
      return
    }
    const id = 'centrifugal_pump_total_head'
    setCentrifugalEtaJWantsCustom(false)
    setFormulaParameters((prev) => {
      const cur = prev[id]
      if (!cur) return prev
      const next = { ...cur }
      for (const name of ['K_1', 'rho_k', 'eta_b'] as const) {
        delete next[name]
      }
      next['eta_j'] = 1
      return { ...prev, [id]: next }
    })
    setFormulaRawInputs((prev) => {
      const cur = prev[id]
      if (!cur) return prev
      const next = { ...cur }
      for (const name of ['K_1', 'rho_k', 'eta_b'] as const) {
        next[name] = ''
      }
      next['eta_j'] = '1'
      return { ...prev, [id]: next }
    })
  }, [formula?.id])

  useEffect(() => {
    setCentrifugalEtaJSelectOpen(false)
    if (formula?.id !== 'centrifugal_pump_total_head') {
      setCentrifugalEtaJWantsCustom(false)
    }
  }, [formula?.id])

  /** 步骤3：未选「自定义」且 η_j 为空时写入联轴器 1.0（解决 scrub 只执行一次导致仍显示自定义） */
  useEffect(() => {
    if (formula?.id !== 'centrifugal_pump_total_head') return
    if (centrifugalEtaJWantsCustom) return
    const ej = parameters['eta_j']
    if (ej != null && !isNaN(ej)) return
    setFormulaParameters((prev) => ({
      ...prev,
      centrifugal_pump_total_head: { ...(prev.centrifugal_pump_total_head || {}), eta_j: 1 },
    }))
    setFormulaRawInputs((prev) => ({
      ...prev,
      centrifugal_pump_total_head: { ...(prev.centrifugal_pump_total_head || {}), eta_j: '1' },
    }))
  }, [formula?.id, centrifugalEtaJWantsCustom, parameters['eta_j']])

  useEffect(() => {
    if (!centrifugalEtaJSelectOpen) return
    const onDown = (e: MouseEvent) => {
      const el = centrifugalEtaJSelectRef.current
      if (el && !el.contains(e.target as Node)) setCentrifugalEtaJSelectOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [centrifugalEtaJSelectOpen])

  /** 容积式泵：去掉后端默认后，清除本会话内可能残留的 K_f、K_1、η_v、η_c（每会话首次进入本公式一次） */
  useEffect(() => {
    if (formula?.id !== 'positive_displacement_pump_outlet_pressure') return
    const k = 'flow_calc_pd_no_defaults_scrub_v1'
    try {
      if (sessionStorage.getItem(k)) return
      sessionStorage.setItem(k, '1')
    } catch {
      return
    }
    const id = 'positive_displacement_pump_outlet_pressure'
    setFormulaParameters((prev) => {
      const cur = prev[id]
      if (!cur) return prev
      const next = { ...cur }
      for (const name of ['K_f', 'K_1', 'eta_v', 'eta_c'] as const) {
        delete next[name]
      }
      return { ...prev, [id]: next }
    })
    setFormulaRawInputs((prev) => {
      const cur = prev[id]
      if (!cur) return prev
      const next = { ...cur }
      for (const name of ['K_f', 'K_1', 'eta_v', 'eta_c'] as const) {
        next[name] = ''
      }
      return { ...prev, [id]: next }
    })
  }, [formula?.id])

  // 当参数改变且已锁定时，自动重新计算并比较
  useEffect(() => {
    if (lockedVc !== null && formula && autoCalculateRef && formula.id !== 'kronodze_pressure') {
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
        title: language === 'en' ? APP_NAME_EN : APP_NAME_ZH,
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

    let trimmed = value.trim()
    if (name === 'C_w') {
      trimmed = trimmed.replace(/%+\s*$/u, '').trim()
    }
    const normalized = normalizeDecimalInput(trimmed)

    // 允许用户输入中间态：比如 "-"、"."、"1."，这时不立刻覆盖数值
    if (normalized === '-' || normalized === '.' || normalized === '-.') return

    // 只接受标准数字格式
    if (!/^-?\d+(\.\d*)?$/.test(normalized)) return

    const numValue = parseFloat(normalized)
    if (isNaN(numValue)) return

    if (name === 'C_w' && (numValue < 0 || numValue > 1)) return

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

    let t = raw.trim()
    if (name === 'C_w') {
      t = t.replace(/%+\s*$/u, '').trim()
    }
    const normalized = normalizeDecimalInput(t)
    const numValue = parseFloat(normalized)
    if (isNaN(numValue)) return

    if (name === 'C_w') {
      if (numValue < 0 || numValue > 1) {
        updateRawInputs((prev) => ({ ...prev, [name]: '' }))
        updateParameters((prev) => ({ ...prev, [name]: undefined }))
        return
      }
    }

    const rounded = Math.round(numValue * 1e6) / 1e6
    updateRawInputs(prev => ({ ...prev, [name]: String(rounded) }))
    updateParameters(prev => ({ ...prev, [name]: rounded }))
    if (formula.id === 'slurry_accel_energy' && (name === 'Z1' || name === 'Z2')) {
      window.setTimeout(() => applySlurryAccelAutoLength(false), 0)
    }
  }

  const parseLooseNumber = (v: unknown): number | null => {
    if (v == null) return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    const s = normalizeDecimalInput(String(v).trim())
    if (s === '') return null
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : null
  }

  const getSlurryAccelAutoLength = (): number | null => {
    if (formula?.id !== 'slurry_accel_energy') return null
    const z1 = parseLooseNumber(rawInputs['Z1'] ?? parameters['Z1'])
    const z2 = parseLooseNumber(rawInputs['Z2'] ?? parameters['Z2'])
    if (z1 == null || z2 == null) return null
    return Math.round(Math.abs(z2 - z1) * 1e6) / 1e6
  }

  const applySlurryAccelAutoLength = (force = false) => {
    if (formula?.id !== 'slurry_accel_energy') return
    const autoL = getSlurryAccelAutoLength()
    if (autoL == null || !Number.isFinite(autoL)) return
    const rawL = String(rawInputs['L'] ?? '').trim()
    const numL = parseLooseNumber(parameters['L'])
    const hasManualL = rawL !== '' || numL != null
    if (!force && hasManualL) return
    updateRawInputs((prev) => ({ ...prev, L: String(autoL) }))
    updateParameters((prev) => ({ ...prev, L: autoL }))
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
    if (raw.trim() === '') {
      if (subId === 'density_mixing' && name === 'rho_s') {
        setFormulaRawInputs((prev) => ({
          ...prev,
          [subId]: { ...(prev[subId] || {}), [name]: '1' }
        }))
        setFormulaParameters((prev) => ({
          ...prev,
          [subId]: { ...(prev[subId] || {}), [name]: 1 }
        }))
      }
      return
    }
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
    const darcy = formulaParameters['darcy_friction'] || {}
    const p = formulaParameters[subId] || {}
    if (subId === 'density_mixing') {
      const Cw = p['C_w']
      if (Cw == null || isNaN(Cw) || Cw < 0 || Cw > 1) return '步骤1：C_w 须在 0～1 之间（小数，如 0.35）'
      if (p['rho_g'] == null || isNaN(p['rho_g']!) || p['rho_g']! <= 0) return '步骤1：请填写 ρ_g'
      if (p['rho_s'] == null || isNaN(p['rho_s']!) || p['rho_s']! <= 0) return '步骤1：请填写 ρ_s'
      return null
    }
    if (subId === 'darcy_friction_step1_rho1') {
      const hasStepA = [darcy['rho_g'], darcy['rho_s'], darcy['C1v']].every((v) => v != null && !isNaN(v!))
      if (!hasStepA) return '步骤2：请填写 ρ_g、ρ_s、C1v'
      return null
    }
    if (subId === 'darcy_friction_step2_re') {
      const rho1 = darcy['rho_1']
      if (rho1 == null || isNaN(rho1) || rho1 <= 0) {
        return '步骤3：请填写 ρ₁（t/m³）；可由步骤 2 结果导入，或在本步输入'
      }
      if (darcy['V'] == null || isNaN(darcy['V']!)) return '步骤3：请填写断面平均流速 V'
      if (darcy['D_n'] == null || isNaN(darcy['D_n']!) || darcy['D_n']! <= 0) {
        return '步骤3：请填写管道内径 D_n'
      }
      if (darcy['eta_1'] == null || isNaN(darcy['eta_1']!) || darcy['eta_1']! <= 0) {
        return '步骤3：请填写混合物动力粘度 η₁（Pa·s）'
      }
      return null
    }
    if (subId === 'darcy_friction_step3_lambda') {
      const Dn = darcy['D_n']
      if (Dn == null || isNaN(Dn) || Dn <= 0) return '步骤4：请填写管道内径 D_n'
      const ReB = darcy['Re_B']
      if (ReB == null || isNaN(ReB) || ReB <= 0) {
        return '步骤4：请填写 Re_B；可取步骤 3 计算结果，或先完成步骤 3'
      }
      return null
    }
    if (subId === 'slurry_friction_loss') {
      const rhoK = p['rho_k']
      if (rhoK == null || isNaN(rhoK) || rhoK <= 0) return '步骤5：请填写 ρ_k；可取步骤 1 计算结果'
      for (const name of ['lambda_coef', 'V', 'D'] as const) {
        const v = p[name]
        if (v == null || isNaN(v)) return `步骤5：请填写 ${name}`
        if (name === 'D' && v === 0) return '步骤5：管道内径 D 不能为 0'
        if (name === 'lambda_coef' && v <= 0) return '步骤5：λ 必须大于 0'
      }
      const rhoS = p['rho_s']
      if (rhoS != null && !isNaN(rhoS) && rhoS <= 0) return '步骤5：水密度 ρ_s 须大于 0'
      const gVal = p['g']
      if (gVal != null && !isNaN(gVal) && gVal <= 0) return '步骤5：重力加速度 g 须大于 0'
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
    const dm = formulaParameters['density_mixing'] || {}
    const darcy = formulaParameters['darcy_friction'] || {}
    const sflP = formulaParameters['slurry_friction_loss'] || {}
    const p = formulaParameters[subId] || {}

    const validParameters: Record<string, number> = {}
    if (subId === 'density_mixing') {
      for (const [key, value] of Object.entries(dm)) {
        if (value !== undefined && value !== null && !isNaN(value as number)) validParameters[key] = value as number
      }
    } else if (
      subId === 'darcy_friction_step1_rho1' ||
      subId === 'darcy_friction_step2_re' ||
      subId === 'darcy_friction_step3_lambda'
    ) {
      if (subId === 'darcy_friction_step1_rho1') {
        for (const key of ['rho_g', 'rho_s', 'C1v'] as const) {
          const value = darcy[key]
          if (value !== undefined && value !== null && !isNaN(value as number)) {
            validParameters[key] = value as number
          }
        }
      } else if (subId === 'darcy_friction_step2_re') {
        for (const key of ['rho_1', 'V', 'D_n', 'eta_1'] as const) {
          const value = darcy[key]
          if (value !== undefined && value !== null && !isNaN(value as number)) {
            validParameters[key] = value as number
          }
        }
      } else {
        for (const [key, value] of Object.entries(darcy)) {
          if (value !== undefined && value !== null && !isNaN(value as number)) validParameters[key] = value as number
        }
      }
      if (subId === 'darcy_friction_step3_lambda' && validParameters['epsilon'] === undefined) {
        validParameters['epsilon'] = DEFAULT_SLURRY_EPSILON
      }
    } else if (subId === 'slurry_friction_loss') {
      for (const [key, value] of Object.entries(sflP)) {
        if (value !== undefined && value !== null && !isNaN(value)) validParameters[key] = value as number
      }
      if (validParameters['rho_s'] === undefined) {
        validParameters['rho_s'] = 1
      }
      if (validParameters['g'] === undefined) {
        validParameters['g'] = 9.81
      }
    }

    const r6 = (x: number) => Math.round(x * 1e6) / 1e6
    setLoading(true)
    try {
      const response = await axios.post(
        `${API_BASE_URL}/calculate`,
        { formula_id: subId, parameters: validParameters },
        { timeout: API_TIMEOUT }
      )
      const data = response.data as CalculationResult
      setFormulaResults((prev) => ({ ...prev, [subId]: data }))

      if (subId === 'slurry_friction_loss') {
        if (!data.success) {
          updateResult({ success: false, error: data.error || '计算失败' })
        } else {
          updateResult(data)
        }
      } else {
        updateResult(null)
      }

      if (!data.success) return
      const res = data.result

      if (subId === 'density_mixing' && res?.rho_k != null) {
        const rk = Number(res.rho_k)
        const rhoG = p['rho_g']
        const rhoS = p['rho_s']
        setFormulaParameters((prev) => {
          const sfl = { ...(prev.slurry_friction_loss || {}) }
          sfl.rho_k = rk
          if ((sfl.rho_s == null || isNaN(sfl.rho_s)) && rhoS != null && !isNaN(rhoS)) {
            sfl.rho_s = r6(rhoS)
          }
          const darcyN = { ...(prev.darcy_friction || {}) }
          if ((darcyN.rho_g == null || isNaN(darcyN.rho_g)) && rhoG != null && !isNaN(rhoG)) {
            darcyN.rho_g = r6(rhoG)
          }
          if ((darcyN.rho_s == null || isNaN(darcyN.rho_s)) && rhoS != null && !isNaN(rhoS)) {
            darcyN.rho_s = r6(rhoS)
          }
          return { ...prev, slurry_friction_loss: sfl, darcy_friction: darcyN }
        })
        setFormulaRawInputs((prev) => {
          const sfl = { ...(prev.slurry_friction_loss || {}) }
          sfl.rho_k = String(rk)
          if ((sfl.rho_s == null || sfl.rho_s === '') && rhoS != null && !isNaN(rhoS)) {
            sfl.rho_s = String(r6(rhoS))
          }
          const darcyR = { ...(prev.darcy_friction || {}) }
          if ((darcyR.rho_g == null || darcyR.rho_g === '') && rhoG != null && !isNaN(rhoG)) {
            darcyR.rho_g = String(r6(rhoG))
          }
          if ((darcyR.rho_s == null || darcyR.rho_s === '') && rhoS != null && !isNaN(rhoS)) {
            darcyR.rho_s = String(r6(rhoS))
          }
          return { ...prev, slurry_friction_loss: sfl, darcy_friction: darcyR }
        })
      }

      if (subId === 'darcy_friction_step1_rho1' && res?.rho_1 != null) {
        const r1 = Number(res.rho_1)
        setFormulaParameters((prev) => {
          const darcyN = { ...(prev.darcy_friction || {}) }
          darcyN.rho_1 = r6(r1)
          return { ...prev, darcy_friction: darcyN }
        })
        setFormulaRawInputs((prev) => {
          const darcyR = { ...(prev.darcy_friction || {}) }
          darcyR.rho_1 = String(r6(r1))
          return { ...prev, darcy_friction: darcyR }
        })
      }

      if (subId === 'darcy_friction_step2_re' && res?.Re_B != null) {
        const reB = Number(res.Re_B)
        setFormulaParameters((prev) => {
          const darcyN = { ...(prev.darcy_friction || {}) }
          darcyN.Re_B = r6(reB)
          if (res.rho_1 != null && (darcyN.rho_1 == null || isNaN(darcyN.rho_1))) {
            darcyN.rho_1 = r6(Number(res.rho_1))
          }
          return { ...prev, darcy_friction: darcyN }
        })
        setFormulaRawInputs((prev) => {
          const darcyR = { ...(prev.darcy_friction || {}) }
          darcyR.Re_B = String(r6(reB))
          if (res.rho_1 != null && (darcyR.rho_1 == null || darcyR.rho_1 === '')) {
            darcyR.rho_1 = String(r6(Number(res.rho_1)))
          }
          return { ...prev, darcy_friction: darcyR }
        })
      }

      if (subId === 'darcy_friction_step3_lambda' && res?.lambda_coef != null) {
        const lam = Number(res.lambda_coef)
        setFormulaParameters((prev) => {
          const dart = prev.darcy_friction || {}
          const sfl = { ...(prev.slurry_friction_loss || {}) }
          if (sfl.lambda_coef == null || isNaN(sfl.lambda_coef)) sfl.lambda_coef = lam
          if ((sfl.V == null || isNaN(sfl.V)) && dart.V != null && !isNaN(dart.V)) {
            sfl.V = r6(dart.V)
          }
          if ((sfl.D == null || isNaN(sfl.D)) && dart.D_n != null && !isNaN(dart.D_n)) {
            sfl.D = r6(dart.D_n)
          }
          if ((sfl.rho_s == null || isNaN(sfl.rho_s)) && dart.rho_s != null && !isNaN(dart.rho_s)) {
            sfl.rho_s = r6(dart.rho_s)
          }
          return { ...prev, slurry_friction_loss: sfl }
        })
        setFormulaRawInputs((prev) => {
          const darcyR = prev.darcy_friction || {}
          const sfl = { ...(prev.slurry_friction_loss || {}) }
          if (sfl.lambda_coef == null || sfl.lambda_coef === '') sfl.lambda_coef = String(lam)
          if ((sfl.V == null || sfl.V === '') && darcyR.V != null && darcyR.V !== '') {
            sfl.V = String(r6(Number(darcyR.V)))
          }
          if ((sfl.D == null || sfl.D === '') && darcyR.D_n != null && darcyR.D_n !== '') {
            sfl.D = String(r6(Number(darcyR.D_n)))
          }
          if ((sfl.rho_s == null || sfl.rho_s === '') && darcyR.rho_s != null && darcyR.rho_s !== '') {
            sfl.rho_s = String(r6(Number(darcyR.rho_s)))
          }
          return { ...prev, slurry_friction_loss: sfl }
        })
      }
    } catch (e: any) {
      if (subId === 'slurry_friction_loss') {
        updateResult({ success: false, error: e.response?.data?.error || '计算失败' })
      }
      await showAppAlert('计算失败', e.response?.data?.error || '请检查输入参数')
    } finally {
      setLoading(false)
    }
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
              <h1 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                {language === 'en' ? APP_NAME_EN : APP_NAME_ZH}
              </h1>
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {language === 'en' ? APP_TAGLINE_MAIN_EN : APP_TAGLINE_ZH}
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
                        {...(idx === 0 ? { fetchPriority: 'high' as const } : {})}
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

    // 长沙有色冶金设计研究院公司介绍（首段 Hero + 数据条 + pic1 双段文案 + pic3 分界 + 紧凑联系信息）
    if (aboutDepartment === 'cinf') {
      const sectionTitleCls = `text-lg font-bold tracking-tight mb-1 ${darkMode ? 'text-white' : 'text-slate-900'}`
      const sectionKickerCls = `text-[11px] font-semibold uppercase tracking-[0.2em] mb-3 ${darkMode ? 'text-blue-400' : 'text-blue-700'}`
      const panelCls = `rounded-2xl border overflow-hidden shadow-sm ${darkMode ? 'border-gray-600 bg-gray-700/40' : 'border-slate-200 bg-white'}`
      const capCls = `px-3 py-2 text-[11px] shrink-0 ${darkMode ? 'text-gray-400 bg-gray-800/60' : 'text-slate-600 bg-slate-50'}`
      const dividerCls = darkMode ? 'border-gray-600' : 'border-slate-200'
      const chipCls = `px-3 py-1 rounded-full text-xs font-medium border ${
        darkMode ? 'border-gray-600 bg-gray-800/60 text-gray-300' : 'border-slate-200 bg-white text-slate-700'
      }`
      const valueCls = `px-3 py-1 text-xs font-semibold rounded-full border ${
        darkMode ? 'border-blue-700/50 bg-blue-900/40 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700'
      }`

      const cinfStats = [
        { n: '11项', l: '甲级资质' },
        { n: '900+', l: '在册职工' },
        { n: '1300+', l: '获奖项目' },
        { n: '500+', l: '有效专利' },
      ]

      return (
        <div ref={scrollContainerRef} className={mainScrollClassName}>
          <div className={contentWrapperClassName}>
            <div className="mb-5">
              <h1 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                {language === 'en' ? APP_NAME_EN : APP_NAME_ZH}
              </h1>
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {language === 'en' ? APP_TAGLINE_MAIN_EN : APP_TAGLINE_ZH}
              </p>
            </div>

            {/* Hero：渐变主视觉，左文右图（建筑效果图）*/}
            <div className={`mb-10 rounded-2xl border px-5 py-7 sm:px-10 sm:py-9 ${
              darkMode
                ? 'border-gray-600 bg-gradient-to-br from-slate-900/95 via-gray-900 to-slate-950'
                : 'border-slate-200/90 bg-gradient-to-br from-white via-slate-50/80 to-blue-50/50 shadow-sm'
            }`}>
              <p className={sectionKickerCls}>长沙有色冶金设计研究院有限公司 · 企业概况</p>
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10 xl:gap-12 lg:items-stretch">
                <div className="min-w-0 flex flex-col justify-center">
                  <h2
                    className={`text-2xl sm:text-3xl font-bold tracking-tight leading-snug ${darkMode ? 'text-white' : 'text-slate-900'}`}
                  >
                    有色金属行业全产业链<br className="hidden sm:block" />技术与服务提供商
                  </h2>
                  <div
                    className={`mt-4 leading-relaxed text-[15px] sm:text-base ${darkMode ? 'text-gray-200' : 'text-slate-800'}`}
                  >
                    <p>
                      <span className="font-semibold">长沙有色冶金设计研究院有限公司</span>（简称长沙有色院）于1953年正式成立，为国家高新技术企业、国家技术创新示范企业、国家企业技术中心，是我国最早成立的大型综合性设计研究单位之一；隶属于中国铝业集团有限公司，为中铝国际工程股份有限公司子公司。
                    </p>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {['国家高新技术企业', '国家技术创新示范企业', '国家企业技术中心', 'AAA级信用企业'].map((c) => (
                      <span key={c} className={chipCls}>{c}</span>
                    ))}
                  </div>
                </div>
                <div className="min-w-0">
                  <div
                    className={`relative overflow-hidden rounded-xl border shadow-sm ${
                      darkMode ? 'border-gray-600 bg-black/20' : 'border-slate-200/90 bg-slate-100'
                    }`}
                  >
                    <div className="aspect-[16/10] w-full">
                      <img
                        src="./about/chinalco-building.png"
                        alt="长沙有色冶金设计研究院大楼"
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <p className={capCls}>中国铝业集团 · 长沙有色冶金设计研究院有限公司</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 核心数据条：4 等宽格子，无内边距，数字突出 */}
            <div className={`mb-10 ${panelCls}`}>
              <div
                className={`grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 ${
                  darkMode ? 'divide-gray-600' : 'divide-slate-200'
                }`}
              >
                {cinfStats.map((s) => (
                  <div key={s.l} className="flex flex-col items-center justify-center py-8 px-4 text-center">
                    <div className={`text-2xl sm:text-3xl font-bold tabular-nums ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      {s.n}
                    </div>
                    <div className={`mt-1.5 text-xs sm:text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                      {s.l}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 竖图 pic1 + 两段文案 */}
            <div className={`mb-8 ${panelCls}`}>
              <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,360px)_1fr] lg:items-start lg:gap-10 xl:grid-cols-[minmax(0,420px)_1fr] xl:gap-12">
                <div className="mx-auto w-full max-w-[min(100%,360px)] shrink-0 sm:max-w-[380px] lg:mx-0 lg:max-w-none xl:max-w-[420px]">
                  <div
                    className={`overflow-hidden rounded-xl border shadow-sm ${
                      darkMode ? 'border-gray-600 bg-black/20' : 'border-slate-200/90 bg-slate-100'
                    }`}
                  >
                    <img
                      src="./pic1.png"
                      alt="长沙有色冶金设计研究院"
                      className="mx-auto block h-auto w-full max-h-[min(620px,62vh)] object-contain object-top sm:max-h-[min(700px,66vh)] lg:max-h-[min(780px,70vh)] xl:max-h-[min(860px,72vh)]"
                      loading="lazy"
                    />
                  </div>
                  <div
                className={`flex flex-col items-stretch gap-2 border-t px-4 py-3 ${
                  darkMode ? 'border-gray-600 bg-gray-900/35' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex flex-wrap justify-center gap-2">
                  {['责任', '诚信', '开放', '卓越'].map((v) => (
                    <span key={v} className={valueCls}>{v}</span>
                  ))}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {['AAA级信用企业', '国家高新技术企业'].map((c) => (
                    <span key={c} className={chipCls}>{c}</span>
                  ))}
                </div>
              </div>
                </div>
                <div className="min-w-0">
                  <p className={sectionKickerCls}>历史沿革 · 创新实践</p>
                  <h3 className={sectionTitleCls}>发展历程与组织沿革</h3>
                  <div
                    className={`mt-4 space-y-3 leading-relaxed text-[15px] sm:text-base ${
                      darkMode ? 'text-gray-200' : 'text-slate-800'
                    }`}
                  >
                    <p>
                      1954年，长沙有色院由赣州迁至长沙，先后隶属于重工业部、冶金工业部、中国有色金属工业总公司、国家有色金属工业局、中国稀有稀土集团。2000年7月由中央下放到湖南省管理，2007年6月加入中国铝业公司。2011年3月改制为中铝国际出资设立的一人有限责任公司，名称变更为「长沙有色冶金设计研究院有限公司」。2015年3月，中铝国际将山东建设（后更名为南方工程）划转；2024年3月，将长勘院划转到长沙有色院。
                    </p>
                    <p>
                      历经七十余年，长沙有色院已形成较强的综合技术实力与行业影响力：在册职工900余人，专业技术人员800余人，拥有全国工程勘察设计大师、行业勘察设计大师、享受政府特殊津贴专家及大批注册工程师；建有<strong className={darkMode ? 'text-gray-100' : 'text-slate-900'}>3个国家级、7个省级科技创新平台</strong>及多个研究生联合培养与中试基地。累计完成工程咨询设计项目万余项，获国家、省、部级科技进步奖与优秀工程设计咨询奖1300余项，有效专利500余件，服务足迹遍及40余个国家与地区。秉承<strong className={darkMode ? 'text-white' : 'text-slate-900'}>励精图治、创新求强</strong>的精神与<strong className={darkMode ? 'text-white' : 'text-slate-900'}>创新驱动，诚信服务，持续为客户创造价值</strong>的理念，持续强化科技供给、标准引领与工程转化能力，致力成为有色行业创新型领军企业。
                    </p>
                    <p>
                      <span className={`font-semibold ${darkMode ? 'text-gray-100' : 'text-slate-900'}`}>科技创新</span>
                      近年多点突破、赋能主业成效显著。以2025年为例：新签科研项目33项，涵盖欧盟「地平线欧洲」计划及马来西亚、安哥拉等国际科研合作，以及自然资源部部省合作、广西科技计划、湖南省科技成果转化示范、甘肃省创新联合攻关等，合同额约2209万元、合同收费约3204万元，项目数量与质量实现双提升。重大成果方面，获省部级科技进步特等奖1项、一等奖6项、二等奖5项、三等奖1项；全国优秀工程勘察设计奖一等奖1项、二等奖2项、三等奖1项；「固废高值化生态化梯级集成利用技术」等4项成果入选国家和省级绿色先进适用技术目录，填补近十年来国家级工程勘察设计一等奖空白；新增立项国家、行业及团体标准14部，创历年新高；获评长沙市「科技创新突出贡献企业」。公司落实「科研—设计—应用」闭环创新链，新疆美盛矿业非爆机械连续采矿方法研究、贵州铝业大竹园铝土矿采矿方法研究、湖北大冶大红山铜矿废弃露天坑生态修复、西部鑫兴稀贵金属钼氧压技术创新等课题取得阶段性成果，推动需求来自设计与现场、成果经设计回到应用。科研管理同步提质：完成2025年55项新立项项目开题与2026年42项新增立项，专项攻坚解决14项政府重大科研课题进度与质量管理难题，完成18项验收，涵盖国家重点研发计划、广西重大科技专项、湖南省发改委两业融合与知识产权战略推进专项、中铝集团重大专项及中铝国际重点科研项目等。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 长图 pic3：横向通栏 + 标签 + 下方文案作介绍与联系区分界 */}
            <div className={`mb-8 overflow-hidden rounded-2xl border shadow-sm ${darkMode ? 'border-gray-600 bg-gray-800/30' : 'border-slate-200 bg-white'}`}>
              <div className={darkMode ? 'bg-black/25' : 'bg-slate-100'}>
                <img
                  src="./pic3.jpg"
                  alt="长沙有色院企业形象"
                  className="mx-auto block h-auto w-full max-h-[280px] object-contain sm:max-h-[320px] md:max-h-[380px]"
                  loading="lazy"
                />
              </div>
            
              <p
                className={`border-t px-4 py-2.5 text-center text-xs sm:text-sm ${
                  darkMode ? 'border-gray-600 text-gray-400 bg-gray-900/40' : 'border-slate-200 text-slate-600 bg-slate-50'
                }`}
              >
                企业精神
              </p>
            </div>

            {/* 联系信息（紧凑排版） */}
            <div className={`mb-10 ${panelCls}`}>
              <div className="p-5 sm:p-6">
                <p className={sectionKickerCls}>联系方式</p>
                <h3 className={`text-base font-bold tracking-tight sm:text-lg ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                  公司与业务联系
                </h3>

                <div
                  className={`mt-3 grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-6 lg:gap-x-4 lg:gap-y-2 ${
                    darkMode ? 'border-gray-600 bg-gray-800/35' : 'border-slate-200 bg-slate-50/90'
                  }`}
                >
                  <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                    <div className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>联系地址</div>
                    <div className={`mt-0.5 text-sm leading-snug ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>湖南省长沙市雨花区木莲东路299号</div>
                  </div>
                  <div className="min-w-0 lg:col-span-1">
                    <div className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>邮政编码</div>
                    <div className={`mt-0.5 text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>410019</div>
                  </div>
                  <div className="min-w-0 lg:col-span-1">
                    <div className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>办公室</div>
                    <a
                      href="tel:0731-84397032"
                      className={`mt-0.5 inline-block text-sm hover:opacity-80 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
                    >
                      0731-84397032
                    </a>
                  </div>
                  <div className="min-w-0 lg:col-span-1">
                    <div className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>传真</div>
                    <div className={`mt-0.5 text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>0731-82228112</div>
                  </div>
                  <div className="min-w-0 sm:col-span-2 lg:col-span-6">
                    <div className={`text-[10px] font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>Email</div>
                    <a
                      href="mailto:cinf@chinalco.com.cn"
                      className={`mt-0.5 inline-block text-sm hover:opacity-80 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
                    >
                      cinf@chinalco.com.cn
                    </a>
                  </div>
                </div>

                <div className={`mt-4 border-t pt-3 ${dividerCls}`}>
                  <p className={`${sectionKickerCls} !mb-2`}>对外联络</p>
                  <div className="grid gap-2.5 md:grid-cols-3">
                    <div className={`rounded-lg border px-3 py-2.5 ${darkMode ? 'border-gray-600 bg-gray-800/40' : 'border-slate-200 bg-white'}`}>
                      <div className={`text-xs font-semibold leading-tight ${darkMode ? 'text-gray-200' : 'text-gray-900'}`}>生产运营中心（市场开发部）</div>
                      <div className="mt-1.5 space-y-0.5 text-sm leading-snug">
                        <div>
                          <span className={darkMode ? 'text-gray-500' : 'text-gray-500'}>电话 </span>
                          <a href="tel:0731-84397070" className={`hover:opacity-80 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>0731-84397070</a>
                        </div>
                        <div className="break-all">
                          <span className={darkMode ? 'text-gray-500' : 'text-gray-500'}>Email </span>
                          <a href="mailto:cinf_scjy@chinalco.com.cn" className={`hover:opacity-80 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>cinf_scjy@chinalco.com.cn</a>
                        </div>
                      </div>
                    </div>
                    <div className={`rounded-lg border px-3 py-2.5 ${darkMode ? 'border-gray-600 bg-gray-800/40' : 'border-slate-200 bg-white'}`}>
                      <div className={`text-xs font-semibold leading-tight ${darkMode ? 'text-gray-200' : 'text-gray-900'}`}>海外业务中心（海外发展中心）</div>
                      <div className="mt-1.5 space-y-0.5 text-sm leading-snug">
                        <div>
                          <span className={darkMode ? 'text-gray-500' : 'text-gray-500'}>电话 </span>
                          <a href="tel:0086-731-84397078" className={`hover:opacity-80 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>0086-731-84397078 / 84397079</a>
                        </div>
                        <div className="break-all">
                          <span className={darkMode ? 'text-gray-500' : 'text-gray-500'}>Email </span>
                          <a href="mailto:cinf_intl@chinalco.com.cn" className={`hover:opacity-80 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>cinf_intl@chinalco.com.cn</a>
                        </div>
                      </div>
                    </div>
                    <div className={`rounded-lg border px-3 py-2.5 ${darkMode ? 'border-gray-600 bg-gray-800/40' : 'border-slate-200 bg-white'}`}>
                      <div className={`text-xs font-semibold leading-tight ${darkMode ? 'text-gray-200' : 'text-gray-900'}`}>人力资源部（党委组织部）</div>
                      <div className="mt-1.5 text-sm">
                        <span className={darkMode ? 'text-gray-500' : 'text-gray-500'}>电话 </span>
                        <a href="tel:0731-84397022" className={`hover:opacity-80 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>0731-84397022</a>
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
                <h1 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                  {language === 'en' ? APP_NAME_EN : APP_NAME_ZH}
                </h1>
                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {language === 'en' ? APP_TAGLINE_MAIN_EN : APP_TAGLINE_ZH}
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
              {language === 'en' ? APP_NAME_EN : APP_NAME_ZH}
            </h1>
            <p className={`text-xs ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>
              {language === 'en' ? APP_TAGLINE_MAIN_EN : APP_TAGLINE_ZH}
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
          appName: APP_NAME_EN,
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
          mailSubject: `[${APP_NAME_EN}] Feedback`,
          mailBody:
            `App: ${APP_NAME_EN}\n\nType: □ Feature request  □ Bug report  □ Other\n\nDetails:\n\n\n\n`,
          updatesTitle: 'App Update',
          currentVersion: 'Current version',
          checkUpdates: 'Check for updates',
          checking: 'Checking for updates...',
          newVersion: 'New version available',
          downloadUpdate: 'Download update',
          downloading: 'Downloading',
          downloaded: 'Update downloaded. Install after restart.',
          installNow: 'Restart & Install',
          updateFailed: "Couldn't check for updates. Please try again.",
          retry: 'Retry',
          versionTitle: 'App Version',
          noAutoUpdateBrowser: '(Auto-update is unavailable in browser mode)',
          legalNotices: 'Legal & Notices',
          disclaimerTitle: 'Disclaimer',
          disclaimerP1:
            'The formulas and results provided by this software are for engineering reference only and do not constitute any guarantee or final design basis. Decisions must be made with applicable standards, site conditions, and professional judgment.',
          disclaimerP2:
            'The developer/provider assumes no liability for any direct or indirect consequences arising from the use of this software or its results. When in doubt, refer to current national/industry standards and formally issued design documents from qualified organizations.',
          disclaimerP3:
            'If you use this software’s outputs or parameters/indicators derived from its features as a basis for engineering design or as material guidance, you must also have a valid, applicable contract or written project authorization from Changsha Nonferrous Metallurgical Design & Research Institute Co., Ltd. The app license is not a substitute for such authorization. Without the company’s written consent, you may not use the institute’s name when submitting results for formal design review or external technical commitments.',
          privacyTitle: 'Data & Privacy',
          privacyP:
            'All calculations are performed locally. The app does not collect or upload your input data or results. Exporting to Word is also done on your machine without sending content to external servers.',
          offlineLicense: 'Product license',
          deviceCode: 'Device ID',
          copyDev: 'Copy',
          licenseCode: 'License key',
          licensePlaceholder: 'CINF-LIC1.…',
          updateLicense: 'Update',
          applyLicenseBusy: 'Applying…',
          validUntil: 'Valid until',
          noExpiry: 'No expiry',
          alreadyLatest: 'You already have the latest version.',
          saveLicense: 'Save',
          licenseSaved: 'Saved. This device is licensed.',
        }
      : {
          title: '设置',
          subtitle: '管理显示与语言、检查更新、查看声明与反馈方式',
          appName: APP_NAME_ZH,
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
          mailSubject: `【${APP_NAME_ZH}】软件建议与反馈`,
          mailBody: `软件名称：${APP_NAME_ZH}\n\n建议/反馈类型：□ 功能建议  □ 问题反馈  □ 其他\n\n内容说明：\n\n\n\n`,
          updatesTitle: '应用更新',
          currentVersion: '当前版本',
          checkUpdates: '检查更新',
          checking: '正在检查更新...',
          newVersion: '发现新版本',
          downloadUpdate: '下载更新',
          downloading: '正在下载',
          downloaded: '更新已下载，重启后安装',
          installNow: '立即重启并安装',
          updateFailed: '暂时无法检查更新，请稍后再试',
          retry: '重试',
          versionTitle: '应用版本',
          noAutoUpdateBrowser: '（浏览器环境下无自动更新）',
          legalNotices: '法律与声明',
          disclaimerTitle: '免责声明',
          disclaimerP1: '本软件所提供的计算公式及计算结果仅供工程设计参考，不构成任何设计依据或保证。实际工程须结合现行规范、现场条件及专业判断综合决策。',
          disclaimerP2: '使用本软件及其结果所产生的任何直接或间接后果，开发与提供方不承担责任。如有疑问，请以现行国家标准、行业规范及有资质单位出具的正式设计文件为准。',
          disclaimerP3:
            '若将本软件产出的计算结果、或依本软件功能形成的参数与指标，作为工程设计依据、设备选型或对外技术条件的依据，或用于对设计起结论性指导的，须同时具备与「长沙有色冶金设计研究院有限公司」合法有效且与项目范围相符的正式合同或该院出具的书面项目授权。本软件使用许可不替代上述合同或授权。未经该院书面同意，不得以长沙有色院或本公司名义将本软件结果用于正式报审、对外技术承诺或担保性表述。',
          privacyTitle: '数据与隐私',
          privacyP: '本软件在本地完成计算，不收集、不上传您的输入数据或计算结果。导出 Word 等操作均在您本机完成，不会将内容发送至外部服务器。',
          offlineLicense: '产品许可',
          deviceCode: '设备标识',
          copyDev: '复制',
          licenseCode: '许可密钥',
          licensePlaceholder: '许可密钥以 CINF-LIC1 开头，整段粘贴即可。',
          updateLicense: '更新',
          applyLicenseBusy: '应用更新中…',
          validUntil: '许可证有效期',
          noExpiry: '无期限',
          alreadyLatest: '当前已是最新版本。',
          saveLicense: '保存',
          licenseSaved: '已保存，本机已激活。',
        }) as Record<string, string>

    return (
      <div ref={scrollContainerRef} className={mainScrollClassName}>
        <div className={contentWrapperClassName}>
          {/* 顶部：标题 + 关于本软件 横幅 */}
          <div className="mb-8">
            <h1 className={`text-2xl sm:text-3xl font-bold mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
              {t.title}
            </h1>
            <p className={`text-xs leading-relaxed mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {language === 'en' ? APP_TAGLINE_MAIN_EN : APP_TAGLINE_ZH}
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

          {!!(
            typeof window !== 'undefined' &&
            (window as { electronAPI?: { license?: { getStatus: () => Promise<unknown> } } }).electronAPI?.license
          ) && (
            <section className="mb-8 mt-2">
              <h2
                className={`text-sm font-semibold mb-3 flex items-center gap-2 border-l-4 ${accentBorder} pl-3 ${
                  darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                {t.offlineLicense}
              </h2>
              <div
                className={`rounded-xl border px-5 pt-3 pb-5 ${
                  darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-white border-gray-200'
                }`}
              >
                {licenseInfo?.ok && (
                  <div className={`text-sm mb-2.5 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    <span className="font-bold">{t.validUntil}</span>
                    <span className="mx-1.5 font-bold">：</span>
                    {licenseInfo.expiresAtMs == null ? (
                      <span className={`font-bold ${darkMode ? 'text-green-400' : 'text-green-700'}`}>{t.noExpiry}</span>
                    ) : (
                      <span
                        className={
                          (() => {
                            const days = (licenseInfo.expiresAtMs - Date.now()) / 86400000
                            if (days <= 30) return darkMode ? 'text-red-400 font-bold' : 'text-red-600 font-bold'
                            return darkMode ? 'text-green-400 font-bold' : 'text-green-700 font-bold'
                          })()
                        }
                      >
                        {new Date(licenseInfo.expiresAtMs).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                )}
                <div className="text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">{t.deviceCode}</div>
                <div className="flex flex-col sm:flex-row gap-2 items-stretch mb-4">
                  <div
                    className={`flex-1 min-w-0 rounded-lg border px-3 py-2 font-mono text-xs break-all min-h-[2.5rem] flex items-center ${
                      darkMode ? 'bg-gray-800/80 border-gray-600 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800'
                    }`}
                  >
                    {licenseInfo?.machineId || '—'}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const id = licenseInfo?.machineId
                      if (!id) return
                      void navigator.clipboard.writeText(id).then(() => {
                        setLicenseCopyOk(true)
                        window.setTimeout(() => setLicenseCopyOk(false), 2000)
                      })
                    }}
                    disabled={!licenseInfo?.machineId}
                    className="shrink-0 w-full sm:w-24 rounded-lg text-sm font-medium bg-slate-100 dark:bg-gray-600 text-slate-800 dark:text-gray-200 hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center min-h-[2.5rem] sm:self-stretch"
                  >
                    {licenseCopyOk ? (language === 'en' ? 'Copied' : '已复制') : t.copyDev}
                  </button>
                </div>
                <div className="text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">{t.licenseCode}</div>
                <div className="flex flex-col sm:flex-row gap-2 items-stretch mb-2">
                  <textarea
                    value={licenseInput}
                    onChange={(e) => {
                      setLicenseInput(e.target.value)
                      setLicenseMsg(null)
                    }}
                    rows={1}
                    placeholder={t.licensePlaceholder}
                    spellCheck={false}
                    className={`flex-1 min-w-0 rounded-lg border px-3 py-2 text-xs font-mono resize-y min-h-[2.5rem] ${
                      darkMode ? 'bg-gray-800/80 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-800'
                    }`}
                  />
                  <button
                    type="button"
                    disabled={licenseBusy || !licenseInput.trim()}
                    onClick={async () => {
                      const api = (window as {
                        electronAPI?: {
                          license?: {
                            activate: (x: string) => Promise<{ ok: boolean; error?: string }>
                            getStatus: () => Promise<{ ok: boolean; machineId?: string; expiresAtMs?: number | null }>
                          }
                        }
                      }).electronAPI?.license
                      if (!api) return
                      setLicenseBusy(true)
                      setLicenseMsg(null)
                      try {
                        const r = await api.activate(licenseInput.trim())
                        if (r.ok) {
                          setLicenseMsg(t.licenseSaved)
                          setLicenseInput('')
                          onLicenseResolved?.()
                          const s = await api.getStatus()
                          setLicenseInfo({
                            machineId: s.machineId || '',
                            ok: true,
                            expiresAtMs: s.expiresAtMs != null ? s.expiresAtMs : null,
                          })
                        } else {
                          setLicenseMsg(r.error || (language === 'en' ? 'Failed' : '保存失败'))
                        }
                      } catch (e) {
                        setLicenseMsg((e as Error)?.message || (language === 'en' ? 'Failed' : '保存失败'))
                      } finally {
                        setLicenseBusy(false)
                      }
                    }}
                    className="shrink-0 w-full sm:w-24 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 inline-flex items-center justify-center min-h-[2.5rem] sm:self-stretch px-2"
                  >
                    {licenseBusy ? t.applyLicenseBusy : t.updateLicense}
                  </button>
                </div>
                {licenseMsg && (
                  <p
                    className={`text-sm mb-2 ${licenseMsg.includes('已保存') || licenseMsg.includes('Saved') ? (darkMode ? 'text-green-400' : 'text-green-700') : 'text-red-600'}`}
                  >
                    {licenseMsg}
                  </p>
                )}
              </div>
            </section>
          )}

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
                      <>
                        {updateUpToDateNotice && (
                          <div
                            className={`p-3 rounded-lg text-sm ${darkMode ? 'bg-green-900/25 border border-green-800 text-green-300' : 'bg-green-50 border border-green-200 text-green-800'}`}
                          >
                            {t.alreadyLatest}
                          </div>
                        )}
                        <button
                          onClick={handleCheckForUpdates}
                          className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                        >
                          {t.checkUpdates}
                        </button>
                      </>
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
                          {updateInfo.releaseNotes && (
                            <div className={`mt-1 text-xs whitespace-pre-line ${darkMode ? 'text-green-400' : 'text-green-700'}`}>
                              {stripHtmlToPlain(updateInfo.releaseNotes)}
                            </div>
                          )}
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
                          {formatUpdateError(updateError, language === 'en' ? 'en' : 'zh') || t.updateFailed}
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
                  <p>{t.disclaimerP3}</p>
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

  const validateCentrifugalPumpStep = (step: 1 | 2 | 3): string | null => {
    if (!formula || formula.id !== 'centrifugal_pump_total_head') return null
    if (step === 1) {
      const cw = parameters['C_w']
      if (cw == null || isNaN(cw)) return '步骤1 请填写浆体重量浓度 C_w'
      const cwn = Number(cw)
      if (cwn < 0 || cwn > 1) return 'C_w 须为 0～1 之间的小数（如 0.35）'
      return null
    }
    if (step === 2) {
      const s = parameters['Sigma_H_s']
      const kp = parameters['K_p']
      const km = parameters['K_m']
      if (s == null || isNaN(s)) return '步骤2 请填写 ΣH_s（m）'
      if (Number(s) <= 0) return 'ΣH_s 须大于 0'
      if (kp == null || isNaN(kp)) return '步骤2 请填写 K_p'
      if (Number(kp) <= 0) return 'K_p 须大于 0'
      if (km == null || isNaN(km)) return '步骤2 请填写 K_m'
      if (Number(km) <= 0) return 'K_m 须大于 0'
      if (Number(km) < 0.85 || Number(km) > 0.98) return 'K_m 须在 0.85～0.98 之间'
      return null
    }
    const hb = parameters['H_b']
    const qk = parameters['Q_k']
    const k1 = parameters['K_1']
    const etaj = parameters['eta_j']
    const etab = parameters['eta_b']
    const rho = parameters['rho_k']
    const gVal = parameters['g']
    if (hb == null || isNaN(hb)) return '步骤3 请填写 H_b（m）'
    if (Number(hb) <= 0) return 'H_b 须大于 0'
    if (qk == null || isNaN(qk)) return '步骤3 请填写浆体计算流量 Q_k（m³/s）'
    if (Number(qk) <= 0) return 'Q_k 须大于 0'
    if (k1 == null || isNaN(k1)) return '步骤3 请填写 K_1'
    if (Number(k1) < 1.1 || Number(k1) > 1.2) return 'K_1 须在 1.1～1.2 之间'
    if (etaj == null || isNaN(etaj)) return '步骤3 请填写传动效率 η_j'
    if (Number(etaj) <= 0) return 'η_j 须大于 0'
    if (etab == null || isNaN(etab)) return '步骤3 请填写泵效率 η_b'
    if (Number(etab) <= 0) return 'η_b 须大于 0'
    if (rho == null || isNaN(rho) || Number(rho) <= 0) return '步骤3 需要有效的 ρ_k（t/m³）'
    if (gVal == null || isNaN(gVal) || Number(gVal) <= 0) return '步骤3 需要有效的 g'
    return null
  }

  const validatePositiveDisplacementStep = (step: 1 | 2): string | null => {
    if (!formula || formula.id !== 'positive_displacement_pump_outlet_pressure') return null
    if (step === 1) {
      const pk = parameters['P_k']
      const kf = parameters['K_f']
      if (pk == null || isNaN(pk)) return '步骤1 请填写浆体管道输送压力 P_k（kPa）'
      if (Number(pk) <= 0) return 'P_k 须大于 0'
      if (kf == null || isNaN(kf)) return '步骤1 请填写压力富余系数 K_f'
      if (Number(kf) <= 0 || Number(kf) > 1) return 'K_f 须为大于 0 且不大于 1 的实数'
      return null
    }
    const pb = parameters['P_b']
    const qk = parameters['Q_k']
    const k1 = parameters['K_1']
    const ev = parameters['eta_v']
    const ec = parameters['eta_c']
    if (pb == null || isNaN(pb)) return '步骤2 请填写 P_b（kPa）'
    if (Number(pb) <= 0) return 'P_b 须大于 0'
    if (qk == null || isNaN(qk)) return '步骤2 请填写浆体计算流量 Q_k（m³/s）'
    if (Number(qk) <= 0) return 'Q_k 须大于 0'
    if (k1 == null || isNaN(k1)) return '步骤2 请填写 K_1'
    if (Number(k1) <= 0) return 'K_1 须大于 0'
    if (ev == null || isNaN(ev)) return '步骤2 请填写容积效率 η_v'
    if (Number(ev) <= 0) return 'η_v 须大于 0'
    if (ec == null || isNaN(ec)) return '步骤2 请填写总机械效率 η_c'
    if (Number(ec) <= 0) return 'η_c 须大于 0'
    return null
  }

  // 验证参数
  const validateParameters = (): string | null => {
    if (!formula) return '请选择公式'

    if (formula.id === 'slurry_dissipation_orifice') {
      return validateOrificeSubStep(3)
    }

    // 浆体摩阻损失（单页公式）：ρ_k、λ 与沿程几何/运动参数为必填；g 缺省由后端取 9.81
    if (formula.id === 'slurry_friction_loss') {
      const rhoK = parameters['rho_k']
      if (rhoK == null || isNaN(rhoK) || rhoK <= 0) return '请填写 ρ_k（可由「密度混合公式」计算或直接输入）'
      const required = ['lambda_coef', 'V', 'D', 'rho_s'] as const
      for (const name of required) {
        const v = parameters[name]
        if (v == null || isNaN(v)) return `请填写参数：${formula.parameters.find((fp) => fp.name === name)?.label || name}`
        if (name === 'D' && v === 0) return '管道内径 D 不能为 0'
        if (name === 'lambda_coef' && v <= 0) return 'λ 必须大于 0'
      }
      const gVal = parameters['g']
      if (gVal != null && !isNaN(gVal) && gVal <= 0) return '重力加速度 g 须大于 0'
      return null
    }

    // 密度混合公式：C_w、ρ_g、ρ_s 必填
    if (formula.id === 'density_mixing') {
      const Cw = parameters['C_w']
      if (Cw == null || isNaN(Cw) || Cw < 0 || Cw > 1) return 'C_w 须在 0～1 之间（小数，如 0.35）'
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

    // 离心泵总扬程：底部「开始计算」等同步骤3（电机功率）
    if (formula.id === 'centrifugal_pump_total_head') {
      return validateCentrifugalPumpStep(3)
    }

    if (formula.id === 'positive_displacement_pump_outlet_pressure') {
      return validatePositiveDisplacementStep(2)
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
          return '似均质中加权平均沉速 ω 不能为 0'
        }
        // lambda_coef必须大于0（费祥俊公式）
        if (param.name === 'lambda_coef' && value <= 0) {
          return 'λ系数必须大于0'
        }
        // Cv体积浓度应该在0-1之间
        if (param.name === 'Cv' && (value < 0 || value > 1)) {
          return '体积浓度 $C_V$ 应在 0～1 之间'
        }
        // C_w质量浓度应该在0-1之间（浆体摩阻损失）
        if (param.name === 'C_w' && (value < 0 || value > 1)) {
          return 'C_w 须在 0～1 之间（小数，如 0.35）'
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
    if (rhoG == null || isNaN(rhoG)) return '步骤1 需要填写 ρg（固体密度）'
    if (W <= 0) return '干尾矿重量 W 必须大于 0'
    if (G <= 0) return '矿浆中水重 G 必须大于 0'
    if (rhoG <= 0) return '固体密度 ρg 必须大于 0'

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

  const handleCentrifugalPumpStepCalculate = async (step: 1 | 2 | 3) => {
    const validationError = validateCentrifugalPumpStep(step)
    if (validationError) {
      await showAppAlert('参数校验', validationError)
      return
    }
    if (!formula || formula.id !== 'centrifugal_pump_total_head') return
    setLoading(true)
    try {
      const validParameters: Record<string, number> = {}
      for (const [key, value] of Object.entries(parameters)) {
        if (value !== undefined && value !== null && !isNaN(value as number)) {
          validParameters[key] = value as number
        }
      }
      validParameters.calculation_step = step
      const response = await axios.post(
        `${API_BASE_URL}/calculate`,
        { formula_id: formula.id, parameters: validParameters, locked_vc: lockedVc },
        { timeout: API_TIMEOUT }
      )
      updateResult(response.data)
      if (step === 1 && response.data?.success && formula) {
        const kpRaw = response.data.result?.K_p
        if (kpRaw == null || !Number.isFinite(Number(kpRaw))) return
        const kpNum = Number(kpRaw)
        const kpStr = (() => {
          const r = Math.round(kpNum * 1e12) / 1e12
          if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-6)) return r.toExponential(8)
          const s = r.toFixed(12).replace(/\.?0+$/, '')
          return s || '0'
        })()
        updateParameters((prev) => ({ ...prev, K_p: kpNum }))
        updateRawInputs((prev) => ({ ...prev, K_p: kpStr }))
        const im = (response.data.result?.intermediate ?? {}) as Record<string, unknown>
        setCentrifugalStep1SnapshotByFormula((prev) => ({
          ...prev,
          [formula.id]: { K_p: kpNum, intermediate: im },
        }))
      }
      if (step === 2 && response.data?.success && formula) {
        const htRaw = response.data.result?.H_total
        if (htRaw == null || !Number.isFinite(Number(htRaw))) return
        const htNum = Number(htRaw)
        const hbStr = (() => {
          const r = Math.round(htNum * 1e12) / 1e12
          if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-6)) return r.toExponential(8)
          const s = r.toFixed(12).replace(/\.?0+$/, '')
          return s || '0'
        })()
        updateParameters((prev) => ({ ...prev, H_b: htNum }))
        updateRawInputs((prev) => ({ ...prev, H_b: hbStr }))
        const im = (response.data.result?.intermediate ?? {}) as Record<string, unknown>
        setCentrifugalStep2SnapshotByFormula((prev) => ({
          ...prev,
          [formula.id]: { H_total: htNum, intermediate: im },
        }))
      }
    } catch (error: any) {
      updateResult({
        success: false,
        error: error.response?.data?.error || '计算失败，请检查输入参数',
      })
    } finally {
      setLoading(false)
    }
  }

  const handlePositiveDisplacementStepCalculate = async (step: 1 | 2) => {
    const validationError = validatePositiveDisplacementStep(step)
    if (validationError) {
      await showAppAlert('参数校验', validationError)
      return
    }
    if (!formula || formula.id !== 'positive_displacement_pump_outlet_pressure') return
    setLoading(true)
    try {
      const validParameters: Record<string, number> = {}
      for (const [key, value] of Object.entries(parameters)) {
        if (value !== undefined && value !== null && !isNaN(value as number)) {
          validParameters[key] = value as number
        }
      }
      validParameters.calculation_step = step
      const response = await axios.post(
        `${API_BASE_URL}/calculate`,
        { formula_id: formula.id, parameters: validParameters, locked_vc: lockedVc },
        { timeout: API_TIMEOUT }
      )
      updateResult(response.data)
      if (step === 1 && response.data?.success && formula) {
        const pbRaw = response.data.result?.P_b ?? response.data.result?.H_total
        if (pbRaw == null || !Number.isFinite(Number(pbRaw))) return
        const pbNum = Number(pbRaw)
        const pbStr = (() => {
          const r = Math.round(pbNum * 1e12) / 1e12
          if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-6)) return r.toExponential(8)
          const s = r.toFixed(12).replace(/\.?0+$/, '')
          return s || '0'
        })()
        updateParameters((prev) => ({ ...prev, P_b: pbNum }))
        updateRawInputs((prev) => ({ ...prev, P_b: pbStr }))
        const im = (response.data.result?.intermediate ?? {}) as Record<string, unknown>
        setPositiveDisplacementStep1SnapshotByFormula((prev) => ({
          ...prev,
          [formula.id]: { P_b: pbNum, intermediate: im },
        }))
      }
    } catch (error: any) {
      updateResult({
        success: false,
        error: error.response?.data?.error || '计算失败，请检查输入参数',
      })
    } finally {
      setLoading(false)
    }
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
        // B.C.克诺罗兹法不参与锁定反推
        locked_vc: formula.id === 'kronodze_pressure' ? null : lockedVc
      }, {
        timeout: API_TIMEOUT
      })
      const calcPayload = response.data as CalculationResult
      updateResult(calcPayload)
      return calcPayload
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
    if (formula.id === 'centrifugal_pump_total_head') {
      const ht =
        result.result?.H_total ??
        centrifugalStep2SnapshotByFormula[formula.id]?.H_total ??
        parameters['H_b']
      if (ht == null || isNaN(Number(ht))) {
        await showAppAlert('导出', '请先完成步骤2（总扬程 H_b）并成功计算后再导出。')
        return
      }
    }
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
    } else if (formula.id === 'slurry_friction_workflow') {
      const addFrom = (obj: Record<string, number | undefined>) => {
        for (const [key, value] of Object.entries(obj)) {
          if (value !== undefined && value !== null && !isNaN(value as number)) {
            validParameters[key] = value as number
          }
        }
      }
      addFrom(formulaParameters['density_mixing'] || {})
      addFrom(formulaParameters['darcy_friction'] || {})
      addFrom(formulaParameters['slurry_friction_loss'] || {})
    } else {
      for (const [key, value] of Object.entries(parameters)) {
        if (value !== undefined && value !== null && !isNaN(value)) {
          validParameters[key] = value as number
        }
      }
    }

    let exportResult = result.result
    if (formula.id === 'slurry_friction_workflow' && exportResult) {
      type Im = Record<string, number | string | boolean>
      const r0 = formulaResults['density_mixing']?.result
      const r1 = formulaResults['darcy_friction_step1_rho1']?.result
      const r2 = formulaResults['darcy_friction_step2_re']?.result
      const r3 = formulaResults['darcy_friction_step3_lambda']?.result
      const r4 = formulaResults['slurry_friction_loss']?.result
      const baseIm = (exportResult as { intermediate?: Im }).intermediate || {}
      exportResult = {
        ...exportResult,
        rho_1: r1?.rho_1 ?? (exportResult as { rho_1?: number }).rho_1,
        Re_B: r2?.Re_B ?? r3?.Re_B ?? (exportResult as { Re_B?: number }).Re_B,
        lambda_coef: r3?.lambda_coef ?? (exportResult as { lambda_coef?: number }).lambda_coef,
        intermediate: {
          ...baseIm,
          ...((r0?.intermediate ?? {}) as Im),
          ...((r1?.intermediate ?? {}) as Im),
          ...((r2?.intermediate ?? {}) as Im),
          ...((r3?.intermediate ?? {}) as Im),
          ...((r4?.intermediate ?? {}) as Im),
        },
      }
    }
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
    if (formula.id === 'centrifugal_pump_total_head' && exportResult) {
      const s2 = centrifugalStep2SnapshotByFormula[formula.id]
      let hbMerged: number | null = null
      if (exportResult.H_total != null && !isNaN(Number(exportResult.H_total))) {
        hbMerged = Number(exportResult.H_total)
      } else if (parameters['H_b'] != null && !isNaN(Number(parameters['H_b']))) {
        hbMerged = Number(parameters['H_b'])
      } else if (s2?.H_total != null) {
        hbMerged = s2.H_total
      }
      const im2 = s2?.intermediate ?? {}
      const imCur = (exportResult.intermediate || {}) as Record<string, string | number | boolean>
      type RIm = NonNullable<CalculationResult['result']>['intermediate']
      exportResult = {
        ...exportResult,
        ...(hbMerged != null ? { H_total: hbMerged } : {}),
        intermediate: { ...im2, ...imCur } as RIm,
      }
    }
    if (formula.id === 'positive_displacement_pump_outlet_pressure' && exportResult) {
      const s1 = positiveDisplacementStep1SnapshotByFormula[formula.id]
      let pbMerged: number | null = null
      if (exportResult.P_b != null && !isNaN(Number(exportResult.P_b))) {
        pbMerged = Number(exportResult.P_b)
      } else if (exportResult.H_total != null && !isNaN(Number(exportResult.H_total))) {
        pbMerged = Number(exportResult.H_total)
      } else if (parameters['P_b'] != null && !isNaN(Number(parameters['P_b']))) {
        pbMerged = Number(parameters['P_b'])
      } else if (s1?.P_b != null) {
        pbMerged = s1.P_b
      }
      const im1 = s1?.intermediate ?? {}
      const imCur = (exportResult.intermediate || {}) as Record<string, string | number | boolean>
      type RIm = NonNullable<CalculationResult['result']>['intermediate']
      exportResult = {
        ...exportResult,
        ...(pbMerged != null ? { P_b: pbMerged, H_total: pbMerged } : {}),
        intermediate: { ...im1, ...imCur } as RIm,
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
        const defaultName = `${APP_EXPORT_FILENAME_PREFIX}_${formula.name.replace(/\s+/g, '')}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.docx`
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
        let filename = `${APP_EXPORT_FILENAME_PREFIX}_${formula.name.replace(/\s+/g, '')}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}_001.docx`
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

  /** 浆体/清水/离心泵总扬程页的成功结果，供容积式泵 P_k 下拉选用 */
  const totalHeadPkSuggestionItems = useMemo(() => {
    const items: { sourceId: string; title: string; subtitle: string; value: number }[] = []
    const push = (sourceId: string, title: string, subtitle: string, v: unknown) => {
      if (v == null) return
      const n = Number(v)
      if (!Number.isFinite(n)) return
      items.push({ sourceId, title, subtitle, value: n })
    }
    const sl = formulaResults['slurry_total_head']
    if (sl?.success) {
      push(
        'slurry_total_head',
        '$P_k$：浆体管道输送压力',
        '「压力与扬程」·「浆体总扬程」',
        sl.result?.H_total
      )
    }
    const cw = formulaResults['clear_water_total_head']
    if (cw?.success) {
      push(
        'clear_water_total_head',
        '$P_w$：清水管道输送压力',
        '「压力与扬程」·「清水总扬程」',
        cw.result?.H_total
      )
    }
    return items
  }, [formulaResults])

  /** 仅当「清水总扬程」已成功计算时，供离心泵步骤2 的 ΣH_s 下拉引用 */
  const centrifugalClearWaterSigmaHsItems = useMemo(() => {
    const cw = formulaResults['clear_water_total_head']
    if (!cw?.success) {
      return [] as {
        sourceId: string
        title: string
        subtitle: string
        value: number
        pwKpa: number
      }[]
    }
    const pwKpa = cw.result?.H_total
    if (pwKpa == null || !Number.isFinite(Number(pwKpa))) return []
    const pClear = formulaParameters['clear_water_total_head'] || {}
    const rhoW = Number(pClear.rho_w ?? 1)
    const g = Number(pClear.g ?? 9.81)
    if (!(rhoW > 0) || !(g > 0)) return []
    const headM = Number(pwKpa) / (rhoW * g)
    return [
      {
        sourceId: 'clear_water_total_head',
        title: '$P_w$：清水总扬程',
        subtitle: '「压力与扬程」·「清水总扬程」',
        value: headM,
        pwKpa: Number(pwKpa),
      },
    ]
  }, [formulaResults, formulaParameters])

  /** 浆体密度 ρ_k：来自「密度混合」或「浆体摩阻损失」成功结果，供离心泵步骤3 选用 */
  const centrifugalRhoKSuggestItems = useMemo(() => {
    const items: { sourceId: string; title: string; subtitle: string; value: number }[] = []
    const push = (sourceId: string, title: string, subtitle: string, v: unknown) => {
      if (v == null) return
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) return
      if (items.some((x) => x.sourceId === sourceId)) return
      items.push({ sourceId, title, subtitle, value: n })
    }
    const dm = formulaResults['density_mixing']
    if (dm?.success && dm.result?.rho_k != null) {
      push('density_mixing', '$\\rho_k$：浆体密度', '「摩阻损失」·「密度混合」', dm.result.rho_k)
    }
    const sfl = formulaResults['slurry_friction_loss']
    const rkSfl = sfl?.success ? formulaParameters['slurry_friction_loss']?.['rho_k'] : undefined
    if (rkSfl != null && !isNaN(rkSfl) && rkSfl > 0) {
      push('slurry_friction_loss', '$\\rho_k$：浆体密度', '「摩阻损失」·「浆体摩阻损失」', rkSfl)
    }
    return items
  }, [formulaResults, formulaParameters])

  /** 「浆体总扬程」的 i_k 可从已成功的「浆体摩阻损失」结果手动导入 */
  const slurryTotalHeadIkSuggestItems = useMemo(() => {
    const items: { sourceId: string; title: string; subtitle: string; value: number }[] = []
    const sfl = formulaResults['slurry_friction_loss']
    if (!sfl?.success) return items
    const ik = sfl.result?.i_k ?? sfl.result?.intermediate?.step_B_i_k
    if (ik == null || !Number.isFinite(Number(ik))) return items
    items.push({
      sourceId: 'slurry_friction_loss',
      title: '$i_k$：单位管长水力坡降',
      subtitle: '「摩阻损失」·「浆体摩阻损失」',
      value: Number(ik),
    })
    return items
  }, [formulaResults])

  /** 「清水总扬程」的 i_w 可从已成功的「清水摩阻损失」结果手动导入 */
  const clearWaterTotalHeadIwSuggestItems = useMemo(() => {
    const items: { sourceId: string; title: string; subtitle: string; value: number }[] = []
    const cwf = formulaResults['clear_water_friction_loss']
    const iw = cwf?.success ? cwf.result?.i : undefined
    if (iw == null || !Number.isFinite(Number(iw))) return items
    items.push({
      sourceId: 'clear_water_friction_loss',
      title: '$i_w$：清水单位管长沿程摩阻系数',
      subtitle: '「摩阻损失」·「清水摩阻损失（海澄-威廉）」',
      value: Number(iw),
    })
    return items
  }, [formulaResults])

  /** 缩径消能 λ_d：可选用已成功计算的达西摩阻系数 λ */
  const slurryDissipationLambdaSuggestItems = useMemo(() => {
    const items: { sourceId: string; title: string; subtitle: string; value: number }[] = []
    const r = formulaResults['darcy_friction_step3_lambda']
    const lam = r?.success ? r.result?.lambda_coef : undefined
    if (lam != null && Number.isFinite(Number(lam)) && Number(lam) > 0) {
      items.push({
        sourceId: 'darcy_friction_step3_lambda',
        title: '$\\lambda$：达西摩阻系数',
        subtitle: '「摩阻损失」·「浆体摩阻损失」步骤4',
        value: Number(lam),
      })
    }
    return items
  }, [formulaResults])

  /** 浆体摩阻损失（单页）ρ_k：可选用密度混合结果 */
  const slurryFrictionRhoKSuggestItems = useMemo(() => {
    const items: { sourceId: string; title: string; subtitle: string; value: number }[] = []
    const dm = formulaResults['density_mixing']
    const v = dm?.success ? dm.result?.rho_k : undefined
    if (v != null && Number.isFinite(Number(v)) && Number(v) > 0) {
      items.push({
        sourceId: 'density_mixing',
        title: '$\\rho_k$：浆体密度',
        subtitle: '「摩阻损失」·「密度混合」',
        value: Number(v),
      })
    }
    return items
  }, [formulaResults])

  /** 浆体摩阻损失（单页）λ：可选用达西摩阻步骤4结果 */
  const slurryFrictionLambdaSuggestItems = useMemo(() => {
    const items: { sourceId: string; title: string; subtitle: string; value: number }[] = []
    const r = formulaResults['darcy_friction_step3_lambda']
    const lam = r?.success ? r.result?.lambda_coef : undefined
    if (lam != null && Number.isFinite(Number(lam)) && Number(lam) > 0) {
      items.push({
        sourceId: 'darcy_friction_step3_lambda',
        title: '$\\lambda$：达西摩阻系数',
        subtitle: '「摩阻损失」·「浆体摩阻损失」步骤4',
        value: Number(lam),
      })
    }
    return items
  }, [formulaResults])

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

  const centrifugalStep3ValidateMsg = isCentrifugalPumpTotalHead
    ? validateCentrifugalPumpStep(3)
    : null

  const positiveDisplacementStep2ValidateMsg = isPositiveDisplacementPumpFormula
    ? validatePositiveDisplacementStep(2)
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

  /** 主结果浅蓝卡：第一行「物理量名称 + 符号」，第二行数值，第三行单位/量纲（全站统一版式） */
  const renderPrimaryResultCallout = (opts: {
    /** 若提供则整行作为标题（可含 KaTeX），不再拼接 nameZh/symbolMath */
    titleRow?: ReactNode
    /** 与标题同一行右侧（如锁定临界流速按钮） */
    titleRight?: ReactNode
    nameZh?: string
    symbolMath?: string
    unitZh: string
    bordered?: boolean
    /** 卡片底部附加区（如锁定 Vc 对比与动画），仍在同一浅蓝卡内 */
    footer?: ReactNode
    value: ReactNode
  }) => {
    const shell = opts.bordered
      ? `rounded-xl border-2 p-5 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`
      : `p-3 rounded-lg ${darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-50'}`
    const labelCls = `text-xs mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`
    const valueCls = `text-base min-h-[1.5rem] ${darkMode ? 'text-gray-200' : 'text-gray-800'}`
    const unitCls = `text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`
    const title =
      opts.titleRow ??
      (opts.symbolMath != null && opts.symbolMath !== '' ? (
        <>
          {opts.nameZh}{' '}
          <InlineMath math={opts.symbolMath} />：
        </>
      ) : (
        <>{opts.nameZh}：</>
      ))
    return (
      <div className={shell}>
        <div className={`${labelCls} flex items-start justify-between gap-2`}>
          <div className="min-w-0 flex-1">{title}</div>
          {opts.titleRight != null ? <div className="shrink-0">{opts.titleRight}</div> : null}
        </div>
        <div className={valueCls}>{opts.value}</div>
        <div className={unitCls}>{opts.unitZh}</div>
        {opts.footer}
      </div>
    )
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

  /** 与全站一致：主结果浅蓝卡；中间计算结果默认白底分区（`gray` 仅保留兼容） */
  const renderIntermediateResultsBlock = (
    entries: [string, unknown][],
    formulaIdForLabel?: string,
    surface: 'gray' | 'white' = 'white'
  ) => {
    if (entries.length === 0) return null
    const surfaceCls =
      surface === 'white'
        ? darkMode
          ? 'mt-3 p-4 rounded-lg border border-gray-600 bg-gray-800/90'
          : 'mt-3 p-4 rounded-lg border border-gray-200 bg-white'
        : darkMode
          ? 'mt-4 p-4 rounded-lg bg-gray-800'
          : 'mt-4 p-4 rounded-lg bg-gray-50'
    return (
      <div className={surfaceCls}>
        <div
          className={`text-sm font-medium mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}
        >
          中间计算结果：
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
              <div key={key} className="flex flex-col min-w-0">
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
            {language === 'en' ? APP_NAME_EN : APP_NAME_ZH}
          </h1>
          <p className={`text-xs ${
            darkMode ? 'text-gray-400' : 'text-gray-500'
          }`}>
            {language === 'en' ? APP_TAGLINE_MAIN_EN : APP_TAGLINE_ZH}
          </p>
        </div>

        {/* Formula Section with Input Parameters */}
        <div className={mainPanelCardClassName}>
          <h2 className={`text-xl font-semibold mb-3 ${
            darkMode ? 'text-gray-100' : 'text-gray-900'
          }`}>
            {(formula?.id === 'slurry_accel_energy' ? '浆体加速流' : formula.name)}：
          </h2>
          
          {isPositiveDisplacementPumpFormula ? (
            <>
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
                <div className={`text-lg font-semibold mb-2 flex flex-wrap items-baseline gap-x-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  <span>1. 容积式泵总扬程</span>
                  <InlineMath math="P_b" />
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  容积式泵出口总扬程采用压力形式。已知浆体管道输送压力 <InlineMath math="P_k" />（kPa）与泵的压力富余系数 <InlineMath math="K_f" />，由下式得到出口侧总扬程{' '}
                  <InlineMath math="P_b" />（kPa）。
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="P_b = \frac{P_k}{K_f}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="relative min-w-0">
                    <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, 'P_k'))}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        value={
                          rawInputs['P_k'] ??
                          (parameters['P_k'] != null && !isNaN(parameters['P_k']!) ? String(parameters['P_k']) : '')
                        }
                        onChange={(e) => handleParameterChange('P_k', e.target.value)}
                        onFocus={() => {
                          if (totalHeadPkSuggestionItems.length > 0) setPkSuggestOpen(true)
                        }}
                        onBlur={() => {
                          handleParameterBlur('P_k')
                          window.setTimeout(() => setPkSuggestOpen(false), 200)
                        }}
                        placeholder={paramPlaceholderFromFormula(
                          formula.parameters,
                          'P_k',
                          POSITIVE_DISPLACEMENT_PARAM_PLACEHOLDER_ZH
                        )}
                        className={`flex-1 min-w-0 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                          darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      />
                      {paramUnitDisplaySuffix(formula.parameters, 'P_k') !== '' && (
                        <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {paramUnitDisplaySuffix(formula.parameters, 'P_k')}
                        </span>
                      )}
                    </div>
                    {pkSuggestOpen && totalHeadPkSuggestionItems.length > 0 && (
                      <div
                        role="listbox"
                        className={`absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border shadow-lg ${
                          darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                        }`}
                      >
                        <div
                          className={`px-3 py-2 text-xs border-b ${darkMode ? 'text-gray-400 border-gray-600' : 'text-gray-500 border-gray-100'}`}
                        >
                          {renderDescriptionWithMath('其他模块已算得的压力（点击填入 $P_k$）')}
                        </div>
                        {totalHeadPkSuggestionItems.map((it) => (
                          <button
                            key={it.sourceId}
                            type="button"
                            role="option"
                            className={`w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 transition-colors ${
                              darkMode
                                ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                            }`}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              const s = (() => {
                                const r = Math.round(it.value * 1e6) / 1e6
                                if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-4))
                                  return r.toExponential(8)
                                const t = r.toFixed(8).replace(/\.?0+$/, '')
                                return t || '0'
                              })()
                              updateParameters((prev) => ({ ...prev, P_k: it.value }))
                              updateRawInputs((prev) => ({ ...prev, P_k: s }))
                              setPkSuggestOpen(false)
                            }}
                          >
                            <div className="font-medium">{renderDescriptionWithMath(it.title)}</div>
                            <div className={`text-xs mt-0.5 flex flex-wrap items-baseline gap-x-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              {renderDescriptionWithMath(it.subtitle)}
                              <span>·</span>
                              <span className="font-mono font-semibold">{fmtDissipation(it.value)}</span>
                              <span>kPa</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {totalHeadPkSuggestionItems.length === 0 && (
                      <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        暂无可用引用：请先在侧栏打开「浆体总扬程」或「清水总扬程」并完成一次成功计算。
                      </p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, 'K_f'))}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        value={
                          rawInputs['K_f'] ??
                          (parameters['K_f'] != null && !isNaN(parameters['K_f']!) ? String(parameters['K_f']) : '')
                        }
                        onChange={(e) => handleParameterChange('K_f', e.target.value)}
                        onBlur={() => handleParameterBlur('K_f')}
                        placeholder={paramPlaceholderFromFormula(
                          formula.parameters,
                          'K_f',
                          POSITIVE_DISPLACEMENT_PARAM_PLACEHOLDER_ZH
                        )}
                        className={`flex-1 min-w-0 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                          darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      />
                    </div>
                    {parameters['K_f'] != null &&
                      !isNaN(parameters['K_f'] as number) &&
                      (Number(parameters['K_f']) < 0.75 || Number(parameters['K_f']) > 0.95) && (
                        <p className={`text-xs mt-1.5 ${darkMode ? 'text-amber-200/90' : 'text-amber-700'}`}>
                          容积泵 K_f 常用约 0.75～0.95，当前值请结合泵型与厂家资料核对。
                        </p>
                      )}
                  </div>
                </div>
                <div className="flex justify-end mb-4">
                  <button
                    type="button"
                    onClick={() => void handlePositiveDisplacementStepCalculate(1)}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}
                  >
                    计算
                  </button>
                </div>
                {renderPrimaryResultCallout({
                  nameZh: '容积泵总扬程（压力）',
                  symbolMath: 'P_b',
                  unitZh: 'kPa（千帕）',
                  value: (() => {
                    const snap = formula ? positiveDisplacementStep1SnapshotByFormula[formula.id] : undefined
                    let v: number | null = null
                    if (parameters['P_b'] != null && !isNaN(Number(parameters['P_b'])))
                      v = Number(parameters['P_b'])
                    else if (snap?.P_b != null) v = snap.P_b
                    else if (
                      result?.success &&
                      result.result?.P_b != null &&
                      result.result?.N == null
                    )
                      v = Number(result.result.P_b)
                    if (v != null) {
                      return (
                        <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                          {fmtDissipation(v)}
                        </span>
                      )
                    }
                    return <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                  })(),
                })}
              </div>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  2. 泵所需电机功率 <InlineMath math="N" />
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  由出口总扬程压力 <InlineMath math="P_b" />（kPa）、浆体计算流量 <InlineMath math="Q_k" />（m³/s）、电机功率富余系数 <InlineMath math="K_1" />、泵容积效率{' '}
                  <InlineMath math="\eta_v" /> 与总机械效率 <InlineMath math="\eta_c" />，按下式估算驱动容积式泵所需的电机功率 <InlineMath math="N" />（kW）。
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="N=\frac{K_1\,Q_k\,P_b}{\eta_v\,\eta_c}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {(() => {
                    const inputCls = `flex-1 min-w-0 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                      darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                    }`
                    const field = (name: 'P_b' | 'Q_k' | 'K_1' | 'eta_v' | 'eta_c', colSpan2?: boolean) => {
                      const unit = paramUnitDisplaySuffix(formula.parameters, name)
                      return (
                        <div key={name} className={`min-w-0 ${colSpan2 ? 'md:col-span-2' : ''}`}>
                          <label
                            className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}
                          >
                            {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, name))}
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
                              placeholder={paramPlaceholderFromFormula(
                                formula.parameters,
                                name,
                                POSITIVE_DISPLACEMENT_PARAM_PLACEHOLDER_ZH
                              )}
                              className={inputCls}
                            />
                            {unit !== '' && (
                              <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                {unit}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    }
                    return (
                      <>
                        {field('P_b', true)}
                        {field('K_1')}
                        {field('Q_k')}
                        {field('eta_v')}
                        {field('eta_c')}
                      </>
                    )
                  })()}
                </div>
                {renderPrimaryResultCallout({
                  nameZh: '泵所需电机功率',
                  symbolMath: 'N',
                  unitZh: 'kW（千瓦，轴功率工程常用单位）',
                  value:
                    result?.success && result.result?.N != null && !isNaN(Number(result.result.N)) ? (
                      <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                        {fmtDissipation(Number(result.result.N))}
                      </span>
                    ) : result?.error ? (
                      <span className={`text-sm ${darkMode ? 'text-red-300' : 'text-red-600'}`}>{result.error}</span>
                    ) : (
                      <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                    ),
                })}
                {(() => {
                  if (!result?.success || result.result?.N == null || !result.result?.intermediate) return null
                  const imo = result.result.intermediate as Record<string, unknown>
                  const order = [
                    'P_b',
                    'Q_k',
                    'K_1',
                    'eta_v',
                    'eta_c',
                    'numerator_K1_Q_Pb',
                    'denom_eta_v_eta_c',
                  ] as const
                  const fmtIm = (raw: unknown) => {
                    if (raw == null || raw === '') return '—'
                    const n = Number(raw)
                    if (!Number.isFinite(n)) return String(raw)
                    return fmtDissipation(n)
                  }
                  const entries = order
                    .filter((k) => imo[k] != null && imo[k] !== '')
                    .map((k) => [k, fmtIm(imo[k])] as [string, unknown])
                  if (entries.length === 0) return null
                  return renderIntermediateResultsBlock(
                    entries,
                    'positive_displacement_pump_outlet_pressure',
                    'white'
                  )
                })()}
              </div>
            </>
          ) : isSlurryFrictionWorkflow ? (
            <>
              {/* space-y-*：控制「简介」与「流程介绍」两段之间的垂直间距；改为 space-y-0 可去掉段间空隙 */}
              <div className="mb-6 space-y-0">
                {SLURRY_FRICTION_WF_OVERVIEW_PARAGRAPHS.map((para, idx) => (
                  <p
                    key={idx}
                    className={`text-sm leading-relaxed ${
                      idx === 0
                        ? darkMode
                          ? 'text-gray-100'
                          : 'text-gray-900'
                        : darkMode
                          ? 'text-gray-400'
                          : 'text-gray-500'
                    }`}
                  >
                    {renderDescriptionWithMath(para)}
                  </p>
                ))}
              </div>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  {renderDescriptionWithMath('1. 浆体密度 ($\\rho_k$)')}
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
                    onClick={() => runFrictionWorkflowStep('density_mixing')}
                    disabled={loading}
                    className="px-6 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    计算
                  </button>
                </div>
                {formulaResults['density_mixing']?.success === false && formulaResults['density_mixing']?.error && (
                  <div
                    className={`mb-3 rounded-lg border px-3 py-3 text-sm ${
                      darkMode ? 'border-red-500/50 bg-red-950/40 text-red-200' : 'border-red-200 bg-red-50 text-red-800'
                    }`}
                  >
                    {formulaResults['density_mixing']!.error}
                  </div>
                )}
                {formulaResults['density_mixing']?.success && (() => {
                  const r = formulaResults['density_mixing']!.result
                  const denom = r?.intermediate?.denom
                  return (
                    <>
                      {renderPrimaryResultCallout({
                        nameZh: '浆体密度',
                        symbolMath: '\\rho_k',
                        unitZh: 't/m³（吨每立方米）',
                        value:
                          r?.rho_k != null ? (
                            <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                              {fmtDissipation(Number(r.rho_k))}
                            </span>
                          ) : (
                            <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                          ),
                      })}
                      {denom != null && !isNaN(Number(denom)) &&
                        renderIntermediateResultsBlock(
                          [['denom', `${fmtDissipation(Number(denom))} m³/t`]],
                          'density_mixing',
                          'white'
                        )}
                    </>
                  )
                })()}
              </div>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  {renderDescriptionWithMath('2. 混合物密度 ($\\rho_1$)')}
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath(SLURRY_FRICTION_WF_STEP_INTROS.darcy_rho1)}
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="\rho_1 = \rho_g \cdot C_{1v} + (1 - C_{1v}) \cdot \rho_s" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {SLURRY_FRICTION_WF_DARCY_RHO1_FIELDS.map(({ name, label, unit, placeholder }) => (
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
                    onClick={() => runFrictionWorkflowStep('darcy_friction_step1_rho1')}
                    disabled={loading}
                    className="px-6 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    计算
                  </button>
                </div>
                {formulaResults['darcy_friction_step1_rho1']?.success === false &&
                  formulaResults['darcy_friction_step1_rho1']?.error && (
                    <div
                      className={`mb-3 rounded-lg border px-3 py-3 text-sm ${
                        darkMode ? 'border-red-500/50 bg-red-950/40 text-red-200' : 'border-red-200 bg-red-50 text-red-800'
                      }`}
                    >
                      {formulaResults['darcy_friction_step1_rho1']!.error}
                    </div>
                  )}
                {formulaResults['darcy_friction_step1_rho1']?.success && (() => {
                  const r = formulaResults['darcy_friction_step1_rho1']!.result
                  const im = r?.intermediate as Record<string, unknown> | undefined
                  const tL = im?.term_rho_g_C1v
                  const tS = im?.term_1minusC1v_rho_s
                  const mid: [string, string][] = []
                  if (tL != null && !isNaN(Number(tL))) {
                    mid.push(['term_rho_g_C1v', `${fmtDissipation(Number(tL))} t/m³`])
                  }
                  if (tS != null && !isNaN(Number(tS))) {
                    mid.push(['term_1minusC1v_rho_s', `${fmtDissipation(Number(tS))} t/m³`])
                  }
                  return (
                    <>
                      {renderPrimaryResultCallout({
                        titleRow: renderDescriptionWithMath('混合物密度 $\\rho_1$：'),
                        unitZh: 't/m³（吨每立方米）',
                        value:
                          r?.rho_1 != null ? (
                            <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                              {fmtDissipation(Number(r.rho_1))}
                            </span>
                          ) : (
                            <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                          ),
                      })}
                      {mid.length > 0 && renderIntermediateResultsBlock(mid, undefined, 'white')}
                    </>
                  )
                })()}
              </div>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  {renderDescriptionWithMath('3. 雷诺数 ($Re_B$)')}
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath(SLURRY_FRICTION_WF_STEP_INTROS.darcy_re)}
                </p>
                <div className={`mb-3 space-y-2 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="Re_B = \frac{V \cdot D_n \cdot 1000 \rho_1}{\eta_1}" />
                  <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    <InlineMath math="\rho_1" /> 输入单位为 t/m³，计算时自动换算为 kg/m³。
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {SLURRY_FRICTION_WF_DARCY_RE_FIELDS.map(({ name, label, unit, placeholder }) => (
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
                    onClick={() => runFrictionWorkflowStep('darcy_friction_step2_re')}
                    disabled={loading}
                    className="px-6 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    计算
                  </button>
                </div>
                {formulaResults['darcy_friction_step2_re']?.success === false && formulaResults['darcy_friction_step2_re']?.error && (
                  <div
                    className={`mb-3 rounded-lg border px-3 py-3 text-sm ${
                      darkMode ? 'border-red-500/50 bg-red-950/40 text-red-200' : 'border-red-200 bg-red-50 text-red-800'
                    }`}
                  >
                    {formulaResults['darcy_friction_step2_re']!.error}
                  </div>
                )}
                {formulaResults['darcy_friction_step2_re']?.success && (() => {
                  const r = formulaResults['darcy_friction_step2_re']!.result
                  const im = r?.intermediate as Record<string, unknown> | undefined
                  const rhoKg = im?.rho_1_kg_m3
                  const num = im?.re_numerator_V_D_rho_kg
                  const reB = r?.Re_B != null && !isNaN(Number(r.Re_B)) ? Number(r.Re_B) : null
                  const flowState =
                    reB == null
                      ? null
                      : reB < 2000
                        ? '通常为层流（黏性力主导，流动稳定，分层明显）'
                        : reB < 4000
                          ? '过渡区（流动状态不稳定）'
                          : '通常为湍流'
                  const mid: [string, string][] = []
                  if (r?.rho_1 != null && !isNaN(Number(r.rho_1))) {
                    mid.push(['mixture_rho_1', `${fmtDissipation(Number(r.rho_1))} t/m³`])
                  }
                  if (rhoKg != null && !isNaN(Number(rhoKg))) {
                    mid.push(['rho_1_kg_m3', `${fmtDissipation(Number(rhoKg))} kg/m³`])
                  }
                  if (num != null && !isNaN(Number(num))) {
                    mid.push(['re_numerator_V_D_rho_kg', fmtDissipation(Number(num))])
                  }
                  return (
                    <>
                      {renderPrimaryResultCallout({
                        titleRow: renderDescriptionWithMath('雷诺数 $Re_B$：'),
                        unitZh: '无量纲',
                        value:
                          r?.Re_B != null ? (
                            <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                              {fmtDissipation(Number(r.Re_B))}
                            </span>
                          ) : (
                            <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                          ),
                      })}
                      {reB != null && flowState && (
                        <div
                          className={`mb-3 rounded-lg border px-3 py-3 text-sm leading-relaxed ${
                            darkMode ? 'border-blue-500/50 bg-blue-950/30 text-blue-100' : 'border-blue-200 bg-blue-50 text-blue-900'
                          }`}
                        >
                          <p>
                            雷诺数（<InlineMath math="Re_B" />）反映了流体流动中惯性力与黏性力的比值。
                          </p>
                          <p className="mt-1">
                            当前判定：<strong>{flowState}</strong>（<InlineMath math={`Re_B=${fmtDissipation(reB)}`} />）
                          </p>
                          <p className={`mt-1 ${darkMode ? 'text-blue-200' : 'text-blue-800'}`}>
                            判别区间：<InlineMath math="Re_B&lt;2000" /> 层流；<InlineMath math="2000&lt;Re_B&lt;4000" /> 过渡区；
                            <InlineMath math="Re_B&gt;4000" /> 湍流。
                          </p>
                        </div>
                      )}
                      {mid.length > 0 && renderIntermediateResultsBlock(mid, undefined, 'white')}
                    </>
                  )
                })()}
              </div>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  {renderDescriptionWithMath('4. 达西摩阻系数 ($\\lambda$)')}
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath(SLURRY_FRICTION_WF_STEP_INTROS.darcy_lambda)}
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="\lambda = \frac{1.33036}{\left[\ln\left(\frac{\varepsilon}{3.7 D_n} + \frac{5.7385}{Re_B^{0.9}}\right)\right]^2}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {SLURRY_FRICTION_WF_DARCY_LAMBDA_FIELDS.map(({ name, label, unit, placeholder }) => {
                    if (name === 'epsilon') {
                      const epsPresetKey = formulaRawInputs['darcy_friction']?.['epsilon_preset'] ?? DEFAULT_SLURRY_EPSILON_PRESET
                      const epsilonRaw =
                        formulaRawInputs['darcy_friction']?.['epsilon'] ??
                        (formulaParameters['darcy_friction']?.['epsilon'] != null &&
                        !isNaN(formulaParameters['darcy_friction']!['epsilon']!)
                          ? String(formulaParameters['darcy_friction']!['epsilon'])
                          : String(DEFAULT_SLURRY_EPSILON))
                      return (
                        <div key={name} className="md:col-span-2">
                          <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                            {renderDescriptionWithMath(label)}
                          </label>
                          <div className={`grid grid-cols-1 ${epsPresetKey === 'custom' ? 'md:grid-cols-2' : ''} gap-3`}>
                            <div className="min-w-0">
                              <div className="flex items-center space-x-2">
                                <div className="flex-1">
                                  <SlurryEpsilonPresetMenu
                                    darkMode={darkMode}
                                    presetKey={epsPresetKey}
                                    onPick={(key) => {
                                      if (key === 'custom') {
                                        setFormulaRawInputs((prev) => ({
                                          ...prev,
                                          darcy_friction: { ...(prev.darcy_friction || {}), epsilon_preset: 'custom' }
                                        }))
                                        return
                                      }
                                      const n = SLURRY_EPSILON_PRESET_VALUES[key]
                                      if (n != null) {
                                        setFormulaParameters((prev) => ({
                                          ...prev,
                                          darcy_friction: { ...(prev.darcy_friction || {}), epsilon: n }
                                        }))
                                        setFormulaRawInputs((prev) => ({
                                          ...prev,
                                          darcy_friction: { ...(prev.darcy_friction || {}), epsilon_preset: key, epsilon: String(n) }
                                        }))
                                      }
                                    }}
                                  />
                                </div>
                                <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{unit}</span>
                              </div>
                            </div>
                            {epsPresetKey === 'custom' && (
                              <div className="min-w-0">
                                <div className="flex items-center space-x-2">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder={placeholder}
                                    value={epsilonRaw}
                                    onChange={(e) => handleSubParameterChange('darcy_friction', 'epsilon', e.target.value)}
                                    onBlur={() => handleSubParameterBlur('darcy_friction', 'epsilon')}
                                    className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                                      darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                                    }`}
                                  />
                                  <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{unit}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    }
                    return (
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
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => runFrictionWorkflowStep('darcy_friction_step3_lambda')}
                    disabled={loading}
                    className="px-6 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    计算
                  </button>
                </div>
                {formulaResults['darcy_friction_step3_lambda']?.success === false &&
                  formulaResults['darcy_friction_step3_lambda']?.error && (
                    <div
                      className={`mb-3 rounded-lg border px-3 py-3 text-sm ${
                        darkMode ? 'border-red-500/50 bg-red-950/40 text-red-200' : 'border-red-200 bg-red-50 text-red-800'
                      }`}
                    >
                      {formulaResults['darcy_friction_step3_lambda']!.error}
                    </div>
                  )}
                {formulaResults['darcy_friction_step3_lambda']?.success && (() => {
                  const r = formulaResults['darcy_friction_step3_lambda']!.result
                  const im = r?.intermediate as Record<string, unknown> | undefined
                  const regime = im?.flow_regime
                  const mid: [string, string][] = []
                  if (r?.Re_B != null && !isNaN(Number(r.Re_B))) {
                    mid.push(['re_B_used', fmtDissipation(Number(r.Re_B))])
                  }
                  if (regime != null && String(regime).trim() !== '') {
                    mid.push(['flow_regime', String(regime)])
                  }
                  return (
                    <>
                      {renderPrimaryResultCallout({
                        titleRow: renderDescriptionWithMath('达西摩阻系数 $\\lambda$：'),
                        unitZh: '无量纲',
                        value:
                          r?.lambda_coef != null ? (
                            <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                              {fmtDissipation(Number(r.lambda_coef))}
                            </span>
                          ) : (
                            <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                          ),
                      })}
                      {mid.length > 0 && renderIntermediateResultsBlock(mid, undefined, 'white')}
                    </>
                  )
                })()}
              </div>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  {renderDescriptionWithMath('5. 水力坡降 ($i_k$)')}
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath(SLURRY_FRICTION_WF_STEP_INTROS.step5_ik)}
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
                              : name === 'rho_s'
                                ? '1'
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
                    计算
                  </button>
                </div>

                {formulaResults['slurry_friction_loss']?.success === false && formulaResults['slurry_friction_loss']?.error && (
                  <div
                    className={`mb-3 rounded-lg border px-3 py-3 text-sm ${
                      darkMode ? 'border-red-500/50 bg-red-950/40 text-red-200' : 'border-red-200 bg-red-50 text-red-800'
                    }`}
                  >
                    {formulaResults['slurry_friction_loss']!.error}
                  </div>
                )}
                {formulaResults['slurry_friction_loss']?.success ? (() => {
                  const r = formulaResults['slurry_friction_loss']!.result
                  const num = r?.intermediate?.numerator
                  const den = r?.intermediate?.denominator
                  const mid: [string, string][] = []
                  if (num != null && !isNaN(Number(num))) {
                    mid.push(['numerator', fmtDissipation(Number(num))])
                  }
                  if (den != null && !isNaN(Number(den))) {
                    mid.push(['denominator', fmtDissipation(Number(den))])
                  }
                  return (
                    <>
                      {renderPrimaryResultCallout({
                        titleRow: renderDescriptionWithMath('水力坡降 $i_k$：'),
                        unitZh: 'mH₂O/m（米水柱每米管长）',
                        value:
                          r?.i_k != null ? (
                            <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                              {fmtDissipation(Number(r.i_k))}
                            </span>
                          ) : (
                            <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                          ),
                      })}
                      {mid.length > 0 && renderIntermediateResultsBlock(mid, 'slurry_friction_loss', 'white')}
                    </>
                  )
                })() : (
                  renderPrimaryResultCallout({
                    titleRow: renderDescriptionWithMath('水力坡降 $i_k$：'),
                    unitZh: 'mH₂O/m（米水柱每米管长）',
                    value: <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>,
                  })
                )}
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
                    <div className={`grid grid-cols-1 ${(rawInputs['ch_preset'] ?? 'steel100') === 'custom' ? 'md:grid-cols-2' : ''} gap-3`}>
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
                      {(rawInputs['ch_preset'] ?? 'steel100') === 'custom' && (
                        <div className="min-w-0">
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
                              placeholder="海澄-威廉系数，如130"
                              className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                                darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                              }`}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {(['K_hw', 'd_j', 'q_g'] as const).map((name) => {
                    const param = formula.parameters.find((p) => p.name === name)
                    const ph =
                      name === 'K_hw'
                        ? '经验参数，默认值 105'
                        : name === 'd_j'
                          ? '管道计算内径，如0.2'
                          : '管段设计流量，如0.05'
                    const suffixText =
                      name === 'K_hw'
                        ? null
                        : param?.unit != null && shouldShowParameterUnitSuffix(param.unit)
                          ? param.unit
                          : null
                    return (
                      <div key={name}>
                        <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                          {param ? renderDescriptionWithMath(displayParamLabelFromApi(param.label || name, param.unit)) : name}
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
              {result?.success ? (
                <>
                  {renderPrimaryResultCallout({
                    nameZh: '单位管长水头损失（清水，海澄–威廉）',
                    symbolMath: 'i',
                    unitZh: 'kPa/m（千帕每米管长）',
                    bordered: true,
                    value:
                      result.result?.i != null ? (
                        <span
                          className={`text-xl font-bold font-mono ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
                        >
                          {String(result.result.i)}
                        </span>
                      ) : (
                        <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                      ),
                  })}
                  {result.result?.intermediate &&
                    renderIntermediateResultsBlock(
                      Object.entries(result.result.intermediate),
                      'clear_water_friction_loss',
                      'white'
                    )}
                </>
              ) : (
                renderPrimaryResultCallout({
                  nameZh: '单位管长水头损失（清水，海澄–威廉）',
                  symbolMath: 'i',
                  unitZh: 'kPa/m（千帕每米管长）',
                  bordered: true,
                  value: result?.error ? (
                    <span className={`text-sm ${darkMode ? 'text-red-300' : 'text-red-600'}`}>{result.error}</span>
                  ) : (
                    <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                  ),
                })
              )}
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
                          rho_k: '浆体密度，如1.2',
                          g: '重力加速度，默认值 9.81',
                          H: '几何扬程，如120',
                          rho_s: '固体密度，如2.5',
                          i_k: '沿程摩阻系数，如0.02',
                          L: '管道总长度，如1000',
                          P_j: '局部压力损失，常用 30～50 kPa',
                          P_n: '泵站附加压力，常用 30～50 kPa',
                          P_z: '出口附加压力，常用 30～50 kPa',
                        }
                        if (param.name === 'i_k') {
                          return (
                            <div key={param.name} className="relative">
                              <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                                {renderDescriptionWithMath(displayParamLabelFromApi(param.label || param.name, param.unit))}
                              </label>
                              <div className="flex items-center space-x-2">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                                  onChange={(e) => handleParameterChange(param.name, e.target.value)}
                                  onFocus={() => {
                                    if (slurryTotalHeadIkSuggestItems.length > 0) setSlurryTotalHeadIkSuggestOpen(true)
                                  }}
                                  onBlur={() => {
                                    handleParameterBlur(param.name)
                                    window.setTimeout(() => setSlurryTotalHeadIkSuggestOpen(false), 200)
                                  }}
                                  className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                                  placeholder={placeholders[param.name] || commonParamPlaceholder(formula?.parameters, param.name)}
                                />
                                {shouldShowParameterUnitSuffix(param.unit) && (
                                  <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                                )}
                              </div>
                              {slurryTotalHeadIkSuggestOpen && slurryTotalHeadIkSuggestItems.length > 0 && (
                                <div
                                  role="listbox"
                                  className={`absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border shadow-lg ${
                                    darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                                  }`}
                                >
                                  <div
                                    className={`px-3 py-2 text-xs border-b ${darkMode ? 'text-gray-400 border-gray-600' : 'text-gray-500 border-gray-100'}`}
                                  >
                                    {renderDescriptionWithMath('其他页面已算得的沿程坡降（点击填入 $i_k$）')}
                                  </div>
                                  {slurryTotalHeadIkSuggestItems.map((it) => (
                                    <button
                                      key={it.sourceId}
                                      type="button"
                                      role="option"
                                      className={`w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 transition-colors ${
                                        darkMode
                                          ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                          : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                                      }`}
                                      onMouseDown={(e) => {
                                        e.preventDefault()
                                        const s = (() => {
                                          const r = Math.round(it.value * 1e6) / 1e6
                                          if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-4))
                                            return r.toExponential(8)
                                          const t = r.toFixed(8).replace(/\.?0+$/, '')
                                          return t || '0'
                                        })()
                                        updateParameters((prev) => ({ ...prev, i_k: it.value }))
                                        updateRawInputs((prev) => ({ ...prev, i_k: s }))
                                        setSlurryTotalHeadIkSuggestOpen(false)
                                      }}
                                    >
                                      <div className="font-medium">{renderDescriptionWithMath(it.title)}</div>
                                      <div className={`text-xs mt-0.5 flex flex-wrap items-baseline gap-x-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {renderDescriptionWithMath(it.subtitle)}
                                        <span>·</span>
                                        <span className="font-mono font-semibold">{fmtDissipation(it.value)}</span>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {slurryTotalHeadIkSuggestItems.length === 0 && (
                                <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                  暂无可用引用：请先在侧栏打开「浆体摩阻损失」并完成一次成功计算。
                                </p>
                              )}
                            </div>
                          )
                        }
                        if (param.name === 'i_w') {
                          return (
                            <div key={param.name} className="relative">
                              <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                                {renderDescriptionWithMath(displayParamLabelFromApi(param.label || param.name, param.unit))}
                              </label>
                              <div className="flex items-center space-x-2">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                                  onChange={(e) => handleParameterChange(param.name, e.target.value)}
                                  onFocus={() => {
                                    if (clearWaterTotalHeadIwSuggestItems.length > 0) setClearWaterTotalHeadIwSuggestOpen(true)
                                  }}
                                  onBlur={() => {
                                    handleParameterBlur(param.name)
                                    window.setTimeout(() => setClearWaterTotalHeadIwSuggestOpen(false), 200)
                                  }}
                                  className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                                  placeholder={placeholders[param.name] || commonParamPlaceholder(formula?.parameters, param.name)}
                                />
                                {shouldShowParameterUnitSuffix(param.unit) && (
                                  <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                                )}
                              </div>
                              {clearWaterTotalHeadIwSuggestOpen && clearWaterTotalHeadIwSuggestItems.length > 0 && (
                                <div
                                  role="listbox"
                                  className={`absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border shadow-lg ${
                                    darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                                  }`}
                                >
                                  <div
                                    className={`px-3 py-2 text-xs border-b ${darkMode ? 'text-gray-400 border-gray-600' : 'text-gray-500 border-gray-100'}`}
                                  >
                                    {renderDescriptionWithMath('其他页面已算得的清水沿程系数（点击填入 $i_w$）')}
                                  </div>
                                  {clearWaterTotalHeadIwSuggestItems.map((it) => (
                                    <button
                                      key={it.sourceId}
                                      type="button"
                                      role="option"
                                      className={`w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 transition-colors ${
                                        darkMode
                                          ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                          : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                                      }`}
                                      onMouseDown={(e) => {
                                        e.preventDefault()
                                        const s = (() => {
                                          const r = Math.round(it.value * 1e6) / 1e6
                                          if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-4))
                                            return r.toExponential(8)
                                          const t = r.toFixed(8).replace(/\.?0+$/, '')
                                          return t || '0'
                                        })()
                                        updateParameters((prev) => ({ ...prev, i_w: it.value }))
                                        updateRawInputs((prev) => ({ ...prev, i_w: s }))
                                        setClearWaterTotalHeadIwSuggestOpen(false)
                                      }}
                                    >
                                      <div className="font-medium">{renderDescriptionWithMath(it.title)}</div>
                                      <div className={`text-xs mt-0.5 flex flex-wrap items-baseline gap-x-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {renderDescriptionWithMath(it.subtitle)}
                                        <span>·</span>
                                        <span className="font-mono font-semibold">{fmtDissipation(it.value)}</span>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {clearWaterTotalHeadIwSuggestItems.length === 0 && (
                                <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                  暂无可用引用：请先在「清水摩阻损失（海澄-威廉）」完成一次成功计算。
                                </p>
                              )}
                            </div>
                          )
                        }
                        return (
                          <div key={param.name}>
                            <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                              {renderDescriptionWithMath(displayParamLabelFromApi(param.label || param.name, param.unit))}
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
                                placeholder={placeholders[param.name] || commonParamPlaceholder(formula?.parameters, param.name)}
                              />
                              {shouldShowParameterUnitSuffix(param.unit) && (
                                <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* 主量浅蓝卡；中间量在下方白底分区 */}
                  {renderPrimaryResultCallout({
                    nameZh: '浆体管道输送压力（总扬程压力形式）',
                    symbolMath: 'P_k',
                    unitZh: 'kPa（千帕，表压/工艺一致）',
                    bordered: true,
                    value: result?.success ? (
                      <div className="space-y-2">
                        <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                          {result.result?.H_total ?? '—'}
                        </span>
                        {result.result?.H_total != null &&
                          parameters['rho_k'] != null &&
                          !isNaN(Number(parameters['rho_k'])) &&
                          !isNaN(Number(result.result.H_total)) && (
                            <span className={`block text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              折合浆体液柱高度（<InlineMath math="P_k/(\rho_k g)" />
                              ）：约{' '}
                              <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                                {kPaToFluidHeadM(
                                  Number(result.result.H_total),
                                  Number(parameters['rho_k']),
                                  Number(parameters['g'] ?? 9.81)
                                )}{' '}
                                m
                              </span>
                            </span>
                          )}
                      </div>
                    ) : result?.error ? (
                      <span className={`text-sm ${darkMode ? 'text-red-300' : 'text-red-600'}`}>{result.error}</span>
                    ) : (
                      <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                    ),
                  })}
                  {result?.success &&
                    result.result?.intermediate &&
                    (() => {
                      const im = result.result.intermediate
                      const rho_s = parameters['rho_s']
                      const gVal = Number(parameters['g'] ?? 9.81)
                      const frictionSub =
                        im.friction_pressure != null &&
                        rho_s != null &&
                        !isNaN(Number(rho_s)) &&
                        !isNaN(Number(im.friction_pressure)) ? (
                          <span
                            className={`block text-xs mt-0.5 font-normal ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                          >
                            ≈{' '}
                            {kPaToFluidHeadM(
                              Number(im.friction_pressure),
                              Number(rho_s),
                              gVal
                            )}{' '}
                            m（<InlineMath math="\rho_s" />）
                          </span>
                        ) : null
                      return renderIntermediateResultsBlock(
                        [
                          ['gravity_pressure', `${String(im.gravity_pressure ?? '—')} kPa`],
                          [
                            'friction_pressure',
                            <span className="block">
                              {String(im.friction_pressure ?? '—')} kPa
                              {frictionSub}
                            </span>,
                          ],
                          ['P_j', `${String(im.P_j ?? '—')} kPa`],
                          ['P_n', `${String(im.P_n ?? '—')} kPa`],
                          ['P_z', `${String(im.P_z ?? '—')} kPa`],
                        ],
                        'slurry_total_head',
                        'white'
                      )
                    })()}

                  {result?.success && (
                    <HydraulicDerivativeResultsSection variant="slurry" darkMode={darkMode} parameters={parameters} />
                  )}

                  {result?.success && (
                    <SlurryClearHydraulicGradeChartBlock
                      darkMode={darkMode}
                      Lmax={Number(parameters['L'])}
                      slurryParams={parameters}
                    />
                  )}
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
                          rho_w: '液体密度，如1',
                          g: '重力加速度，默认值 9.81',
                          H: '几何扬程，如120',
                          i_w: '清水沿程系数，如0.01',
                          L: '管道总长度，如1000',
                          P_j: '局部压力损失，常用 30～50 kPa',
                          P_n: '泵站附加压力，常用 30～50 kPa',
                          P_z: '出口附加压力，常用 30～50 kPa',
                        }
                        return (
                          <div key={param.name}>
                            <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                              {renderDescriptionWithMath(displayParamLabelFromApi(param.label || param.name, param.unit))}
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
                                placeholder={placeholders[param.name] || commonParamPlaceholder(formula?.parameters, param.name)}
                              />
                              {shouldShowParameterUnitSuffix(param.unit) && (
                                <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {renderPrimaryResultCallout({
                    nameZh: '清水管道输送压力（总扬程压力形式）',
                    symbolMath: 'P_w',
                    unitZh: 'kPa（千帕，表压/工艺一致）',
                    bordered: true,
                    value: result?.success ? (
                      <div className="space-y-2">
                        <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                          {result.result?.H_total ?? '—'}
                        </span>
                        {result.result?.H_total != null &&
                          parameters['rho_w'] != null &&
                          !isNaN(Number(parameters['rho_w'])) &&
                          !isNaN(Number(result.result.H_total)) && (
                            <span className={`block text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              折合清水液柱高度（<InlineMath math="P_w/(\rho_w g)" />
                              ）：约{' '}
                              <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                                {kPaToFluidHeadM(
                                  Number(result.result.H_total),
                                  Number(parameters['rho_w']),
                                  Number(parameters['g'] ?? 9.81)
                                )}{' '}
                                m
                              </span>
                            </span>
                          )}
                      </div>
                    ) : result?.error ? (
                      <span className={`text-sm ${darkMode ? 'text-red-300' : 'text-red-600'}`}>{result.error}</span>
                    ) : (
                      <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                    ),
                  })}
                  {result?.success &&
                    result.result?.intermediate &&
                    (() => {
                      const im = result.result.intermediate
                      const rho_w = parameters['rho_w']
                      const gVal = Number(parameters['g'] ?? 9.81)
                      const frictionSub =
                        im.friction_pressure != null &&
                        rho_w != null &&
                        !isNaN(Number(rho_w)) &&
                        !isNaN(Number(im.friction_pressure)) ? (
                          <span
                            className={`block text-xs mt-0.5 font-normal ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                          >
                            ≈{' '}
                            {kPaToFluidHeadM(
                              Number(im.friction_pressure),
                              Number(rho_w),
                              gVal
                            )}{' '}
                            m（<InlineMath math="\rho_w" />）
                          </span>
                        ) : null
                      return renderIntermediateResultsBlock(
                        [
                          ['gravity_pressure', `${String(im.gravity_pressure ?? '—')} kPa`],
                          [
                            'friction_pressure',
                            <span className="block">
                              {String(im.friction_pressure ?? '—')} kPa
                              {frictionSub}
                            </span>,
                          ],
                          ['P_j', `${String(im.P_j ?? '—')} kPa`],
                          ['P_n', `${String(im.P_n ?? '—')} kPa`],
                          ['P_z', `${String(im.P_z ?? '—')} kPa`],
                        ],
                        'clear_water_total_head',
                        'white'
                      )
                    })()}

                  {result?.success && (
                    <HydraulicDerivativeResultsSection variant="clear_water" darkMode={darkMode} parameters={parameters} />
                  )}

                  {result?.success && (
                    <ClearWaterHydraulicGradeChartBlock
                      darkMode={darkMode}
                      Lmax={Number(parameters['L'])}
                      clearParams={parameters}
                    />
                  )}
                </>
              )}
            </>
          ) : isCentrifugalPumpTotalHead ? (
            <>
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
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  1. 扬程降低率 <InlineMath math="K_p" />
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  本式给出固相质量分数（浆体重量浓度）<InlineMath math="C_w" /> 与含固输送条件下扬程降低率{' '}
                  <InlineMath math="K_p" />（无量纲）的常用关系：<InlineMath math="C_w" /> 越大，等效扬程折减越显著；步骤2 计算{' '}
                  <InlineMath math="H_b" /> 时需用到此 <InlineMath math="K_p" />。
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="K_p = 1 - 0.25\,C_w" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, 'C_w'))}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        value={
                          rawInputs['C_w'] ??
                          (parameters['C_w'] != null && !isNaN(parameters['C_w']!) ? String(parameters['C_w']) : '')
                        }
                        onChange={(e) => handleParameterChange('C_w', e.target.value)}
                        onBlur={() => handleParameterBlur('C_w')}
                        placeholder={paramPlaceholderFromFormula(
                          formula.parameters,
                          'C_w',
                          CENTRIFUGAL_PARAM_PLACEHOLDER_ZH
                        )}
                        className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                          darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end mb-4">
                  <button
                    type="button"
                    onClick={() => void handleCentrifugalPumpStepCalculate(1)}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}
                  >
                    计算
                  </button>
                </div>
                {renderPrimaryResultCallout({
                  nameZh: '扬程降低率',
                  symbolMath: 'K_p',
                  unitZh: '无量纲',
                  value: (() => {
                    const snap = formula ? centrifugalStep1SnapshotByFormula[formula.id] : undefined
                    const pay = result?.result
                    const kp = pay && 'K_p' in pay && pay.K_p != null ? Number(pay.K_p) : NaN
                    const v = snap?.K_p ?? (result?.success && !isNaN(kp) ? kp : null)
                    return (
                      <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                        {v != null ? fmtDissipation(v) : '—'}
                      </span>
                    )
                  })(),
                })}
              </div>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 flex flex-wrap items-baseline gap-x-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  <span>2. 主泵扬送清水的总扬程</span>
                  <InlineMath math="H_b" />
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  本式由装置所需液柱扬程累计 <InlineMath math="\sum H_s" />（m；清水总扬程 <InlineMath math="P_w" /> 为 kPa 时可按{' '}
                  <InlineMath math="P_w/(\rho_w g)" /> 折算）、主泵输送浆体时的扬程降低率 <InlineMath math="K_p" /> 及磨蚀后扬程折损率{' '}
                  <InlineMath math="K_m" />，求主泵扬送清水的总扬程 <InlineMath math="H_b" />（m）。
                </p>
                <div className={`mb-3 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="H_b=\frac{\sum H_s}{K_p\,K_m}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="relative md:col-span-2">
                    <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, 'Sigma_H_s'))}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        value={
                          rawInputs['Sigma_H_s'] ??
                          (parameters['Sigma_H_s'] != null && !isNaN(parameters['Sigma_H_s']!)
                            ? String(parameters['Sigma_H_s'])
                            : '')
                        }
                        onChange={(e) => handleParameterChange('Sigma_H_s', e.target.value)}
                        onFocus={() => {
                          if (centrifugalClearWaterSigmaHsItems.length > 0) setCentrifugalSigmaHsSuggestOpen(true)
                        }}
                        onBlur={() => {
                          handleParameterBlur('Sigma_H_s')
                          window.setTimeout(() => setCentrifugalSigmaHsSuggestOpen(false), 200)
                        }}
                        placeholder={paramPlaceholderFromFormula(
                          formula.parameters,
                          'Sigma_H_s',
                          CENTRIFUGAL_PARAM_PLACEHOLDER_ZH
                        )}
                        className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                          darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      />
                      {paramUnitDisplaySuffix(formula.parameters, 'Sigma_H_s') !== '' && (
                        <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {paramUnitDisplaySuffix(formula.parameters, 'Sigma_H_s')}
                        </span>
                      )}
                    </div>
                    {centrifugalSigmaHsSuggestOpen && centrifugalClearWaterSigmaHsItems.length > 0 && (
                      <div
                        role="listbox"
                        className={`absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border shadow-lg ${
                          darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                        }`}
                      >
                        <div
                          className={`px-3 py-2 text-xs border-b ${darkMode ? 'text-gray-400 border-gray-600' : 'text-gray-500 border-gray-100'}`}
                        >
                          {renderDescriptionWithMath('引用 $P_w$（折算液柱填入 $\\sum H_s$）')}
                        </div>
                        {centrifugalClearWaterSigmaHsItems.map((it) => (
                          <button
                            key={it.sourceId}
                            type="button"
                            role="option"
                            className={`w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 transition-colors ${
                              darkMode
                                ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                            }`}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              const s = (() => {
                                const r = Math.round(it.value * 1e6) / 1e6
                                if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-4))
                                  return r.toExponential(8)
                                const t = r.toFixed(8).replace(/\.?0+$/, '')
                                return t || '0'
                              })()
                              updateParameters((prev) => ({ ...prev, Sigma_H_s: it.value }))
                              updateRawInputs((prev) => ({ ...prev, Sigma_H_s: s }))
                              setCentrifugalSigmaHsSuggestOpen(false)
                            }}
                          >
                            <div className="font-medium">{renderDescriptionWithMath(it.title)}</div>
                            <div className={`text-xs mt-0.5 flex flex-wrap items-baseline gap-x-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              {renderDescriptionWithMath(it.subtitle)}
                              <span>·</span>
                              <span className="font-mono font-semibold">{fmtDissipation(it.pwKpa)}</span>
                              <span>kPa</span>
                              <span>→</span>
                              <span className="font-mono font-semibold">{fmtDissipation(it.value)}</span>
                              <span>m</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {(['K_p', 'K_m'] as const).map((name) => {
                    const unit = paramUnitDisplaySuffix(formula.parameters, name)
                    return (
                      <div key={name}>
                        <label
                          className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}
                        >
                          {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, name))}
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
                            placeholder={paramPlaceholderFromFormula(
                              formula.parameters,
                              name,
                              CENTRIFUGAL_PARAM_PLACEHOLDER_ZH
                            )}
                            className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                              darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                            }`}
                          />
                          {unit !== '' && (
                            <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              {unit}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-end mb-4">
                  <button
                    type="button"
                    onClick={() => void handleCentrifugalPumpStepCalculate(2)}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}
                  >
                    计算
                  </button>
                </div>
                {renderPrimaryResultCallout({
                  nameZh: '主泵扬送清水的总扬程（清水液柱）',
                  symbolMath: 'H_b',
                  unitZh: 'm（米液柱）',
                  bordered: true,
                  value: (() => {
                    const snap2 = formula ? centrifugalStep2SnapshotByFormula[formula.id] : undefined
                    const hbNum =
                      result?.success &&
                      result.result?.H_total != null &&
                      result.result?.N == null &&
                      !isNaN(Number(result.result.H_total))
                        ? Number(result.result.H_total)
                        : parameters['H_b'] != null && !isNaN(Number(parameters['H_b']))
                          ? Number(parameters['H_b'])
                          : snap2?.H_total ?? null
                    if (hbNum != null && hbNum > 0) {
                      return (
                        <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                          {fmtDissipation(hbNum)}
                        </span>
                      )
                    }
                    if (result?.error) {
                      return <span className={`text-sm ${darkMode ? 'text-red-300' : 'text-red-600'}`}>{result.error}</span>
                    }
                    return <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                  })(),
                })}
                {(() => {
                  const snap2 = formula ? centrifugalStep2SnapshotByFormula[formula.id] : undefined
                  const im =
                    result?.success && result.result?.N != null
                      ? snap2?.intermediate
                      : result?.success && result.result?.intermediate
                        ? (result.result.intermediate as Record<string, unknown>)
                        : snap2?.intermediate
                  if (!im) return null
                  const imo = im as Record<string, unknown>
                  const order = ['Sigma_H_s', 'K_p', 'K_m', 'K_p_K_m'] as const
                  const entries = order
                    .filter((k) => imo[k] != null && imo[k] !== '')
                    .map((k) => [k, imo[k]] as [string, unknown])
                  if (entries.length === 0) return null
                  return renderIntermediateResultsBlock(
                    entries,
                    'centrifugal_pump_total_head',
                    'white'
                  )
                })()}
              </div>

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  3. 泵所需电机功率 <InlineMath math="N" />
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  功率式中液柱项为步骤2 的 <InlineMath math="H_b" />（m）；与 <InlineMath math="\rho_k" />（t/m³）、<InlineMath math="g" />、{' '}
                  <InlineMath math="Q_k" />、<InlineMath math="K_1" />、<InlineMath math="\eta_j" />、<InlineMath math="\eta_b" /> 共同求{' '}
                  <InlineMath math="N" />（kW）。程序将 <InlineMath math="\rho_k" /> 换为 SI 密度（kg/m³）参与计算。
                </p>
                <div className={`mb-2 overflow-x-auto ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="N = K_1 \cdot \dfrac{\rho_k\, g\, Q_k\, H_b}{1000\,\eta_j\,\eta_b}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {(() => {
                    const inputCls = `flex-1 min-w-0 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                      darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                    }`
                    const etaJPreset = inferCentrifugalEtaJPreset(
                      parameters['eta_j'] as number | undefined,
                      centrifugalEtaJWantsCustom
                    )
                    const applyEtaJ = (num: number) => {
                      setCentrifugalEtaJWantsCustom(false)
                      updateParameters((prev) => ({ ...prev, eta_j: num }))
                      updateRawInputs((prev) => ({ ...prev, eta_j: String(num) }))
                    }
                    const clearCentrifugalEtaJ = () => {
                      setCentrifugalEtaJWantsCustom(true)
                      updateParameters((prev) => ({ ...prev, eta_j: undefined }))
                      updateRawInputs((prev) => ({ ...prev, eta_j: '' }))
                    }
                    const etaJDropdownFace =
                      etaJPreset === 'custom'
                        ? renderDescriptionWithMath('自定义（手填 $\\eta_j$）')
                        : etaJPreset === 'coupling'
                          ? renderDescriptionWithMath('联轴器，$\\eta_j=1.0$')
                          : etaJPreset === 'belt'
                            ? renderDescriptionWithMath('三角皮带，$0.90\\leq\\eta_j\\leq0.94$（取 $0.92$）')
                            : renderDescriptionWithMath('齿轮，$0.97\\leq\\eta_j\\leq0.98$（取 $0.975$）')
                    const field = (name: 'K_1' | 'rho_k' | 'g' | 'Q_k' | 'H_b' | 'eta_b') => {
                      const unit =
                        name === 'H_b' ? 'm' : paramUnitDisplaySuffix(formula.parameters, name)
                      return (
                        <div key={name} className="min-w-0">
                          <label
                            className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}
                          >
                            {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, name))}
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
                              placeholder={paramPlaceholderFromFormula(
                                formula.parameters,
                                name,
                                CENTRIFUGAL_PARAM_PLACEHOLDER_ZH
                              )}
                              className={inputCls}
                            />
                            {unit !== '' && (
                              <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                {unit}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    }
                    return (
                      <>
                        {field('K_1')}
                        <div className="relative min-w-0">
                          <label
                            className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}
                          >
                            {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, 'rho_k'))}
                          </label>
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              spellCheck={false}
                              value={
                                rawInputs['rho_k'] ??
                                (parameters['rho_k'] != null && !isNaN(parameters['rho_k']!) ? String(parameters['rho_k']) : '')
                              }
                              onChange={(e) => handleParameterChange('rho_k', e.target.value)}
                              onFocus={() => {
                                if (centrifugalRhoKSuggestItems.length > 0) setCentrifugalRhoKSuggestOpen(true)
                              }}
                              onBlur={() => {
                                handleParameterBlur('rho_k')
                                window.setTimeout(() => setCentrifugalRhoKSuggestOpen(false), 200)
                              }}
                              placeholder={paramPlaceholderFromFormula(
                                formula.parameters,
                                'rho_k',
                                CENTRIFUGAL_PARAM_PLACEHOLDER_ZH
                              )}
                              className={inputCls}
                            />
                            {paramUnitDisplaySuffix(formula.parameters, 'rho_k') !== '' && (
                              <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                {paramUnitDisplaySuffix(formula.parameters, 'rho_k')}
                              </span>
                            )}
                          </div>
                          {centrifugalRhoKSuggestOpen && centrifugalRhoKSuggestItems.length > 0 && (
                            <div
                              role="listbox"
                              className={`absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border shadow-lg ${
                                darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                              }`}
                            >
                              <div
                                className={`px-3 py-2 text-xs border-b ${darkMode ? 'text-gray-400 border-gray-600' : 'text-gray-500 border-gray-100'}`}
                              >
                                {renderDescriptionWithMath('选用已算得的浆体密度（填入 $\\rho_k$）')}
                              </div>
                              {centrifugalRhoKSuggestItems.map((it) => (
                                <button
                                  key={it.sourceId}
                                  type="button"
                                  role="option"
                                  className={`w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 transition-colors ${
                                    darkMode
                                      ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                      : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                                  }`}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    const s = (() => {
                                      const r = Math.round(it.value * 1e6) / 1e6
                                      if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-4))
                                        return r.toExponential(8)
                                      const t = r.toFixed(8).replace(/\.?0+$/, '')
                                      return t || '0'
                                    })()
                                    updateParameters((prev) => ({ ...prev, rho_k: it.value }))
                                    updateRawInputs((prev) => ({ ...prev, rho_k: s }))
                                    setCentrifugalRhoKSuggestOpen(false)
                                  }}
                                >
                                  <div className="font-medium">{renderDescriptionWithMath(it.title)}</div>
                                  <div
                                    className={`text-xs mt-0.5 flex flex-wrap items-baseline gap-x-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                                  >
                                    {renderDescriptionWithMath(it.subtitle)}
                                    <span>·</span>
                                    <span className="font-mono font-semibold">{fmtDissipation(it.value)}</span>
                                    <span>t/m³</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {field('g')}
                        {field('Q_k')}
                        {field('H_b')}
                        {field('eta_b')}
                        <div ref={centrifugalEtaJSelectRef} className="min-w-0 md:col-span-2">
                          <label
                            className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}
                          >
                            {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, 'eta_j'))}
                          </label>
                          <div className="relative">
                            <div className="flex items-center space-x-2">
                              <button
                                type="button"
                                aria-expanded={centrifugalEtaJSelectOpen}
                                aria-haspopup="listbox"
                                onClick={() => setCentrifugalEtaJSelectOpen((o) => !o)}
                                className={`${inputCls} flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 text-left appearance-none`}
                              >
                                {/* 不用 overflow-x-auto：在 Windows/Electron 下易出现滚动条箭头，被误认为「数字步进」 */}
                                <span className="min-w-0 flex-1 overflow-hidden param-label-math param-label-math--prose text-left">
                                  {etaJDropdownFace}
                                </span>
                                <span
                                  className={`shrink-0 select-none inline-flex items-center justify-center w-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                                  aria-hidden
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="opacity-80">
                                    <path d="M6 8L1.5 3.5h9L6 8z" />
                                  </svg>
                                </span>
                              </button>
                            </div>
                            {centrifugalEtaJSelectOpen && (
                              <div
                                role="listbox"
                                className={`absolute left-0 right-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border shadow-lg ${
                                  darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                                }`}
                              >
                              <button
                                type="button"
                                role="option"
                                className={`w-full text-left px-3 py-2.5 text-sm border-b transition-colors param-label-math param-label-math--prose ${
                                  darkMode
                                    ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                    : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                                }`}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  applyEtaJ(1)
                                  setCentrifugalEtaJSelectOpen(false)
                                }}
                              >
                                {renderDescriptionWithMath('联轴器，$\\eta_j=1.0$')}
                              </button>
                              <button
                                type="button"
                                role="option"
                                className={`w-full text-left px-3 py-2.5 text-sm border-b transition-colors param-label-math param-label-math--prose ${
                                  darkMode
                                    ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                    : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                                }`}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  applyEtaJ(0.92)
                                  setCentrifugalEtaJSelectOpen(false)
                                }}
                              >
                                {renderDescriptionWithMath('三角皮带，$0.90\\leq\\eta_j\\leq0.94$（取 $0.92$）')}
                              </button>
                              <button
                                type="button"
                                role="option"
                                className={`w-full text-left px-3 py-2.5 text-sm border-b transition-colors param-label-math param-label-math--prose ${
                                  darkMode
                                    ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                    : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                                }`}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  applyEtaJ(0.975)
                                  setCentrifugalEtaJSelectOpen(false)
                                }}
                              >
                                {renderDescriptionWithMath('齿轮，$0.97\\leq\\eta_j\\leq0.98$（取 $0.975$）')}
                              </button>
                              <button
                                type="button"
                                role="option"
                                className={`w-full text-left px-3 py-2.5 text-sm transition-colors param-label-math param-label-math--prose ${
                                  darkMode ? 'hover:bg-gray-700/80 text-gray-100' : 'hover:bg-blue-50 text-gray-800'
                                }`}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  clearCentrifugalEtaJ()
                                  setCentrifugalEtaJSelectOpen(false)
                                }}
                              >
                                {renderDescriptionWithMath('自定义（手填 $\\eta_j$）')}
                              </button>
                              </div>
                            )}
                          </div>
                          {etaJPreset === 'custom' && (
                            <div className="mt-3 min-w-0">
                              <label
                                className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}
                              >
                                {renderDescriptionWithMath('$\\eta_j$ 手填数值')}
                              </label>
                              <div className="flex items-center space-x-2">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  spellCheck={false}
                                  value={
                                    rawInputs['eta_j'] ??
                                    (parameters['eta_j'] != null && !isNaN(parameters['eta_j']!)
                                      ? String(parameters['eta_j'])
                                      : '')
                                  }
                                  onChange={(e) => handleParameterChange('eta_j', e.target.value)}
                                  onBlur={() => handleParameterBlur('eta_j')}
                                  placeholder="传动效率，如0.95"
                                  className={inputCls}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>
                {renderPrimaryResultCallout({
                  nameZh: '泵所需电机功率',
                  symbolMath: 'N',
                  unitZh: 'kW（千瓦，轴功率工程常用单位）',
                  value:
                    result?.success && result.result?.N != null && !isNaN(Number(result.result.N)) ? (
                      <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                        {fmtDissipation(Number(result.result.N))}
                      </span>
                    ) : result?.error ? (
                      <span className={`text-sm ${darkMode ? 'text-red-300' : 'text-red-600'}`}>{result.error}</span>
                    ) : (
                      <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                    ),
                })}
                {(() => {
                  if (!result?.success || result.result?.N == null || !result.result?.intermediate) return null
                  const imo = result.result.intermediate as Record<string, unknown>
                  const order = [
                    'K_1',
                    'rho_k_t_m3',
                    'rho_si_kg_m3',
                    'Q_k',
                    'H_b_m',
                    'H_m',
                    'eta_j',
                    'eta_b',
                  ] as const
                  const entries = order
                    .filter((k) => imo[k] != null && imo[k] !== '')
                    .map((k) => [k, imo[k]] as [string, unknown])
                  if (entries.length === 0) return null
                  return renderIntermediateResultsBlock(entries, 'centrifugal_pump_total_head', 'white')
                })()}
              </div>
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
                        {renderDescriptionWithMath(displayParamLabelFromApi(param.label || param.name, param.unit))}
                      </label>
                      {param.name === 'lambda_d' ? (
                        <div className="relative">
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
                              onFocus={() => {
                                if (slurryDissipationLambdaSuggestItems.length > 0) {
                                  setSlurryDissipationLambdaSuggestOpen(true)
                                }
                              }}
                              onBlur={() => {
                                handleParameterBlur(param.name)
                                window.setTimeout(() => setSlurryDissipationLambdaSuggestOpen(false), 200)
                              }}
                              className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                                darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                              }`}
                              placeholder="达西摩阻系数，如0.025"
                            />
                            {shouldShowParameterUnitSuffix(param.unit) && (
                              <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                            )}
                          </div>
                          {slurryDissipationLambdaSuggestOpen && slurryDissipationLambdaSuggestItems.length > 0 && (
                            <div
                              role="listbox"
                              className={`absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border shadow-lg ${
                                darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                              }`}
                            >
                              <div
                                className={`px-3 py-2 text-xs border-b ${darkMode ? 'text-gray-400 border-gray-600' : 'text-gray-500 border-gray-100'}`}
                              >
                                {renderDescriptionWithMath('选用已计算的达西摩阻系数（填入 $\\lambda_d$）')}
                              </div>
                              {slurryDissipationLambdaSuggestItems.map((it) => (
                                <button
                                  key={it.sourceId}
                                  type="button"
                                  role="option"
                                  className={`w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 transition-colors ${
                                    darkMode
                                      ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                      : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                                  }`}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    const s = (() => {
                                      const r = Math.round(it.value * 1e6) / 1e6
                                      if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-4))
                                        return r.toExponential(8)
                                      const t = r.toFixed(8).replace(/\.?0+$/, '')
                                      return t || '0'
                                    })()
                                    updateParameters((prev) => ({ ...prev, lambda_d: it.value }))
                                    updateRawInputs((prev) => ({ ...prev, lambda_d: s }))
                                    setSlurryDissipationLambdaSuggestOpen(false)
                                  }}
                                >
                                  <div className="font-medium">{renderDescriptionWithMath(it.title)}</div>
                                  <div className={`text-xs mt-0.5 flex flex-wrap items-baseline gap-x-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {renderDescriptionWithMath(it.subtitle)}
                                    <span>·</span>
                                    <span className="font-mono font-semibold">{fmtDissipation(it.value)}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                          {slurryDissipationLambdaSuggestItems.length === 0 && (
                            <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                              暂无可用引用：请先在「浆体摩阻损失」步骤4完成一次达西摩阻系数计算。
                            </p>
                          )}
                        </div>
                      ) : (
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
                            placeholder={
                              param.name === 'L_s'
                                ? '管段长度，如200'
                                : '消能管径内径，如0.15'
                            }
                          />
                          {shouldShowParameterUnitSuffix(param.unit) && (
                            <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                          )}
                        </div>
                      )}
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
                {/* 与全站一致：浅蓝主结果区 + 白底「中间计算结果」（共用 renderIntermediateResultsBlock） */}
                {renderPrimaryResultCallout({
                  titleRow: renderDescriptionWithMath('流量消能系数 $K_{QL}$：'),
                  unitZh: 'h²/m⁵（与式中 Q 取 m³/h 配套）',
                  value: (
                    <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      {result?.success && (result.result?.intermediate?.step_1_kql != null || result.result?.K_QL != null)
                        ? (() => {
                            const v =
                              result.result?.intermediate?.step_1_kql ?? result.result?.K_QL
                            return v != null && v !== '' && !isNaN(Number(v))
                              ? fmtDissipation(Number(v))
                              : String(v)
                          })()
                        : '—'}
                    </span>
                  ),
                })}
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

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
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
                        {renderDescriptionWithMath(displayParamLabelFromApi(param.label || param.name, param.unit))}
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
                          placeholder={param.name === 'Q' ? '浆体流量，如350' : '流量消能系数，如0.02'}
                        />
                        {shouldShowParameterUnitSuffix(param.unit) && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mb-4">
                  <button
                    type="button"
                    onClick={() => handleSlurryDissipationStepCalculate(2)}
                    disabled={loading}
                    className={`px-6 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}
                  >
                    计算
                  </button>
                </div>
                {/* 与步骤1相同版式：参数区 → 计算按钮 → 浅蓝主结果卡 → 白底中间计算结果 */}
                {(() => {
                  const dhRaw =
                    result?.success &&
                    (result.result?.delta_h ?? result.result?.intermediate?.step_2_delta_h)
                  const dhNum =
                    dhRaw != null && dhRaw !== '' && !isNaN(Number(dhRaw)) ? Number(dhRaw) : null
                  const q2 = result?.success ? result.result?.intermediate?.Q_squared : undefined
                  const showMid =
                    dhNum != null && q2 != null && !isNaN(Number(q2))
                  return (
                    <>
                      {renderPrimaryResultCallout({
                        titleRow: renderDescriptionWithMath('消能水头 $\\Delta h$：'),
                        unitZh: 'm（米液柱）',
                        value: (
                          <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                            {dhNum != null ? fmtDissipation(dhNum) : '—'}
                          </span>
                        ),
                      })}
                      {showMid &&
                        renderIntermediateResultsBlock(
                          [['dissipation_q_squared', fmtDissipation(Number(q2))]],
                          formula?.id
                        )}
                    </>
                  )
                })()}
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
                      ['d', '$d$：孔板开孔直径', '孔板开孔直径，如0.08', 'm'],
                      ['D', '$D$：管道内径', '管道内径，如0.2', 'm'],
                    ] as const
                  ).map(([name, lab, ph, unit]) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(lab)}
                      </label>
                      <div className="flex items-center space-x-2">
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
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                            darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                          }`}
                          placeholder={ph}
                        />
                        <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{unit}</span>
                      </div>
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
                {formulaResults['orifice_step1']?.success &&
                  renderPrimaryResultCallout({
                    nameZh: '孔径比',
                    symbolMath: '\\beta',
                    unitZh: '无量纲（0～1）',
                    value: (
                      <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                        {formulaResults['orifice_step1']?.result?.beta != null
                          ? fmtDissipation(Number(formulaResults['orifice_step1']!.result!.beta))
                          : '—'}
                      </span>
                    ),
                  })}
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
                      ['beta', '$\\beta$：孔径比', '孔径比，如0.4', '无量纲'],
                      ['d', '$d$：孔板开孔直径', '孔板开孔直径，如0.08', 'm'],
                    ] as const
                  ).map(([name, lab, ph, unit]) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(lab)}
                      </label>
                      <div className="flex items-center space-x-2">
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
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                            darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                          }`}
                          placeholder={ph}
                        />
                        <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{unit}</span>
                      </div>
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
                {formulaResults['orifice_step2']?.success &&
                  renderPrimaryResultCallout({
                    titleRow: renderDescriptionWithMath('孔板流量消能系数 $K_{Qk}$：'),
                    unitZh: 'h²/m⁵（与式中 Q 取 m³/h 配套）',
                    value: (
                      <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                        {formulaResults['orifice_step2']?.result?.K_Qk != null
                          ? fmtDissipation(Number(formulaResults['orifice_step2']!.result!.K_Qk))
                          : '—'}
                      </span>
                    ),
                  })}
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
                      ['K_Qk', '$K_{Qk}$：孔板流量消能系数', '孔板流量消能系数，如0.02', 'h²/m⁵'],
                      ['Q', '$Q$：浆体体积流量', '浆体体积流量，如350', 'm³/h'],
                    ] as const
                  ).map(([name, lab, ph, unit]) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(lab)}
                      </label>
                      <div className="flex items-center space-x-2">
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
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${
                            darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'
                          }`}
                          placeholder={ph}
                        />
                        <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{unit}</span>
                      </div>
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
                    {renderPrimaryResultCallout({
                      titleRow: renderDescriptionWithMath('消能水头 $\\Delta h$：'),
                      unitZh: 'm（米液柱）',
                      value: (
                        <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                          {fmtDissipation(Number(result.result.delta_h))}
                        </span>
                      ),
                    })}
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
                  !(result?.success === false && result?.error) &&
                  renderPrimaryResultCallout({
                    titleRow: renderDescriptionWithMath('消能水头 $\\Delta h$：'),
                    unitZh: 'm（米液柱）',
                    value: <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>,
                  })
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
              {renderPrimaryResultCallout({
                nameZh: '模块主结果',
                unitZh: '—（当前为占位页）',
                bordered: true,
                value: <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>,
              })}
            </>
          ) : formula?.id === 'density_mixing' ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath('本节由固体质量浓度与液、固相密度确定浆体密度 $\\rho_k$，作为沿程水力坡降计算的前置量。求得的 $\\rho_k$ 可输入同栏「浆体摩阻损失」分步流程或合并公式，用于后续核算。')}
              </p>
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>计算浆体密度</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('依据固体质量浓度 $C_w$ 及固体密度 $\\rho_g$、液体密度 $\\rho_s$，按质量加权关系计算浆体密度 $\\rho_k$（t/m³）。')}
                </p>
                <div className={`mb-4 text-xl ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  <BlockMath math="\rho_k = \frac{1}{\frac{C_w}{\rho_g} + \frac{1-C_w}{\rho_s}}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formula.parameters.map((param) => {
                    const placeholders: Record<string, string> = {
                      C_w: '固相质量分数，如0.35',
                      rho_g: '固体密度，如2.5',
                      rho_s: '浆体密度，如1.2',
                    }
                    return (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(displayParamLabelFromApi(param.label || param.name, param.unit))}
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
                        {shouldShowParameterUnitSuffix(param.unit) && (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </div>
              {renderPrimaryResultCallout({
                nameZh: '浆体密度',
                symbolMath: '\\rho_k',
                unitZh: 't/m³（吨每立方米）',
                bordered: true,
                value: result?.success ? (
                  <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                    {result.result?.rho_k ?? '—'}
                  </span>
                ) : result?.error ? (
                  <span className={`text-sm ${darkMode ? 'text-red-300' : 'text-red-600'}`}>{result.error}</span>
                ) : (
                  <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                ),
              })}
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
                  {renderDescriptionWithMath('在达西–魏斯巴赫框架下，采用浆体密度 $\\rho_k$ 估算似均质悬浮流单位管长水力坡降 $i_k$（mH₂O/m）；式中密度比 $\\rho_k/\\rho_s$ 用于反映固相对能量损失的影响，其中 $\\rho_s$ 为水密度。给定管长 $L$ 时，总沿程水头损失可取 $h_f = i_k \\cdot L$。适用于固相浓度中等、悬浮较均匀的管流；浓度很高或流态明显偏离假定时，应结合经验系数与试验或规范另行校核。')}
                </p>
                <div className={`mb-4 text-lg ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  <BlockMath math="i_k = \lambda \cdot \frac{V^2}{2gD} \cdot \frac{\rho_k}{\rho_s}" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formula.parameters.filter((p) => ['rho_k', 'lambda_coef', 'V', 'D', 'rho_s', 'g'].includes(p.name)).map((param) => {
                    const placeholders: Record<string, string> = {
                      rho_k: '浆体密度，如1.35',
                      lambda_coef: '达西摩阻系数，如0.018',
                      V: '断面平均流速，如2',
                      D: '管道内径，如0.2',
                      rho_s: '水密度，默认值1',
                      g: '重力加速度，默认值 9.81',
                    }
                    return (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {param.name === 'rho_s'
                          ? renderDescriptionWithMath('$\\rho_s$：水密度')
                          : renderDescriptionWithMath(displayParamLabelFromApi(param.label || param.name, param.unit))}
                      </label>
                      {param.name === 'rho_k' ? (
                        <div className="relative">
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                              onChange={(e) => handleParameterChange(param.name, e.target.value)}
                              onFocus={() => {
                                if (slurryFrictionRhoKSuggestItems.length > 0) setSlurryFrictionRhoKSuggestOpen(true)
                              }}
                              onBlur={() => {
                                handleParameterBlur(param.name)
                                window.setTimeout(() => setSlurryFrictionRhoKSuggestOpen(false), 200)
                              }}
                              className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                              placeholder={placeholders[param.name] || commonParamPlaceholder(formula?.parameters, param.name)}
                            />
                            {shouldShowParameterUnitSuffix(param.unit) && (
                              <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                            )}
                          </div>
                          {slurryFrictionRhoKSuggestOpen && slurryFrictionRhoKSuggestItems.length > 0 && (
                            <div
                              role="listbox"
                              className={`absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border shadow-lg ${
                                darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                              }`}
                            >
                              <div
                                className={`px-3 py-2 text-xs border-b ${darkMode ? 'text-gray-400 border-gray-600' : 'text-gray-500 border-gray-100'}`}
                              >
                                {renderDescriptionWithMath('选用其他页面已算得的浆体密度（填入 $\\rho_k$）')}
                              </div>
                              {slurryFrictionRhoKSuggestItems.map((it) => (
                                <button
                                  key={it.sourceId}
                                  type="button"
                                  role="option"
                                  className={`w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 transition-colors ${
                                    darkMode
                                      ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                      : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                                  }`}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    const s = (() => {
                                      const r = Math.round(it.value * 1e6) / 1e6
                                      if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-4))
                                        return r.toExponential(8)
                                      const t = r.toFixed(8).replace(/\.?0+$/, '')
                                      return t || '0'
                                    })()
                                    updateParameters((prev) => ({ ...prev, rho_k: it.value }))
                                    updateRawInputs((prev) => ({ ...prev, rho_k: s }))
                                    setSlurryFrictionRhoKSuggestOpen(false)
                                  }}
                                >
                                  <div className="font-medium">{renderDescriptionWithMath(it.title)}</div>
                                  <div className={`text-xs mt-0.5 flex flex-wrap items-baseline gap-x-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {renderDescriptionWithMath(it.subtitle)}
                                    <span>·</span>
                                    <span className="font-mono font-semibold">{fmtDissipation(it.value)}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : param.name === 'lambda_coef' ? (
                        <div className="relative">
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                              onChange={(e) => handleParameterChange(param.name, e.target.value)}
                              onFocus={() => {
                                if (slurryFrictionLambdaSuggestItems.length > 0) setSlurryFrictionLambdaSuggestOpen(true)
                              }}
                              onBlur={() => {
                                handleParameterBlur(param.name)
                                window.setTimeout(() => setSlurryFrictionLambdaSuggestOpen(false), 200)
                              }}
                              className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                              placeholder={placeholders[param.name] || commonParamPlaceholder(formula?.parameters, param.name)}
                            />
                            {shouldShowParameterUnitSuffix(param.unit) && (
                              <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                            )}
                          </div>
                          {slurryFrictionLambdaSuggestOpen && slurryFrictionLambdaSuggestItems.length > 0 && (
                            <div
                              role="listbox"
                              className={`absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border shadow-lg ${
                                darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                              }`}
                            >
                              <div
                                className={`px-3 py-2 text-xs border-b ${darkMode ? 'text-gray-400 border-gray-600' : 'text-gray-500 border-gray-100'}`}
                              >
                                {renderDescriptionWithMath('选用其他页面已算得的达西摩阻系数（填入 $\\lambda$）')}
                              </div>
                              {slurryFrictionLambdaSuggestItems.map((it) => (
                                <button
                                  key={it.sourceId}
                                  type="button"
                                  role="option"
                                  className={`w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 transition-colors ${
                                    darkMode
                                      ? 'border-gray-700 hover:bg-gray-700/80 text-gray-100'
                                      : 'border-gray-100 hover:bg-blue-50 text-gray-800'
                                  }`}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    const s = (() => {
                                      const r = Math.round(it.value * 1e6) / 1e6
                                      if (Math.abs(r) >= 1e6 || (Math.abs(r) > 0 && Math.abs(r) < 1e-4))
                                        return r.toExponential(8)
                                      const t = r.toFixed(8).replace(/\.?0+$/, '')
                                      return t || '0'
                                    })()
                                    updateParameters((prev) => ({ ...prev, lambda_coef: it.value }))
                                    updateRawInputs((prev) => ({ ...prev, lambda_coef: s }))
                                    setSlurryFrictionLambdaSuggestOpen(false)
                                  }}
                                >
                                  <div className="font-medium">{renderDescriptionWithMath(it.title)}</div>
                                  <div className={`text-xs mt-0.5 flex flex-wrap items-baseline gap-x-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {renderDescriptionWithMath(it.subtitle)}
                                    <span>·</span>
                                    <span className="font-mono font-semibold">{fmtDissipation(it.value)}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={rawInputs[param.name] ?? (parameters[param.name] != null && !isNaN(parameters[param.name]!) ? String(parameters[param.name]) : '')}
                            onChange={(e) => handleParameterChange(param.name, e.target.value)}
                            onBlur={() => handleParameterBlur(param.name)}
                            className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base ${darkMode ? 'bg-gray-600 border-gray-500 text-gray-100' : 'bg-white border-gray-300 text-gray-900'}`}
                            placeholder={placeholders[param.name] || commonParamPlaceholder(formula?.parameters, param.name)}
                          />
                          {shouldShowParameterUnitSuffix(param.unit) && (
                            <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{param.unit}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              </div>

              {/* 底部结果区（计算由右下角「开始计算」统一触发） */}
              {renderPrimaryResultCallout({
                nameZh: '单位管长水力坡降',
                symbolMath: 'i_k',
                unitZh: 'mH₂O/m（米水柱每米管长）',
                bordered: true,
                value: result?.success ? (
                  <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                    {result.result?.intermediate?.step_B_i_k ?? result.result?.i_k ?? '—'}
                  </span>
                ) : result?.error ? (
                  <span className={`text-sm ${darkMode ? 'text-red-300' : 'text-red-600'}`}>{result.error}</span>
                ) : (
                  <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                ),
              })}
            </>
          ) : formula?.id === 'kronodze_pressure' ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath('本模型主要用于计算流体输送系统中压力管道的临界流速和摩阻损失，其计算结果可运用于管材和泵选型。该模型适用于：1、有压隧洞泥沙运输，管道内悬浮液处于第一、第二临界流速情况下；2、适用于固体密度小于 $3$、颗粒粒径小于 $0.4$ mm 的浆体。在重力流管道情况下，该模型的应用价值有限。当体积浓度 $C_V>30\\%$ 时，该模型计算得出的数据与实际情况偏差较大。本方法采用三步顺序计算，每步可独立执行，结果将作为下一步的输入。')}
              </p>

              {/* 1. 计算矿浆流量：公式 → 本步参数 → 计算 → 结果 */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>1. 计算矿浆流量</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('根据干尾矿重量 $W$、矿浆中水重 $G$、固体密度 $\\rho_g$ 及波动系数 $K$，计算矿浆流量 $Q_k$。$Q_k$ 为后续步骤的基础，单位 m^3/s。')}
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
                            ? 'K：波动系数，单位为 无量纲'
                            : param.name === 'W'
                            ? 'W：干尾矿重量，单位为 t/h'
                            : param.name === 'G'
                            ? 'G：矿浆中水重，单位为 t/h'
                            : '$\\rho_g$：固体密度，单位为 t/m³'
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
                          placeholder={commonParamPlaceholder(formula?.parameters, param.name)}
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
                {renderPrimaryResultCallout({
                  nameZh: '矿浆流量',
                  symbolMath: 'Q_k',
                  unitZh: 'm³/s（立方米每秒）',
                  value: (
                    <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      {result?.success && result.result?.intermediate?.step_A_Qk != null
                        ? result.result.intermediate.step_A_Qk
                        : '—'}
                    </span>
                  ),
                })}
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
                        {renderDescriptionWithMath(displayParamLabelFromApi(param.label || param.name, param.unit))}
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
                          placeholder={commonParamPlaceholder(formula?.parameters, param.name)}
                        />
                        {shouldShowParameterUnitSuffix(param.unit) && (
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
                {renderPrimaryResultCallout({
                  nameZh: '临界管径',
                  symbolMath: 'D_L',
                  unitZh: 'mm（毫米）',
                  value: (
                    <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      {result?.success && result.result?.intermediate?.step_B_DL_mm != null
                        ? result.result.intermediate.step_B_DL_mm
                        : '—'}
                    </span>
                  ),
                })}
              </div>

              {/* 3. 计算临界流速：公式 + 参数输入（由步骤1、2自动导入，可微调） */}
              <div className="rounded-xl border-2 p-5 mb-5 bg-white border-gray-300">
                <div className="text-lg font-semibold mb-2 text-gray-800">3. 计算临界流速</div>
                <p className="text-sm mb-3 text-gray-600">
                  {renderDescriptionWithMath('需先完成步骤1、2。由步骤1得到的 $C_d$（重量砂水比 $=W/G\\times100$）、步骤2得到的 $D_L$（临界管径 mm）及 $\\beta$，计算临界流速 $V_L$（m/s）。')}
                </p>
                <div className="mb-3 text-gray-700">
                  <BlockMath math="V_L = 0.255\beta(1+2.48\sqrt[3]{C_d}\sqrt[4]{D_L})" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700">
                      {renderDescriptionWithMath('$\\beta$：固体物料相对密度修正系数，单位为 无量纲')}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={rawInputs['beta'] ?? (parameters['beta'] != null && !isNaN(parameters['beta']!) ? String(parameters['beta']) : '')}
                        onChange={(e) => handleParameterChange('beta', e.target.value)}
                        onBlur={() => handleParameterBlur('beta')}
                        className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white border-gray-300 text-gray-900"
                        placeholder="固体物料相对密度修正系数，如1.2"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700">
                      {renderDescriptionWithMath('$W$：干尾矿重量，单位为 t/h')}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={rawInputs['W'] ?? (parameters['W'] != null && !isNaN(parameters['W']!) ? String(parameters['W']) : '')}
                        onChange={(e) => handleParameterChange('W', e.target.value)}
                        onBlur={() => handleParameterBlur('W')}
                        className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white border-gray-300 text-gray-900"
                        placeholder="干尾矿重量，如60"
                      />
                      <span className="text-sm shrink-0 text-gray-500">t/h</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700">
                      {renderDescriptionWithMath('$G$：矿浆中水重，单位为 t/h')}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={rawInputs['G'] ?? (parameters['G'] != null && !isNaN(parameters['G']!) ? String(parameters['G']) : '')}
                        onChange={(e) => handleParameterChange('G', e.target.value)}
                        onBlur={() => handleParameterBlur('G')}
                        className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white border-gray-300 text-gray-900"
                        placeholder="矿浆中水重，如400"
                      />
                      <span className="text-sm shrink-0 text-gray-500">t/h</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700">
                      {renderDescriptionWithMath('$D_L$：临界管径，单位为 mm')}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={
                          result?.success && result.result?.intermediate?.step_B_DL_mm != null
                            ? String(result.result.intermediate.step_B_DL_mm)
                            : ''
                        }
                        readOnly
                        className="flex-1 px-3 py-2 border rounded-lg bg-gray-100 border-gray-300 text-gray-700 cursor-not-allowed"
                        placeholder="临界管径（步骤2结果），如120"
                      />
                      <span className="text-sm shrink-0 text-gray-500">mm</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 克诺罗兹法中间计算结果（白底分区，与全站一致） */}
              {kronodzeStep3Visible && result?.success && result.result?.intermediate && (() => {
                const inter = result.result.intermediate as Record<string, unknown>
                const formulaKeys = ['term_cd', 'term_dl', 'bracket_term', 'step_A_Qk', 'step_B_DL_mm'] as const
                const rows = formulaKeys
                  .filter((k) => inter[k] != null)
                  .map((k) => {
                    const value = inter[k]
                    const displayValue =
                      typeof value === 'number'
                        ? k === 'step_A_Qk'
                          ? `${value} m³/s`
                          : k === 'step_B_DL_mm'
                            ? `${value} mm`
                            : String(value)
                        : String(value)
                    return [k, displayValue] as [string, string]
                  })
                if (rows.length === 0) return null
                return renderIntermediateResultsBlock(rows, formula?.id, 'white')
              })()}
            </>
          ) : (
            <>
              <div className={`mb-4 p-3 rounded-lg overflow-x-auto ${
                darkMode ? 'bg-gray-600' : 'bg-gray-50'
              }`}>
                {isSlurryAccelFormula ? (
                  <BlockMath math="\left(Z_1 + \frac{P_1}{\rho_k g}\right) - \left(Z_2 + \frac{P_2}{\rho_k g}\right) > iL" />
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

          {/* Input Parameters - 非 B.C.克诺罗兹法、非浆体摩阻损失、非密度混合 时显示统一参数区 */}
          {formula?.id !== 'kronodze_pressure' && formula?.id !== 'slurry_friction_loss' && formula?.id !== 'density_mixing' && formula?.id !== 'slurry_friction_workflow' && !isSlurryDissipationFormula && !isSlurryEnergyPlaceholder && !isClearWaterFrictionLoss && !isTotalHeadFormula && !isPositiveDisplacementPumpFormula && !isCentrifugalPumpTotalHead && !isSlurryDissipationOrifice && (
          <div className={`border-t pt-4 ${
            darkMode ? 'border-gray-600' : 'border-gray-200'
          }`}>
            <h3 className={`text-base font-semibold mb-3 ${
              darkMode ? 'text-gray-100' : 'text-gray-900'
            }`}>
              参数输入
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {formula.parameters.map((param) => {
                const displayValue = (() => {
                  const raw = rawInputs[param.name]
                  if (raw !== undefined) return raw
                  const val = parameters[param.name]
                  return val !== undefined && val !== null && !isNaN(val) ? String(val) : ''
                })()
                const ph = (() => {
                  if (formula?.id === 'slurry_accel_energy') {
                    return paramPlaceholderFromFormula(
                      formula?.parameters,
                      param.name,
                      SLURRY_ACCEL_PARAM_PLACEHOLDER_ZH
                    )
                  }
                  if (param.name === 'Cv') {
                    return cvParameterPlaceholder()
                  }
                  if (formula?.id === 'liu_dezhong' && param.name === 'omega') {
                    return param.default !== undefined
                      ? `${param.default}（点击展开似均质中加权平均沉速辅助计算）`
                      : '点击输入框展开「似均质中加权平均沉速」辅助计算'
                  }
                  if (formula?.id === 'liu_dezhong' && param.name === 'omega_s') {
                    return param.default !== undefined
                      ? `${param.default}（点击展开水中加权平均沉速辅助计算）`
                      : '点击输入框展开「水中加权平均沉速（斯托克斯）」辅助计算'
                  }
                  if (isApiDecimalUnit(param.unit)) {
                    return decimalParameterPlaceholder(
                      formula?.parameters,
                      param.name,
                      param.default as number | string | undefined,
                      meaningfulExampleForParam(formula?.parameters, param.name)
                    )
                  }
                  if (param.default !== undefined) {
                    return defaultNumericPlaceholder(formula?.parameters, param.name, param.default)
                  }
                  return suggestedNumericPlaceholder(formula?.parameters, param.name)
                })()
                const slurryAccelAutoL =
                  formula?.id === 'slurry_accel_energy' && param.name === 'L'
                    ? getSlurryAccelAutoLength()
                    : null
                return (
                  <div key={param.name}>
                    <label
                      className={`mb-1 block text-sm font-medium ${
                        darkMode ? 'text-gray-200' : 'text-gray-700'
                      }`}
                    >
                      {formula?.id === 'liu_dezhong' && param.name === 'omega'
                        ? renderDescriptionWithMath('$\\omega$：似均质中加权平均沉速，单位为 m/s')
                        : formula?.id === 'liu_dezhong' && param.name === 'omega_s'
                          ? renderDescriptionWithMath('$\\omega_s$：水中加权平均沉速，单位为 m/s')
                          : renderDescriptionWithMath(displayParamLabelFromApi(param.label || param.name, param.unit))}
                    </label>
                    {param.name === 'Cv' ? (
                      <CvVolumeConcentrationField
                        darkMode={darkMode}
                        inputValue={displayValue}
                        onInputChange={(v) => handleParameterChange('Cv', v)}
                        onInputBlur={() => handleParameterBlur('Cv')}
                        placeholder={ph}
                        unit={
                          shouldShowParameterUnitSuffix(param.unit) ? (
                            <span
                              className={`self-center text-sm shrink-0 ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}
                            >
                              {param.unit}
                            </span>
                          ) : null
                        }
                        onApplyCvFromRatio={(s) => handleParameterChange('Cv', s)}
                      />
                    ) : formula?.id === 'liu_dezhong' && param.name === 'omega' ? (
                      <LiuDezhongOmegaBinghamField
                        darkMode={darkMode}
                        inputValue={displayValue}
                        onInputChange={(v) => handleParameterChange('omega', v)}
                        onInputBlur={() => handleParameterBlur('omega')}
                        placeholder={ph}
                        unit={
                          shouldShowParameterUnitSuffix(param.unit) ? (
                            <span
                              className={`self-center text-sm shrink-0 ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}
                            >
                              {param.unit}
                            </span>
                          ) : null
                        }
                        parameters={parameters}
                        onApplyOmega={(s) => handleParameterChange('omega', s)}
                        onDlComputed={(dL) => {
                          if (!formula) return
                          setLiuOmegaDLByFormula((prev) => ({
                            ...prev,
                            [formula.id]: dL ?? null,
                          }))
                        }}
                      />
                    ) : formula?.id === 'liu_dezhong' && param.name === 'omega_s' ? (
                      <LiuDezhongOmegaSStokesField
                        darkMode={darkMode}
                        inputValue={displayValue}
                        onInputChange={(v) => handleParameterChange('omega_s', v)}
                        onInputBlur={() => handleParameterBlur('omega_s')}
                        placeholder={ph}
                        unit={
                          shouldShowParameterUnitSuffix(param.unit) ? (
                            <span
                              className={`self-center text-sm shrink-0 ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}
                            >
                              {param.unit}
                            </span>
                          ) : null
                        }
                        parameters={parameters}
                        dLFromOmega={liuOmegaDL}
                        onApplyOmegaS={(s) => handleParameterChange('omega_s', s)}
                      />
                    ) : formula?.id === 'slurry_accel_energy' && param.name === 'L' ? (
                      <div className="relative">
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            spellCheck={false}
                            value={displayValue}
                            onChange={(e) => handleParameterChange(param.name, e.target.value)}
                            onFocus={() => {
                              if (slurryAccelAutoL != null) setSlurryAccelLSuggestOpen(true)
                            }}
                            onBlur={() => {
                              handleParameterBlur(param.name)
                              window.setTimeout(() => setSlurryAccelLSuggestOpen(false), 200)
                            }}
                            className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                              darkMode
                                ? 'bg-gray-600 border-gray-500 text-gray-100 placeholder-gray-400'
                                : 'bg-white border-gray-300 text-gray-900'
                            }`}
                            placeholder={ph}
                          />
                          {shouldShowParameterUnitSuffix(param.unit) && (
                            <span
                              className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                            >
                              {param.unit}
                            </span>
                          )}
                        </div>
                        {slurryAccelLSuggestOpen && slurryAccelAutoL != null && (
                          <div
                            role="listbox"
                            className={`absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border shadow-lg ${
                              darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                            }`}
                          >
                            <div
                              className={`px-3 py-2 text-xs border-b ${darkMode ? 'text-gray-400 border-gray-600' : 'text-gray-500 border-gray-100'}`}
                            >
                              {renderDescriptionWithMath('按起点/终点自动计算的管道长度（点击填入 $L$）')}
                            </div>
                            <button
                              type="button"
                              role="option"
                              className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                                darkMode
                                  ? 'hover:bg-gray-700/80 text-gray-100'
                                  : 'hover:bg-blue-50 text-gray-800'
                              }`}
                              onMouseDown={(e) => {
                                e.preventDefault()
                                applySlurryAccelAutoLength(true)
                                setSlurryAccelLSuggestOpen(false)
                              }}
                            >
                              <div className="font-medium">{renderDescriptionWithMath('自动计算结果')}</div>
                              <div
                                className={`text-xs mt-0.5 flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                              >
                                <span className="font-mono font-semibold">{fmtDissipation(slurryAccelAutoL)}</span>
                                <span>{param.unit || 'm'}</span>
                              </div>
                            </button>
                          </div>
                        )}
                        {slurryAccelAutoL == null && (
                          <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            填写起点与终点后可自动计算管道长度。
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          spellCheck={false}
                          value={displayValue}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onBlur={() => handleParameterBlur(param.name)}
                          className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            darkMode
                              ? 'bg-gray-600 border-gray-500 text-gray-100 placeholder-gray-400'
                              : 'bg-white border-gray-300 text-gray-900'
                          }`}
                          placeholder={ph}
                        />
                        {shouldShowParameterUnitSuffix(param.unit) && (
                          <span
                            className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                          >
                            {param.unit}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          )}
        </div>

        {/* Results Section：克诺罗兹法完成步骤3后联动显示结果与动画；步骤未完成时不显示本区以免与步骤内结果重复 */}
        {(formula?.id !== 'kronodze_pressure' || kronodzeStep3Visible) &&
          formula?.id !== 'slurry_friction_loss' &&
          formula?.id !== 'density_mixing' &&
          formula?.id !== 'slurry_friction_workflow' &&
          !isSlurryDissipationFormula &&
          !isSlurryEnergyPlaceholder &&
          !isClearWaterFrictionLoss &&
          !isTotalHeadFormula &&
          !isPositiveDisplacementPumpFormula &&
          !isCentrifugalPumpTotalHead &&
          !isSlurryDissipationOrifice && (
        <div className={mainPanelCardClassName}>
          <h3 className={`text-base font-semibold mb-3 ${
            darkMode ? 'text-gray-100' : 'text-gray-900'
          }`}>
            计算结果
          </h3>
          <div className="space-y-4">
            {renderPrimaryResultCallout({
              titleRow:
                formula?.id === 'friction_loss'
                  ? renderDescriptionWithMath('沿程摩阻损失 $i_k$：')
                  : isSlurryAccelFormula
                    ? (<>浆体加速流能量条件：</>)
                    : renderDescriptionWithMath('临界流速 $V_c$：'),
              titleRight:
                result?.success &&
                result.result?.Vc !== undefined &&
                !isSlurryAccelFormula &&
                formula?.id !== 'friction_loss' &&
                !isKronodzeFormula ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (lockedVc === null) {
                        updateLockedVc(result.result!.Vc ?? null)
                        setAutoCalculateRef(true)
                      } else {
                        updateLockedVc(null)
                        setAutoCalculateRef(false)
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
                ) : null,
              unitZh:
                formula?.id === 'friction_loss'
                  ? result?.success && result.result?.unit
                    ? `${String(result.result.unit)}（浆体沿程单位管长水头损失）`
                    : 'mH₂O/m（米水柱每米管长）'
                  : isSlurryAccelFormula
                    ? '定性结论；能量与裕度见下方「中间计算结果」'
                    : result?.success && result.result?.unit
                      ? `${String(result.result.unit)}（临界流速）`
                      : 'm/s（米每秒）',
              value: (() => {
                const tone =
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
                const text =
                  result?.success && result.result?.condition_met !== undefined
                    ? result.result.condition_met
                      ? '✅ 浆体加速流条件满足'
                      : '❌ 浆体加速流条件不满足'
                    : result?.success &&
                        (result.result?.Vc !== undefined ||
                          result.result?.i_k !== undefined ||
                          result.result?.rho_k !== undefined ||
                          result.result?.lambda_coef !== undefined)
                      ? String(
                          result.result?.Vc ??
                            result.result?.i_k ??
                            result.result?.rho_k ??
                            result.result?.lambda_coef ??
                            ''
                        )
                      : result?.error || '—'
                return <span className={`text-xl font-bold ${tone}`}>{text}</span>
              })(),
              footer:
                isKronodzeFormula &&
                kronodzeStep3Visible &&
                result?.success &&
                result.result?.Vc !== undefined ? (
                  (() => {
                    const animationType = result.animation_type || 'still-flow'
                    const statusText =
                      animationType === 'settle-30'
                        ? '⚠️ 严重沉降'
                        : animationType === 'settle-20'
                          ? '⚠️ 中度沉降'
                          : animationType === 'settle-10-flow'
                            ? '⚠️ 轻度沉降'
                            : animationType === 'still-flow'
                              ? '临界状态'
                              : animationType === 'medium-flow'
                                ? '✅ 正常流动'
                                : '✅ 快速流动'
                    const statusColor =
                      animationType === 'settle-30'
                        ? darkMode ? 'text-red-300' : 'text-red-700'
                        : animationType === 'settle-20'
                          ? darkMode ? 'text-orange-300' : 'text-orange-700'
                          : animationType === 'settle-10-flow'
                            ? darkMode ? 'text-yellow-300' : 'text-yellow-700'
                            : animationType === 'still-flow'
                              ? darkMode ? 'text-blue-300' : 'text-blue-700'
                              : darkMode ? 'text-green-300' : 'text-green-700'
                    return (
                      <div
                        className={`mt-2 pt-2 border-t ${
                          darkMode ? 'border-blue-700' : 'border-blue-200'
                        }`}
                      >
                        <div className={`mt-1 py-2 px-3 rounded text-xs border ${
                          darkMode
                            ? 'bg-blue-900 bg-opacity-30 text-gray-200 border-blue-600'
                            : 'bg-blue-100 text-gray-800 border-blue-300'
                        }`}>
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0" style={{ flex: '2', maxWidth: '66.666%' }}>
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <div className={`font-semibold ${statusColor}`}>{statusText}</div>
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
                              <div className="text-xs leading-relaxed break-words">
                                根据临界流速计算结果展示当前流态动画。
                              </div>
                            </div>
                            <div className="flex-shrink-0" style={{ flex: '1', minWidth: '120px', maxWidth: '33.333%' }}>
                              {renderFlowAnimation(animationType, statusColor, 'small')}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })()
                ) : lockedVc !== null ? (
                  <div
                    className={`mt-2 pt-2 border-t ${
                      darkMode ? 'border-blue-700' : 'border-blue-200'
                    }`}
                  >
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
                ) : null,
            })}

            {isSlurryAccelFormula &&
              result?.success &&
              result.result?.condition_met !== undefined &&
              result.result?.intermediate &&
              (() => {
                const inter = result.result.intermediate
                const headDiffN = Number(inter.head_diff)
                const frictionLossN = Number(inter.friction_loss_total)
                const hasNumeric = Number.isFinite(headDiffN) && Number.isFinite(frictionLossN)
                const margin = hasNumeric ? headDiffN - frictionLossN : null
                const marginRatio =
                  hasNumeric && frictionLossN > 0 ? headDiffN / frictionLossN : null
                const met = result.result.condition_met!
                const hintTitle = met ? '运行建议' : '优化建议'
                const hintText = !hasNumeric
                  ? '建议先核对输入参数，确保各项单位一致后再进行工况判断。'
                  : met
                    ? `当前工况已满足加速流条件，净水头裕度约 ${margin!.toFixed(3)} m。建议在运行中持续监测压力波动与流量变化，优先保证上游压头稳定，并预留 5%~10% 的设计裕度以应对工况扰动。`
                    : `当前工况未满足加速流条件，尚缺净水头约 ${Math.abs(margin!).toFixed(3)} m。建议优先提高上游有效压头（提高泵扬程或抬高上游液位），并同步降低沿程损失（减小摩阻系数 i、缩短等效管长 L、优化管径与局部构件）后复核。`

                return (
                  <>
                    {renderIntermediateResultsBlock(
                      [
                        [
                          'head_diff',
                          <span className="block text-left font-sans font-normal">
                            <span
                              className={`block text-xs mb-1.5 leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}
                            >
                              <InlineMath math="\left(Z_1 + \frac{P_1}{\rho_k g}\right) - \left(Z_2 + \frac{P_2}{\rho_k g}\right)" />
                            </span>
                            <span className="font-mono font-semibold">{String(inter.head_diff)} m</span>
                          </span>,
                        ],
                        [
                          'friction_loss_total',
                          <span className="block text-left font-sans font-normal">
                            <span
                              className={`block text-xs mb-1.5 leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}
                            >
                              <InlineMath math="iL" />
                            </span>
                            <span className="font-mono font-semibold">{String(inter.friction_loss_total)} m</span>
                          </span>,
                        ],
                      ],
                      'slurry_accel_energy',
                      'white'
                    )}
                    <div
                      className={`mt-3 p-3 rounded-lg border text-sm leading-relaxed ${
                        met
                          ? darkMode
                            ? 'bg-green-900/20 border-green-700 text-green-200'
                            : 'bg-green-50 border-green-200 text-green-800'
                          : darkMode
                            ? 'bg-amber-900/20 border-amber-700 text-amber-200'
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}
                    >
                      <div className="font-semibold mb-1">{hintTitle}</div>
                      <div>{hintText}</div>
                      {hasNumeric && marginRatio != null && (
                        <div className={`mt-1 text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          当前能量比（左侧/右侧）≈ {marginRatio.toFixed(3)}
                        </div>
                      )}
                    </div>
                  </>
                )
              })()}

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
                    if (formula.id === 'slurry_friction_workflow') {
                      setFormulaParameters((prev) => {
                        const n = { ...prev }
                        delete n.density_mixing
                        delete n.darcy_friction
                        delete n.slurry_friction_loss
                        return n
                      })
                      setFormulaRawInputs((prev) => {
                        const n = { ...prev }
                        delete n.density_mixing
                        delete n.darcy_friction
                        delete n.slurry_friction_loss
                        return n
                      })
                      setFormulaResults((prev) => {
                        const n = { ...prev }
                        for (const id of SLURRY_FRICTION_CHAIN_IDS) {
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
                    if (formula.id === 'centrifugal_pump_total_head') {
                      setCentrifugalStep1SnapshotByFormula((prev) => {
                        const n = { ...prev }
                        delete n[formula.id]
                        return n
                      })
                      setCentrifugalStep2SnapshotByFormula((prev) => {
                        const n = { ...prev }
                        delete n[formula.id]
                        return n
                      })
                    }
                    if (formula.id === 'positive_displacement_pump_outlet_pressure') {
                      setPositiveDisplacementStep1SnapshotByFormula((prev) => {
                        const n = { ...prev }
                        delete n[formula.id]
                        return n
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
                    if (formula?.id === 'centrifugal_pump_total_head') {
                      void handleCentrifugalPumpStepCalculate(3)
                      return
                    }
                    if (formula?.id === 'positive_displacement_pump_outlet_pressure') {
                      void handlePositiveDisplacementStepCalculate(2)
                      return
                    }
                    handleCalculate(false)
                  }}
                  disabled={
                    loading
                    || (formula?.id === 'slurry_dissipation_orifice' && validateOrificeSubStep(3) !== null)
                    || (formula?.id === 'kronodze_pressure' && !kronodzeStep2Ready)
                    || (isSlurryDissipationFormula && dissipationStep2ValidateMsg !== null)
                    || (formula?.id === 'centrifugal_pump_total_head' && centrifugalStep3ValidateMsg !== null)
                    || (formula?.id === 'positive_displacement_pump_outlet_pressure' &&
                      positiveDisplacementStep2ValidateMsg !== null)
                  }
                  title={
                    formula?.id === 'slurry_dissipation_orifice'
                      ? validateOrificeSubStep(3) || '计算第 3 步消能水头 Δh（需填写 K_Qk 与 Q）'
                      : isSlurryDissipationFormula
                        ? dissipationStep2ValidateMsg || '填写 Q 与系数后点击开始计算'
                        : formula?.id === 'centrifugal_pump_total_head'
                          ? centrifugalStep3ValidateMsg || '按当前参数计算步骤3：泵所需电机功率 N'
                          : formula?.id === 'positive_displacement_pump_outlet_pressure'
                            ? positiveDisplacementStep2ValidateMsg || '按当前参数计算泵所需电机功率 N'
                          : lockedVc !== null
                            ? '已锁定临界流速：支持自动重算，也可点击手动重算'
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
                  disabled={
                    !result?.success ||
                    exporting ||
                    (formula?.id === 'centrifugal_pump_total_head' &&
                      (result.result?.H_total == null || isNaN(Number(result.result.H_total))))
                  }
                  title={
                    !result?.success
                      ? '请先成功完成计算后再导出'
                      : formula?.id === 'centrifugal_pump_total_head' &&
                          (result.result?.H_total == null || isNaN(Number(result.result.H_total)))
                        ? '请先完成步骤2（总扬程 H_b）后再导出'
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
