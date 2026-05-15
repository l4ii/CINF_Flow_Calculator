import { useState, useEffect, useRef, useMemo, useCallback, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import type { FormulaInfo, CalculationResult, Parameter } from '../types';
import axios from 'axios';
import { API_BASE_URL, API_TIMEOUT } from '../config/api';
import { BlockMath, InlineMath } from 'react-katex';
import { FormulaFrame, ParameterFrame, InputWithTrailingUnit, UnitBadge } from './calculationUiPrimitives.tsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  downloadScientificHlChartPng,
  formatHydraulicHeadTick,
  formatHydraulicLengthTick,
} from '../utils/chartExportCanvas'
import { formatUpdateError } from '../utils/formatUpdateError'
import { stripHtmlToPlain } from '../utils/stripHtmlToPlain'
import { classifyLockedVcAnimation } from '../utils/criticalVelocityAnimation'
import {
  APP_EXPORT_FILENAME_PREFIX,
  APP_NAME_EN,
  APP_NAME_ZH,
  APP_TITLE_MAIN_EN,
  APP_TITLE_MAIN_ZH,
  APP_ORG_NAME_EN,
  APP_TAGLINE_MAIN_EN,
  APP_TAGLINE_ZH,
  APP_VERSION,
} from '../constants/appCopy';
import { buildFormulaDescriptionSnippet, useAssistantSnapshotOptional } from '../context/AssistantContext';

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
  // 侧栏/API 偶发附带「由浆体重量浓度…换算」说明：主参数标题只保留体积浓度本身
  desc = desc.replace(/；由浆体重量浓度[^；）]*/g, '')
  desc = desc.replace(/（由浆体重量浓度[^）]*）/g, '')
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
  rho_g: '2500',
  rho_s: '1000',
  rho_k: '1200',
  rho_w: '1000',
  rho_1: '1380',
  eta_1: '0.001',
  eta_j: '0.97',
  eta_b: '0.8',
  eta_v: '0.92',
  eta_c: '0.9',
  lambda_coef: '0.02',
  epsilon: '0.053',
  i_k: '0.02',
  i_w: '0.01',
  C_w: '0.35',
  C1v: '0.15',
  Cv: '0.3',
  Q_k: '0.15',
  W: '42000',
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
  if (unit.includes('kg/m³') || unit.toLowerCase().includes('kg/m3')) return '1200'
  if (unit.includes('pa')) return '0.001'
  if (unit === 'm³/h' || unit.toLowerCase() === 'm3/h') return '350'
  if (unit === 'kg/h') return '42000'
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
const CV_VOLUME_ASSIST_HINT = '点击输入框展开「体积浓度——辅助计算」'

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
  rho_k: '浆体密度，如1470',
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
  rho_k: '浆体密度，如1470',
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
    name: 'rho_1' as const,
    label: '$\\rho_1$：混合物密度（可选，与下方三栏二选一）',
    unit: 'kg/m³',
    placeholder: '可选；直填 ρ₁ 时，下方 ρ_g、ρ_k、C_{1V} 可留空',
  },
  {
    name: 'rho_g' as const,
    label: '$\\rho_g$：固体密度',
    unit: 'kg/m³',
    placeholder: '固体密度，如2650',
  },
  {
    name: 'rho_k' as const,
    label: '$\\rho_k$：浆体密度（步骤1结果，勿填清水密度）',
    unit: 'kg/m³',
    placeholder: '步骤1「浆体密度」ρ_k，如1470',
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
    name: 'V' as const,
    label: '$V$：断面平均流速',
    unit: 'm/s',
    placeholder: '未直填 Re_B 时必填，如2',
  },
  {
    name: 'D_n' as const,
    label: '$D_n$：管道内径',
    unit: 'm',
    placeholder: '未直填 Re_B 时必填，如0.2',
  },
  {
    name: 'rho_1' as const,
    label: '$\\rho_1$：混合物密度',
    unit: 'kg/m³',
    placeholder: '混合物密度，如1380',
  },
  {
    name: 'eta_1' as const,
    label: '$\\eta$：刚度系数（Pa·s）',
    unit: 'Pa·s',
    placeholder: '未直填 Re_B 时必填，如0.001',
  },
  {
    name: 'Re_B' as const,
    label: '$Re_B$：雷诺数（可选）',
    unit: '无量纲',
    placeholder: '已知 Re_B 时可直填；填写后本步可不填 V、D_n、ρ₁、η',
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
    label: '$\\varepsilon$：管壁绝对粗糙度',
    unit: 'mm',
    placeholder: '如 0.053（直缝新钢管常见量级）',
  },
]

/** 浆体摩阻工作流：各步骤参数的标签、单位后缀；提示写在输入框 placeholder 内 */
const SLURRY_FRICTION_WF_STEP1_FIELDS = [
  {
    name: 'C_w' as const,
    label: '$C_w$：浆体混合液的含水率（水相体积分数）',
    unit: '无量纲',
    placeholder: '浆体混合液含水率，取值范围 0～1',
  },
  {
    name: 'rho_g' as const,
    label: '$\\rho_g$：固体密度',
    unit: 'kg/m³',
    placeholder: '固体密度，如2650',
  },
  {
    name: 'rho_s' as const,
    label: '$\\rho_s$：清水密度',
    unit: 'kg/m³',
    placeholder: '清水密度，常用1000',
  },
]

const SLURRY_FRICTION_WF_STEP3_FIELDS = [
  {
    name: 'rho_k' as const,
    label: '$\\rho_k$：浆体密度',
    unit: 'kg/m³',
    placeholder: '浆体密度，如1470',
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
    unit: 'kg/m³',
    placeholder: '水密度，常用1000',
  },
  {
    name: 'g' as const,
    label: '$g$：重力加速度',
    unit: 'm/s²',
    placeholder: '重力加速度，默认值 9.81',
  },
]

/** 浆体摩阻损失步骤 3 / 流态判别步骤 2：与用户提供的「达西 λ」版说明一致（非刘德忠–Fanning 语境） */
const SLURRY_PIPELINE_REYNOLDS_STEP_INTRO_ZH =
  '本步骤用于计算浆体管道摩阻损失中的雷诺数 $Re_B$。雷诺数综合反映浆体流速 $V$、管道内径 $D_n$、混合物密度 $\\rho_1$ 及刚度系数 $\\eta$ 对流动状态的影响，是判断管内流态及计算摩阻系数的基础参数。计算得到的 $Re_B$ 将用于后续达西摩阻系数 $\\lambda$ 的计算，从而进一步求取浆体管道摩阻损失。'

const SLURRY_FRICTION_WF_STEP_INTROS: Record<
  'step1' | 'darcy_rho1' | 'darcy_re' | 'darcy_lambda' | 'step5_ik',
  string
> = {
  step1:
    '依据浆体质量浓度 $C_w$ 与固体密度 $\\rho_g$、清水密度 $\\rho_s$，按质量加权关系求浆体密度 $\\rho_k$（kg/m³）。若浆体密度（$\\rho_k$）已由设计或试验给定，可跳过本步并在「摩阻损失计算」→「浆体摩阻损失」→「5.水力坡降（$i_k$）」中直接输入。',
  darcy_rho1:
    '可先直填混合物密度 $\\rho_1$（与本节首栏「可选」一致）；否则依据固体密度 $\\rho_g$、步骤1求得的浆体密度 $\\rho_k$（勿与步骤1输入栏的清水密度 $\\rho_s$ 混淆）与 $C_{1V}$，按 $\\rho_1 = \\rho_g C_{1V} + (1-C_{1V})\\rho_k$ 计算（kg/m³）。结果写入后续「计算雷诺数」所用参数；若 $\\rho_1$ 已知，也可跳过本步并在「3 计算雷诺数」中直接填写。',
  darcy_re:
    `${SLURRY_PIPELINE_REYNOLDS_STEP_INTRO_ZH}若雷诺数 $Re_B$ 已由设计或试验给定，可跳过本步并在「摩阻损失计算」→「浆体摩阻损失」→「4.达西摩阻系数（$\\lambda$）」中直接输入。`,
  darcy_lambda:
    '达西摩阻系数（$\\lambda$）是描述管道内流体流动时阻力特性的无量纲参数，是计算浆体管道摩阻损失（水力坡降）的核心依据。其计算采用科尔布鲁克-怀特（Colebrook-White）公式的近似形式。若达西摩阻系数（$\\lambda$）已由设计或试验给定，可跳过本步并在「摩阻损失计算」→「浆体摩阻损失」→「5.水力坡降（$i_k$）」中直接输入。',
  step5_ik:
    '水力坡降 $i_k$ 计算采用达西-魏斯巴赫公式的多相流扩展形式，通过在经典公式中引入浆体密度与液体介质密度的比值，校正固体颗粒引起的附加能量损失，从而准确表征浆体管道单位管长的水头损失。计算所需的参数若已在前序步骤得出，系统会在当前栏位为空时自动带入，用户也可直接输入已知设计值。',
}
const SLURRY_FRICTION_WF_OVERVIEW_PARAGRAPHS = [
  '本模块通过引入当量密度（$\\rho_k$）的概念，将达西-魏斯巴赫公式扩展应用于气-固-液多相流的摩阻损失计算。公式$i_k$在经典形式的基础上，乘以密度比（$\\frac{\\rho_k}{\\rho_s}$），以校正由于固体颗粒存在导致的附加能量损失。计算结果$i_k$可直接用于计算给定管长$L$下的总沿程水头损失：$h_f = i_k \\cdot L$。本方法适用于固体浓度适中、颗粒均匀悬浮的浆体或气力输送系统。当固体浓度极高或流动状态异常时，需结合经验系数进行修正。',
  '计算步骤：本模块按五个步骤顺序计算 ① 浆体密度 $\\rho_k$；② 混合物密度 $\\rho_1$；③ 计算雷诺数；④ 达西摩阻系数 $\\lambda$；⑤ 单位管长水力坡降 $i_k$。各步可单独执行；',
]

type PseudoHomogeneousFlowRow = {
  d: string
  delta_P: string
  omega: string
}

/** 单档「式 4-8→4-4」链路中间量（与克诺罗兹分步类似，向下游步骤传递） */
type PseudoCcaChainSnapshot = {
  rho_l?: number
  Re_B?: number
  f_L?: number
  U?: number
  c_over_ca_i?: number
}

/** 若 ρ₁、Re_B、f_L、U 已有测定值，可手填跳过前几步计算 */
type PseudoCcaKnownOverrideFields = {
  rho_l?: string
  Re_B?: string
  /** 步骤 3 手改管径时与主参数 D 同步；为空则用步骤 2 / 主表管径 */
  D_n?: string
  f_L?: string
  U?: string
  /** 步骤 5：修正卡门常数；空则先用页顶 $K$，再用 0.36 */
  K_karman?: string
  /** 步骤 5：伊斯梅尔系数；空则先用页顶 $\\beta$，再用 1 */
  beta_ismail?: string
}

const PSEUDO_HOMOGENEOUS_FLOW_TEMPLATE_ROWS: PseudoHomogeneousFlowRow[] = [
  /** 无粒径表 UI 时保留单行代表档，供 particle_fractions、斯托克斯 ω 与汇总插值链使用 */
  { d: '2e-4', delta_P: '1', omega: '' },
]

function inferredSlurryPipelineFlowRegime(
  r: CalculationResult['result'] | undefined
): 'pseudo_homogeneous' | 'heterogeneous' | 'composite' | null {
  if (!r) return null
  const fr = r.flow_regime
  if (fr === 'pseudo_homogeneous' || fr === 'heterogeneous' || fr === 'composite') return fr
  const c = r.C_over_CA
  const d = r.C_CA_d95
  if (c == null || d == null || isNaN(Number(c)) || isNaN(Number(d))) return null
  const cn = Number(c)
  const dn = Number(d)
  if (cn <= 0.1) return 'heterogeneous'
  if (cn >= 0.8 && dn >= 0.5) return 'pseudo_homogeneous'
  return 'composite'
}

function normalizeCsvDecimalInput(raw: string): string {
  return raw.replace(/，/g, ',').replace(/,/g, '.').trim()
}

function parsePseudoCcaOptionalNumber(raw: string | undefined): number | undefined {
  if (raw == null || String(raw).trim() === '') return undefined
  const x = parseFloat(normalizeCsvDecimalInput(String(raw)))
  return Number.isFinite(x) ? x : undefined
}

function parsePseudoFlowFractionsFromRows(rows: PseudoHomogeneousFlowRow[]): {
  error: string | null
  fractions: Array<{ d: number; delta_P: number; omega?: number }>
} {
  const fractions: Array<{ d: number; delta_P: number; omega?: number }> = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const ds = normalizeCsvDecimalInput(r.d)
    const dps = normalizeCsvDecimalInput(r.delta_P)
    const oms = normalizeCsvDecimalInput(r.omega)
    if (ds === '' && dps === '' && oms === '') continue
    const d = parseFloat(ds)
    const dp = parseFloat(dps)
    if (!Number.isFinite(d) || d <= 0) {
      return { error: `内置粒径档第 ${i + 1} 行：粒径 d（m）须为正数`, fractions: [] }
    }
    if (!Number.isFinite(dp) || dp <= 0) {
      return { error: `内置粒径档第 ${i + 1} 行：质量权重 ΔP（小数）须为正数`, fractions: [] }
    }
    const row: { d: number; delta_P: number; omega?: number } = { d, delta_P: dp }
    if (oms === '') {
      return {
        error: `内置粒径档第 ${i + 1} 行：须填写 $W_i$似均质中加权平均沉速辅助计算结果`,
        fractions: [],
      }
    }
    const w = parseFloat(oms)
    if (!Number.isFinite(w) || w < 0) {
      return { error: `内置粒径档第 ${i + 1} 行：$W_i$（m/s）须为非负实数`, fractions: [] }
    }
    row.omega = w
    fractions.push(row)
  }
  if (fractions.length === 0) {
    return { error: '内置粒径档数据无效：请刷新页面或重新进入本公式', fractions: [] }
  }
  return { error: null, fractions }
}

/** 由分步链路各档 $(C/C_A)_i$ 构造「开始计算」汇总请求（与 pseudo_homogeneous_summarize_ratios 一致） */
function buildPseudoSummarizeFractionsFromChain(
  rows: PseudoHomogeneousFlowRow[],
  cmap: Record<number, PseudoCcaChainSnapshot>
): {
  error: string | null
  fractions: Array<{ d: number; delta_P: number; c_over_ca_i: number }> | null
} {
  const fr: Array<{ d: number; delta_P: number; c_over_ca_i: number }> = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const ds = normalizeCsvDecimalInput(r.d)
    const dps = normalizeCsvDecimalInput(r.delta_P)
    const oms = normalizeCsvDecimalInput(r.omega)
    if (ds === '' && dps === '' && oms === '') continue
    const dm = parseFloat(ds)
    const dp = parseFloat(dps)
    if (!Number.isFinite(dm) || dm <= 0 || !Number.isFinite(dp) || dp <= 0) {
      return {
        error: `请先完成第 ${i + 1} 档的粒径 d（m）与级配权重 ΔP（须为正数）`,
        fractions: null,
      }
    }
    const cci = cmap[i]?.c_over_ca_i
    if (cci == null || !Number.isFinite(cci)) {
      return {
        error: `请先对第 ${i + 1} 档完成步骤 5（计算相对体积浓度），求得 $(C/C_A)_i$ 后再点击「开始计算」`,
        fractions: null,
      }
    }
    fr.push({ d: dm, delta_P: dp, c_over_ca_i: cci })
  }
  if (fr.length === 0) {
    return {
      error: '请先配置粒径档并完成步骤 5，再点击右下角「开始计算」进行流态判断。',
      fractions: null,
    }
  }
  return { error: null, fractions: fr }
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

const SLURRY_EPSILON_PRESET_VALUES: Record<string, number> = {
  // 键名沿用历史会话；直缝新钢管常用绝对粗糙度（mm）
  new_steel_pipe_053: 0.053,
  new_steel_pipe_055: 0.055,
}

type SlurryEpsilonPresetKey = 'new_steel_pipe_053' | 'new_steel_pipe_055' | 'custom'
const DEFAULT_SLURRY_EPSILON_PRESET: SlurryEpsilonPresetKey = 'new_steel_pipe_053'
const DEFAULT_SLURRY_EPSILON = SLURRY_EPSILON_PRESET_VALUES[DEFAULT_SLURRY_EPSILON_PRESET]

function normalizeSlurryEpsilonPresetKey(raw: string | undefined): SlurryEpsilonPresetKey {
  if (raw === 'new_steel_pipe_053' || raw === 'new_steel_pipe_055' || raw === 'custom') return raw
  return DEFAULT_SLURRY_EPSILON_PRESET
}

/** 与浆体摩阻「达西 λ」第 4 步同一 Colebrook 显式式（费祥俊辅助面板主公式） */
const DARCY_FRICTION_EXPLICIT_LAMBDA_BLOCK_MATH =
  '\\lambda = \\frac{1.33036}{\\left[\\ln\\left(\\frac{\\varepsilon}{3.7 D_n} + \\frac{5.7385}{Re_B^{0.9}}\\right)\\right]^2}'

const SLURRY_EPSILON_MENU_ROWS: { key: SlurryEpsilonPresetKey; prose: string; math: string }[] = [
  { key: 'new_steel_pipe_053', prose: '直缝新钢管', math: '\\varepsilon = 0.0508\\ \\mathrm{mm}' },
  { key: 'new_steel_pipe_055', prose: '直缝新钢管', math: '\\varepsilon = 0.0540\\ \\mathrm{mm}' },
  { key: 'custom', prose: '用户可自定义输入', math: '\\varepsilon' },
]

/** 费祥俊辅助面板：粗糙度 mm（首选数值框；可选用下拉典型值） */
function parseFeiAuxEpsilonMm(
  preset: SlurryEpsilonPresetKey,
  customStr: string
): number | null {
  const norm = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
  const parsed = parseFloat(norm(customStr))
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  if (preset !== 'custom') {
    const v = SLURRY_EPSILON_PRESET_VALUES[preset]
    if (Number.isFinite(v) && v > 0) return v
  }
  return null
}

/** 达西 λ 辅助：雷诺数分界与浆体摩阻步骤 4 一致 */
function darcyAuxFlowRegimeLabel(language: 'zh' | 'en', Re_B: number): string {
  if (!Number.isFinite(Re_B)) return ''
  if (language === 'en') return Re_B < 2000 ? 'laminar' : 'turbulent'
  return Re_B < 2000 ? '层流' : '湍流'
}

/** 费祥俊公式主界面：中间量展示顺序（是否存在 fei_Re_flow 由后端决定是否迭代） */
const FEI_XIANGJUN_INTERMEDIATE_ORDER = [
  'fei_Re_flow',
  'lambda_coef',
  'fei_lambda_rel_residual',
  'delta_rho_ratio',
  'bracket_term',
  'conc_term',
  'size_term',
  'leading_coef',
] as const

function sortFeiXiangjunIntermediateEntries(entries: [string, unknown][]): [string, unknown][] {
  const map = new Map(entries)
  const out: [string, unknown][] = []
  for (const k of FEI_XIANGJUN_INTERMEDIATE_ORDER) {
    if (map.has(k)) out.push([k, map.get(k)!])
  }
  return out
}

const FEI_LAMBDA_ITER_MAX_STEPS = 80
const FEI_LAMBDA_ITER_TOL_REL = 1e-6

/** 与 calculation_engine._darcy_lambda_from_re 一致（费祥俊 λ 辅助预览）；epsilon 为管壁绝对粗糙度（m，SI） */
function darcyLambdaFromRePreview(Re_B: number, epsilon: number, D_n: number): number {
  if (Re_B < 2000) return 64 / Re_B
  const eps_term = epsilon ? epsilon / (3.7 * D_n) : 1e-10
  const re_term = 5.7385 / Re_B ** 0.9
  const inner = eps_term + re_term
  if (inner <= 0) return NaN
  return 1.33036 / Math.log(inner) ** 2
}

/** 费祥俊 λ 辅助：用 V=Vc 与达西显式式做不动点迭代，与 backend._calculate_fei_xiangjun_iterative 一致 */
function computeFeiDarcyAssistPreview(args: {
  language: 'zh' | 'en'
  D: number | undefined
  rho_g: number | undefined
  rho_k: number | undefined
  Cv: number | undefined
  d90: number | undefined
  g: number | undefined
  coefficient_2_26: number | undefined
  feiLambdaAuxEta1: string
  feiLambdaAuxEpsilonPreset: SlurryEpsilonPresetKey
  feiLambdaAuxEpsilonCustom: string
  lambdaSeed: number | undefined
}): {
  Re_B: number | null
  flowRegime: string | null
  lambda: number | null
  relResidual: number | null
} {
  const norm = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
  const eta1 = parseFloat(norm(args.feiLambdaAuxEta1))
  const epsMm = parseFeiAuxEpsilonMm(args.feiLambdaAuxEpsilonPreset, args.feiLambdaAuxEpsilonCustom)
  const eps = epsMm != null && epsMm > 0 ? epsMm : NaN

  const r6 = (x: number) => Math.round(x * 1e6) / 1e6

  const rho_g = args.rho_g
  const rho_k = args.rho_k
  const Cv = args.Cv
  let rho_1: number | null = null
  if (
    rho_g != null &&
    !isNaN(rho_g) &&
    rho_k != null &&
    !isNaN(rho_k) &&
    rho_k > 0 &&
    Cv != null &&
    !isNaN(Cv) &&
    Cv >= 0 &&
    Cv <= 1
  ) {
    if (Math.abs(Cv - 1) < 1e-15) {
      rho_1 = r6(rho_k)
    } else {
      const denom = 1 - Cv
      const rho_s_derived = Math.abs(denom) > 1e-12 ? (rho_k - rho_g * Cv) / denom : NaN
      if (Number.isFinite(rho_s_derived) && rho_s_derived > 0) {
        rho_1 = r6(rho_g * Cv + (1 - Cv) * rho_s_derived)
      }
    }
  }

  const D = args.D
  const d90 = args.d90
  const g = args.g ?? 9.81
  const c226 = args.coefficient_2_26 ?? 2.26

  if (
    rho_1 == null ||
    D == null ||
    isNaN(D) ||
    D <= 0 ||
    d90 == null ||
    isNaN(d90) ||
    d90 < 0 ||
    rho_g == null ||
    isNaN(rho_g) ||
    rho_k == null ||
    isNaN(rho_k) ||
    Cv == null ||
    isNaN(Cv)
  ) {
    return { Re_B: null, flowRegime: null, lambda: null, relResidual: null }
  }

  if (!Number.isFinite(eta1) || eta1 <= 0 || !Number.isFinite(eps) || eps <= 0) {
    return { Re_B: null, flowRegime: null, lambda: null, relResidual: null }
  }

  if (rho_g < rho_k) {
    return { Re_B: null, flowRegime: null, lambda: null, relResidual: null }
  }

  let lambda_k =
    args.lambdaSeed != null && !isNaN(args.lambdaSeed) && args.lambdaSeed > 0 ? args.lambdaSeed : 0.02

  const delta_rho_ratio = (rho_g - rho_k) / rho_k
  const bracket_value = g * D * delta_rho_ratio
  if (bracket_value < 0) {
    return { Re_B: null, flowRegime: null, lambda: null, relResidual: null }
  }
  const bracket_term = Math.sqrt(bracket_value)
  const conc_term = Cv ** 0.25
  const size_term = (d90 / D) ** (1 / 3)

  const vcFromLambda = (lam: number) => {
    const leading = c226 / Math.sqrt(lam)
    return leading * bracket_term * conc_term * size_term
  }

  const maxIter = FEI_LAMBDA_ITER_MAX_STEPS
  const tolRel = FEI_LAMBDA_ITER_TOL_REL
  let lastRel = 0
  let Re_B: number | null = null

  let converged = false
  for (let k = 0; k < maxIter; k++) {
    const lambda_old = lambda_k
    const Vc = vcFromLambda(lambda_old)
    if (!Number.isFinite(Vc) || Vc <= 0) {
      return { Re_B: null, flowRegime: null, lambda: null, relResidual: null }
    }
    const re = (Vc * D * rho_1) / eta1
    if (!Number.isFinite(re) || re <= 0) {
      return { Re_B: null, flowRegime: null, lambda: null, relResidual: null }
    }
    const lamNew = darcyLambdaFromRePreview(re, eps / 1000, D)
    if (!Number.isFinite(lamNew) || lamNew <= 0) {
      return { Re_B: null, flowRegime: null, lambda: null, relResidual: null }
    }
    lastRel = Math.abs(lamNew - lambda_old) / Math.max(lambda_old, 1e-12)
    lambda_k = lamNew
    Re_B = r6(re)
    if (lastRel < tolRel) {
      converged = true
      break
    }
  }

  if (!converged || Re_B == null || !Number.isFinite(Re_B)) {
    return { Re_B: null, flowRegime: null, lambda: null, relResidual: null }
  }

  return {
    Re_B,
    flowRegime: darcyAuxFlowRegimeLabel(args.language, Re_B),
    lambda: r6(lambda_k),
    relResidual: Math.round(lastRel * 1e12) / 1e12,
  }
}

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
  const listCls = `absolute z-[200] mt-1 w-full max-h-72 overflow-auto rounded-lg border shadow-lg ${
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

/** 管壁绝对粗糙度：典型值下拉与手填 mm 同高、同外框（费祥俊 λ 辅助、浆体摩阻步骤4） */
function SlurryEpsilonCombinedRow({
  darkMode,
  language = 'zh',
  presetKey,
  valueMm,
  onChange,
  onBlur,
  rowAriaLabel,
}: {
  darkMode: boolean
  language?: 'zh' | 'en'
  presetKey: SlurryEpsilonPresetKey
  valueMm: string
  onChange: (preset: SlurryEpsilonPresetKey, valueMm: string) => void
  onBlur?: () => void
  /** 整行控件的无障碍名称 */
  rowAriaLabel?: string
}) {
  const shellBorder = darkMode ? 'border-gray-500' : 'border-gray-300'
  const shellBg = darkMode ? 'bg-gray-700/80' : 'bg-gray-50'
  const selectCls = `shrink-0 max-w-[min(55%,13.5rem)] cursor-pointer border-0 border-r py-2 pl-2 pr-1 text-sm shadow-none focus:outline-none focus:ring-0 ${
    darkMode ? 'border-gray-500 bg-transparent text-gray-100' : 'border-gray-300 bg-transparent text-gray-900'
  }`
  const inputCls = `min-w-0 flex-1 border-0 bg-transparent px-2 py-2 text-sm focus:outline-none focus:ring-0 ${
    darkMode ? 'text-gray-100 placeholder-gray-400' : 'text-gray-900 placeholder-gray-500'
  }`
  const presetRows = SLURRY_EPSILON_MENU_ROWS.filter((r) => r.key !== 'custom')
  return (
    <div
      className={`flex min-h-[2.5rem] items-stretch overflow-hidden rounded-lg border ${shellBorder} ${shellBg}`}
      aria-label={rowAriaLabel}
    >
      <select
        className={selectCls}
        value={presetKey}
        onChange={(e) => {
          const k = e.target.value as SlurryEpsilonPresetKey
          if (k === 'custom') {
            onChange('custom', valueMm)
          } else {
            const n = SLURRY_EPSILON_PRESET_VALUES[k]
            onChange(k, String(n))
          }
        }}
      >
        {presetRows.map((row) => {
          const mm = SLURRY_EPSILON_PRESET_VALUES[row.key]
          return (
            <option key={row.key} value={row.key}>
              {language === 'en' ? `${row.prose} (${mm} mm)` : `${row.prose} ${mm} mm`}
            </option>
          )
        })}
        <option value="custom">{language === 'en' ? 'Custom (type mm)' : '自定义'}</option>
      </select>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={valueMm}
        onChange={(e) => onChange('custom', e.target.value)}
        onBlur={onBlur}
        placeholder={language === 'en' ? 'mm' : 'mm'}
        className={inputCls}
        aria-label={language === 'en' ? 'Wall roughness ε (mm)' : '管壁绝对粗糙度 ε（mm）'}
      />
      <UnitBadge darkMode={darkMode}>mm</UnitBadge>
    </div>
  )
}

/** 锁定 Vc 对比动画状态文案（小图 / 全屏一致，中英） */
function criticalVelocityAnimStatusLabel(animationType: string, language: 'zh' | 'en'): string {
  if (language === 'en') {
    switch (animationType) {
      case 'settle-30':
        return 'Severe settling'
      case 'settle-20':
        return 'Moderate settling'
      case 'settle-10-flow':
        return 'Mild settling'
      case 'still-flow':
        return 'Critical flow'
      case 'medium-flow':
        return 'Normal flow'
      default:
        return 'Fast flow'
    }
  }
  switch (animationType) {
    case 'settle-30':
      return '严重沉降'
    case 'settle-20':
      return '中度沉降'
    case 'settle-10-flow':
      return '轻度沉降'
    case 'still-flow':
      return '临界状态'
    case 'medium-flow':
      return '正常流动'
    default:
      return '快速流动'
  }
}

/** 锁定对比卡片标题：沉降加 ⚠️，良好流动加 ✅，临界无前缀 */
function criticalVelocityComparisonBadgeText(animationType: string, language: 'zh' | 'en'): string {
  const label = criticalVelocityAnimStatusLabel(animationType, language)
  if (animationType === 'settle-30' || animationType === 'settle-20' || animationType === 'settle-10-flow') {
    return `⚠️ ${label}`
  }
  if (animationType === 'medium-flow' || animationType === 'fast-flow') {
    return `✅ ${label}`
  }
  return label
}

function criticalVelocityLockedCompareExplanation(
  animationType: string,
  newVc: number,
  velocityRatio: number,
  language: 'zh' | 'en'
): string {
  const pct = (velocityRatio * 100).toFixed(1)
  if (language === 'en') {
    if (animationType === 'settle-30') {
      return `Current critical velocity (${newVc} m/s) is ${pct}% of the locked value — severe settling risk.`
    }
    if (animationType === 'settle-20') {
      return `Current critical velocity (${newVc} m/s) is ${pct}% of the locked value — moderate settling risk.`
    }
    if (animationType === 'settle-10-flow') {
      return `Current critical velocity (${newVc} m/s) is ${pct}% of the locked value — mild settling risk.`
    }
    if (animationType === 'still-flow') {
      return `Current critical velocity (${newVc} m/s) is ${pct}% of the locked value — at critical condition; keep velocity stable.`
    }
    if (animationType === 'medium-flow') {
      return `Current critical velocity (${newVc} m/s) is ${pct}% of the locked value — normal flow, acceptable.`
    }
    return `Current critical velocity (${newVc} m/s) is ${pct}% of the locked value — fast flow, acceptable.`
  }
  if (animationType === 'settle-30') {
    return `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${pct}%，严重沉降风险`
  }
  if (animationType === 'settle-20') {
    return `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${pct}%，中度沉降风险`
  }
  if (animationType === 'settle-10-flow') {
    return `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${pct}%，轻度沉降风险`
  }
  if (animationType === 'still-flow') {
    return `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${pct}%，临界状态，需要保持稳定流速`
  }
  if (animationType === 'medium-flow') {
    return `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${pct}%，正常流动，安全`
  }
  return `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${pct}%，快速流动，安全`
}

/** 临界流速：$C_V$ 辅助计算（默认 C/C_A；刘德忠页为浆体重量浓度 C_W 换算） */
function CvVolumeConcentrationField({
  darkMode,
  inputValue,
  onInputChange,
  onInputBlur,
  placeholder,
  unitText,
  onApplyCvFromRatio,
  assistKind = 'solid_volume_ratio',
  rhoGKgM3FromForm,
}: {
  darkMode: boolean
  inputValue: string
  onInputChange: (value: string) => void
  onInputBlur: () => void
  placeholder: string
  /** 主栏单位徽章文本；无量纲 decimal 等传 null */
  unitText?: string | null
  onApplyCvFromRatio: (cvDecimalString: string) => void
  /** solid_volume_ratio：C/C_A（体积比）；slurry_mass_fraction：刘德忠 C_W 与 ρ_s、ρ_g 换算 */
  assistKind?: 'solid_volume_ratio' | 'slurry_mass_fraction'
  /** 与同页主表固体密度 ρ_g（kg/m³）一致，仅 slurry_mass_fraction 使用 */
  rhoGKgM3FromForm?: number
}) {
  const [open, setOpen] = useState(false)
  const [cStr, setCStr] = useState('')
  const [caStr, setCaStr] = useState('')
  const [cwStr, setCwStr] = useState('')
  const [rhoSStr, setRhoSStr] = useState('1000')
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
  const isMassAssist = assistKind === 'slurry_mass_fraction'
  const c = parseFloat(norm(cStr))
  const ca = parseFloat(norm(caStr))
  const ratioOk = Number.isFinite(c) && Number.isFinite(ca) && Math.abs(ca) > 1e-15
  const cvRaw = ratioOk ? c / ca : NaN
  const cvRounded = Number.isFinite(cvRaw) ? Math.round(cvRaw * 1e6) / 1e6 : NaN

  const cw = parseFloat(norm(cwStr))
  const rho_s_aux = parseFloat(norm(rhoSStr))
  const rhoGForm = rhoGKgM3FromForm
  const rhoGOk = rhoGForm != null && !isNaN(rhoGForm) && rhoGForm > 0
  const denomMass =
    rhoGOk && Number.isFinite(cw) && Number.isFinite(rho_s_aux)
      ? rhoGForm - rhoGForm * cw + rho_s_aux * cw
      : NaN
  const cvRawMass =
    Number.isFinite(denomMass) && Math.abs(denomMass) > 1e-12 && Number.isFinite(cw) && Number.isFinite(rho_s_aux)
      ? (cw * rho_s_aux) / denomMass
      : NaN
  const cvRoundedMass = Number.isFinite(cvRawMass) ? Math.round(cvRawMass * 1e6) / 1e6 : NaN
  const massFracOk =
    rhoGOk &&
    Number.isFinite(cw) &&
    cw >= 0 &&
    cw <= 1 &&
    Number.isFinite(rho_s_aux) &&
    rho_s_aux > 0 &&
    Number.isFinite(denomMass) &&
    Math.abs(denomMass) > 1e-12

  const cvPreview = isMassAssist ? cvRoundedMass : cvRounded
  const canCompute = isMassAssist ? massFracOk : ratioOk
  const outOfUnitRange = Number.isFinite(cvPreview) && (cvPreview < 0 || cvPreview > 1)

  const [cvCommitted, setCvCommitted] = useState<number | null>(null)
  const [cvCalcBarPct, setCvCalcBarPct] = useState(0)
  const [cvCalcBusy, setCvCalcBusy] = useState(false)

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
  const panelCls = `absolute left-0 right-0 z-50 mt-1.5 rounded-xl border shadow-lg ${
    isMassAssist
      ? `max-h-[min(70vh,32rem)] overflow-y-auto overflow-x-hidden ${
          darkMode ? 'border-gray-500 bg-gray-800 text-gray-100' : 'border-gray-200 bg-white text-gray-900'
        }`
      : `overflow-hidden ${darkMode ? 'border-gray-500 bg-gray-800 text-gray-100' : 'border-gray-200 bg-white text-gray-900'}`
  }`
  const panelInnerCls = darkMode ? 'border-gray-600' : 'border-gray-100'
  const assistFieldInputCls = 'text-sm py-2 rounded-none'
  const hintMuted = darkMode ? 'text-gray-400' : 'text-gray-600'
  const hintStrong = darkMode ? 'text-gray-200' : 'text-gray-800'

  return (
    <div className="relative min-w-0 flex-1" ref={wrapRef}>
      <div
        className={`flex min-w-0 items-stretch overflow-hidden rounded-lg border focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent ${shellBorder} ${shellBg} ${shellFocus}`}
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
        {unitText != null && String(unitText).trim() !== '' ? (
          <UnitBadge darkMode={darkMode}>{unitText}</UnitBadge>
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          className={chevronBtnCls}
          aria-label={open ? '收起体积浓度——辅助计算' : '展开体积浓度——辅助计算'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`inline-block text-xs transition-transform ${open ? '-rotate-180' : ''}`} aria-hidden>
            ▼
          </span>
        </button>
      </div>

      {open && (
        <div
          id="cv-ratio-panel"
          className={panelCls}
          role="region"
          aria-labelledby="cv-volume-concentration-input"
        >
          {isMassAssist ? (
            <header className={`flex min-h-[2.75rem] flex-col justify-center gap-2 border-b px-3 py-2.5 ${panelInnerCls}`}>
              <div className={`text-xs font-semibold leading-snug tracking-wide ${hintStrong}`}>
                体积浓度——辅助计算（<InlineMath math="C_V" />）
              </div>
              <div className={`space-y-2 overflow-x-auto text-[11px] ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                <FormulaFrame darkMode={darkMode} compact className="mb-0">
                  <BlockMath math="C_V = \dfrac{C_W \rho_s}{\rho_g - \rho_g C_W + \rho_s C_W}" />
                </FormulaFrame>
              </div>
              <p className={`whitespace-nowrap overflow-x-auto text-[10px] leading-snug ${hintMuted}`}>
                <InlineMath math="C_V" />
                ：体积浓度 · 无量纲（0～1）；
              </p>
            </header>
          ) : (
            <div className={`border-b px-3 py-2.5 ${panelInnerCls}`}>
              <div className={`text-xs font-semibold tracking-wide ${hintStrong}`}>体积浓度——辅助计算（<InlineMath math="C_V" />）</div>
              <p className={`mt-1 text-[11px] leading-relaxed ${hintMuted}`}>
                本页 <InlineMath math="C_V" /> 为<strong className="font-medium">体积浓度（小数 0～1）</strong>
                ，含义是<strong className="font-medium">固相所占体积</strong>与<strong className="font-medium">浆体混合物总体积</strong>
                之比。若资料给出的是两个体积（或同一量纲下的计量），可用下式换算后再写入上方输入框。
              </p>
              <div className={`mt-2 overflow-x-auto text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                <FormulaFrame darkMode={darkMode} compact className="mb-0">
                  <BlockMath math="C_V = \dfrac{C}{C_A}" />
                </FormulaFrame>
              </div>
            </div>
          )}

          <div className="space-y-3 px-3 py-3">
            {isMassAssist ? (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <span className={`text-xs font-medium ${hintStrong}`}>
                      <InlineMath math="C_W" />：浆体重量浓度 · 无量纲（0～1）
                    </span>
                    <InputWithTrailingUnit
                      darkMode={darkMode}
                      className="mt-1 w-full"
                      inputClassName={assistFieldInputCls}
                      value={cwStr}
                      onChange={(e) => setCwStr(e.target.value)}
                      placeholder="浆体重量浓度，如0.42"
                      unit="无量纲"
                    />
                  </div>
                  <div>
                    <span className={`text-xs font-medium ${hintStrong}`}>
                      <InlineMath math="\rho_s" />：水的密度 · kg/m³
                    </span>
                    <InputWithTrailingUnit
                      darkMode={darkMode}
                      className="mt-1 w-full"
                      inputClassName={assistFieldInputCls}
                      value={rhoSStr}
                      onChange={(e) => setRhoSStr(e.target.value)}
                      placeholder="水的密度，默认1000"
                      unit="kg/m³"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <span className={`text-xs font-medium ${hintStrong}`}>
                      <InlineMath math="\rho_g" />：固体物料密度 · kg/m³
                    </span>
                    <InputWithTrailingUnit
                      darkMode={darkMode}
                      className="mt-1 w-full"
                      inputClassName={assistFieldInputCls}
                      readOnly
                      tabIndex={-1}
                      aria-readonly
                      value={rhoGOk ? String(rhoGForm) : ''}
                      placeholder="固体物料密度，同页主表"
                      unit="kg/m³"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className={`text-xs font-medium ${hintStrong}`}>
                    <InlineMath math="C" />
                  </div>
                  <p className={`mt-0.5 text-[11px] leading-snug ${hintMuted}`}>
                    填<strong>固相体积</strong>：与 <InlineMath math="C_A" />{' '}
                    <strong>必须用同一单位</strong>（如均为 m³、mL、L）。可取量筒读数、析水/沉降后固体体积，或报告给出的固体体积当量。
                  </p>
                  <InputWithTrailingUnit
                    darkMode={darkMode}
                    className="mt-1 w-full"
                    inputClassName={assistFieldInputCls}
                    value={cStr}
                    onChange={(e) => setCStr(e.target.value)}
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
                    填<strong>浆体混合物总体积</strong>（浆样中液体相与固体相各自占据的体积之和），与 <InlineMath math="C" />{' '}
                    同单位。<strong>不可为 0</strong>。
                  </p>
                  <InputWithTrailingUnit
                    darkMode={darkMode}
                    className="mt-1 w-full"
                    inputClassName={assistFieldInputCls}
                    value={caStr}
                    onChange={(e) => setCaStr(e.target.value)}
                    placeholder="浆体总体积，如100（与 C 同单位）"
                  />
                </div>
              </>
            )}

            {isMassAssist ? (
              <div
                className={`rounded-lg border px-2.5 py-2 text-[11px] ${darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}
              >
                <div className={`mb-1.5 text-xs font-semibold ${hintStrong}`}>中间计算结果</div>
                <ul className={`space-y-1.5 leading-relaxed ${hintMuted}`}>
                  <li className={`flex flex-wrap items-baseline gap-x-1 gap-y-0.5 ${hintStrong}`}>
                    <InlineMath math="C_V" />
                    <span>（体积浓度）=</span>
                    {cvCommitted != null && Number.isFinite(cvCommitted) ? (
                      <span className="font-mono font-semibold">{String(cvCommitted)}</span>
                    ) : (
                      '—'
                    )}
                  </li>
                </ul>
              </div>
            ) : (
              <div
                className={`rounded-lg border px-2.5 py-2 text-xs ${darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}
              >
                <div className={`mb-1 text-[11px] font-semibold ${hintStrong}`}>计算结果</div>
                <div
                  className={`mb-1.5 h-1.5 w-full overflow-hidden rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}
                  aria-hidden
                >
                  <div
                    className={`h-full rounded-full bg-blue-500 transition-[width] duration-1000 ease-linear`}
                    style={{ width: `${cvCalcBarPct}%` }}
                  />
                </div>
                <InlineMath math="C_V" />
                <span className={hintMuted}> = </span>
                {cvCalcBusy ? (
                  <span className={hintMuted}>…</span>
                ) : cvCommitted != null ? (
                  <span className="font-mono text-sm font-semibold">{String(cvCommitted)}</span>
                ) : (
                  <span className={hintMuted}>—（点「计算」后显示并写入上方）</span>
                )}
              </div>
            )}

            {!isMassAssist && (
              <p className={`text-[11px] leading-relaxed ${hintMuted}`}>
                <span className="font-medium text-inherit">示例：</span>
                量筒中浆样总体积 <InlineMath math="C_A=100\ \mathrm{mL}" />
                ，固体体积 <InlineMath math="C=15\ \mathrm{mL}" />
                ，则 <InlineMath math="C_V=0.15" />
                （再点「计算」写入上方）。
              </p>
            )}

            {isMassAssist && !rhoGOk && cwStr.trim() !== '' && (
              <p className={`text-[11px] ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                请先在主表填写固体密度 <InlineMath math="\rho_g" />（kg/m³）。
              </p>
            )}

            {outOfUnitRange && (
              <p className={`text-[11px] leading-snug ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                当前比值超出 0～1，临界流速计算通常要求 <InlineMath math="C_V" /> 为小数形式 0～1；请核对试验定义或单位是否一致。
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
                disabled={isMassAssist ? !canCompute : !canCompute || cvCalcBusy}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                  darkMode ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (isMassAssist) {
                    if (!canCompute) return
                    const cwN = parseFloat(norm(cwStr))
                    const rhoSN = parseFloat(norm(rhoSStr))
                    const rg = rhoGKgM3FromForm
                    if (rg == null || isNaN(rg) || rg <= 0) return
                    const dm = rg - rg * cwN + rhoSN * cwN
                    if (!Number.isFinite(cwN) || !Number.isFinite(rhoSN) || Math.abs(dm) <= 1e-12) return
                    const v = Math.round(((cwN * rhoSN) / dm) * 1e6) / 1e6
                    setCvCommitted(v)
                    onApplyCvFromRatio(String(v))
                    setOpen(false)
                    return
                  }
                  if (!canCompute || cvCalcBusy) return
                  setCvCalcBusy(true)
                  setCvCalcBarPct(0)
                  window.requestAnimationFrame(() => setCvCalcBarPct(100))
                  window.setTimeout(() => {
                    const v = Math.round((c / ca) * 1e6) / 1e6
                    if (!Number.isFinite(v)) {
                      setCvCalcBusy(false)
                      return
                    }
                    setCvCommitted(v)
                    onApplyCvFromRatio(String(v))
                    setCvCalcBusy(false)
                    setOpen(false)
                  }, 1000)
                }}
              >
                计算
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type FeiDarcyAssistPreviewRow = ReturnType<typeof computeFeiDarcyAssistPreview>

/** 费祥俊公式：达西摩阻系数 λ 辅助计算，下拉面板交互与同页「体积浓度」一致；D_n 同步自主表管径 D */
function FeiDarcyLambdaAssistField({
  darkMode,
  language,
  inputValue,
  onInputChange,
  onInputBlur,
  placeholder,
  unitText,
  computeAssistPreview,
  feiLambdaAuxEta1,
  setFeiLambdaAuxEta1,
  feiLambdaAuxEpsilonPreset,
  setFeiLambdaAuxEpsilonPreset,
  feiLambdaAuxEpsilonCustom,
  setFeiLambdaAuxEpsilonCustom,
  onApplyLambda,
  renderDescriptionWithMath,
}: {
  darkMode: boolean
  language: 'zh' | 'en'
  inputValue: string
  onInputChange: (value: string) => void
  onInputBlur: () => void
  placeholder: string
  unitText?: string | null
  computeAssistPreview: () => FeiDarcyAssistPreviewRow
  feiLambdaAuxEta1: string
  setFeiLambdaAuxEta1: (v: string) => void
  feiLambdaAuxEpsilonPreset: SlurryEpsilonPresetKey
  setFeiLambdaAuxEpsilonPreset: (k: SlurryEpsilonPresetKey) => void
  feiLambdaAuxEpsilonCustom: string
  setFeiLambdaAuxEpsilonCustom: (v: string) => void
  /** 点击「计算」并得到有效 λ 后写入主栏（与体积浓度「计算」一致） */
  onApplyLambda: (preview: FeiDarcyAssistPreviewRow) => void
  renderDescriptionWithMath: (label: string) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [panelPreview, setPanelPreview] = useState<FeiDarcyAssistPreviewRow | null>(null)
  const [calcBarPct, setCalcBarPct] = useState(0)
  const [calcBusy, setCalcBusy] = useState(false)

  const norm = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
  const eta1 = parseFloat(norm(feiLambdaAuxEta1))
  const epsMm = parseFeiAuxEpsilonMm(feiLambdaAuxEpsilonPreset, feiLambdaAuxEpsilonCustom)
  const canAttempt = Number.isFinite(eta1) && eta1 > 0 && epsMm != null && epsMm > 0

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

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
  const panelCls = `absolute left-0 right-0 z-[60] mt-1.5 overflow-visible rounded-xl border shadow-lg ${
    darkMode ? 'border-gray-500 bg-gray-800 text-gray-100' : 'border-gray-200 bg-white text-gray-900'
  }`
  const panelInnerCls = darkMode ? 'border-gray-600' : 'border-gray-100'
  const labelCls = `block text-xs font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`
  const hintMuted = darkMode ? 'text-gray-400' : 'text-gray-600'
  const hintStrong = darkMode ? 'text-gray-200' : 'text-gray-800'

  const fmtFeiAssistNumber = (n: number): string => {
    if (!Number.isFinite(n)) return '—'
    const ax = Math.abs(n)
    if (ax !== 0 && (ax >= 1e8 || ax < 1e-4)) return n.toExponential(6)
    const rounded = Math.round(n * 1e6) / 1e6
    const t = rounded.toFixed(8).replace(/\.?0+$/, '')
    return t || '0'
  }

  const fmtCell = (n: number | null) => (n != null && Number.isFinite(n) ? fmtFeiAssistNumber(n) : '—')

  const preview = panelPreview
  const hasLambda = preview != null && preview.lambda != null

  return (
    <div className="relative min-w-0 flex-1 overflow-visible" ref={wrapRef}>
      <div
        className={`flex min-w-0 items-stretch overflow-hidden rounded-lg border focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent ${shellBorder} ${shellBg} ${shellFocus}`}
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
          aria-controls="fei-darcy-lambda-assist-panel"
          id="fei-darcy-lambda-input"
        />
        {unitText != null && String(unitText).trim() !== '' ? (
          <UnitBadge darkMode={darkMode}>{unitText}</UnitBadge>
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          className={chevronBtnCls}
          aria-label={
            open
              ? language === 'en'
                ? 'Collapse Darcy friction factor assist'
                : '收起达西摩阻系数——辅助计算'
              : language === 'en'
                ? 'Expand Darcy friction factor assist'
                : '展开达西摩阻系数——辅助计算'
          }
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`inline-block text-xs transition-transform ${open ? '-rotate-180' : ''}`} aria-hidden>
            ▼
          </span>
        </button>
      </div>

      {open && (
        <div
          id="fei-darcy-lambda-assist-panel"
          className={panelCls}
          role="region"
          aria-labelledby="fei-darcy-lambda-input"
        >
          <div className={`border-b px-3 py-2.5 ${panelInnerCls}`}>
            <div className={`text-xs font-semibold tracking-wide ${hintStrong}`}>
              {language === 'en' ? (
                <>
                  Darcy friction factor — assist calculation (<InlineMath math="\lambda" />)
                </>
              ) : (
                <>
                  达西摩阻系数——辅助计算（<InlineMath math="\lambda" />）
                </>
              )}
            </div>
            <div
              className={`mt-2 overflow-x-auto rounded-md py-1 text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}
            >
              <FormulaFrame darkMode={darkMode} compact className="mb-0">
                <BlockMath math={DARCY_FRICTION_EXPLICIT_LAMBDA_BLOCK_MATH} />
              </FormulaFrame>
            </div>
            <div className={`mt-2 space-y-1 text-[11px] leading-relaxed ${hintMuted}`}>
              {language === 'en' ? (
                <div>
                  <InlineMath math="\lambda" />: Darcy–Weisbach friction factor (dimensionless).
                </div>
              ) : (
                <div>
                  <InlineMath math="\lambda" />：达西摩阻系数（无量纲）。
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 px-3 py-3">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <div className="min-w-[10rem] flex-1">
                <label className={labelCls}>
                  {language === 'en'
                    ? renderDescriptionWithMath('$\\eta_1$：mixture dynamic viscosity（Pa·s）')
                    : renderDescriptionWithMath('$\\eta_1$：混合物动力粘度（Pa·s）')}
                </label>
                <InputWithTrailingUnit
                  darkMode={darkMode}
                  className="mt-1"
                  inputClassName="text-sm py-2 rounded-none"
                  value={feiLambdaAuxEta1}
                  onChange={(e) => setFeiLambdaAuxEta1(e.target.value)}
                  placeholder={language === 'en' ? 'e.g. 0.001' : '如 0.001'}
                  unit="Pa·s"
                />
              </div>
              <div className="min-w-[12rem] flex-[1.35]">
                <div className={labelCls}>
                  {language === 'en'
                    ? renderDescriptionWithMath('$\\varepsilon$：pipe wall absolute roughness（mm）')
                    : renderDescriptionWithMath('$\\varepsilon$：管壁绝对粗糙度（mm）')}
                </div>
                <SlurryEpsilonCombinedRow
                  darkMode={darkMode}
                  language={language}
                  presetKey={feiLambdaAuxEpsilonPreset}
                  valueMm={feiLambdaAuxEpsilonCustom}
                  onChange={(preset, mm) => {
                    setFeiLambdaAuxEpsilonPreset(preset)
                    setFeiLambdaAuxEpsilonCustom(mm)
                  }}
                />
              </div>
            </div>

            <div
              className={`rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${
                darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className={`font-semibold ${hintStrong}`}>
                {language === 'en' ? 'Results' : '计算结果'}
              </div>
              <div className="mt-2 space-y-1.5">
                <div
                  className={`h-1.5 w-full overflow-hidden rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}
                  aria-hidden
                >
                  <div
                    className={`h-full rounded-full bg-blue-500 transition-[width] duration-1000 ease-linear`}
                    style={{ width: `${calcBarPct}%` }}
                  />
                </div>
                <p className={`${hintMuted}`}>
                  {language === 'en' ? (
                    <>
                      Iteration criterion (same as server): relative residual{' '}
                      <InlineMath math={'|\\lambda_{n+1}-\\lambda_n|\\,/\\max(\\lambda_n,10^{-12})'} />{' '}
                      <InlineMath math="\lt 10^{-6}" />; at most {FEI_LAMBDA_ITER_MAX_STEPS} steps.
                      {preview?.relResidual != null && (
                        <>
                          {' '}
                          Last residual: {fmtFeiAssistNumber(preview.relResidual)}.
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {preview?.relResidual != null && (
                        <>
                          当前末步相对残差：{fmtFeiAssistNumber(preview.relResidual)}。
                        </>
                      )}
                    </>
                  )}
                </p>
              </div>
              <dl className={`mt-1.5 space-y-1.5 ${hintMuted}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <dt className={`font-normal shrink-0 ${hintMuted}`}>
                    <InlineMath math="\mathrm{Re}_B" />
                    <span>
                      {language === 'en' ? ' & flow regime' : ' 与流态'}
                    </span>
                  </dt>
                  <dd className={`text-right font-normal font-sans tabular-nums ${hintStrong}`}>
                    {preview != null && preview.Re_B != null && preview.flowRegime
                      ? `${fmtCell(preview.Re_B)}（${preview.flowRegime}）`
                      : '—'}
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <dt className={`font-normal shrink-0 ${hintMuted}`}>
                    <InlineMath math="\lambda" />
                    <span>{language === 'en' ? ' (Darcy)' : '（达西摩阻系数）'}</span>
                  </dt>
                  <dd
                    className={`text-right font-sans tabular-nums ${
                      hasLambda ? `${hintStrong} font-bold` : `font-normal ${hintMuted}`
                    }`}
                  >
                    {preview ? fmtCell(preview.lambda) : '—'}
                  </dd>
                </div>
              </dl>
            </div>

            <p className={`text-[11px] leading-relaxed ${hintMuted}`}>
              {language === 'en' ? (
                <>
                  Click <strong className="font-medium text-inherit">Calculate</strong> to iterate λ (about 1 s
                  progress) and write it to the main field. The panel stays open so you can review the values; click
                  outside or <strong className="font-medium text-inherit">Close</strong> when finished.
                </>
              ) : (
                <>
                  点击下方<strong className="font-medium text-inherit">「计算」</strong>
                  后开始迭代并将 λ 写入主栏。<strong className="font-medium text-inherit">面板保持打开</strong>
                  ，便于逐项核对辅助结果；完成后点击页面其他区域或<strong className="font-medium text-inherit">「收起」</strong>关闭。
                </>
              )}
            </p>

            <div className="flex justify-end gap-2 pt-0.5">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  darkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)}
              >
                {language === 'en' ? 'Close' : '收起'}
              </button>
              <button
                type="button"
                disabled={!canAttempt || calcBusy}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                  darkMode ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (!canAttempt || calcBusy) return
                  setCalcBusy(true)
                  setCalcBarPct(0)
                  window.requestAnimationFrame(() => setCalcBarPct(100))
                  window.setTimeout(() => {
                    const p = computeAssistPreview()
                    setPanelPreview(p)
                    if (p.lambda != null) onApplyLambda(p)
                    setCalcBusy(false)
                  }, 1000)
                }}
              >
                {language === 'en' ? 'Calculate' : '计算'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 刘德忠公式：宾汉体（η）辅助面板；η 为 Pa·s；ρ_g、ρ_k 与本页主输入一致时使用 kg/m³；d_i（m）；ω_i=N_w·ω_L */
/** 规范 (C.0.3-1) — N_w = (20.5209/N_d)[√(1+N_d^{1.5}/(0.213^{0.5}×4.53²))−1]² ，其中 ω_i=N_w ω_L */
const LIU_BINGHAM_REF = 4.53
const LIU_BINGHAM_NW_COEF = LIU_BINGHAM_REF ** 2
const LIU_BINGHAM_NW_INNER_DENOM = Math.sqrt(0.213) * LIU_BINGHAM_NW_COEF

/** √(1+x)-1 的稳定形式，避免 x≪1 时相消 */
function liuSqrt1pM1(x: number): number {
  if (!Number.isFinite(x) || x < -1) return NaN
  const t = 1 + x
  if (t < 0) return NaN
  if (x === 0) return 0
  return x / (Math.sqrt(t) + 1)
}

/** 规范 (C.0.3-1) 的 N_w；小 N_d 时用 liuSqrt1pM1 保持精度 */
function liuBinghamNwFromNd(N_d: number): number {
  if (!Number.isFinite(N_d) || N_d <= 0) return NaN
  const x = N_d ** 1.5 / LIU_BINGHAM_NW_INNER_DENOM
  const s = liuSqrt1pM1(x)
  if (!Number.isFinite(s)) return NaN
  return (LIU_BINGHAM_NW_COEF / N_d) * (s * s)
}

/** 宾汉 ω 辅助中间量：极小量用科学计数法，避免四舍五入成 0 */
function formatLiuBinghamAuxScalar(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const av = Math.abs(v)
  if (av < 1e-4) return v.toExponential(4)
  if (av < 0.01) return v.toPrecision(6)
  return String(Math.round(v * 1e9) / 1e9)
}

/** 将 ω_i 写入主栏：极小沉速保留有效位数 */
function formatLiuOmegaIFill(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return ''
  const av = Math.abs(v)
  if (av < 1e-6) return v.toExponential(8)
  return String(Math.round(v * 1e12) / 1e12)
}

/** 刘德忠 ω、ω_s：避免统一 6 位小数把小沉速变成 0 */
function roundLiuDezhongSlurryVelocity(n: number): number {
  if (!Number.isFinite(n)) return NaN
  if (n === 0) return 0
  const av = Math.abs(n)
  if (av < 1e-4) return Number(n.toPrecision(12))
  return Math.round(n * 1e9) / 1e9
}

/** 刘德忠其余参数（D、η₁、ρ 等）：比全局 6 位小数更细，便于 d_i、μ_w 量级输入 */
function roundLiuDezhongScalarParam(n: number): number {
  if (!Number.isFinite(n)) return NaN
  if (n === 0) return 0
  const av = Math.abs(n)
  if (av < 1e-6) return Number(n.toPrecision(12))
  return Math.round(n * 1e9) / 1e9
}

/** 主栏/辅助填入时的可读字符串（含科学计数法） */
function formatLiuSlurryVelocityRawInput(n: number): string {
  if (!Number.isFinite(n)) return ''
  const rounded = roundLiuDezhongSlurryVelocity(n)
  const av = Math.abs(rounded)
  if (rounded === 0) return '0'
  if (av < 1e-6) return rounded.toExponential(8)
  return String(rounded)
}

/** 斯托克斯 ω_s：从宾汉 ω 同步 d_i（m）时保留完整有效小数，避免固定 9 位舍入丢位 */
function formatLiuStokesDiMImportFromBingham(d: number): string {
  if (!Number.isFinite(d) || d <= 0) return ''
  const t = d.toFixed(16).replace(/\.?0+$/, '')
  return t === '' ? '0' : t
}

/** 判断斯托克斯粒径输入是否仍与宾汉侧 d_i 数值一致（用于宾汉改粒径后刷新文本位数） */
function liuStokesDiNumericAlmostEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-15)
  /** 允许截断显示与完整双精度之间有相对偏差，否则会无法刷新小数位 */
  return Math.abs(a - b) <= 0.002 * scale
}

/** 刘德忠 ω、ω_s 手输或粘贴：允许科学计数法 */
const LIU_SLURRY_VELOCITY_INPUT_RE = /^-?\d+(\.\d*)?([eE][+-]?\d+)?$/

/** ρ_g、ρ_w 均为 SI 体积质量 kg/m³（与斯托克斯 ω_s 辅助面板输入一致），与刘德忠主栏一致 */
function computeLiuStokesOmegaSFromAux(params: {
  rho_g: number
  rho_w: number
  g: number
  d_m: number
  mu_w: number
}): number | null {
  const { rho_g, rho_w, g, d_m, mu_w } = params
  if (
    !Number.isFinite(rho_g) ||
    !Number.isFinite(rho_w) ||
    rho_g <= rho_w ||
    rho_w <= 0 ||
    !Number.isFinite(g) ||
    g <= 0 ||
    !Number.isFinite(d_m) ||
    d_m <= 0 ||
    !Number.isFinite(mu_w) ||
    mu_w <= 0
  ) {
    return null
  }
  const rhoDiffKgM3 = rho_g - rho_w
  const omegaS = (g * rhoDiffKgM3 * d_m ** 2) / (18 * mu_w)
  if (!Number.isFinite(omegaS)) return null
  return roundLiuDezhongSlurryVelocity(omegaS)
}

function LiuDezhongOmegaBinghamField({
  darkMode,
  inputValue,
  onInputChange,
  onInputBlur,
  placeholder,
  unitText,
  parameters,
  onApplyOmega,
  onDiComputed,
  assistContext = 'liu_dezhong',
  language = 'zh',
}: {
  darkMode: boolean
  inputValue: string
  onInputChange: (value: string) => void
  onInputBlur: () => void
  placeholder: string
  unitText?: string | null
  parameters: Record<string, number | undefined>
  onApplyOmega: (omegaStr: string, meta?: { eta: number }) => void
  onDiComputed?: (dIM: number | undefined) => void
  assistContext?: 'liu_dezhong' | 'flow_judgment'
  language?: 'zh' | 'en'
}) {
  const [open, setOpen] = useState(false)
  const [rhoGStr, setRhoGStr] = useState('')
  const [rhoKStr, setRhoKStr] = useState('')
  const [gStr, setGStr] = useState('9.81')
  const [gbStr, setGbStr] = useState('')
  const [diMStr, setDiMStr] = useState('')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [binghamCommitted, setBinghamCommitted] = useState<{
    D_L: number
    W_L: number
    N_d: number
    N_w: number
    omega_i: number
  } | null>(null)
  const [binghamCalcBusy, setBinghamCalcBusy] = useState(false)
  const [binghamCalcBarPct, setBinghamCalcBarPct] = useState(0)

  useEffect(() => {
    const rg = parameters.rho_g
    const rk = parameters.rho_k
    const g0 = parameters.g
    const et = parameters.eta
    if (rg != null && !isNaN(Number(rg))) setRhoGStr(String(roundLiuDezhongScalarParam(Number(rg))))
    if (rk != null && !isNaN(Number(rk))) setRhoKStr(String(roundLiuDezhongScalarParam(Number(rk))))
    if (g0 != null && !isNaN(Number(g0))) setGStr(String(g0))
    if (et != null && !isNaN(Number(et))) setGbStr(String(roundLiuDezhongScalarParam(Number(et))))
  }, [parameters.rho_g, parameters.rho_k, parameters.g, parameters.eta])

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
  /** ρ 为 SI 体积质量 kg/m³；η 为 Pa·s — δ 可由无量纲比值，η/ρ_k 必须用 kg/m³ 才与加速度 g 配对得 m/s 量级沉速 */
  const rhoG_kg = parseFloat(norm(rhoGStr))
  const rhoK_kg = parseFloat(norm(rhoKStr))
  const gVal = parseFloat(norm(gStr))
  const GB = parseFloat(norm(gbStr))

  const deltaOk =
    Number.isFinite(rhoG_kg) &&
    Number.isFinite(rhoK_kg) &&
    rhoK_kg > 0 &&
    rhoG_kg > rhoK_kg &&
    Number.isFinite(GB) &&
    GB > 0 &&
    Number.isFinite(gVal) &&
    gVal > 0

  const delta = deltaOk ? rhoG_kg / rhoK_kg - 1 : NaN
  const D_L =
    deltaOk && delta > 0 ? (GB / rhoK_kg) ** (2 / 3) / (gVal * delta) ** (1 / 3) : NaN
  const W_L = deltaOk && delta > 0 ? (gVal * delta * (GB / rhoK_kg)) ** (1 / 3) : NaN
  const d_i_m_parse = parseFloat(norm(diMStr))
  const d_i_m = Number.isFinite(d_i_m_parse) && d_i_m_parse > 0 ? d_i_m_parse : NaN

  const ndOk =
    Number.isFinite(D_L) &&
    D_L > 0 &&
    Number.isFinite(d_i_m) &&
    d_i_m > 0 &&
    Number.isFinite(W_L) &&
    W_L > 0

  const N_d = ndOk ? d_i_m / D_L : NaN
  const innerRadicand = ndOk ? 1 + N_d ** 1.5 / LIU_BINGHAM_NW_INNER_DENOM : NaN
  const nwOk =
    ndOk &&
    Number.isFinite(innerRadicand) &&
    innerRadicand >= 0 &&
    N_d > 0 &&
    Number.isFinite(N_d)

  /** 由 N_d 给出的无量纲系数（上书作 N_w；ω_i=N_w ω_L） */
  const N_w_from_nd = nwOk ? liuBinghamNwFromNd(N_d) : NaN
  const omega_i_prime = nwOk && Number.isFinite(W_L) && Number.isFinite(N_w_from_nd) ? N_w_from_nd * W_L : NaN

  const omegaFillOk = nwOk && Number.isFinite(omega_i_prime) && omega_i_prime > 0
  useEffect(() => {
    onDiComputed?.(Number.isFinite(d_i_m) && d_i_m > 0 ? d_i_m : undefined)
  }, [d_i_m, onDiComputed])

  const hintMuted = darkMode ? 'text-gray-400' : 'text-gray-600'
  const hintStrong = darkMode ? 'text-gray-200' : 'text-gray-800'

  const fj = assistContext === 'flow_judgment'
  const en = language === 'en'

  const chevronBtnCls = `flex h-full shrink-0 items-center justify-center border-l px-2.5 transition-colors ${
    darkMode
      ? `border-gray-500/80 text-gray-300 hover:bg-gray-700/60 ${open ? 'bg-gray-700/35' : ''}`
      : `border-gray-200 text-gray-500 hover:bg-gray-50 ${open ? 'bg-gray-50/90' : ''}`
  }`
  const panelCls = `absolute left-0 right-0 z-50 mt-1.5 max-h-[min(70vh,32rem)] overflow-y-auto overflow-x-hidden rounded-xl border shadow-lg ${
    darkMode ? 'border-gray-500 bg-gray-800 text-gray-100' : 'border-gray-200 bg-white text-gray-900'
  }`
  const panelInnerCls = darkMode ? 'border-gray-600' : 'border-gray-100'

  return (
    <div className="relative min-w-0 flex-1" ref={wrapRef}>
      <div
        className={`flex min-h-[2.75rem] items-stretch overflow-hidden rounded-xl border transition-shadow ${
          darkMode
            ? `border-gray-500/80 bg-gray-800/60 ${open ? 'ring-1 ring-blue-500/35 border-blue-500/55' : ''}`
            : `border-gray-200 bg-white shadow-sm ${open ? 'ring-2 ring-blue-100 border-blue-400' : ''}`
        }`}
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
          className={`min-w-0 flex-1 border-0 bg-transparent px-3 py-2.5 text-base focus:outline-none focus:ring-0 ${
            darkMode ? 'text-gray-100 placeholder-gray-400' : 'text-gray-900 placeholder-gray-400'
          }`}
          aria-expanded={open}
          aria-controls="liu-omega-bingham-panel"
          id="liu-omega-bingham-input"
        />
        <UnitBadge darkMode={darkMode}>
          {unitText != null && String(unitText).trim() !== '' ? unitText : 'm/s'}
        </UnitBadge>
        <button
          type="button"
          tabIndex={-1}
          className={chevronBtnCls}
          aria-label={
            open
              ? en
                ? 'Collapse weighted settling velocity assist'
                : '收起似均质中加权平均沉速——辅助计算'
              : en
                ? 'Expand weighted settling velocity assist'
                : '展开似均质中加权平均沉速——辅助计算'
          }
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`inline-block text-xs transition-transform ${open ? '-rotate-180' : ''}`} aria-hidden>
            ▼
          </span>
        </button>
      </div>

      {open && (
        <div id="liu-omega-bingham-panel" className={panelCls} role="region" aria-labelledby="liu-omega-bingham-input">
          <header className={`flex min-h-[2.75rem] flex-col justify-center gap-2 border-b px-3 py-2.5 ${panelInnerCls}`}>
            <div className={`text-xs font-semibold leading-snug tracking-wide ${hintStrong}`}>
              {en ? (
                <>
                  Weighted mean settling velocity · assist (<InlineMath math="\omega" />)
                </>
              ) : (
                <>
                  似均质中加权平均沉速——辅助计算（<InlineMath math="\omega" />）
                </>
              )}
            </div>
            <FormulaFrame darkMode={darkMode} compact className="mb-0">
              <div className="flex w-full min-w-0 flex-col items-center gap-2">
                <BlockMath math="d_L=\dfrac{\left(\eta/\rho_k\right)^{2/3}}{\left[g\left(\rho_g/\rho_k-1\right)\right]^{1/3}}" />
                <BlockMath math="\omega_L=\left[g\left(\dfrac{\rho_g}{\rho_k}-1\right)\dfrac{\eta}{\rho_k}\right]^{1/3}" />
                <BlockMath math="N_d=\dfrac{d_i}{d_L}" />
                <BlockMath math="N_w=\dfrac{20.5209}{N_d}\left[\left(1+\dfrac{N_d^{1.5}}{0.213^{0.5}\times 4.53^2}\right)^{0.5}-1\right]^2" />
                <BlockMath math="\omega_i=N_w\cdot\omega_L" />
              </div>
            </FormulaFrame>
            <p className={`whitespace-normal sm:whitespace-nowrap overflow-x-auto text-[10px] leading-snug ${hintMuted}`}>
              {en ? (
                <span>
                  <InlineMath math="d_L" />: standard length scale;&nbsp;
                  <InlineMath math="\omega_L" />: reference settling velocity;&nbsp;
                  <InlineMath math="N_d" /> / <InlineMath math="N_w" />: dimensionless groups;&nbsp;
                  <InlineMath math="\omega_i" />: settling speed for&nbsp;
                  <InlineMath math="d_i" />.
                </span>
              ) : (
                <span>
                  <InlineMath math="d_L" />
                  （标准度量粒径）；<InlineMath math="\omega_L" />
                  （标准度量沉速）；<InlineMath math="N_d" />
                  （无因次粒径数）；<InlineMath math="N_w" />
                  （无因次沉降数）；<InlineMath math="\omega_i" />
                  （粒径沉速）。
                </span>
              )}
            </p>
          </header>

          <div className="space-y-3 px-3 py-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <span className={`block text-[11px] font-medium leading-snug ${hintStrong}`}>
                  {fj ? (
                    en ? (
                      <>
                        <InlineMath math="\rho_g" /> (kg/m³): step 1 inputs on this page; editable
                      </>
                    ) : (
                      <>
                        <InlineMath math="\rho_g" />
                        ：固体密度（kg/m³）；取本页步骤「1」参数，可修改
                      </>
                    )
                  ) : (
                    <>
                      <InlineMath math="\rho_g" />
                      {en ? ': solid density · kg/m³' : '：固体密度 · kg/m³'}
                    </>
                  )}
                </span>
                <InputWithTrailingUnit
                  darkMode={darkMode}
                  inputClassName="text-sm py-2.5"
                  value={rhoGStr}
                  onChange={(e) => setRhoGStr(e.target.value)}
                  placeholder={en ? 'e.g. 2500' : '固体密度，如2500'}
                  unit="kg/m³"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <span className={`block text-[11px] font-medium leading-snug ${hintStrong}`}>
                  {fj ? (
                    en ? (
                      <>
                        <InlineMath math="\rho_k" /> (kg/m³): mixture density&nbsp;
                        <InlineMath math="\rho_1" />
                        &nbsp;from step 1; editable
                      </>
                    ) : (
                      <>
                        <InlineMath math="\rho_k" />
                        （浆体密度，kg/m³）：取步骤「1」计算结果&nbsp;
                        <InlineMath math="\rho_1" />
                        ，可修改
                      </>
                    )
                  ) : (
                    <>
                      <InlineMath math="\rho_k" />
                      {en ? ': slurry density · kg/m³' : '：浆体密度 · kg/m³'}
                    </>
                  )}
                </span>
                <InputWithTrailingUnit
                  darkMode={darkMode}
                  inputClassName="text-sm py-2.5"
                  value={rhoKStr}
                  onChange={(e) => setRhoKStr(e.target.value)}
                  placeholder={en ? 'e.g. 1200' : '浆体密度，如1200'}
                  unit="kg/m³"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <span className={`block text-[11px] font-medium leading-snug ${hintStrong}`}>
                  {fj ? (
                    en ? (
                      <>
                        <InlineMath math="\eta" /> (Pa·s): stiffness from step 2; editable
                      </>
                    ) : (
                      <>
                        <InlineMath math="\eta" />
                        ：混合物动力粘度（刚度系数，Pa·s）；取步骤「2」参数，可修改
                      </>
                    )
                  ) : (
                    <>
                      <InlineMath math="\eta" />
                      {en ? ': Bingham stiffness · Pa·s' : '：宾汉体刚度系数 · Pa·s'}
                    </>
                  )}
                </span>
                <InputWithTrailingUnit
                  darkMode={darkMode}
                  inputClassName="text-sm py-2.5"
                  value={gbStr}
                  onChange={(e) => setGbStr(e.target.value)}
                  placeholder={en ? 'e.g. 0.01' : '如 0.01'}
                  unit="Pa·s"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <span className={`block text-[11px] font-medium leading-snug ${hintStrong}`}>
                  {fj ? (
                    en ? (
                      <>
                        <InlineMath math="d_i" /> (m): enter particle size (required)
                      </>
                    ) : (
                      <>
                        <InlineMath math="d_i" />
                        ：代表粒径（m）；此项须手填
                      </>
                    )
                  ) : (
                    <>
                      <InlineMath math="d_i" />
                      {en ? ': particle size · m' : '：物料粒径 · m'}
                    </>
                  )}
                </span>
                <InputWithTrailingUnit
                  darkMode={darkMode}
                  inputClassName="text-sm py-2.5"
                  value={diMStr}
                  onChange={(e) => setDiMStr(e.target.value)}
                  placeholder={en ? 'e.g. 2e-4' : '如 2e-4'}
                  unit="m"
                />
              </div>
            </div>

            <div className="min-w-0 space-y-1.5">
              <span className={`block text-[11px] font-medium leading-snug ${hintStrong}`}>
                {fj ? (
                  en ? (
                    <>
                      <InlineMath math="g" /> (m/s²): linked to page&nbsp;
                      <InlineMath math="g" />
                      ; editable
                    </>
                  ) : (
                    <>
                      <InlineMath math="g" />
                      ：重力加速度（m/s²）；取本页参数，可修改
                    </>
                  )
                ) : (
                  <>
                    <InlineMath math="g" />
                    {en ? ': gravity · m/s²' : '：重力加速度 · m/s²'}
                  </>
                )}
              </span>
              <InputWithTrailingUnit
                darkMode={darkMode}
                inputClassName="text-sm py-2.5"
                value={gStr}
                onChange={(e) => setGStr(e.target.value)}
                placeholder={en ? 'default 9.81' : '默认值 9.81'}
                unit="m/s²"
              />
            </div>

            <div
              className={`rounded-lg border px-2.5 py-2 text-[11px] ${darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}
            >
              <div className={`mb-1.5 text-xs font-semibold ${hintStrong}`}>中间计算结果</div>
              <div
                className={`mb-1.5 h-1.5 w-full overflow-hidden rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width] duration-1000 ease-linear"
                  style={{ width: `${binghamCalcBarPct}%` }}
                />
              </div>
              <ul className={`space-y-1.5 leading-relaxed ${hintMuted}`}>
                <li className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                  <InlineMath math="d_L" />
                  <span>（标准度量粒径）=</span>
                  {binghamCommitted && Number.isFinite(binghamCommitted.D_L) ? (
                    <span className="font-mono font-semibold">{String(Math.round(binghamCommitted.D_L * 1e9) / 1e9)}</span>
                  ) : (
                    '—'
                  )}
                  <span>m</span>
                </li>
                <li className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                  <InlineMath math="\omega_L" />
                  <span>（标准度量沉速）=</span>
                  {binghamCommitted && Number.isFinite(binghamCommitted.W_L) ? (
                    <span className="font-mono font-semibold">{String(Math.round(binghamCommitted.W_L * 1e9) / 1e9)}</span>
                  ) : (
                    '—'
                  )}
                  <span>m/s</span>
                </li>
                <li className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                  <InlineMath math="N_d" />
                  <span>（无因次粒径数）=</span>
                  {binghamCommitted && Number.isFinite(binghamCommitted.N_d) ? (
                    <span className="font-mono font-semibold">{formatLiuBinghamAuxScalar(binghamCommitted.N_d)}</span>
                  ) : (
                    '—'
                  )}
                </li>
                <li className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                  <InlineMath math="N_w" />
                  <span>（无因次沉降数）=</span>
                  {binghamCommitted && Number.isFinite(binghamCommitted.N_w) ? (
                    <span className="font-mono font-semibold">{formatLiuBinghamAuxScalar(binghamCommitted.N_w)}</span>
                  ) : (
                    '—'
                  )}
                </li>
                <li className={`flex flex-wrap items-baseline gap-x-1 gap-y-0.5 ${hintStrong}`}>
                  <InlineMath math="\omega_i" />
                  <span>（粒径沉速）=</span>
                  {binghamCommitted && Number.isFinite(binghamCommitted.omega_i) ? (
                    <span className="font-mono font-semibold">{formatLiuBinghamAuxScalar(binghamCommitted.omega_i)}</span>
                  ) : (
                    '—'
                  )}
                  <span>m/s</span>
                </li>
              </ul>
            </div>

            {!deltaOk && (rhoGStr || rhoKStr || gbStr) && (
              <p className={`text-[11px] ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                需满足 <InlineMath math="\rho_g>\rho_k" />、<InlineMath math="\rho_k>0" />、<InlineMath math="\eta>0" />、<InlineMath math="g>0" />。
              </p>
            )}
            {deltaOk && !nwOk && gbStr && diMStr && (
              <p className={`text-[11px] ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                请检查 <InlineMath math="d_L" />、<InlineMath math="d_i" />、<InlineMath math="\omega_L" />，使 <InlineMath math="N_d" /> 有效且根号内非负。
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
                disabled={!omegaFillOk || binghamCalcBusy}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                  darkMode ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (!omegaFillOk || binghamCalcBusy) return
                  setBinghamCalcBusy(true)
                  setBinghamCalcBarPct(0)
                  window.requestAnimationFrame(() => setBinghamCalcBarPct(100))
                  window.setTimeout(() => {
                    setBinghamCommitted({
                      D_L,
                      W_L,
                      N_d,
                      N_w: N_w_from_nd,
                      omega_i: omega_i_prime,
                    })
                    const omegaStr = formatLiuOmegaIFill(omega_i_prime)
                    if (!omegaStr) {
                      setBinghamCalcBusy(false)
                      return
                    }
                    const etaParsed = Number(norm(gbStr))
                    onApplyOmega(
                      omegaStr,
                      Number.isFinite(etaParsed) && etaParsed > 0 ? { eta: etaParsed } : undefined
                    )
                    setBinghamCalcBusy(false)
                    setOpen(false)
                  }, 1000)
                }}
              >
                计算
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 刘德忠公式：ω_s 斯托克斯辅助；粒径 d_i（m）与同页宾汉 ω 辅助一致；ρ、ρ_w 输入为 kg/m³，清水默认 1000（不与 ρ_k 联动） */
function LiuDezhongOmegaSStokesField({
  darkMode,
  inputValue,
  onInputChange,
  onInputBlur,
  placeholder,
  unitText,
  parameters,
  diMFromBingham,
  onApplyOmegaS,
}: {
  darkMode: boolean
  inputValue: string
  onInputChange: (value: string) => void
  onInputBlur: () => void
  placeholder: string
  unitText?: string | null
  parameters: Record<string, number | undefined>
  /** 宾汉 ω 面板当前有效的物料粒径 d_i（m），用于在未手填时给出初值 */
  diMFromBingham: number | null
  onApplyOmegaS: (omegaSStr: string, meta?: { dM: number }) => void
}) {
  const [open, setOpen] = useState(false)
  const [rhoGStr, setRhoGStr] = useState('')
  const [rhoWStr, setRhoWStr] = useState('1000')
  const [gStr, setGStr] = useState('9.81')
  const [diMStr, setDiMStr] = useState('')
  const [muWStr, setMuWStr] = useState('')
  /** 最近一次由宾汉 d_i 自动写入斯托克斯时对应的宾汉数值；用于区分手改与联动 */
  const stokesDiLastSyncedBinghamNumRef = useRef<number | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [stokesCommittedWs, setStokesCommittedWs] = useState<number | null>(null)
  const [stokesCalcBusy, setStokesCalcBusy] = useState(false)
  const [stokesCalcBarPct, setStokesCalcBarPct] = useState(0)

  useEffect(() => {
    const rg = parameters.rho_g
    const g0 = parameters.g
    if (rg != null && !isNaN(Number(rg))) setRhoGStr(String(roundLiuDezhongScalarParam(Number(rg))))
    if (g0 != null && !isNaN(Number(g0))) setGStr(String(g0))
    if (!muWStr) setMuWStr('0.0010559')
  }, [parameters.rho_g, parameters.g, muWStr])

  useEffect(() => {
    if (
      diMFromBingham == null ||
      !Number.isFinite(diMFromBingham) ||
      diMFromBingham <= 0
    ) {
      return
    }
    const normDi = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
    const nextStr = formatLiuStokesDiMImportFromBingham(diMFromBingham)
    setDiMStr((prev) => {
      const p = normDi(prev)
      const parsed = p === '' ? NaN : parseFloat(p)
      const lastN = stokesDiLastSyncedBinghamNumRef.current
      const stillLinkedToBingham =
        p === '' ||
        (Number.isFinite(parsed) &&
          (liuStokesDiNumericAlmostEqual(parsed, diMFromBingham) ||
            (lastN != null && liuStokesDiNumericAlmostEqual(parsed, lastN))))
      if (!stillLinkedToBingham) return prev
      stokesDiLastSyncedBinghamNumRef.current = diMFromBingham
      return nextStr
    })
  }, [diMFromBingham])

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
  const d_i_m = parseFloat(norm(diMStr))
  const muW = parseFloat(norm(muWStr))

  const ok =
    Number.isFinite(rhoG) &&
    Number.isFinite(rhoW) &&
    rhoG > rhoW &&
    rhoW > 0 &&
    Number.isFinite(gVal) &&
    gVal > 0 &&
    Number.isFinite(d_i_m) &&
    d_i_m > 0 &&
    Number.isFinite(muW) &&
    muW > 0

  const rhoDiffKgM3 = ok ? rhoG - rhoW : NaN
  const omegaS = ok ? (gVal * rhoDiffKgM3 * d_i_m ** 2) / (18 * muW) : NaN
  const omegaSRounded = Number.isFinite(omegaS) ? roundLiuDezhongSlurryVelocity(omegaS) : NaN

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
  const stokesAssistInputCls = 'text-sm py-2'
  const hintMuted = darkMode ? 'text-gray-400' : 'text-gray-600'
  const hintStrong = darkMode ? 'text-gray-200' : 'text-gray-800'

  return (
    <div className="relative min-w-0 flex-1" ref={wrapRef}>
      <div
        className={`flex min-w-0 items-stretch overflow-hidden rounded-lg border focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent ${shellBorder} ${shellBg} ${shellFocus}`}
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
        <UnitBadge darkMode={darkMode}>
          {unitText != null && String(unitText).trim() !== '' ? unitText : 'm/s'}
        </UnitBadge>
        <button
          type="button"
          tabIndex={-1}
          className={chevronBtnCls}
          aria-label={open ? '收起水中加权平均沉速（斯托克斯）——辅助计算' : '展开水中加权平均沉速（斯托克斯）——辅助计算'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`inline-block text-xs transition-transform ${open ? '-rotate-180' : ''}`} aria-hidden>
            ▼
          </span>
        </button>
      </div>

      {open && (
        <div id="liu-omega-s-stokes-panel" className={panelCls} role="region" aria-labelledby="liu-omega-s-stokes-input">
          <header className={`flex min-h-[2.75rem] flex-col justify-center gap-2 border-b px-3 py-2.5 ${panelInnerCls}`}>
            <div className={`text-xs font-semibold leading-snug tracking-wide ${hintStrong}`}>
              水中加权平均沉速（斯托克斯）——辅助计算（<InlineMath math="\omega_s" />）
            </div>
            <FormulaFrame darkMode={darkMode} compact className="mb-0">
              <BlockMath math="\omega_s=\dfrac{g(\rho_g-\rho_w)d_i^2}{18\mu_w}" />
            </FormulaFrame>
            <p className={`whitespace-nowrap overflow-x-auto text-[10px] leading-snug ${hintMuted}`}>
              <InlineMath math="\omega_s" />
              （水中加权平均沉速）；
            </p>
          </header>

          <div className="space-y-3 px-3 py-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="\rho_g" />：颗粒密度 · kg/m³
                </span>
                <InputWithTrailingUnit
                  darkMode={darkMode}
                  className="mt-1 w-full"
                  inputClassName={stokesAssistInputCls}
                  value={rhoGStr}
                  onChange={(e) => setRhoGStr(e.target.value)}
                  placeholder="颗粒密度，如2500"
                  unit="kg/m³"
                />
              </div>
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="\rho_w" />：水密度 · kg/m³
                </span>
                <InputWithTrailingUnit
                  darkMode={darkMode}
                  className="mt-1 w-full"
                  inputClassName={stokesAssistInputCls}
                  value={rhoWStr}
                  onChange={(e) => setRhoWStr(e.target.value)}
                  placeholder="水密度，默认1000"
                  unit="kg/m³"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="d_i" />：物料粒径 · m
                </span>
                <InputWithTrailingUnit
                  darkMode={darkMode}
                  className="mt-1 w-full"
                  inputClassName={stokesAssistInputCls}
                  value={diMStr}
                  onChange={(e) => setDiMStr(e.target.value)}
                  placeholder="与同页 ω 辅助一致，如 2e-4"
                  unit="m"
                />
              </div>
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="\mu_w" />：水动力粘度 · Pa·s
                </span>
                <InputWithTrailingUnit
                  darkMode={darkMode}
                  className="mt-1 w-full"
                  inputClassName={stokesAssistInputCls}
                  value={muWStr}
                  onChange={(e) => setMuWStr(e.target.value)}
                  placeholder="水动力粘度，默认 0.0010559 Pa·s"
                  unit="Pa·s"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <span className={`text-xs font-medium ${hintStrong}`}>
                  <InlineMath math="g" />：重力加速度 · m/s²
                </span>
                <InputWithTrailingUnit
                  darkMode={darkMode}
                  className="mt-1 w-full"
                  inputClassName={stokesAssistInputCls}
                  value={gStr}
                  onChange={(e) => setGStr(e.target.value)}
                  placeholder="重力加速度，默认值 9.81"
                  unit="m/s²"
                />
              </div>
            </div>
            <div
              className={`rounded-lg border px-2.5 py-2 text-[11px] ${darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}
            >
              <div className={`mb-1.5 text-xs font-semibold ${hintStrong}`}>中间计算结果</div>
              <div
                className={`mb-1.5 h-1.5 w-full overflow-hidden rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width] duration-1000 ease-linear"
                  style={{ width: `${stokesCalcBarPct}%` }}
                />
              </div>
              <ul className={`space-y-1.5 leading-relaxed ${hintMuted}`}>
                <li className={`flex flex-wrap items-baseline gap-x-1 gap-y-0.5 ${hintStrong}`}>
                  <InlineMath math="\omega_s" />
                  <span>（水中加权平均沉速）=</span>
                  {stokesCommittedWs != null && Number.isFinite(stokesCommittedWs) ? (
                    <span className="font-mono font-semibold">{formatLiuBinghamAuxScalar(stokesCommittedWs)}</span>
                  ) : (
                    '—'
                  )}
                  <span>m/s</span>
                </li>
              </ul>
            </div>
            {!ok && (rhoGStr || rhoWStr || diMStr || muWStr) && (
              <p className={`text-[11px] ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                需满足 <InlineMath math="\rho_g>\rho_w>0" />、<InlineMath math="d_i>0" />、<InlineMath math="\mu_w>0" />、<InlineMath math="g>0" />。
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
                disabled={!ok || stokesCalcBusy}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                  darkMode ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (!ok || stokesCalcBusy || !Number.isFinite(omegaSRounded)) return
                  setStokesCalcBusy(true)
                  setStokesCalcBarPct(0)
                  window.requestAnimationFrame(() => setStokesCalcBarPct(100))
                  window.setTimeout(() => {
                    setStokesCommittedWs(omegaSRounded)
                    onApplyOmegaS(formatLiuSlurryVelocityRawInput(omegaSRounded), { dM: d_i_m })
                    setStokesCalcBusy(false)
                    setOpen(false)
                  }, 1000)
                }}
              >
                计算
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

function kPaToFluidHeadM(kpa: number, rhoKgPerM3: number, g: number): string {
  if (!Number.isFinite(kpa) || rhoKgPerM3 <= 0 || g <= 0) return '—'
  return ((kpa * 1000) / (rhoKgPerM3 * g)).toFixed(3)
}

/** 横轴刻度等分数（与 L_max 计算步长 L_max/10）；曲线本身用密集点折线便于悬停读数 */
const HYDRAULIC_GRADE_TICK_DIVISIONS = 10
const HYDRAULIC_GRADE_CURVE_POINTS = 240

/** 衍生计算结果区 BlockMath（与坡度图纵轴一致） */
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
      <InlineMath math="P_n" />（泵站零件）、<InlineMath math="P_z" />（出口余压）为集中项，未计入纵坐标高程线。
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
  return (rho_s * g * i_k * l) / 1000 + (Lmax > 0 ? P_j * (l / Lmax) : 0)
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
  return (rho_w * g * i_w * l) / 1000 + (Lmax > 0 ? P_j * (l / Lmax) : 0)
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

/** 浆体页对比用「清水」水力坡度：与当前页浆体输入一致的几何扬程 H、管长 L、P_j、g，取 ρ_w=1000 kg/m³、i_w=i_k（清水总扬程同一损失模型，不读清水模块参数）。 */
const SLURRY_CHART_CLEAR_WATER_RHO = 1000

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
    (slurryCumLossKpaAt(l, Lmax, rho_s, gS, i_k, PjS) * 1000) / (rho_k * gS)
  const slurrySeries = slurryOk
    ? buildDenseHydraulicGradeHead(Lmax, Hs, slurryLossHeadM, numPoints)
    : []

  const clearOk = slurryOk
  if (!slurryOk) {
    return { data: [], slurryOk: false, clearOk: false }
  }

  const rho_w = SLURRY_CHART_CLEAR_WATER_RHO
  const clearLossHeadM = (l: number) =>
    (clearWaterCumLossKpaAt(l, Lmax, rho_w, gS, i_k, PjS) * 1000) / (rho_w * gS)
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

/** 最大允许压力运行线：1.5×浆体水力坡降纵坐标高程 − 地形高度 */
function hydraulicMaxAllowPressureLineHeadM(headSlurry: number, terrainZ: number): number | undefined {
  if (!Number.isFinite(headSlurry) || !Number.isFinite(terrainZ)) return undefined
  return 1.5 * headSlurry - terrainZ
}

function computeClearWaterHydraulicDerivativeValues(
  params: Record<string, number | undefined>
): null | { H: number; deltaHw: number; H0: number } {
  const Lmax = Number(params.L)
  const rho_w = Number(params.rho_w ?? 1000)
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
  const deltaHw = (clearWaterCumLossKpaAt(Lmax, Lmax, rho_w, g, i_w, P_j) * 1000) / (rho_w * g)
  return { H, deltaHw, H0: H + deltaHw }
}

function fmtHeadM3(x: number): string {
  return Number.isFinite(x) ? x.toFixed(3) : '—'
}

/**
 * 与「中间计算结果」同卡片样式；先公式再按上式代入的数值，用语与式中 H(l)、l 一致。
 */
function HydraulicDerivativeResultsSection({
  darkMode,
  parameters,
}: {
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

  const v = computeClearWaterHydraulicDerivativeValues(parameters)
  if (!v) return null
  return (
    <div className={surfaceCls}>
      <div className={`text-sm font-medium mb-3 ${titleCls}`}>衍生计算结果：</div>
      <div className={`text-sm font-medium mb-2 ${titleCls}`}>高程（纵坐标）</div>
      <p className={`text-sm mb-4 leading-relaxed ${bodyCls}`}>
        输入 <InlineMath math="H" /> 为<strong>扬送清水的几何高度</strong>，与 <InlineMath math="l=L_{\max}" /> 处纵坐标一致；下式为清水坡度线的<strong>高程</strong> <InlineMath math="H(l)" />。
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

type SlurryHydraulicChartRow = MergedHydraulicRow & {
  /** 纵坐标：折算清水柱高度 (m)，≈ 1000·P/(ρ_w g)，ρ_w=1000 kg/m³ 时与同压力下水柱米高一致；等于 headSlurry（内层混合水头）× ρ_k/1000 */
  headSlurryDisplay: number
  terrainZ?: number
  maxPressZ?: number
}

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
  language = 'zh',
}: {
  darkMode: boolean
  Lmax: number
  slurryParams: Record<string, number | undefined>
  language?: 'zh' | 'en'
}) {
  const [showSlurry, setShowSlurry] = useState(true)
  const [showClear, setShowClear] = useState(true)
  /** 主图上的地形数据：仅「添加到主图」后写入 */
  const [appliedTerrain, setAppliedTerrain] = useState<AppliedTerrainState | null>(null)
  /** 编辑区草稿（未添加前不影响主图） */
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
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false)

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
    const rk = Number(slurryParams.rho_k)
    const headSlurryToDisplay = (raw: number) =>
      slurryOk && Number.isFinite(rk) && rk > 0 && Number.isFinite(raw) ? (raw * rk) / 1000 : raw
    return chartData.map((r) => {
      const headSlurryDisplay = headSlurryToDisplay(r.headSlurry)
      if (!terrainDrawOk) {
        return { ...r, headSlurryDisplay }
      }
      const tz = interpolateTerrainZ(r.L, terrainVerts)
      return {
        ...r,
        headSlurryDisplay,
        terrainZ: tz,
        maxPressZ: hydraulicMaxAllowPressureLineHeadM(headSlurryDisplay, tz),
      }
    })
  }, [chartData, terrainDrawOk, terrainVerts, slurryOk, slurryParams.rho_k])

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
      ? (slurryCumLossKpaAt(Lmax, Lmax, rho_s, gSlurry, i_k, P_j_s) * 1000) / (rho_k * gSlurry)
      : 0
  const totalLossHeadClearM =
    slurryOk && Number.isFinite(rho_w_clear) && rho_w_clear > 0 && gClear > 0
      ? (clearWaterCumLossKpaAt(Lmax, Lmax, rho_w_clear, gClear, i_k, P_j_s) * 1000) / (rho_w_clear * gClear)
      : 0

  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const d of chartRows) {
      if (showSlurry && slurryOk && Number.isFinite(d.headSlurryDisplay)) {
        lo = Math.min(lo, d.headSlurryDisplay)
        hi = Math.max(hi, d.headSlurryDisplay)
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
    const rk = Number(slurryParams.rho_k)
    const headSlurryToDisplay = (raw: number) =>
      slurryOk && Number.isFinite(rk) && rk > 0 && Number.isFinite(raw) ? (raw * rk) / 1000 : raw
    let lo = Infinity
    let hi = -Infinity
    for (const d of chartData) {
      if (slurryOk && Number.isFinite(d.headSlurry)) {
        const hd = headSlurryToDisplay(d.headSlurry)
        lo = Math.min(lo, hd)
        hi = Math.max(hi, hd)
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
        const hd = headSlurryToDisplay(d.headSlurry)
        const maxPressZ = hydraulicMaxAllowPressureLineHeadM(hd, tz) ?? NaN
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
  }, [chartData, slurryOk, clearOk, terrainDrawOk, terrainVerts, slurryParams.rho_k])

  const minSepL = Math.max(Lmax * 0.008, 1e-6)

  const handleApplyBulkTerrain = () => {
    const r = parseTerrainMiddleBulk(bulkText, Lmax)
    if (!r.ok) {
      setEditorErr(r.err)
      return
    }
    setEditorErr(null)
    setDraftMiddlePts(r.pts)
    setBulkPasteOpen(false)
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
      setEditorErr(
        language === 'en'
          ? 'Enter valid terrain start/end elevations and valid L_max.'
          : '请填写有效的地形线起点高度、终点高度，且 L_max 有效。'
      )
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
      return { L: r.L, terrainZ }
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
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { previewYMin: 0, previewYMax: 1 }
    const span = Math.max(hi - lo, 1e-6)
    const pad = Math.max(span * 0.06, 0.5)
    return { previewYMin: lo - pad, previewYMax: hi + pad }
  }, [terrainPreviewRows])

  const handleExportChartPNG = () => {
    if (!hydraulicExportYDomain) return
    const dateStr = new Date().toISOString().slice(0, 10)
    const rk = Number(slurryParams.rho_k)
    const slurryPts = chartData.map((r: MergedHydraulicRow) => ({
      L: r.L,
      H:
        slurryOk && Number.isFinite(rk) && rk > 0 && Number.isFinite(r.headSlurry)
          ? r.headSlurry * rk
          : r.headSlurry,
    }))
    const clearPts: { L: number; H: number }[] =
      clearOk && chartData.every((r: MergedHydraulicRow) => r.headClear != null)
        ? chartData.map((r: MergedHydraulicRow) => ({ L: r.L, H: r.headClear as number }))
        : []
    const extra: { curve: { L: number; H: number }[]; color: string; legend: string }[] = []
    if (terrainDrawOk && showTerrainLine) {
      extra.push({
        curve: chartData.map((r) => ({ L: r.L, H: interpolateTerrainZ(r.L, terrainVerts) })),
        color: TERRAIN_EXPORT_LINE,
        legend: '地形线（高程）',
      })
    }
    if (terrainDrawOk && showMaxPressLine) {
      extra.push({
        curve: chartData.map((r) => {
          const terrainZ = interpolateTerrainZ(r.L, terrainVerts)
          const hd =
            slurryOk && Number.isFinite(rk) && rk > 0 && Number.isFinite(r.headSlurry)
              ? r.headSlurry * rk
              : r.headSlurry
          const maxPressZ = hydraulicMaxAllowPressureLineHeadM(hd, terrainZ) ?? NaN
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
      secondLegendText: '清水水力坡度线',
      extraHydraulicCurves: extra.length ? extra : undefined,
      darkMode,
      title: language === 'en' ? 'Hydraulic grade line' : '水力坡度线',
      xAxisLabel: language === 'en' ? 'Pipe length (m)' : '管长 (m)',
      yAxisLabel: language === 'en' ? 'Elevation (m)' : '高程 (m)',
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
      <div className="flex items-center justify-between mb-3">
        <div className={`text-lg font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
          {language === 'en' ? 'Hydraulic grade line' : '水力坡度线'}
        </div>
        <button
          type="button"
          onClick={handleExportChartPNG}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            darkMode ? 'border-gray-500 text-gray-300 hover:bg-gray-500' : 'border-gray-300 text-gray-600 hover:bg-gray-100'
          }`}
        >
          {language === 'en' ? 'Export PNG' : '导出图片'}
        </button>
      </div>

      <details
        className={`mb-3 rounded-lg border text-xs ${
          darkMode ? 'border-gray-500 bg-gray-800/40' : 'border-gray-200 bg-gray-50/90'
        }`}
      >
        <summary
          className={`cursor-pointer select-none px-3 py-2 font-medium [&::-webkit-details-marker]:hidden ${
            darkMode ? 'text-gray-200' : 'text-gray-700'
          }`}
        >
          {language === 'en' ? 'Chart notes' : '读图说明'}
        </summary>
        <div
          className={`space-y-4 border-t px-3 py-3 leading-relaxed ${
            darkMode ? 'border-gray-500 text-gray-400' : 'border-gray-200 text-gray-600'
          }`}
        >
          <div>
            <div
              className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${
                darkMode ? 'text-gray-300' : 'text-gray-500'
              }`}
            >
              {language === 'en' ? 'Axes & curves' : '坐标与曲线'}
            </div>
            <div className="space-y-2">
              {language === 'en' ? (
                <>
                  <p>
                    Abscissa <InlineMath math="[0,L_{\max}]" />; tick step{' '}
                    <span className="font-mono">{stepStr}</span> m. Ordinate: freshwater-equivalent head{' '}
                    <InlineMath math="1000\,P/(\rho_w g)" /> with <InlineMath math="\rho_w=1000\ \mathrm{kg/m^3}" /> (slurry: model head ×{' '}
                    <InlineMath math="\rho_k/1000" />
                    ). Hover shows elevation and pressure.
                  </p>
                  <p>
                    <strong className="text-amber-600 dark:text-amber-400">Slurry</strong> line uses this page’s slurry total-head model;{' '}
                    <strong className="text-blue-600 dark:text-blue-400">clear-water comparison</strong> uses the same{' '}
                    <InlineMath math="H,L,P_j,g" /> with <InlineMath math="\rho_w=1000\ \mathrm{kg/m^3}" />, <InlineMath math="i_w=i_k" />.
                  </p>
                  <p>
                    Terrain is edited below; preview is separate until{' '}
                    <strong className={darkMode ? 'text-gray-200' : 'text-gray-800'}>Add to main chart</strong>, then terrain and the max.
                    allowable line overlay the plot.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    横轴 <InlineMath math="[0,L_{\max}]" />，主刻度步长 <span className="font-mono">{stepStr}</span> m。纵坐标为折算清水柱{' '}
                    <InlineMath math="1000\,P/(\rho_w g)" />（<InlineMath math="\rho_w=1000\ \mathrm{kg/m^3}" />
                    ），浆体线为模型水头 × <InlineMath math="\rho_k/1000" />；悬停可读高程与压力。
                  </p>
                  <p>
                    <strong className="text-amber-600 dark:text-amber-400">浆体线</strong>按本页浆体总扬程；
                    <strong className="text-blue-600 dark:text-blue-400">清水对比线</strong>与当前页相同 <InlineMath math="H,L,P_j,g" />，取{' '}
                    <InlineMath math="\rho_w=1000\ \mathrm{kg/m^3}" />、<InlineMath math="i_w=i_k" />。
                  </p>
                  <p>
                    地形在下方编辑；预览与主图分离，点击「
                    <strong className={darkMode ? 'text-gray-200' : 'text-gray-800'}>添加到主图</strong>
                    」后叠加地形与最大允许压力线。
                  </p>
                </>
              )}
            </div>
          </div>
          <div>
            <div
              className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${
                darkMode ? 'text-gray-300' : 'text-gray-500'
              }`}
            >
              {language === 'en' ? 'Caption & inlet heads' : '图注与进口端'}
            </div>
            <div className="space-y-2">
              <HydraulicSlopeScopeNote />{' '}
              {language === 'en' ? (
                <>
                  <p>
                    Slurry-line inlet ordinate (freshwater head, <InlineMath math="1000\,P/(\rho_w g)" />, <InlineMath math="\rho_w=1000\ \mathrm{kg/m^3}" />) ≈{' '}
                    {Number.isFinite(H_in) && Number.isFinite(totalLossHeadM) && Number.isFinite(rho_k)
                      ? (((H_in + totalLossHeadM) * rho_k) / 1000).toFixed(1)
                      : '—'}{' '}
                    m (inner <InlineMath math="H+\Delta h_{\mathrm{k}}(L_{\max})" /> ≈{' '}
                    {Number.isFinite(H_in + totalLossHeadM) ? (H_in + totalLossHeadM).toFixed(1) : '—'} m × <InlineMath math="\rho_k/1000" />
                    ; <InlineMath math="P_j" /> share ≈{' '}
                    {Number.isFinite(totalLossHeadM) && Number.isFinite(rho_k)
                      ? ((totalLossHeadM * rho_k) / 1000).toFixed(1)
                      : '—'}{' '}
                    m column).
                    Clear-water inlet ≈ <InlineMath math="H+\Delta h_{\mathrm{w}}(L_{\max})" /> ≈{' '}
                    {Number.isFinite(H_in + totalLossHeadClearM) ? (H_in + totalLossHeadClearM).toFixed(1) : '—'} m (Δh_w ={' '}
                    {totalLossHeadClearM.toFixed(1)} m).
                    {terrainDrawOk ? <> Max. allowable line: 1.5× (slurry-grade elevation) − terrain.</> : null}
                  </p>
                </>
              ) : (
                <>
                  <p>
                    浆体线进口纵坐标（折算清水柱）≈{' '}
                    {Number.isFinite(H_in) && Number.isFinite(totalLossHeadM) && Number.isFinite(rho_k)
                      ? (((H_in + totalLossHeadM) * rho_k) / 1000).toFixed(1)
                      : '—'}{' '}
                    m（内层 <InlineMath math="H+\Delta h_{\mathrm{k}}(L_{\max})" /> ≈{' '}
                    {Number.isFinite(H_in + totalLossHeadM) ? (H_in + totalLossHeadM).toFixed(1) : '—'} m × <InlineMath math="\rho_k/1000" />
                    ；<InlineMath math="P_j" /> 分摊损失折合约{' '}
                    {Number.isFinite(totalLossHeadM) && Number.isFinite(rho_k) ? ((totalLossHeadM * rho_k) / 1000).toFixed(1) : '—'} m）。清水对比线同端 ≈{' '}
                    <InlineMath math="H+\Delta h_{\mathrm{w}}(L_{\max})" /> ≈{' '}
                    {Number.isFinite(H_in + totalLossHeadClearM) ? (H_in + totalLossHeadClearM).toFixed(1) : '—'} m（分摊折合{' '}
                    {totalLossHeadClearM.toFixed(1)} m）。
                    {terrainDrawOk ? <> 最大允许压力线：各点 1.5×浆体坡度纵坐标 − 地形高程。</> : null}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </details>

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
                  value: language === 'en' ? 'Pipe length (m)' : '管长 (m)',
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
                  value: language === 'en' ? 'Elevation (m)' : '高程 (m)',
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
                          .filter((p) => p.dataKey === 'headSlurryDisplay')
                          .map((p) => {
                            const hm = Number(p.value)
                            const pk = Number.isFinite(hm) && gSlurry > 0 ? hm * gSlurry : NaN
                            return (
                              <div key="s" className="text-amber-600 dark:text-amber-400">
                                {language === 'en' ? 'Slurry hydraulic grade:' : '浆体水力坡度：'}
                                {language === 'en' ? ' elevation ' : ' 高程 '}
                                {Number.isFinite(hm) ? hm.toFixed(3) : '—'} m
                                {Number.isFinite(pk)
                                  ? language === 'en'
                                    ? `, ${pk.toFixed(2)} kPa`
                                    : `，压力 ${pk.toFixed(2)} kPa`
                                  : null}
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
                                ? (hm * rho_w_clear * gClear) / 1000
                                : NaN
                            return (
                              <div key="c" className="text-blue-600 dark:text-blue-400">
                                {language === 'en' ? 'Clear-water comparison:' : '清水水力坡度：'}
                                {language === 'en' ? ' elevation ' : ' 高程 '}
                                {Number.isFinite(hm) ? hm.toFixed(3) : '—'} m
                                {Number.isFinite(pk)
                                  ? language === 'en'
                                    ? `, ${pk.toFixed(2)} kPa`
                                    : `，压力 ${pk.toFixed(2)} kPa`
                                  : null}
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
                                {language === 'en' ? 'Terrain elevation:' : '地形高程：'}{' '}
                                {Number.isFinite(zv) ? zv.toFixed(3) : '—'} m
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
                                {language === 'en' ? 'Max. allowable line elevation:' : '最大允许压力线高程：'}
                                {Number.isFinite(mv) ? mv.toFixed(3) : '—'} m
                              </div>
                            )
                          })}
                    </div>
                  )
                }}
              />
              <Line
                type="linear"
                dataKey="headSlurryDisplay"
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
            {language === 'en' ? 'Slurry hydraulic grade' : '浆体水力坡度线'}
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
            {language === 'en' ? 'Clear-water comparison grade' : '清水水力坡度线'}
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
                {language === 'en' ? 'Terrain' : '地形线'}
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
                {language === 'en' ? 'Max. allowable operating line' : '最大允许运行压力线'}
              </label>
            </>
          ) : null}
        </div>
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
            {language === 'en' ? 'Add terrain polyline' : '添加地形线'}
          </h3>
        </div>
        <div className="space-y-4 px-4 py-4">
          <p className={`text-xs leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {language === 'en' ? (
              <>
                Start/end elevations at <InlineMath math="L=0" /> and <InlineMath math="L=L_{\max}" />, optional middles. Preview below;{' '}
                <strong className={darkMode ? 'text-gray-200' : 'text-gray-800'}>Add to main chart</strong> overlays terrain and the max.
                allowable line.
              </>
            ) : (
              <>
                填写起点、终点（<InlineMath math="L=0" />、<InlineMath math="L=L_{\max}" />）及可选中间点；下方预览。「
                <strong className={darkMode ? 'text-gray-200' : 'text-gray-800'}>添加到主图</strong>
                」后主图叠加地形与最大允许压力线。
              </>
            )}
          </p>

          <div
            className={`space-y-3 rounded-lg border p-3 sm:p-4 ${darkMode ? 'border-gray-600 bg-gray-900/30' : 'border-gray-200 bg-gray-50'}`}
          >
            <div className={`text-xs font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {language === 'en' ? 'Terrain vertices (start, end & middles)' : '地形折线：起点、终点与中间点'}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className={`mb-1 block text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {language === 'en' ? 'Terrain start elevation:' : '地形线起点高度：'}
                </span>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draftZ0Str}
                    onChange={(e) => setDraftZ0Str(e.target.value)}
                    placeholder={
                      language === 'en' ? 'Terrain start elevation, e.g. 12.5' : '地形线起点高度，如 12.5'
                    }
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
                  {language === 'en' ? 'Terrain end elevation:' : '地形线终点高度：'}
                </span>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draftZ1Str}
                    onChange={(e) => setDraftZ1Str(e.target.value)}
                    placeholder={
                      language === 'en' ? 'Terrain end elevation, e.g. 11.8' : '地形线终点高度，如 11.8'
                    }
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
                  {language === 'en' ? 'Middle point: pipe length L' : '中间点：管长 L'}
                </span>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualLStr}
                    onChange={(e) => setManualLStr(e.target.value)}
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
                  {language === 'en' ? 'Elevation z' : '高程 z'}
                </span>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualZStr}
                    onChange={(e) => setManualZStr(e.target.value)}
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
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setBulkPasteOpen((open) => !open)}
                  aria-expanded={bulkPasteOpen}
                  className={`text-left text-xs underline-offset-2 hover:underline ${
                    darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {language === 'en' ? 'Bulk paste middles' : '批量粘贴中间点'}
                </button>
                <button
                  type="button"
                  onClick={handleAddManualMiddle}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {language === 'en' ? 'Add middle point' : '添加中间点'}
                </button>
              </div>
              {bulkPasteOpen ? (
                <div
                  className={`space-y-2 rounded-lg border p-3 ${
                    darkMode ? 'border-gray-600 bg-gray-900/30' : 'border-gray-200 bg-white'
                  }`}
                >
                  <p className={`text-[11px] leading-relaxed ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                    {language === 'en'
                      ? 'Two columns per line: L and elevation; paste from spreadsheets; a header row is auto-skipped.'
                      : '每行两列：管长 L、高程；可从表格复制；首行若为文字表头会自动跳过。'}
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
                      {language === 'en' ? 'Apply' : '添加'}
                    </button>
                  </div>
                </div>
              ) : null}
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
                    L = {p.L.toFixed(2)} m，{language === 'en' ? 'z' : '高程'} = {p.z.toFixed(3)} m
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveMiddle(p.id)}
                    className="shrink-0 text-red-500 hover:underline"
                  >
                    {language === 'en' ? 'Remove' : '删除'}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {editorErr ? <p className="text-sm text-red-500 dark:text-red-400">{editorErr}</p> : null}
          </div>

          <div className={`rounded-lg border ${darkMode ? 'border-gray-600' : 'border-gray-200'}`}>
            <div
              className={`border-b px-3 py-2 text-xs font-medium ${darkMode ? 'border-gray-600 text-gray-400' : 'border-gray-200 text-gray-600'}`}
            >
              {language === 'en' ? 'Terrain profile preview' : '地形线预览图'}
            </div>
            <div className="p-2 sm:p-3">
              <div
                className={`mb-2 flex min-h-[1.25rem] flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
              >
                <p className={`tabular-nums ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {appliedTerrain ? (
                    <>
                      {language === 'en' ? 'Main chart: terrain applied (' : '主图已叠加（'}
                      {appliedTerrain.middlePts.length}
                      {language === 'en' ? ' middle points).' : ' 个中间点）。'}
                    </>
                  ) : null}
                </p>
                <div className={`text-right text-xs tabular-nums sm:shrink-0 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {previewHover ? (
                    <span>
                      L = {previewHover.L.toFixed(3)} m，{language === 'en' ? 'elevation' : '高程'}={' '}
                      {previewHover.z.toFixed(3)} m
                    </span>
                  ) : (
                    <span className="opacity-60">{language === 'en' ? 'Hover preview' : '悬停预览'}</span>
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
                          value: language === 'en' ? 'Pipe length (m)' : '管长 (m)',
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
                          value: language === 'en' ? 'Elevation (m)' : '高程 (m)',
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
                                    {language === 'en' ? 'Elevation' : '高程'} ={' '}
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
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className={`py-8 text-center text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  {language === 'en'
                    ? 'Enter valid terrain start and end elevations.'
                    : '请输入有效的地形线起点、终点高度。'}
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
                    {language === 'en' ? 'Terrain' : '地形线'}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

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
              {language === 'en' ? 'Add to main chart' : '添加到主图'}
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
    const lossHeadM = (l: number) => (clearWaterCumLossKpaAt(l, Lmax, rho_w, g, i_w, P_j) * 1000) / (rho_w * g)
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
      ? (clearWaterCumLossKpaAt(Lmax, Lmax, rho_w, g, i_w, P_j) * 1000) / (rho_w * g)
      : 0

  const handleExportChartPNG = () => {
    const dateStr = new Date().toISOString().slice(0, 10)
    downloadScientificHlChartPng({
      curveData: chartData.map((r) => ({ L: r.L, H: r.headClear })),
      darkMode,
      title: '水力坡度线',
      xAxisLabel: '管长 (m)',
      yAxisLabel: '高程 (m)',
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
      <div className="flex items-center justify-between mb-3">
        <div className={`text-lg font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>水力坡度线</div>
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

      <details
        className={`mb-3 rounded-lg border text-xs ${
          darkMode ? 'border-gray-500 bg-gray-800/40' : 'border-gray-200 bg-gray-50/90'
        }`}
      >
        <summary
          className={`cursor-pointer select-none px-3 py-2 font-medium [&::-webkit-details-marker]:hidden ${
            darkMode ? 'text-gray-200' : 'text-gray-700'
          }`}
        >
          读图说明
        </summary>
        <div
          className={`space-y-4 border-t px-3 py-3 leading-relaxed ${
            darkMode ? 'border-gray-500 text-gray-400' : 'border-gray-200 text-gray-600'
          }`}
        >
          <div>
            <div
              className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${
                darkMode ? 'text-gray-300' : 'text-gray-500'
              }`}
            >
              坐标与曲线
            </div>
            <div className="space-y-2">
              <p>
                横轴 <InlineMath math="[0,L_{\max}]" />，主刻度步长 <span className="font-mono">{stepStr}</span> m。纵坐标为<strong>高程</strong>
                ，悬停可读折算压力。
              </p>
              <p>
                <strong className="text-blue-600 dark:text-blue-400">清水线</strong>按本页清水总扬程：
                <InlineMath math="\rho_w" />、<InlineMath math="g" />、<InlineMath math="i_w" />、几何高度 <InlineMath math="H" />、管长{' '}
                <InlineMath math="L_{\max}" />、<InlineMath math="P_j" />；沿程损失按{' '}
                <InlineMath math="\rho_w g i_w l + P_j\cdot(l/L_{\max})" /> 折合为清水柱高后计入纵坐标。
              </p>
            </div>
          </div>
          <div>
            <div
              className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${
                darkMode ? 'text-gray-300' : 'text-gray-500'
              }`}
            >
              图注与进口端
            </div>
            <p>
              <HydraulicSlopeScopeNote /> 进口端纵坐标高程 <InlineMath math="H+\Delta h_{\mathrm{w}}(L_{\max})" /> ≈{' '}
              {Number.isFinite(H + totalLossHeadM) ? (H + totalLossHeadM).toFixed(1) : '—'} m。
            </p>
          </div>
        </div>
      </details>

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
                value: '管长 (m)',
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
                value: '高程 (m)',
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
                      清水水力坡度：高程 {Number.isFinite(hm) ? hm.toFixed(3) : '—'} m
                      {Number.isFinite(pk) ? `，压力 ${pk.toFixed(2)} kPa` : null}
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

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
})

interface MainContentProps {
  formula: FormulaInfo | null
  darkMode?: boolean
  currentView?: 'formula' | 'about' | 'settings'
  aboutDepartment?: string | null
  language?: 'zh' | 'en'
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
  /** 宾汉 ω 面板中求得的物料粒径 d_i（m），供斯托克斯 ω_s 面板默认值与锁定后刷新 */
  const [liuOmegaDiMByFormula, setLiuOmegaDiMByFormula] = useState<Record<string, number | null>>({})
  const [kronodzeStep2ReadyMap, setKronodzeStep2ReadyMap] = useState<Record<string, boolean>>({})
  const [kronodzeStep3VisibleMap, setKronodzeStep3VisibleMap] = useState<Record<string, boolean>>({})
  
  // 当前公式的参数（从formulaParameters中获取）
  const parameters = formula ? (formulaParameters[formula.id] || {}) : {}
  const rawInputs = formula ? (formulaRawInputs[formula.id] || {}) : {}
  const result = formula ? (formulaResults[formula.id] || null) : null
  const lockedVc = formula ? (formulaLockedVc[formula.id] ?? null) : null
  const liuOmegaDiM = formula ? (liuOmegaDiMByFormula[formula.id] ?? null) : null
  const kronodzeStep2Ready = formula ? (kronodzeStep2ReadyMap[formula.id] || false) : false
  const kronodzeStep3Visible = formula ? (kronodzeStep3VisibleMap[formula.id] || false) : false
  const { setAssistantSnapshot } = useAssistantSnapshotOptional()

  useEffect(() => {
    const p = formula ? { ...(formulaParameters[formula.id] ?? {}) } : {}
    setAssistantSnapshot({
      currentView,
      aboutDepartment,
      language: language ?? 'zh',
      formula: formula
        ? {
            id: formula.id,
            name: formula.name,
            descriptionSnippet: buildFormulaDescriptionSnippet(formula.description),
          }
        : null,
      parameters: p,
      lastCalculation: result,
      lockedVc,
    })
  }, [
    setAssistantSnapshot,
    currentView,
    aboutDepartment,
    language,
    formula?.id,
    formula?.name,
    formula?.description,
    formulaParameters,
    formulaResults,
    result,
    lockedVc,
  ])

  const isSlurryAccelFormula = formula?.id === 'slurry_accel_energy'
  // 名称「浆体消能」作为兜底：防止列表顺序/旧数据导致 id 异常时仍走加速流接口
  /** 缩径消能（原浆体消能计算） */
  const isSlurryDissipationReducer =
    formula?.id === 'slurry_dissipation' || formula?.id === 'slurry_energy_dissipation'
  const isSlurryDissipationOrifice = formula?.id === 'slurry_dissipation_orifice'
  /** 与历史代码兼容：仅缩径消能走消能计算链 */
  const isSlurryDissipationFormula = isSlurryDissipationReducer
  const isClearWaterFrictionLoss = formula?.id === 'clear_water_friction_loss'
  const isSlurryFrictionWorkflow = formula?.id === 'slurry_friction_workflow'
  const isPseudoHomogeneousFlowJudgment = formula?.id === 'pseudo_homogeneous_flow_judgment'
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
      density_mixing: { ...(prev.density_mixing || {}), rho_s: '1000' }
    }))
    setFormulaParameters((prev) => ({
      ...prev,
      density_mixing: { ...(prev.density_mixing || {}), rho_s: 1000 }
    }))
  }, [isSlurryFrictionWorkflow, densityMixingRawRhoS, densityMixingRhoS])

  // 浆体摩阻工作流步骤4：ε 默认显示并使用「直缝新钢管 0.053 mm」
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
  const [feiLambdaAuxEta1, setFeiLambdaAuxEta1] = useState('')
  const [feiLambdaAuxEpsilonPreset, setFeiLambdaAuxEpsilonPreset] =
    useState<SlurryEpsilonPresetKey>(DEFAULT_SLURRY_EPSILON_PRESET)
  const [feiLambdaAuxEpsilonCustom, setFeiLambdaAuxEpsilonCustom] = useState('0.053')
  /** 费祥俊 λ：用户在主表手写后置 true；从辅助「填入」后置 false */
  const feiLambdaManualRef = useRef(false)
  /** 刘德忠 ω / ω_s：主表直接编辑后置 true；从辅助「填入」后置 false 并记录 η、d 等供锁定后自动刷新 */
  const liuOmegaManualRef = useRef(false)
  const liuOmegaSManualRef = useRef(false)
  const liuBinghamEtaForAutoRef = useRef<number | null>(null)
  const liuStokesDiMForAutoRef = useRef<number | null>(null)
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
  /** 浆体管道流态判断公式：代表粒径档状态（按公式 id 分槽；界面不再展示粒径表） */
  const [pseudoFlowRowsByFormula, setPseudoFlowRowsByFormula] = useState<
    Record<string, PseudoHomogeneousFlowRow[]>
  >({})
  /** 分步行 C/C_A：各档链路中间量；选中行索引按公式分槽 */
  const [pseudoCcaChainByFormula, setPseudoCcaChainByFormula] = useState<
    Record<string, Record<number, PseudoCcaChainSnapshot>>
  >({})
  const [pseudoCcaActiveRowByFormula, setPseudoCcaActiveRowByFormula] = useState<Record<string, number>>({})
  const [pseudoCcaKnownOverrideByFormula, setPseudoCcaKnownOverrideByFormula] = useState<
    Record<string, Record<number, PseudoCcaKnownOverrideFields>>
  >({})
  const [pseudoCcaStepBusyKey, setPseudoCcaStepBusyKey] = useState<string | null>(null)
  /** 浆体管道流态判断公式 · 分步 f_L：粗糙度下拉与手填（mm），写入主参数 epsilon 供链式调用 */
  const [pseudoCcaEpsilonPreset, setPseudoCcaEpsilonPreset] =
    useState<SlurryEpsilonPresetKey>(DEFAULT_SLURRY_EPSILON_PRESET)
  const [pseudoCcaEpsilonCustomMm, setPseudoCcaEpsilonCustomMm] = useState('0.053')

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
  const renderAppHeader = () => (
    <div className="mb-6">
      <h1 className={`text-2xl font-bold tracking-wide mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
        {language === 'en' ? APP_TITLE_MAIN_EN : APP_TITLE_MAIN_ZH}
      </h1>
      <p className={`text-xs leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        {language === 'en' ? APP_TAGLINE_MAIN_EN : APP_TAGLINE_ZH}
      </p>
    </div>
  )
  
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

  const feiLambdaAssistPreview = useMemo(() => {
    if (formula?.id !== 'fei_xiangjun') return null
    return computeFeiDarcyAssistPreview({
      language,
      D: parameters['D'],
      rho_g: parameters['rho_g'],
      rho_k: parameters['rho_k'],
      Cv: parameters['Cv'],
      d90: parameters['d90'],
      g: parameters['g'],
      coefficient_2_26: parameters['coefficient_2_26'],
      feiLambdaAuxEta1,
      feiLambdaAuxEpsilonPreset,
      feiLambdaAuxEpsilonCustom,
      lambdaSeed: parameters['lambda_coef'],
    })
  }, [
    formula?.id,
    language,
    parameters.D,
    parameters.rho_g,
    parameters.rho_k,
    parameters.Cv,
    parameters.d90,
    parameters.g,
    parameters.coefficient_2_26,
    parameters.lambda_coef,
    feiLambdaAuxEta1,
    feiLambdaAuxEpsilonPreset,
    feiLambdaAuxEpsilonCustom,
  ])

  const computeFeiAssistPreviewNow = useCallback((): FeiDarcyAssistPreviewRow => {
    return computeFeiDarcyAssistPreview({
      language,
      D: parameters['D'],
      rho_g: parameters['rho_g'],
      rho_k: parameters['rho_k'],
      Cv: parameters['Cv'],
      d90: parameters['d90'],
      g: parameters['g'],
      coefficient_2_26: parameters['coefficient_2_26'],
      feiLambdaAuxEta1,
      feiLambdaAuxEpsilonPreset,
      feiLambdaAuxEpsilonCustom,
      lambdaSeed: parameters['lambda_coef'],
    })
  }, [
    language,
    parameters.D,
    parameters.rho_g,
    parameters.rho_k,
    parameters.Cv,
    parameters.d90,
    parameters.g,
    parameters.coefficient_2_26,
    parameters.lambda_coef,
    feiLambdaAuxEta1,
    feiLambdaAuxEpsilonPreset,
    feiLambdaAuxEpsilonCustom,
  ])

  const feiLambdaAssistPreviewRef = useRef(feiLambdaAssistPreview)
  feiLambdaAssistPreviewRef.current = feiLambdaAssistPreview
  
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
        rho_k_input_kg_m3: { zh: '浆体密度（输入，kg/m³）', math: '\\rho_k\\ \\mathrm{(kg/m^3)}' },
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
    if (formulaId === 'darcy_friction_step3_lambda') {
      const darcyLm: Record<string, { zh: string; en: string; math: string }> = {
        darcy_laminar_formula: {
          zh: '层流区哈根–泊肃叶关系',
          en: 'Laminar (Hagen–Poiseuille)',
          math: '\\lambda = 64/\\mathrm{Re}_B',
        },
        epsilon_over_37D: {
          zh: '粗糙项 ε/(3.7 Dₙ)',
          en: 'Roughness term ε/(3.7 Dₙ)',
          math: '\\varepsilon/(3.7 D_n)',
        },
        swamee_jain_re_term: {
          zh: '雷诺数幂次修正项 5.7385/Re_B^0.9',
          en: 'Exponent correction 5.7385/Re_B^{0.9}',
          math: '5.7385/\\mathrm{Re}_B^{0.9}',
        },
        colebrook_ln_argument: {
          zh: '对数内因（两项之和）',
          en: 'Logarithmic argument (sum of two terms)',
          math: '\\frac{\\varepsilon}{3.7 D_n}+\\frac{5.7385}{\\mathrm{Re}_B^{0.9}}',
        },
        colebrook_ln: {
          zh: '自然对数 ln(·)',
          en: 'Natural logarithm ln(·)',
          math: '\\ln(\\cdot)',
        },
        colebrook_ln_squared: {
          zh: '对数平方 [ln(·)]²（分母因子）',
          en: '[ln(·)]² (denominator factor)',
          math: '\\ln(\\cdot)^{2}',
        },
      }
      const di = darcyLm[key]
      if (di) {
        return (
          <span className="flex flex-col gap-0.5 items-start text-left min-w-0">
            <span
              className={`text-xs leading-snug font-normal ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
            >
              {language === 'en' ? di.en : di.zh}
            </span>
            <InlineMath math={di.math} />
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
      'fei_iteration_count': 'λ–Vc 迭代次数',
      'fei_lambda_rel_residual': 'λ 迭代相对残差',
      'Vc_for_Re': '用于雷诺数的 Vc',
      'rho_1': '混合物密度 ρ₁',
      'epsilon': '管壁绝对粗糙度 ε（mm）',
      'epsilon_mm': '管壁绝对粗糙度 ε（mm）',

      'eta_1': '刚度系数 η',
      
      // 克诺罗兹法（公式中间项）
      'term_cd': '浓度修正项',
      'term_dl': '管径修正项',
      'sqrt_term': '平方根项',
      'sin_theta': 'sin(θ)',
      'step_A_Qk': '浆体体积流量',
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
      'term_1minusC1v_rho_k': '浆体体积项',
      'term_1minusC1v_rho_s': '浆体体积项',
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
      'rho_k_input_kg_m3': '浆体密度 ρ_k（输入，kg/m³）',
      'rho_si_kg_m3': '参与功率计算的 ρ_k（kg/m³）',
      'term_0p25_Cw': '项 0.25·C_w',
      'Sigma_H_s': 'ΣH_s（m）',
      'K_p_K_m': 'K_p·K_m',
      'K_f': '压力富余系数 K_f',
      'P_k': '管道输送压力 P_k',

    }

    const feiIntermediateLabelOverride: Record<string, string> =
      formulaId === 'fei_xiangjun'
        ? {
            fei_Re_flow: language === 'en' ? 'Reynolds number & flow regime' : '雷诺数与流态',
            fei_lambda_rel_residual:
              language === 'en' ? 'Final relative residual (λ iteration)' : 'λ 迭代末步相对残差',
            lambda_coef:
              language === 'en' ? 'Converged Darcy friction factor λ' : '达西摩阻系数 λ（收敛值）',
            delta_rho_ratio: language === 'en' ? 'Relative density difference Δρ/ρ' : '相对密度差 Δρ/ρ',
            bracket_term: language === 'en' ? 'Bracket term' : '核心项',
            conc_term: language === 'en' ? 'Concentration correction' : '浓度修正项',
            size_term: language === 'en' ? 'Size-ratio correction' : '粒径比修正项',
            leading_coef: language === 'en' ? 'Leading coefficient' : '核心系数',
          }
        : {}

    let label = feiIntermediateLabelOverride[key] ?? labelMap[key] ?? key
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
      'fei_lambda_rel_residual':
        '\\frac{|\\lambda_{n+1}-\\lambda_n|}{\\max(\\lambda_n,\\,10^{-12})}',
      'term_cd': '\\sqrt[3]{C_d}',
      'term_dl': '\\sqrt[4]{D_L}',
      'step_A_Qk': 'Q_K',
      'step_B_DL_mm': 'D_L',
      'sqrt_term': '\\sqrt{gD \\cdot \\frac{\\Delta\\rho}{\\rho}}',
      'sin_theta': '\\sin(\\theta)',
      'numerator': 'V^2 \\cdot \\rho_k',
      'denominator': '2gD \\cdot \\rho_s',
      'denom': '\\frac{C_w}{\\rho_g} + \\frac{1-C_w}{\\rho_s}',
      'term_rho_g_C1v': '\\rho_g \\cdot C_{1v}',
      'term_1minusC1v_rho_k': '(1-C_{1v})\\cdot\\rho_k',
      'term_1minusC1v_rho_s': '(1-C_{1v})\\cdot\\rho_k',
      'rho_1_kg_m3': '\\rho_1\\ \\mathrm{(kg/m^3)}',
      're_numerator_V_D_rho_kg': 'V \\cdot D_n \\cdot \\rho_1',
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
        formulaId === 'clear_water_total_head' ? '\\rho_w g H/1000' : '\\rho_k g H/1000'
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
          ? '\\rho_w g i_w L/1000'
          : '\\rho_s g i_k L/1000'
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
        setCurrentVersion(APP_VERSION)
      })
    } else {
      setCurrentVersion(APP_VERSION)
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
    const isSmallSettlingPreview = size === 'small' && (animationType === 'settle-20' || animationType === 'settle-10-flow')
    const isSmallMediumSettle = size === 'small' && animationType === 'settle-20'
    const boxBase =
      size === 'full'
        ? 'w-full h-[60vh] sm:h-[70vh] rounded-xl border-2 relative overflow-hidden'
        : `w-full ${isSmallSettlingPreview ? 'h-28' : 'h-24'} rounded border-2 relative overflow-hidden`

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

    const label = criticalVelocityAnimStatusLabel(animationType, language)

    const scale = size === 'full' ? 1.8 : isSmallSettlingPreview ? 1.3 : 1.14
    const speedScale = size === 'full' ? 1.28 : isSmallSettlingPreview ? 1.14 : 1
    const isSevereSettle = animationType === 'settle-30'
    const isCritical = animationType === 'still-flow'
    const isFast = animationType !== 'settle-30' && animationType !== 'settle-20' && animationType !== 'settle-10-flow' && animationType !== 'still-flow' && animationType !== 'medium-flow'
    const particleCount = size === 'full'
      ? isCritical
        ? 156
        : isFast
          ? 168
          : 158
      : isCritical
        ? 118
        : isFast
          ? 124
          : 116
    const settlingMovingCount = size === 'full'
      ? isSevereSettle
        ? 34
        : animationType === 'settle-20'
          ? 58
          : 82
      : isSevereSettle
        ? 24
        : animationType === 'settle-20'
          ? 96
          : 38
    const settledCount = size === 'full'
      ? isSevereSettle
        ? 240
        : animationType === 'settle-20'
          ? 210
          : 176
      : isSevereSettle
        ? 160
        : animationType === 'settle-20'
          ? 132
          : 236
    const pseudo = (i: number, salt: number) => {
      const x = Math.sin((i + 1) * (salt + 12.9898)) * 43758.5453
      return x - Math.floor(x)
    }
    const particleMeta = (i: number, mode: 'settle' | 'critical' | 'flow') => {
      const diameter = (2.1 + pseudo(i, 1) * 4.2) * scale
      const left =
        mode === 'flow'
          ? -18 + pseudo(i, 2) * 36
          : mode === 'critical'
            ? 4 + pseudo(i, 2) * 92
            : 2 + pseudo(i, 2) * 96
      const top =
        mode === 'settle'
          ? isSevereSettle
            ? 54 + pseudo(i, 3) * 28
            : animationType === 'settle-20'
              ? isSmallMediumSettle
                ? 6 + pseudo(i, 3) * 72
                : 34 + pseudo(i, 3) * 42
              : size === 'small' && animationType === 'settle-10-flow'
                ? 46 + pseudo(i, 3) * 28
                : 6 + pseudo(i, 3) * 72
          : mode === 'critical'
            ? 10 + pseudo(i, 3) * 74
            : 7 + pseudo(i, 3) * 78
      const driftX =
        mode === 'critical'
          ? (0.15 + pseudo(i, 4) * 0.85) * 52 * scale
          : mode === 'settle'
            ? (pseudo(i, 4) - 0.5) * (isSevereSettle ? 18 : 34) * scale
            : (pseudo(i, 4) - 0.5) * 42 * scale
      const driftY =
        mode === 'critical'
          ? (pseudo(i, 5) - 0.5) * 42 * scale
          : (pseudo(i, 5) - 0.5) * (mode === 'settle' ? 18 : 34) * scale
      const fallY =
        mode === 'settle'
          ? (isSevereSettle
            ? 22 + pseudo(i, 6) * 42
            : isSmallMediumSettle
              ? 58 + pseudo(i, 6) * 76
              : size === 'small' && animationType === 'settle-10-flow'
                ? 18 + pseudo(i, 6) * 40
              : 42 + pseudo(i, 6) * 64) * scale
          : (46 + pseudo(i, 6) * 60) * scale
      const duration = (
        mode === 'settle'
          ? isSevereSettle
            ? 9.2 + pseudo(i, 7) * 5.2
            : animationType === 'settle-20'
              ? isSmallMediumSettle
                ? 4.2 + pseudo(i, 7) * 2.6
                : 6.8 + pseudo(i, 7) * 4.1
              : size === 'small' && animationType === 'settle-10-flow'
                ? 11.5 + pseudo(i, 7) * 7.0
                : 5.6 + pseudo(i, 7) * 3.6
          : mode === 'critical'
            ? 6.6 + pseudo(i, 7) * 4.8
            : isFast
              ? 5.4 + pseudo(i, 7) * 3.0
              : 4.2 + pseudo(i, 7) * 2.6
      ) * speedScale
      const delay = -pseudo(i, 8) * duration
      const opacity = 0.55 + pseudo(i, 9) * 0.42
      return { diameter, left, top, driftX, driftY, fallY, duration, delay, opacity }
    }
    const particleColor = darkMode ? 'rgba(30, 64, 175, 0.92)' : 'rgba(30, 64, 175, 0.9)'
    const renderMovingParticles = (mode: 'settle' | 'critical' | 'flow') =>
      Array.from({ length: mode === 'settle' ? settlingMovingCount : particleCount }).map((_, i) => {
        const p = particleMeta(i, mode)
        const animationName =
          mode === 'settle'
            ? 'particle-random-settle'
            : mode === 'critical'
              ? 'particle-critical-drift'
              : 'particle-random-flow'
        const style = {
          width: `${p.diameter}px`,
          height: `${p.diameter}px`,
          left: `${p.left}%`,
          top: `${p.top}%`,
          opacity: p.opacity,
          animation: `${animationName} ${p.duration}s ease-in-out infinite`,
          animationDelay: `${p.delay}s`,
          '--particle-drift-x': `${p.driftX}px`,
          '--particle-drift-y': `${p.driftY}px`,
          '--particle-fall-y': `${p.fallY}px`,
        } as CSSProperties
        return (
          <div
            key={`${mode}-${i}`}
            className="absolute rounded-full shadow-[0_0_5px_rgba(30,64,175,0.22)]"
            style={{ ...style, backgroundColor: particleColor }}
          />
        )
      })
    const renderSettledBedParticles = (bedHeightPct: number) =>
      Array.from({ length: settledCount }).map((_, i) => {
        const diameter = (2.4 + pseudo(i, 21) * 5.2) * scale * (size === 'full' ? 1 : 1.14)
        const left = 0.5 + pseudo(i, 22) * 99
        const bottom = pseudo(i, 23) ** 1.45 * Math.max(8, bedHeightPct - 1)
        return (
          <div
            key={`bed-${i}`}
            className="absolute rounded-full z-20"
            style={{
              width: `${diameter}px`,
              height: `${diameter}px`,
              left: `${left}%`,
              bottom: `${bottom}%`,
              backgroundColor: darkMode ? 'rgba(146, 64, 14, 0.95)' : 'rgba(146, 64, 14, 0.92)',
              opacity: 0.55 + pseudo(i, 24) * 0.4,
              boxShadow: '0 0 4px rgba(120, 53, 15, 0.24)',
            }}
          />
        )
      })
    const renderFlowStreaks = (speed: 'slow' | 'medium' | 'fast' | 'vertical') => {
      const count = size === 'full' ? 20 : isSmallSettlingPreview && speed === 'vertical' ? 16 : 12
      return Array.from({ length: count }).map((_, i) => {
        const horizontal = speed !== 'vertical'
        const duration = (
          speed === 'fast'
            ? 5.8 + pseudo(i, 31) * 2.2
            : speed === 'medium'
              ? 4.6 + pseudo(i, 31) * 1.9
              : speed === 'vertical'
                ? 5.2 + pseudo(i, 31) * 2.1
                : 7.2 + pseudo(i, 31) * 3.0
        ) * speedScale
        return (
          <div
            key={`streak-${speed}-${i}`}
            className={`absolute rounded-full ${horizontal ? 'h-[2px] w-1/4' : 'h-1/3 w-[2px]'}`}
            style={{
              left: horizontal ? `${pseudo(i, 32) * 100}%` : `${8 + pseudo(i, 32) * 84}%`,
              top: horizontal ? `${8 + pseudo(i, 33) * 84}%` : `${pseudo(i, 33) * 100}%`,
              opacity: 0.15 + pseudo(i, 34) * 0.18,
              backgroundColor: speed === 'vertical' ? 'rgba(180, 83, 9, 0.45)' : 'rgba(255, 255, 255, 0.65)',
              animation: `${horizontal ? 'flow-horizontal' : 'flow-vertical'} ${duration}s linear infinite`,
              animationDelay: `${-pseudo(i, 35) * duration}s`,
            }}
          />
        )
      })
    }

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
                {renderSettledBedParticles(30)}
                {renderMovingParticles('settle')}
              </>
            ) : animationType === 'settle-20' ? (
              <>
                <div
                  className="absolute inset-0 bg-gradient-to-b from-orange-200 via-orange-300 to-orange-400"
                  style={{
                    animation: `flow-vertical ${size === 'full' ? 8 : size === 'small' ? 8.1 : 6.2}s linear infinite`,
                    backgroundSize: '100% 200%',
                  }}
                ></div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-700 via-amber-600 to-amber-500" style={{ height: '20%' }}></div>
                {renderFlowStreaks('vertical')}
                {renderSettledBedParticles(20)}
                {renderMovingParticles('settle')}
              </>
            ) : animationType === 'settle-10-flow' ? (
              <>
                <div
                  className="absolute inset-0 bg-gradient-to-b from-yellow-200 via-yellow-300 to-yellow-200"
                  style={{
                    animation: `flow-vertical ${size === 'full' ? 8.8 : size === 'small' ? 7.4 : 6.8}s linear infinite`,
                    backgroundSize: '100% 200%',
                  }}
                ></div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-amber-700 via-amber-600 to-amber-500" style={{ height: '10%' }}></div>
                {renderFlowStreaks('vertical')}
                {renderSettledBedParticles(10)}
                {renderMovingParticles('settle')}
              </>
            ) : animationType === 'still-flow' ? (
              <>
                <div className="absolute inset-0 bg-gradient-to-b from-blue-300 via-blue-400 to-blue-300"></div>
                {renderFlowStreaks('slow')}
                {renderMovingParticles('critical')}
              </>
            ) : animationType === 'medium-flow' ? (
              <>
                {/* 正常流动：液体整体由左向右流动 */}
                <div
                  className="absolute inset-0 bg-gradient-to-r from-green-300 via-green-400 to-green-300"
                  style={{ animation: `flow-horizontal ${size === 'full' ? 7.2 : 5.4}s linear infinite`, backgroundSize: '200% 100%' }}
                ></div>
                {renderFlowStreaks('medium')}
                {renderMovingParticles('flow')}
              </>
            ) : (
              <>
                {/* 快速流动：液体更快由左向右流动 */}
                <div
                  className="absolute inset-0 bg-gradient-to-r from-green-300 via-green-400 to-green-300"
                  style={{ animation: `flow-horizontal ${size === 'full' ? 9 : 6.8}s linear infinite`, backgroundSize: '200% 100%' }}
                ></div>
                {renderFlowStreaks('fast')}
                {renderMovingParticles('flow')}
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
          if (formulaId === 'kronodze_pressure' && (newParams['rho_s'] === undefined || newParams['rho_s'] === null || isNaN(newParams['rho_s'] as number))) {
            newParams['rho_s'] = 1000
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
            initialParams['rho_s'] = 1000
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
          if (formulaId === 'kronodze_pressure' && !(newRaw['rho_s'] && String(newRaw['rho_s']).trim() !== '')) {
            newRaw['rho_s'] = '1000'
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
            initialRaw['rho_s'] = '1000'
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
      feiLambdaManualRef.current = false
      liuOmegaManualRef.current = false
      liuOmegaSManualRef.current = false
      liuBinghamEtaForAutoRef.current = null
      liuStokesDiMForAutoRef.current = null
      if (formula.id === 'kronodze_pressure') {
        updateKronodzeStep2Ready(false)
        updateKronodzeStep3Visible(false)
      }
      if (formula.id === 'pseudo_homogeneous_flow_judgment') {
        setPseudoFlowRowsByFormula((prev) => ({
          ...prev,
          [formulaId]: PSEUDO_HOMOGENEOUS_FLOW_TEMPLATE_ROWS.map((r) => ({ ...r })),
        }))
        setPseudoCcaActiveRowByFormula((p) => ({ ...p, [formulaId]: 0 }))
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
      let allParamsFilled = formula.parameters.every((param) => {
        if (formula.id === 'fei_xiangjun') {
          if (
            param.name === 'lambda_coef' ||
            param.name === 'eta_1' ||
            param.name === 'epsilon' ||
            param.name === 'fei_iterate_lambda'
          ) {
            return true
          }
        }
        const value = parameters[param.name]
        return param.default !== undefined || (value !== undefined && value !== null && !isNaN(value))
      })

      if (allParamsFilled && formula.id === 'fei_xiangjun') {
        const norm = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
        const eta1 = parseFloat(norm(feiLambdaAuxEta1))
        const epsMm = parseFeiAuxEpsilonMm(feiLambdaAuxEpsilonPreset, feiLambdaAuxEpsilonCustom)
        allParamsFilled =
          Number.isFinite(eta1) && eta1 > 0 && epsMm != null && epsMm > 0
      }
      
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
  }, [
    parameters,
    lockedVc,
    formula,
    feiLambdaAuxEta1,
    feiLambdaAuxEpsilonPreset,
    feiLambdaAuxEpsilonCustom,
  ])

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

    const isLiuSlurryVelocity =
      formula.id === 'liu_dezhong' && (name === 'omega' || name === 'omega_s')

    // 只接受标准数字格式（刘德忠 ω、ω_s 另允科学计数法）
    if (isLiuSlurryVelocity) {
      if (!LIU_SLURRY_VELOCITY_INPUT_RE.test(normalized)) return
    } else if (!/^-?\d+(\.\d*)?$/.test(normalized)) {
      return
    }

    const numValue = parseFloat(normalized)
    if (isNaN(numValue)) return

    if (name === 'C_w' && (numValue < 0 || numValue > 1)) return

    const rounded = isLiuSlurryVelocity
      ? roundLiuDezhongSlurryVelocity(numValue)
      : formula.id === 'liu_dezhong'
        ? roundLiuDezhongScalarParam(numValue)
        : Math.round(numValue * 1e6) / 1e6
    updateParameters(prev => ({ ...prev, [name]: rounded }))
    if (formula.id === 'fei_xiangjun' && name === 'lambda_coef') {
      feiLambdaManualRef.current = true
    }
    if (formula.id === 'liu_dezhong' && name === 'omega') {
      liuOmegaManualRef.current = true
    }
    if (formula.id === 'liu_dezhong' && name === 'omega_s') {
      liuOmegaSManualRef.current = true
    }
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

    const isLiuSlurryVelocity =
      formula.id === 'liu_dezhong' && (name === 'omega' || name === 'omega_s')
    const rounded = isLiuSlurryVelocity
      ? roundLiuDezhongSlurryVelocity(numValue)
      : formula.id === 'liu_dezhong'
        ? roundLiuDezhongScalarParam(numValue)
        : Math.round(numValue * 1e6) / 1e6
    const rawStr = isLiuSlurryVelocity ? formatLiuSlurryVelocityRawInput(rounded) : String(rounded)
    updateRawInputs((prev) => ({ ...prev, [name]: rawStr }))
    updateParameters(prev => ({ ...prev, [name]: rounded }))
    if (formula.id === 'fei_xiangjun' && name === 'lambda_coef') {
      feiLambdaManualRef.current = true
    }
    if (formula.id === 'liu_dezhong' && name === 'omega') {
      liuOmegaManualRef.current = true
    }
    if (formula.id === 'liu_dezhong' && name === 'omega_s') {
      liuOmegaSManualRef.current = true
    }
    if (formula.id === 'slurry_accel_energy' && (name === 'Z1' || name === 'Z2')) {
      window.setTimeout(() => applySlurryAccelAutoLength(false), 0)
    }
  }

  const writeFeiLambdaCoefFromPreview = (p: { lambda: number }) => {
    feiLambdaManualRef.current = false
    const lv = Math.round(p.lambda * 1e6) / 1e6
    const s = (() => {
      if (Math.abs(lv) >= 1e6 || (Math.abs(lv) > 0 && Math.abs(lv) < 1e-4)) return lv.toExponential(8)
      const t = lv.toFixed(8).replace(/\.?0+$/, '')
      return t || '0'
    })()
    updateRawInputs((prev) => ({ ...prev, lambda_coef: s }))
    updateParameters((prev) => ({ ...prev, lambda_coef: lv }))
  }

  // 锁定后：费祥俊 λ 在用户未手写覆盖时，随管径/C_V 与辅助量自动重算（与面板实时预览同源）
  useEffect(() => {
    if (formula?.id !== 'fei_xiangjun' || lockedVc === null || !autoCalculateRef || feiLambdaManualRef.current) return
    if (feiLambdaAssistPreview?.lambda == null) return
    const timer = window.setTimeout(() => {
      const p = feiLambdaAssistPreviewRef.current
      if (!p?.lambda) return
      writeFeiLambdaCoefFromPreview({ lambda: p.lambda })
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formula?.id, lockedVc, autoCalculateRef, feiLambdaAssistPreview])

  // 锁定后：刘德忠 ω_s 在曾从斯托克斯辅助填入且非手写覆盖时，仍随 ρ_g、d_i、μ_w 刷新；ω 仅在使用宾汉辅助点「填入」时写入主栏，不因面板内实时改参而自动覆盖
  useEffect(() => {
    if (formula?.id !== 'liu_dezhong' || lockedVc === null || !autoCalculateRef) return
    const timer = window.setTimeout(() => {
      if (!liuOmegaSManualRef.current) {
        const rg = parameters.rho_g
        const dM =
          liuStokesDiMForAutoRef.current ??
          (parameters.D != null && !isNaN(Number(parameters.D)) ? Number(parameters.D) : undefined)
        const mu = parameters.eta_1 != null && !isNaN(parameters.eta_1) ? parameters.eta_1 : 0.0010559
        const g = parameters.g ?? 9.81
        const rhoWater = 1000
        if (rg != null && dM != null && !isNaN(rg) && !isNaN(Number(dM)) && Number(dM) > 0) {
          const ws = computeLiuStokesOmegaSFromAux({
            rho_g: rg,
            rho_w: rhoWater,
            g,
            d_m: Number(dM),
            mu_w: mu,
          })
          if (ws != null) {
            updateRawInputs((prev) => ({ ...prev, omega_s: formatLiuSlurryVelocityRawInput(ws) }))
            updateParameters((prev) => ({ ...prev, omega_s: ws }))
          }
        }
      }
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formula?.id,
    lockedVc,
    autoCalculateRef,
    parameters.rho_g,
    parameters.g,
    parameters.D,
    parameters.eta_1,
  ])

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

  /** 与界面显示一致：优先已解析数，其次从当前输入框原文解析（避免未 blur 时提交缺参）。 */
  const getWorkflowNumeric = (subId: string, name: string): number | undefined => {
    const pm = formulaParameters[subId] as Record<string, number | undefined> | undefined
    const parsed = pm?.[name]
    if (parsed !== undefined && parsed !== null && typeof parsed === 'number' && !isNaN(parsed)) {
      return parsed
    }
    const raw = formulaRawInputs[subId]?.[name]
    if (raw === undefined || String(raw).trim() === '') return undefined
    const normalized = normalizeDecimalInput(String(raw).trim())
    if (normalized === '-' || normalized === '.' || normalized === '-.') return undefined
    if (!/^-?\d+(\.\d*)?$/.test(normalized)) return undefined
    const numValue = parseFloat(normalized)
    if (isNaN(numValue)) return undefined
    return Math.round(numValue * 1e6) / 1e6
  }

  const validateFrictionSubStep = (subId: string): string | null => {
    if (subId === 'density_mixing') {
      const Cw = getWorkflowNumeric('density_mixing', 'C_w')
      if (Cw == null || isNaN(Cw) || Cw < 0 || Cw > 1) {
        return '步骤1：含水率 C_w 须在 0～1 之间（小数，如 0.35）'
      }
      const rg = getWorkflowNumeric('density_mixing', 'rho_g')
      if (rg == null || rg <= 0) return '步骤1：请填写固体密度 ρ_g'
      const rs = getWorkflowNumeric('density_mixing', 'rho_s')
      if (rs == null || rs <= 0) return '步骤1：请填写清水密度 ρ_s'
      return null
    }
    if (subId === 'darcy_friction_step1_rho1') {
      const rho1 =
        getWorkflowNumeric('darcy_friction', 'rho_1') ?? getWorkflowNumeric('darcy_friction', 'rho_l')
      if (rho1 != null && rho1 > 0) return null
      const rg = getWorkflowNumeric('darcy_friction', 'rho_g')
      const rk = getWorkflowNumeric('darcy_friction', 'rho_k')
      const c1 =
        getWorkflowNumeric('darcy_friction', 'C1v') ??
        getWorkflowNumeric('darcy_friction', 'C_lv') ??
        getWorkflowNumeric('darcy_friction', 'Clv')
      if (rg != null && rk != null && c1 != null) return null
      return '步骤2：请直填首栏混合物密度 ρ₁，或填写固体密度 ρ_g、步骤1浆体密度 ρ_k、似均质体积浓度 C_{1V}'
    }
    if (subId === 'darcy_friction_step2_re') {
      const rho1 = getWorkflowNumeric('darcy_friction', 'rho_1')
      if (rho1 == null || isNaN(rho1) || rho1 <= 0) {
        return '步骤3：请填写「混合物密度 ρ₁」（kg/m³）；可由步骤2计算写入，或在本步参数表填写'
      }
      const reB = getWorkflowNumeric('darcy_friction', 'Re_B')
      if (reB != null && !isNaN(reB) && reB > 0) return null
      const V = getWorkflowNumeric('darcy_friction', 'V')
      if (V == null || isNaN(V)) return '步骤3：请填写断面平均流速 V（未直填 Re_B 时必填）'
      const Dn = getWorkflowNumeric('darcy_friction', 'D_n')
      if (Dn == null || isNaN(Dn) || Dn <= 0) return '步骤3：请填写管道内径 D_n'
      const eta = getWorkflowNumeric('darcy_friction', 'eta_1')
      if (eta == null || isNaN(eta) || eta <= 0) return '步骤3：请填写刚度系数 η（Pa·s）'
      return null
    }
    if (subId === 'darcy_friction_step3_lambda') {
      const Dn = getWorkflowNumeric('darcy_friction', 'D_n')
      if (Dn == null || isNaN(Dn) || Dn <= 0) return '步骤4：请填写管道内径 D_n'
      const ReB = getWorkflowNumeric('darcy_friction', 'Re_B')
      if (ReB == null || isNaN(ReB) || ReB <= 0) {
        return '步骤4：请填写雷诺数 Re_B；可取步骤 3 计算结果，或先完成步骤 3'
      }
      return null
    }
    if (subId === 'slurry_friction_loss') {
      const rhoK = getWorkflowNumeric('slurry_friction_loss', 'rho_k')
      if (rhoK == null || isNaN(rhoK) || rhoK <= 0) {
        return '步骤5：请填写浆体密度 ρ_k（与步骤1浆体密度同义，kg/m³）'
      }
      const step5Names: Record<'lambda_coef' | 'V' | 'D', string> = {
        lambda_coef: '达西摩阻系数 λ',
        V: '断面平均流速 V',
        D: '管道内径 D',
      }
      for (const name of ['lambda_coef', 'V', 'D'] as const) {
        const v = getWorkflowNumeric('slurry_friction_loss', name)
        if (v == null || isNaN(v)) return `步骤5：请填写 ${step5Names[name]}`
        if (name === 'D' && v === 0) return '步骤5：管道内径 D 不能为 0'
        if (name === 'lambda_coef' && v <= 0) return '步骤5：达西摩阻系数 λ 必须大于 0'
      }
      const rhoS = getWorkflowNumeric('slurry_friction_loss', 'rho_s')
      if (rhoS != null && !isNaN(rhoS) && rhoS <= 0) return '步骤5：液体密度 ρ_s 须大于 0'
      const gVal = getWorkflowNumeric('slurry_friction_loss', 'g')
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

    const validParameters: Record<string, number> = {}
    if (subId === 'density_mixing') {
      for (const key of ['C_w', 'rho_g', 'rho_s'] as const) {
        const v = getWorkflowNumeric('density_mixing', key)
        if (v !== undefined && !isNaN(v)) validParameters[key] = v
      }
    } else if (
      subId === 'darcy_friction_step1_rho1' ||
      subId === 'darcy_friction_step2_re' ||
      subId === 'darcy_friction_step3_lambda'
    ) {
      if (subId === 'darcy_friction_step1_rho1') {
        const r1 =
          getWorkflowNumeric('darcy_friction', 'rho_1') ?? getWorkflowNumeric('darcy_friction', 'rho_l')
        if (r1 != null && r1 > 0) {
          validParameters.rho_1 = r1
        } else {
          const rg = getWorkflowNumeric('darcy_friction', 'rho_g')
          const rk = getWorkflowNumeric('darcy_friction', 'rho_k')
          const c1 =
            getWorkflowNumeric('darcy_friction', 'C1v') ??
            getWorkflowNumeric('darcy_friction', 'C_lv') ??
            getWorkflowNumeric('darcy_friction', 'Clv')
          if (rg !== undefined && !isNaN(rg)) validParameters.rho_g = rg
          if (rk !== undefined && !isNaN(rk)) validParameters.rho_k = rk
          if (c1 !== undefined && !isNaN(c1)) validParameters.C1v = c1
        }
      } else if (subId === 'darcy_friction_step2_re') {
        for (const key of ['V', 'D_n', 'rho_1', 'eta_1', 'Re_B'] as const) {
          const value = getWorkflowNumeric('darcy_friction', key)
          if (value !== undefined && !isNaN(value)) validParameters[key] = value
        }
      } else {
        for (const key of ['Re_B', 'D_n', 'epsilon'] as const) {
          const value = getWorkflowNumeric('darcy_friction', key)
          if (value !== undefined && !isNaN(value)) validParameters[key] = value
        }
      }
      if (subId === 'darcy_friction_step3_lambda' && validParameters['epsilon'] === undefined) {
        validParameters['epsilon'] = DEFAULT_SLURRY_EPSILON
      }
    } else if (subId === 'slurry_friction_loss') {
      for (const key of ['rho_k', 'lambda_coef', 'V', 'D', 'rho_s', 'g'] as const) {
        const value = getWorkflowNumeric('slurry_friction_loss', key)
        if (value !== undefined && !isNaN(value)) validParameters[key] = value
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
      const response = await apiClient.post(
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
        const rhoG = validParameters['rho_g']
        const rhoS = validParameters['rho_s']
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
          if (darcyN.rho_k == null || isNaN(darcyN.rho_k)) {
            darcyN.rho_k = r6(rk)
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
          if (darcyR.rho_k == null || darcyR.rho_k === '') {
            darcyR.rho_k = String(r6(rk))
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
          const dmNow = prev.density_mixing || {}
          const sfl = { ...(prev.slurry_friction_loss || {}) }
          if (sfl.lambda_coef == null || isNaN(sfl.lambda_coef)) sfl.lambda_coef = lam
          if ((sfl.V == null || isNaN(sfl.V)) && dart.V != null && !isNaN(dart.V)) {
            sfl.V = r6(dart.V)
          }
          if ((sfl.D == null || isNaN(sfl.D)) && dart.D_n != null && !isNaN(dart.D_n)) {
            sfl.D = r6(dart.D_n)
          }
          if ((sfl.rho_s == null || isNaN(sfl.rho_s)) && dmNow.rho_s != null && !isNaN(dmNow.rho_s)) {
            sfl.rho_s = r6(dmNow.rho_s)
          }
          return { ...prev, slurry_friction_loss: sfl }
        })
        setFormulaRawInputs((prev) => {
          const darcyR = prev.darcy_friction || {}
          const dmR = prev.density_mixing || {}
          const sfl = { ...(prev.slurry_friction_loss || {}) }
          if (sfl.lambda_coef == null || sfl.lambda_coef === '') sfl.lambda_coef = String(lam)
          if ((sfl.V == null || sfl.V === '') && darcyR.V != null && darcyR.V !== '') {
            sfl.V = String(r6(Number(darcyR.V)))
          }
          if ((sfl.D == null || sfl.D === '') && darcyR.D_n != null && darcyR.D_n !== '') {
            sfl.D = String(r6(Number(darcyR.D_n)))
          }
          if ((sfl.rho_s == null || sfl.rho_s === '') && dmR.rho_s != null && dmR.rho_s !== '') {
            sfl.rho_s = String(r6(Number(dmR.rho_s)))
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

  const runPseudoCcaChainStep = async (
    step: 'rho' | 're' | 'fl' | 'u' | 'ratio',
    rowIndex: number
  ) => {
    if (!formula || formula.id !== 'pseudo_homogeneous_flow_judgment') return
    const fid = formula.id
    const rows = pseudoFlowRowsByFormula[fid] ?? PSEUDO_HOMOGENEOUS_FLOW_TEMPLATE_ROWS
    const row = rows[rowIndex]

    const chainRow = (): PseudoCcaChainSnapshot =>
      pseudoCcaChainByFormula[fid]?.[rowIndex] || {}

    const patchChain = (patch: PseudoCcaChainSnapshot) =>
      setPseudoCcaChainByFormula((prev) => ({
        ...prev,
        [fid]: {
          ...(prev[fid] || {}),
          [rowIndex]: { ...(prev[fid]?.[rowIndex] || {}), ...patch },
        },
      }))

    const rg = parameters['rho_g']
    const rs = parameters['rho_s']
    const v = parameters['v']
    const D = parameters['D']
    const eta = parameters['eta']
    const epsMm =
      parseFeiAuxEpsilonMm(pseudoCcaEpsilonPreset, pseudoCcaEpsilonCustomMm) ??
      (parameters['epsilon'] != null && !isNaN(parameters['epsilon']!) ? Number(parameters['epsilon']) : null)
    const Kk = parameters['K_karman']
    const bet = parameters['beta_ismail']

    const bust = `${step}-${rowIndex}`
    const fail = async (msg: string) => {
      await showAppAlert('浆体管道流态判断公式·分步', msg)
    }

    if (!row) {
      await fail('无效的粒径档索引')
      return
    }

    const c1vStr = normalizeCsvDecimalInput(String(rawInputs['Cv'] ?? ''))

    try {
      if (step === 'rho') {
        if (c1vStr === '' || !Number.isFinite(parseFloat(c1vStr))) {
          await fail(`请先填写 $C_{1V}$（小数 0～1；与「临界流速」相同，可展开「体积浓度——辅助计算」）`)
          return
        }
        if (rg == null || rs == null || isNaN(rg) || isNaN(rs)) {
          await fail('请在步骤「1 · 计算浆体密度」内填写固体密度 $\\rho_g$、液相密度 $\\rho_s$')
          return
        }
      }
      const chNow = chainRow()
      const ovRow = pseudoCcaKnownOverrideByFormula[fid]?.[rowIndex] || {}
      let paramsPayload: Record<string, unknown> = {}

      if (step === 'rho') {
        paramsPayload = {
          rho_g: rg as number,
          rho_s: rs as number,
          C1v: parseFloat(c1vStr),
        }
      } else if (step === 're') {
        const rlOv = parsePseudoCcaOptionalNumber(ovRow.rho_l)
        const rl = rlOv ?? chNow.rho_l
        if (rl == null || !Number.isFinite(rl)) {
          await fail('请先对本档执行步骤「1」求 $\\rho_1$，或在步骤「2」中手填已知 $\\rho_1$（kg/m³）')
          return
        }
        if (v == null || D == null || eta == null || isNaN(v) || isNaN(D) || isNaN(eta)) {
          await fail('请填写断面平均流速 $v$、管道内径 $D_{n}$ 与混合物动力粘度 $\\eta$（Pa·s；步骤「计算雷诺数」）')
          return
        }
        paramsPayload = { v, D, eta, rho_l: rl }
      } else if (step === 'fl') {
        const reBOv = parsePseudoCcaOptionalNumber(ovRow.Re_B)
        const reB = reBOv ?? chNow.Re_B
        if (reB == null || !Number.isFinite(reB)) {
          await fail('请先对本档执行步骤「2」求 $\\mathrm{Re}_B$，或在步骤「3」中手填已知 $\\mathrm{Re}_B$')
          return
        }
        const dOv = parsePseudoCcaOptionalNumber(ovRow.D_n)
        const Duse =
          dOv != null && Number.isFinite(dOv) && dOv > 0
            ? dOv
            : D != null && !isNaN(Number(D)) && Number(D) > 0
              ? Number(D)
              : null
        if (Duse == null) {
          await fail('请填写管道内径 $D_{n}$（m；可与步骤 2 相同，或在步骤 3 直接填写）')
          return
        }
        const epsSend = epsMm != null && Number.isFinite(epsMm) && epsMm > 0 ? epsMm : 0.053
        paramsPayload = { Re_B: reB, D: Duse, epsilon: epsSend }
      } else if (step === 'u') {
        const flOv = parsePseudoCcaOptionalNumber(ovRow.f_L)
        const fl = flOv ?? chNow.f_L
        if (fl == null || !Number.isFinite(fl)) {
          await fail('请先对本档执行步骤「3」求刘德忠–Fanning $f_L$，或在步骤「4」中手填已知 $f_L$')
          return
        }
        if (v == null || isNaN(v)) {
          await fail('请先填写断面平均流速 $V$（步骤「2」或本页 $v$ 主栏，与步骤 4 联动）')
          return
        }
        paramsPayload = { v, f_L: fl }
      } else if (step === 'ratio') {
        const UOv = parsePseudoCcaOptionalNumber(ovRow.U)
        const Uv = UOv ?? chNow.U
        if (Uv == null || !Number.isFinite(Uv)) {
          await fail('请先对本档执行步骤「4」求摩阻流速 $U$，或在步骤「5」中手填已知 $U$（m/s）')
          return
        }
        const oms = normalizeCsvDecimalInput(row.omega)
        if (oms === '') {
          await fail(
            `请先填写第 ${rowIndex + 1} 档的 $W_i$（似均质中加权平均沉速，m/s）：可手输或在本步展开辅助计算求解，不可用空值代入。`
          )
          return
        }
        const ow = parseFloat(oms)
        if (!Number.isFinite(ow) || ow < 0) {
          await fail(`第 ${rowIndex + 1} 档 $W_i$（m/s）须为非负数`)
          return
        }
        const omegaVal = ow
        const kStep = parsePseudoCcaOptionalNumber(ovRow.K_karman)
        const betStep = parsePseudoCcaOptionalNumber(ovRow.beta_ismail)
        const kSend = kStep ?? (Kk != null && !isNaN(Kk) ? Kk : 0.36)
        const betSend = betStep ?? (bet != null && !isNaN(bet) ? bet : 1)
        paramsPayload = {
          omega_i: omegaVal,
          friction_velocity_U: Uv,
          K_karman: kSend,
          beta_ismail: betSend,
        }
      }

      let formulaIdPayload = ''
      if (step === 'rho') formulaIdPayload = 'pseudo_cca_step_rho_mixture'
      else if (step === 're') formulaIdPayload = 'pseudo_cca_step_Re_B'
      else if (step === 'fl') formulaIdPayload = 'pseudo_cca_step_fanning_f_L'
      else if (step === 'u') formulaIdPayload = 'pseudo_cca_step_friction_velocity_u'
      else formulaIdPayload = 'pseudo_cca_step_ratio_i'

      setPseudoCcaStepBusyKey(bust)
      const response = await apiClient.post(
        `${API_BASE_URL}/calculate`,
        { formula_id: formulaIdPayload, parameters: paramsPayload },
        { timeout: API_TIMEOUT }
      )
      const data = response.data as CalculationResult
      if (!data.success) {
        await fail(data.error || '计算失败')
        return
      }
      const r = data.result
      const im = (r?.intermediate || {}) as { c_over_ca_i?: number }
      if (step === 'rho' && r?.rho_l != null) {
        const rhoNum = Number(r.rho_l)
        patchChain({ rho_l: rhoNum })
        setPseudoCcaKnownOverrideByFormula((prev) => ({
          ...prev,
          [fid]: {
            ...(prev[fid] || {}),
            [rowIndex]: { ...(prev[fid]?.[rowIndex] || {}), rho_l: String(rhoNum) },
          },
        }))
      }
      if (step === 're' && r?.Re_B != null) {
        patchChain({ Re_B: Number(r.Re_B) })
        const rlUsed = parsePseudoCcaOptionalNumber(ovRow.rho_l) ?? chNow.rho_l
        if (rlUsed != null && Number.isFinite(rlUsed)) patchChain({ rho_l: rlUsed })
      }
      if (step === 'fl' && r?.f_L != null) {
        const reBPatch = parsePseudoCcaOptionalNumber(ovRow.Re_B) ?? chNow.Re_B
        patchChain({
          f_L: Number(r.f_L),
          ...(reBPatch != null && Number.isFinite(reBPatch) ? { Re_B: reBPatch } : {}),
        })
      }
      if (step === 'u' && r?.friction_velocity_U != null) {
        const flPatch = parsePseudoCcaOptionalNumber(ovRow.f_L) ?? chNow.f_L
        patchChain({
          U: Number(r.friction_velocity_U),
          ...(flPatch != null && Number.isFinite(flPatch) ? { f_L: flPatch } : {}),
        })
      }
      if (step === 'ratio' && im.c_over_ca_i != null && !isNaN(Number(im.c_over_ca_i))) {
        const uPatch = parsePseudoCcaOptionalNumber(ovRow.U) ?? chNow.U
        patchChain({
          c_over_ca_i: Number(im.c_over_ca_i),
          ...(uPatch != null && Number.isFinite(uPatch) ? { U: uPatch } : {}),
        })
      }
    } catch (e: any) {
      await fail(e.response?.data?.error || String(e.message || '网络或计算异常'))
    } finally {
      setPseudoCcaStepBusyKey(null)
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
      const response = await apiClient.post(
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
      const researchKickerCls = `text-sm sm:text-base font-semibold tracking-[0.08em] mb-4 ${darkMode ? 'text-blue-400' : 'text-blue-700'}`
      /** 科研创新中心职能与导读；具体平台技术内容见下方各分块，避免与单中心介绍重复 */
      const researchIntroP1 =
        '科研创新中心负责统筹长沙有色院科技创新与成果转化，对接主业设计咨询、工程总承包与生产运营中的技术需求，在采矿、选矿、冶炼、环保与节能降碳等领域组织课题攻关、标准与知识产权布局。中心与国家企业技术中心、博士后科研工作站及院研发中心、大师工作室、试验基地等协同联动，完善项目策划、过程管理与产学研用衔接，推动科研与工程实践相互支撑。'
      const researchIntroP2 =
        '以下按板块介绍我院牵头或共建的省级工程技术研究中心及工程研究中心，涵盖再生金属循环利用、铅锌清洁冶炼、深井矿山安全高效开采、矿山安全智能监控、有色冶金智能制造等方向；各平台研究方向与代表性成果见分块正文及展示资料。'

      return (
        <div ref={scrollContainerRef} className={mainScrollClassName}>
          <div className={contentWrapperClassName}>
            {renderAppHeader()}

            <div className={`${mainPanelCardClassName} mb-10`}>
              <p className={researchKickerCls}>
                {language === 'en'
                  ? `${APP_ORG_NAME_EN} · Research Innovation Center`
                  : '长沙有色冶金设计研究院有限公司 · 科研创新中心'}
              </p>
              <h2 className={`text-2xl font-bold mb-4 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                {language === 'en' ? 'Research Innovation Center' : '科研创新中心'}
              </h2>
              <div
                className={`space-y-3 text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
              >
                {language === 'en' && (
                  <p>
                    Detailed platform descriptions are currently provided in Chinese. Key English headings are shown to keep navigation and context clear.
                  </p>
                )}
                <p className="font-medium">{researchIntroP1}</p>
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
                        <span className="text-sm">{language === 'en' ? 'Loading...' : '加载中...'}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="relative z-[2] w-full max-w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={() => setZoomPlatformImageUrl(item.image)}
                      aria-label={language === 'en' ? `Open image: ${item.name}` : `放大查看：${item.name}`}
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
                  <p className={capCls}>{language === 'en' ? 'Platform Display · Click to enlarge' : '平台展示 · 点击可放大'}</p>
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
                aria-label={language === 'en' ? 'Image preview' : '放大查看图片'}
              >
                <button
                  type="button"
                  className="absolute top-4 right-4 z-[2] w-10 h-10 rounded-full bg-white/20 text-white hover:bg-white/30 flex items-center justify-center text-xl"
                  onClick={() => setZoomPlatformImageUrl(null)}
                  aria-label={language === 'en' ? 'Close' : '关闭'}
                >
                  ×
                </button>
                {!researchZoomLightboxReady && (
                  <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 text-white text-sm pointer-events-none">
                    <span className="inline-block h-8 w-8 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden />
                    <span>{language === 'en' ? 'Loading...' : '加载中…'}</span>
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
      const sectionKickerCls = `text-sm sm:text-base font-semibold tracking-[0.08em] mb-4 ${darkMode ? 'text-blue-400' : 'text-blue-700'}`
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
            {renderAppHeader()}

            {/* Hero：渐变主视觉，左文右图（建筑效果图）*/}
            <div className={`mb-10 rounded-2xl border px-5 py-7 sm:px-10 sm:py-9 ${
              darkMode
                ? 'border-gray-600 bg-gradient-to-br from-slate-900/95 via-gray-900 to-slate-950'
                : 'border-slate-200/90 bg-gradient-to-br from-white via-slate-50/80 to-blue-50/50 shadow-sm'
            }`}>
              <p className={sectionKickerCls}>
                {language === 'en' ? `${APP_ORG_NAME_EN} · Company Profile` : '长沙有色冶金设计研究院有限公司 · 企业概况'}
              </p>
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10 xl:gap-12 lg:items-stretch">
                <div className="min-w-0 flex flex-col justify-center">
                  <h2
                    className={`text-2xl sm:text-3xl font-bold tracking-tight leading-snug ${darkMode ? 'text-white' : 'text-slate-900'}`}
                  >
                    {language === 'en' ? (
                      <>
                        Full-Chain Technology and Services<br className="hidden sm:block" />for the Nonferrous Metals Industry
                      </>
                    ) : (
                      <>
                        有色金属行业全产业链<br className="hidden sm:block" />技术与服务提供商
                      </>
                    )}
                  </h2>
                  <div
                    className={`mt-4 leading-relaxed text-[15px] sm:text-base ${darkMode ? 'text-gray-200' : 'text-slate-800'}`}
                  >
                    <p className="font-medium">
                      {language === 'en' && (
                        <span className="mb-3 block">
                          Detailed corporate materials are currently shown in Chinese. This section introduces the institute's history, capabilities, innovation platforms, contact channels, and representative credentials.
                        </span>
                      )}
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
                    <p className={capCls}>
                      {language === 'en' ? `Chinalco · ${APP_ORG_NAME_EN}` : '中国铝业集团 · 长沙有色冶金设计研究院有限公司'}
                    </p>
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
      const sectionKickerCls = `text-sm sm:text-base font-semibold tracking-[0.08em] mb-4 ${darkMode ? 'text-blue-400' : 'text-blue-700'}`
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
              {renderAppHeader()}

              {/* 顶栏 kicker → 下一行左：标题 + 标题下正文；右：手册轮播与标题顶对齐、整体靠右 */}
              <div
                className={`mb-10 rounded-2xl border px-5 py-7 sm:px-10 sm:py-9 ${
                  darkMode
                    ? 'border-gray-600 bg-gradient-to-br from-slate-900/95 via-gray-900 to-slate-950'
                    : 'border-slate-200/90 bg-gradient-to-br from-white via-slate-50/80 to-blue-50/50 shadow-sm'
                }`}
              >
                <p className={sectionKickerCls}>
                  {language === 'en' ? `${APP_ORG_NAME_EN} · Municipal Division` : '长沙有色冶金设计研究院有限公司 · 市政事业部'}
                </p>
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10 xl:gap-12 lg:items-start">
                  <div className="min-w-0">
                    <h2
                      className={`text-2xl sm:text-3xl font-bold tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}
                    >
                      {language === 'en' ? 'Municipal Engineering · Wastewater Treatment and Slurry Transport' : '市政工程 · 废水处理及矿浆输送技术'}
                    </h2>
                    <div
                      className={`mt-4 leading-relaxed text-[15px] sm:text-base ${
                        darkMode ? 'text-gray-200' : 'text-slate-800'
                      }`}
                    >
                      {language === 'en' && (
                        <p className="mb-3 font-medium">
                          Detailed municipal project materials are currently shown in Chinese. This page covers wastewater treatment, slurry transport, representative projects, and related qualifications.
                        </p>
                      )}
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
                    <p className="font-medium">
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
          {renderAppHeader()}

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
          appOrg: APP_ORG_NAME_EN,
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
          offlineLicense: 'Product License',
          deviceCode: 'Device ID',
          copyDev: 'Copy',
          licenseCode: 'License Key',
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
                      !darkMode ? 'bg-blue-600 text-white shadow' : darkMode ? 'bg-gray-600/80 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span className="font-medium">{t.light}</span>
                    <span className={`block text-xs mt-0.5 ${!darkMode ? 'opacity-90' : 'opacity-70'}`}>{t.lightHint}</span>
                  </button>
                  <button
                    onClick={() => onDarkModeChange && onDarkModeChange(true)}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      darkMode ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span className="font-medium">{t.dark}</span>
                    <span className={`block text-xs mt-0.5 ${darkMode ? 'opacity-90' : 'opacity-70'}`}>{t.darkHint}</span>
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
    if (rho == null || isNaN(rho) || Number(rho) <= 0) return '步骤3 需要有效的 ρ_k（kg/m³）'
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

    /** B.C.克诺罗兹：步骤1 四项 W、C_W、ρ_g、ρ_s 均须为有效数值 */
    if (formula.id === 'kronodze_pressure') {
      const w = parameters['W']
      const rg = parameters['rho_g']
      const rs = parameters['rho_s']
      const cw = parameters['C_w']
      if (w == null || isNaN(w)) return '步骤1：请填写干固体质量流量 W（kg/h）'
      if (w <= 0) return '步骤1：W 须大于 0'
      if (rg == null || isNaN(rg) || rg <= 0) return '步骤1：请填写固体密度 ρ_g（kg/m³）'
      if (rs == null || isNaN(rs) || rs <= 0) return '步骤1：请填写液相密度 ρ_s（kg/m³，清水常用 1000）'
      if (cw == null || isNaN(cw)) return '步骤1：请填写浆体重量浓度 C_W（如 0.42）'
      if (cw <= 0 || cw >= 1) {
        return '步骤1：C_W 须在 0 与 1 之间且不取端点（须含固、液两相），如 0.42'
      }
    }

    if (formula.id === 'pseudo_homogeneous_flow_judgment') {
      const rows = pseudoFlowRowsByFormula[formula.id] ?? PSEUDO_HOMOGENEOUS_FLOW_TEMPLATE_ROWS
      const pf = parsePseudoFlowFractionsFromRows(rows)
      if (pf.error) return pf.error
      const cmap = pseudoCcaChainByFormula[formula.id] || {}
      const built = buildPseudoSummarizeFractionsFromChain(rows, cmap)
      if (built.error) return built.error
      return null
    }

    // 浆体消能：与步骤2相同规则（Q + K_QL 或 Q + λ_d/L_s/d）
    if (isSlurryDissipationFormula) {
      return validateSlurryDissipationStep(2)
    }

    if (formula.id === 'fei_xiangjun') {
      const norm = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
      const eta1 = parseFloat(norm(feiLambdaAuxEta1))
      if (!Number.isFinite(eta1) || eta1 <= 0) {
        return '请在「达西摩阻系数——辅助计算」中填写有效的混合物动力粘度 η₁（Pa·s）'
      }
      const epsMm = parseFeiAuxEpsilonMm(feiLambdaAuxEpsilonPreset, feiLambdaAuxEpsilonCustom)
      if (epsMm == null || epsMm <= 0) {
        return '请在「达西摩阻系数——辅助计算」中填写有效的管壁绝对粗糙度 ε（mm）'
      }
    }
    
    const paramsToCheck = formula.parameters

    for (const param of paramsToCheck) {
      if (formula.id === 'fei_xiangjun') {
        if (
          param.name === 'lambda_coef' ||
          param.name === 'eta_1' ||
          param.name === 'epsilon' ||
          param.name === 'fei_iterate_lambda'
        ) {
          continue
        }
      }

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
        if (param.name === 'lambda_coef' && formula.id !== 'fei_xiangjun' && value <= 0) {
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
    const W = parameters['W']
    const rhoG = parameters['rho_g']
    const rhoS = parameters['rho_s']
    const cw = parameters['C_w']
    if (W == null || isNaN(W)) return '步骤1 需要填写 W（干固体质量流量，kg/h）'
    if (rhoG == null || isNaN(rhoG)) return '步骤1 需要填写 ρ_g（固体密度）'
    if (rhoS == null || isNaN(rhoS)) return '步骤1 需要填写 ρ_s（液相密度，清水常用 1000 kg/m³）'
    if (W <= 0) return '干固体质量流量 W 必须大于 0'
    if (rhoG <= 0) return '固体密度 ρ_g 必须大于 0'
    if (rhoS <= 0) return '液相密度 ρ_s 必须大于 0'
    if (cw == null || isNaN(cw)) return '步骤1 需要填写 C_W（浆体重量浓度）'
    if (cw <= 0 || cw >= 1) return '步骤1：C_W 须在 0 与 1 之间且不取端点（须含固、液两相）'

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
      // 步骤1：只算浆体体积流量 Q_K（m³/h），不传 dp/beta 以防后端连算步骤2、3
      if (!formula) return
      setLoading(true)
      try {
        const step1Params: Record<string, number> = {}
        for (const key of ['W', 'rho_g', 'rho_s', 'C_w'] as const) {
          const v = parameters[key]
          if (v !== undefined && v !== null && !isNaN(v)) step1Params[key] = v
        }
        const response = await apiClient.post(`${API_BASE_URL}/calculate`, {
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
      const response = await apiClient.post(
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
      const response = await apiClient.post(
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
      if (formula.id === 'pseudo_homogeneous_flow_judgment') {
        const rows = pseudoFlowRowsByFormula[formula.id] ?? PSEUDO_HOMOGENEOUS_FLOW_TEMPLATE_ROWS
        const cmap = pseudoCcaChainByFormula[formula.id] || {}
        const built = buildPseudoSummarizeFractionsFromChain(rows, cmap)
        if (built.error || !built.fractions) {
          updateResult({ success: false, error: built.error || '数据不完整' })
          return null
        }
        const response = await apiClient.post(
          `${API_BASE_URL}/calculate`,
          {
            formula_id: 'pseudo_homogeneous_summarize_ratios',
            parameters: { particle_fractions: built.fractions },
            locked_vc: null,
          },
          { timeout: API_TIMEOUT }
        )
        const calcPayload = response.data as CalculationResult
        updateResult(calcPayload)
        setFormulaResults((prev) => ({ ...prev, pseudo_homogeneous_summarize_ratios: calcPayload }))
        return calcPayload
      }

      // 过滤掉undefined值，只发送有效参数
      const parametersPayload: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(parameters)) {
        if (value !== undefined && value !== null && !isNaN(value)) {
          parametersPayload[key] = value as number
        }
      }

      if (formula.id === 'fei_xiangjun') {
        const norm = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
        const eta1 = parseFloat(norm(feiLambdaAuxEta1))
        const epsMm = parseFeiAuxEpsilonMm(feiLambdaAuxEpsilonPreset, feiLambdaAuxEpsilonCustom)
        if (Number.isFinite(eta1) && eta1 > 0) parametersPayload.eta_1 = eta1
        if (epsMm != null && epsMm > 0) parametersPayload.epsilon = epsMm
        parametersPayload.fei_iterate_lambda = 1
      }

      const response = await apiClient.post(`${API_BASE_URL}/calculate`, {
        formula_id: effectiveFormulaId,
        parameters: parametersPayload,
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

    const exportParameters: Record<string, unknown> = { ...validParameters }
    if (formula.id === 'pseudo_homogeneous_flow_judgment') {
      const pf = parsePseudoFlowFractionsFromRows(
        pseudoFlowRowsByFormula[formula.id] ?? PSEUDO_HOMOGENEOUS_FLOW_TEMPLATE_ROWS
      )
      if (!pf.error) {
        exportParameters.particle_fractions = pf.fractions
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
      parameters: exportParameters,
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
        const response = await apiClient.post(`${API_BASE_URL}/export`, { ...payload, save_path: savePath }, {
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
      const response = await apiClient.post(`${API_BASE_URL}/export`, payload, {
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
    /** 为 true 时不渲染第三行单位区（单位改由 value 内自行排版） */
    omitUnitRow?: boolean
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
          {opts.titleRight != null ? (
            <div className="flex shrink-0 items-center gap-1">{opts.titleRight}</div>
          ) : null}
        </div>
        <div className={valueCls}>{opts.value}</div>
        {!opts.omitUnitRow ? <div className={unitCls}>{opts.unitZh}</div> : null}
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
          className={`text-sm font-medium mb-3 ${
            darkMode ? 'text-gray-200' : 'text-gray-700'
          }`}
        >
          {language === 'en' ? 'Intermediate quantities' : '中间计算结果'}
          {language === 'en' ? ':' : '：'}
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
                <span className="font-mono">{value as ReactNode}</span>
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
        {renderAppHeader()}

        {/* Formula Section with Input Parameters */}
        <div className={mainPanelCardClassName}>
          <h2 className={`text-xl font-semibold mb-3 ${
            darkMode ? 'text-gray-100' : 'text-gray-900'
          }`}>
            {(formula?.id === 'slurry_accel_energy'
              ? '浆体加速流'
              : formula?.id === 'pseudo_homogeneous_flow_judgment'
                ? language === 'en'
                  ? 'Slurry pipeline regime judgment formulas'
                  : '浆体管道流态判断公式'
                : formula.name)}：
          </h2>

          {formula?.id === 'pseudo_homogeneous_flow_judgment' ? (
            <div className="mb-6 space-y-4">
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {language === 'en'
                  ? renderDescriptionWithMath(
                      'This formula classifies slurry pipeline flow regimes from concentration distributions at different heights in the pipe. First evaluate $R=C/C_A$ together with $R_{d95}$, the concentration ratio at particle size $d_{95}$; compare these against thresholds to assign pseudo-homogeneous, heterogeneous, or composite flow. Here $C$ is volumetric concentration at $0.92D$ above the invert, $C_A$ at $0.5D$, $R$ reflects how uniformly concentration is distributed over the cross-section, and $R_{d95}$ reflects suspension of the representative coarse fraction ($d_{95}$) over the cross-section.'
                    )
                  : renderDescriptionWithMath(
                      '该公式用于根据管道内不同高度处的浆体浓度分布特征，对浆体管道流态进行分类判定。计算时先求取浓度比值 $R = C/C_A$，并结合粒径 $d_{95}$ 对应的浓度比值 $R_{d95}$，将计算结果与给定阈值进行比较，从而判断浆体属于似均质流态、非均质流态或复合流态。其中，$C$ 为距管内底 $0.92D$ 处的体积浓度，$C_A$ 为距管内底 $0.5D$ 处的体积浓度，$R$ 反映整体浆体在管道断面上的浓度分布均匀程度，$R_{d95}$ 反映粗颗粒代表粒径在管道断面上的悬浮分布状态。'
                    )}
              </p>
              <div className={`overflow-x-auto pb-1 flex justify-center ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                <BlockMath math="\displaystyle R=\frac{C}{C_A},\qquad R_{d95}=\left(\frac{C}{C_A}\right)_{d95}" />
              </div>
              <div
                className={`overflow-x-auto rounded-xl border px-3 py-4 sm:px-4 ${
                  darkMode ? 'border-gray-500 bg-gray-700/35' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className={`text-sm font-semibold mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {language === 'en' ? 'Flow regime classification' : '流态判定'}
                </div>
                <div className={`${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                  {language === 'en' ? (
                    <BlockMath
                      math={
                        '\\text{Regime}=\\begin{cases}' +
                        '\\text{Pseudo-homogeneous}, & R \\geqslant 0.8 \\ \\text{and} \\ R_{d95} \\geqslant 0.5 \\\\' +
                        '\\text{Heterogeneous}, & R \\leqslant 0.1 \\\\' +
                        '\\text{Composite}, & 0.1 < R < 0.8 \\ \\text{and} \\ R_{d95} > 0.5' +
                        '\\end{cases}'
                      }
                    />
                  ) : (
                    <BlockMath
                      math={
                        '\\text{流态}=\\begin{cases}' +
                        '\\text{似均质流态}, & R \\geqslant 0.8 \\ \\text{且} \\ R_{d95} \\geqslant 0.5 \\\\' +
                        '\\text{非均质流态}, & R \\leqslant 0.1 \\\\' +
                        '\\text{复合流态}, & 0.1 < R < 0.8 \\ \\text{且} \\ R_{d95} > 0.5' +
                        '\\end{cases}'
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          ) : null}
          
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
                <FormulaFrame darkMode={darkMode}>
                  <BlockMath math="P_b = \frac{P_k}{K_f}" />
                </FormulaFrame>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="relative min-w-0">
                    <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, 'P_k'))}
                    </label>
                    <InputWithTrailingUnit
                      darkMode={darkMode}
                      className="relative z-10"
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
                      unit={
                        paramUnitDisplaySuffix(formula.parameters, 'P_k') !== ''
                          ? paramUnitDisplaySuffix(formula.parameters, 'P_k')
                          : null
                      }
                    />
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
                    <InputWithTrailingUnit
                      darkMode={darkMode}
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
                    />
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
                <FormulaFrame darkMode={darkMode}>
                  <BlockMath math="N=\frac{K_1\,Q_k\,P_b}{\eta_v\,\eta_c}" />
                </FormulaFrame>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {(() => {
                    const field = (name: 'P_b' | 'Q_k' | 'K_1' | 'eta_v' | 'eta_c', colSpan2?: boolean) => {
                      const unit = paramUnitDisplaySuffix(formula.parameters, name)
                      return (
                        <div key={name} className={`min-w-0 ${colSpan2 ? 'md:col-span-2' : ''}`}>
                          <label
                            className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}
                          >
                            {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, name))}
                          </label>
                          <InputWithTrailingUnit
                            darkMode={darkMode}
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
                            unit={unit !== '' ? unit : null}
                          />
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
                <FormulaFrame darkMode={darkMode}>
                  <BlockMath math="\rho_k = \frac{1}{\frac{C_w}{\rho_g}+\frac{1-C_w}{\rho_s}}" />
                </FormulaFrame>
                <ParameterFrame darkMode={darkMode} showTitle={false} className="mb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {SLURRY_FRICTION_WF_STEP1_FIELDS.map(({ name, label, unit, placeholder }) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(label)}
                      </label>
                      <InputWithTrailingUnit
                        darkMode={darkMode}
                        value={
                          formulaRawInputs['density_mixing']?.[name] ??
                          (formulaParameters['density_mixing']?.[name] != null &&
                          !isNaN(formulaParameters['density_mixing']![name]!)
                            ? String(formulaParameters['density_mixing']![name])
                            : '')
                        }
                        onChange={(e) => handleSubParameterChange('density_mixing', name, e.target.value)}
                        onBlur={() => handleSubParameterBlur('density_mixing', name)}
                        placeholder={placeholder}
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        unit={unit}
                      />
                    </div>
                  ))}
                </div>
                </ParameterFrame>
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
                        unitZh: 'kg/m³',
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
                <FormulaFrame darkMode={darkMode}>
                  <BlockMath math="\rho_1 = \rho_g \cdot C_{1V} + (1 - C_{1V}) \cdot \rho_k" />
                </FormulaFrame>
                <ParameterFrame darkMode={darkMode} showTitle={false} className="mb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {SLURRY_FRICTION_WF_DARCY_RHO1_FIELDS.map(({ name, label, unit, placeholder }) => {
                    const displayVal =
                      formulaRawInputs['darcy_friction']?.[name] ??
                      (formulaParameters['darcy_friction']?.[name] != null &&
                      !isNaN(formulaParameters['darcy_friction']![name]!)
                        ? String(formulaParameters['darcy_friction']![name])
                        : '')
                    return (
                      <div key={name}>
                        <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                          {renderDescriptionWithMath(label)}
                        </label>
                        {name === 'C1v' ? (
                          <CvVolumeConcentrationField
                            darkMode={darkMode}
                            inputValue={displayVal}
                            onInputChange={(v) => handleSubParameterChange('darcy_friction', name, v)}
                            onInputBlur={() => handleSubParameterBlur('darcy_friction', name)}
                            placeholder={placeholder}
                            unitText={unit}
                            onApplyCvFromRatio={(s) => handleSubParameterChange('darcy_friction', name, s)}
                          />
                        ) : (
                          <InputWithTrailingUnit
                            darkMode={darkMode}
                            placeholder={placeholder}
                            value={displayVal}
                            onChange={(e) => handleSubParameterChange('darcy_friction', name, e.target.value)}
                            onBlur={() => handleSubParameterBlur('darcy_friction', name)}
                            inputMode="decimal"
                            autoComplete="off"
                            spellCheck={false}
                            unit={unit}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
                </ParameterFrame>
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
                  const tS = im?.term_1minusC1v_rho_k ?? im?.term_1minusC1v_rho_s
                  const mid: [string, string][] = []
                  if (tL != null && !isNaN(Number(tL))) {
                    mid.push(['term_rho_g_C1v', `${fmtDissipation(Number(tL))} kg/m³`])
                  }
                  if (tS != null && !isNaN(Number(tS))) {
                    mid.push(['term_1minusC1v_rho_k', `${fmtDissipation(Number(tS))} kg/m³`])
                  }
                  return (
                    <>
                      {renderPrimaryResultCallout({
                        titleRow: renderDescriptionWithMath('混合物密度 $\\rho_1$：'),
                        unitZh: 'kg/m³',
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
                  {renderDescriptionWithMath('3. 计算雷诺数')}
                </div>
                <p className={`text-sm leading-relaxed mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath(SLURRY_FRICTION_WF_STEP_INTROS.darcy_re)}
                </p>
                <FormulaFrame darkMode={darkMode}>
                  <BlockMath math="Re_B = \frac{V \cdot D_n \cdot \rho_1}{\eta}" />
                </FormulaFrame>
                <ParameterFrame darkMode={darkMode} showTitle={false} className="mb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {SLURRY_FRICTION_WF_DARCY_RE_FIELDS.map(({ name, label, unit, placeholder }) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(label)}
                      </label>
                      <InputWithTrailingUnit
                        darkMode={darkMode}
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
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        unit={unit}
                      />
                    </div>
                  ))}
                </div>
                </ParameterFrame>
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
                    mid.push(['mixture_rho_1', `${fmtDissipation(Number(r.rho_1))} kg/m³`])
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
                <FormulaFrame darkMode={darkMode}>
                  <BlockMath math="\lambda = \frac{1.33036}{\left[\ln\left(\frac{\varepsilon}{3.7 D_n} + \frac{5.7385}{Re_B^{0.9}}\right)\right]^2}" />
                </FormulaFrame>
                <p className={`text-xs leading-relaxed mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {language === 'en'
                    ? 'Note: enter wall roughness ε in mm below; the program converts to SI metres (ε/1000) for use with D_n in m in the equation above.'
                    : '说明：下方管壁绝对粗糙度 ε 请以 mm 为单位输入；程序按 ε/1000 换算为 m 后与管内径 D_n（m）配套代入上式。'}
                </p>
                <ParameterFrame darkMode={darkMode} showTitle={false} className="mb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {SLURRY_FRICTION_WF_DARCY_LAMBDA_FIELDS.map(({ name, label, unit, placeholder }) => {
                    if (name === 'epsilon') {
                      const epsPresetKey = normalizeSlurryEpsilonPresetKey(
                        formulaRawInputs['darcy_friction']?.['epsilon_preset']
                      )
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
                          <SlurryEpsilonCombinedRow
                            darkMode={darkMode}
                            language={language}
                            presetKey={epsPresetKey}
                            valueMm={epsilonRaw}
                            onChange={(preset, mm) => {
                              setFormulaRawInputs((prev) => ({
                                ...prev,
                                darcy_friction: {
                                  ...(prev.darcy_friction || {}),
                                  epsilon_preset: preset,
                                  epsilon: mm,
                                },
                              }))
                              const norm = (s: string) => s.replace(/，/g, ',').replace(/,/g, '.').trim()
                              const parsed = parseFloat(norm(mm))
                              if (Number.isFinite(parsed) && parsed > 0) {
                                setFormulaParameters((prev) => ({
                                  ...prev,
                                  darcy_friction: { ...(prev.darcy_friction || {}), epsilon: parsed },
                                }))
                              }
                            }}
                            onBlur={() => handleSubParameterBlur('darcy_friction', 'epsilon')}
                          />
                        </div>
                      )
                    }
                    return (
                      <div key={name}>
                        <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                          {renderDescriptionWithMath(label)}
                        </label>
                        <InputWithTrailingUnit
                          darkMode={darkMode}
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
                          inputMode="decimal"
                          autoComplete="off"
                          spellCheck={false}
                          unit={unit}
                        />
                      </div>
                    )
                  })}
                </div>
                </ParameterFrame>
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
                  const mid: [string, string][] = []
                  const branch = String(im?.darcy_formula_branch ?? '')
                  if (branch === 'laminar') {
                    mid.push(['darcy_laminar_formula', '—'])
                  } else if (branch === 'swamee_jain') {
                    const keys = [
                      'epsilon_over_37D',
                      'swamee_jain_re_term',
                      'colebrook_ln_argument',
                      'colebrook_ln',
                      'colebrook_ln_squared',
                    ] as const
                    for (const k of keys) {
                      const v = im?.[k]
                      if (v === null || v === undefined || v === '') continue
                      const num = Number(v)
                      if (!Number.isFinite(num)) continue
                      mid.push([k, fmtDissipation(num)])
                    }
                  }
                  return (
                    <>
                      {renderPrimaryResultCallout({
                        titleRow: renderDescriptionWithMath('达西摩阻系数 $\\lambda$：'),
                        unitZh: language === 'en' ? 'dimensionless' : '无量纲',
                        value:
                          r?.lambda_coef != null ? (
                            <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                              {fmtDissipation(Number(r.lambda_coef))}
                            </span>
                          ) : (
                            <span className={`text-xl font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>—</span>
                          ),
                        })}
                      {mid.length > 0 &&
                        renderIntermediateResultsBlock(mid, 'darcy_friction_step3_lambda', 'white')}
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
                <FormulaFrame darkMode={darkMode}>
                  <BlockMath math="i_k = \lambda \cdot \frac{V^2 \rho_k}{2 g D \rho_s}" />
                </FormulaFrame>
                <ParameterFrame darkMode={darkMode} showTitle={false} className="mb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {SLURRY_FRICTION_WF_STEP3_FIELDS.map(({ name, label, unit, placeholder }) => (
                    <div key={name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(label)}
                      </label>
                      <InputWithTrailingUnit
                        darkMode={darkMode}
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
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        unit={unit}
                      />
                    </div>
                  ))}
                </div>
                </ParameterFrame>
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
          ) : isPseudoHomogeneousFlowJudgment ? (
            <>
              {(() => {
                const fid = formula.id
                const sar = pseudoCcaActiveRowByFormula[fid] ?? 0
                const snap = pseudoCcaChainByFormula[fid]?.[sar] || {}
                const ovRow = pseudoCcaKnownOverrideByFormula[fid]?.[sar] || {}
                const setOv = (field: keyof PseudoCcaKnownOverrideFields, val: string) => {
                  setPseudoCcaKnownOverrideByFormula((prev) => ({
                    ...prev,
                    [fid]: {
                      ...(prev[fid] || {}),
                      [sar]: { ...(prev[fid]?.[sar] || {}), [field]: val },
                    },
                  }))
                }
                const stepBusy = (st: string) => pseudoCcaStepBusyKey === `${st}-${sar}`
                const phRows = pseudoFlowRowsByFormula[fid] ?? PSEUDO_HOMOGENEOUS_FLOW_TEMPLATE_ROWS
                const phRow = phRows[sar] ?? PSEUDO_HOMOGENEOUS_FLOW_TEMPLATE_ROWS[0]
                const wiNorm = normalizeCsvDecimalInput(phRow.omega ?? '')
                const wiParsed = parseFloat(wiNorm)
                const wiStep5Ok = wiNorm !== '' && Number.isFinite(wiParsed) && wiParsed >= 0
                const patchPseudoFlowRowField = (rowIdx: number, patch: Partial<PseudoHomogeneousFlowRow>) => {
                  setPseudoFlowRowsByFormula((prev) => {
                    const base = (prev[fid] ?? PSEUDO_HOMOGENEOUS_FLOW_TEMPLATE_ROWS.map((r) => ({ ...r }))).map((r) => ({
                      ...r,
                    }))
                    while (base.length <= rowIdx) {
                      base.push({ d: '2e-4', delta_P: '1', omega: '' })
                    }
                    base[rowIdx] = { ...base[rowIdx], ...patch }
                    return { ...prev, [fid]: base }
                  })
                }
                const lblCls = `block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`
                const calcBtnCls = `px-6 py-2 rounded-lg font-medium disabled:opacity-50 ${
                  darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`
                const phParam = (name: string) => {
                  const param = formula.parameters.find((p) => p.name === name)
                  if (!param) return null
                  return (
                    <div key={name} className="min-w-0">
                      <label className={lblCls}>
                        {renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, param.name))}
                      </label>
                      <InputWithTrailingUnit
                        darkMode={darkMode}
                        value={
                          rawInputs[param.name] ??
                          (parameters[param.name] != null && !isNaN(parameters[param.name]!)
                            ? String(parameters[param.name])
                            : '')
                        }
                        onChange={(e) => handleParameterChange(param.name, e.target.value)}
                        onBlur={() => handleParameterBlur(param.name)}
                        placeholder={commonParamPlaceholder(formula.parameters, param.name)}
                        unit={shouldShowParameterUnitSuffix(param.unit) ? param.unit ?? null : null}
                      />
                    </div>
                  )
                }
                return (
                  <>
                    {/* Step 1 · 计算浆体密度 ρ₁（式 4-8） */}
                    <div
                      className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}
                    >
                      <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                        {language === 'en'
                          ? '1. Slurry mixture density ρ₁'
                          : '1. 计算浆体密度'}
                      </div>
                      <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {language === 'en' ? (
                          <span>
                            From solid density <InlineMath math="\rho_g" />
                            , liquid density <InlineMath math="\rho_s" />
                            , and slurry volumetric concentration <InlineMath math="C_{1V}" />
                            , compute slurry mixture density <InlineMath math="\rho_1" />
                            . It is the equivalent density from solid and liquid volumetric fractions and underpins the{' '}
                            <InlineMath math="\mathrm{Re}_B" /> calculation used later.
                          </span>
                        ) : (
                          renderDescriptionWithMath(
                            '由固体密度 $\\rho_g$、液相密度 $\\rho_s$ 及浆体体积浓度 $C_{1V}$ 计算浆体混合密度 $\\rho_1$。该密度表示浆体中固相与液相按体积分数组成后的等效密度，是后续雷诺数 $\\mathrm{Re}_B$ 计算所需的基础参数。'
                          )
                        )}
                      </p>
                      <FormulaFrame darkMode={darkMode}>
                        <BlockMath math="\displaystyle \rho_1 = \rho_g C_{1V} + (1-C_{1V})\rho_s" />
                      </FormulaFrame>
                      <ParameterFrame darkMode={darkMode} showTitle={false} className="mb-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {phParam('rho_g')}
                        {phParam('rho_s')}
                        <div className="md:col-span-2">
                          <label className={lblCls}>
                            {language === 'en'
                              ? renderDescriptionWithMath(
                                  '$C_{1V}$ (0–1): same expandable assist as critical-velocity $C_V$ ($C/C_A$ or volumes)'
                                )
                              : renderDescriptionWithMath(
                                  '$C_{1V}$（小数 0～1）：与「临界流速」模块相同，点击输入框展开「体积浓度——辅助计算」'
                                )}
                          </label>
                          <CvVolumeConcentrationField
                            darkMode={darkMode}
                            inputValue={rawInputs['Cv'] ?? ''}
                            onInputChange={(v) => handleParameterChange('Cv', v)}
                            onInputBlur={() => handleParameterBlur('Cv')}
                            placeholder={
                              language === 'en'
                                ? 'Click input to expand volumetric-concentration assist (same as critical velocity)'
                                : CV_VOLUME_ASSIST_HINT
                            }
                            unitText="（0～1）"
                            onApplyCvFromRatio={(s) => handleParameterChange('Cv', s)}
                            assistKind="solid_volume_ratio"
                            rhoGKgM3FromForm={
                              parameters.rho_g != null && !isNaN(Number(parameters.rho_g))
                                ? Number(parameters.rho_g)
                                : undefined
                            }
                          />
                        </div>
                      </div>
                      </ParameterFrame>
                      <div className="flex justify-end mb-4">
                        <button
                          type="button"
                          disabled={pseudoCcaStepBusyKey != null}
                          onClick={() => runPseudoCcaChainStep('rho', sar)}
                          className={calcBtnCls}
                        >
                          {stepBusy('rho') ? '…' : language === 'en' ? 'Calculate' : '计算'}
                        </button>
                      </div>
                      {renderPrimaryResultCallout({
                        nameZh: '浆体密度',
                        symbolMath: '\\rho_1',
                        unitZh: 'kg/m³',
                        value: (
                          <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                            {snap.rho_l != null && Number.isFinite(snap.rho_l) ? fmtDissipation(snap.rho_l) : '—'}
                          </span>
                        ),
                      })}
                    </div>

                    {/* Step 2 · 计算雷诺数 */}
                    <div
                      className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}
                    >
                      <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                        {language === 'en' ? '2. Calculate Reynolds number' : renderDescriptionWithMath('2. 计算雷诺数')}
                      </div>
                      <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {language === 'en' ? (
                          <span>
                            This step computes the Bingham Reynolds number <InlineMath math="\mathrm{Re}_B" />. It accounts for
                            cross-sectional average velocity <InlineMath math="v" />, pipe inner diameter{' '}
                            <InlineMath math="D_{n}" />, mixture density, and mixture dynamic viscosity{' '}
                            <InlineMath math="\eta" /> to characterize Bingham-type
                            slurry flow in the pipe. The value then feeds the{' '}
                            <strong className="font-medium">Liu–Fanning</strong> friction factor step used to relate friction to flow regime.
                          </span>
                        ) : (
                          renderDescriptionWithMath(
                            '本步骤用于计算浆体的宾汉雷诺数 $\\mathrm{Re}_B$。该参数综合考虑断面平均流速 $v$、管道内径 $D_{n}$、浆体混合物密度 $\\rho_1$ 及混合物动力粘度 $\\eta$，用于表征宾汉型浆体在管道中的流动状态。计算得到的 $\\mathrm{Re}_B$ 将作为后续刘德忠–Fanning 摩阻系数计算的基础参数，用于确定摩阻系数与流动状态之间的关系。'
                          )
                        )}
                      </p>
                      <FormulaFrame darkMode={darkMode}>
                        <BlockMath math="\displaystyle \mathrm{Re}_B = \frac{v\, D_{n}\, \rho_1}{\eta}" />
                      </FormulaFrame>
                      <ParameterFrame darkMode={darkMode} showTitle={false} className="mb-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="min-w-0">
                          <label className={lblCls}>{renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, 'v'))}</label>
                          <InputWithTrailingUnit
                            darkMode={darkMode}
                            value={
                              rawInputs['v'] ??
                              (parameters['v'] != null && !isNaN(parameters['v']!) ? String(parameters['v']) : '')
                            }
                            onChange={(e) => handleParameterChange('v', e.target.value)}
                            onBlur={() => handleParameterBlur('v')}
                            placeholder={commonParamPlaceholder(formula.parameters, 'v')}
                            unit="m/s"
                          />
                        </div>
                        <div className="min-w-0">
                          <label className={lblCls}>{renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, 'D'))}</label>
                          <InputWithTrailingUnit
                            darkMode={darkMode}
                            value={
                              rawInputs['D'] ??
                              (parameters['D'] != null && !isNaN(parameters['D']!) ? String(parameters['D']) : '')
                            }
                            onChange={(e) => handleParameterChange('D', e.target.value)}
                            onBlur={() => handleParameterBlur('D')}
                            placeholder={commonParamPlaceholder(formula.parameters, 'D')}
                            unit="m"
                          />
                        </div>
                        <div className="min-w-0">
                          <label className={lblCls}>
                            {renderDescriptionWithMath('$\\rho_1$：浆体密度（kg/m³）；取步骤「1」计算结果，可修改')}
                          </label>
                          <InputWithTrailingUnit
                            darkMode={darkMode}
                            value={
                              ovRow.rho_l !== undefined
                                ? ovRow.rho_l
                                : snap.rho_l != null && Number.isFinite(snap.rho_l)
                                  ? String(snap.rho_l)
                                  : ''
                            }
                            onChange={(e) => setOv('rho_l', e.target.value)}
                            placeholder={language === 'en' ? 'From step 1 or manual' : '步骤 1 结果或手填'}
                            unit="kg/m³"
                          />
                        </div>
                        <div className="min-w-0">
                          <label className={lblCls}>{renderDescriptionWithMath(paramLabelFromFormula(formula.parameters, 'eta'))}</label>
                          <InputWithTrailingUnit
                            darkMode={darkMode}
                            value={
                              rawInputs['eta'] ??
                              (parameters['eta'] != null && !isNaN(parameters['eta']!) ? String(parameters['eta']) : '')
                            }
                            onChange={(e) => handleParameterChange('eta', e.target.value)}
                            onBlur={() => handleParameterBlur('eta')}
                            placeholder={commonParamPlaceholder(formula.parameters, 'eta')}
                            unit="Pa·s"
                          />
                        </div>
                      </div>
                      </ParameterFrame>
                      <div className="flex justify-end mb-4">
                        <button
                          type="button"
                          disabled={pseudoCcaStepBusyKey != null}
                          onClick={() => runPseudoCcaChainStep('re', sar)}
                          className={calcBtnCls}
                        >
                          {stepBusy('re') ? '…' : language === 'en' ? 'Calculate' : '计算'}
                        </button>
                      </div>
                      {renderPrimaryResultCallout({
                        nameZh: '宾汉雷诺数',
                        symbolMath: '\\mathrm{Re}_B',
                        unitZh: '无量纲',
                        value: (
                          <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                            {snap.Re_B != null && Number.isFinite(snap.Re_B) ? fmtDissipation(snap.Re_B) : '—'}
                          </span>
                        ),
                      })}
                    </div>

                    {/* Step 3 · 刘德忠–Fanning f_L（式 4-6） */}
                    <div
                      className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}
                    >
                      <div
                        className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}
                      >
                        {language === 'en' ? '3. Calculate Liu–Fanning friction factor' : '3. 计算刘德忠–Fanning摩阻系数'}
                      </div>
                      <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {language === 'en' ? (
                          <span>
                            This step calculates the Liu–Fanning friction factor <InlineMath math="f_L" />. It accounts for
                            slurry flow state, pipe inner diameter, and wall roughness effects on along-pipe losses, and
                            characterizes friction during transport. The resulting <InlineMath math="f_L" /> feeds the next
                            step’s friction velocity <InlineMath math="U" />.
                          </span>
                        ) : (
                          renderDescriptionWithMath(
                            '本步骤用于计算刘德忠–Fanning 摩阻系数 $f_L$。该系数综合考虑浆体流动状态、管道内径和管壁粗糙度对沿程阻力的影响，用于表征浆体在管道输送过程中的摩阻特性。计算得到的 $f_L$ 将作为下一步摩阻流速 $U$ 计算的基础参数。'
                          )
                        )}
                      </p>
                      <div className={`mb-5 overflow-x-auto rounded-xl border px-3 py-4 md:px-4 ${darkMode ? 'border-gray-500/50 bg-gray-800/40' : 'border-gray-200 bg-gray-50/90'}`}>
                        <BlockMath math="\displaystyle f_L=\frac{0.33259}{\left[\ln\left(\frac{\varepsilon}{3.7D_n}+\frac{5.7385}{\mathrm{Re}_B^{0.9}}\right)\right]^2}" />
                      </div>
                      <div
                        className={`mb-5 rounded-2xl border px-4 py-5 md:px-6 md:py-6 ${
                          darkMode
                            ? 'border-gray-500/60 bg-gradient-to-b from-gray-700/45 to-gray-800/25 shadow-inner'
                            : 'border-gray-200/90 bg-gradient-to-b from-white to-gray-50/95 shadow-sm'
                        }`}
                      >
                        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-x-6 md:gap-y-5">
                          <div className="min-w-0 space-y-2">
                            <label className={lblCls}>
                              {language === 'en'
                                ? renderDescriptionWithMath('$Re_B$: Reynolds number — defaults to step 2 result if empty')
                                : renderDescriptionWithMath(
                                    '$Re_B$：雷诺数；取步骤「2」计算结果，可修改'
                                  )}
                            </label>
                            <div
                              className={`flex min-h-[2.75rem] items-center gap-3 rounded-xl border px-3 transition-shadow ${
                                darkMode
                                  ? 'border-gray-500/80 bg-gray-800/60 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30'
                                  : 'border-gray-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
                              }`}
                            >
                              <input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                spellCheck={false}
                                value={
                                  ovRow.Re_B != null && String(ovRow.Re_B).trim() !== ''
                                    ? ovRow.Re_B
                                    : snap.Re_B != null && Number.isFinite(snap.Re_B)
                                      ? String(snap.Re_B)
                                      : ''
                                }
                                onChange={(e) => setOv('Re_B', e.target.value)}
                                className={`min-w-0 flex-1 border-0 bg-transparent py-2.5 text-base focus:outline-none focus:ring-0 ${
                                  darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                                }`}
                                placeholder={language === 'en' ? 'From step 2 or manual' : '步骤 2 结果或手填，如 20000'}
                              />
                              <span
                                className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium tracking-wide ${
                                  darkMode ? 'bg-gray-900/50 text-gray-400' : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {language === 'en' ? 'nondim.' : '无量纲'}
                              </span>
                            </div>
                          </div>
                          <div className="min-w-0 space-y-2">
                            <label className={lblCls}>
                              {language === 'en'
                                ? renderDescriptionWithMath('$D_n$: pipe inner diameter — defaults to step 2 / main form')
                                : renderDescriptionWithMath(
                                    '$D_{n}$：管道内径；取步骤「2」参数输入结果，可修改'
                                  )}
                            </label>
                            <div
                              className={`flex min-h-[2.75rem] items-center gap-3 rounded-xl border px-3 transition-shadow ${
                                darkMode
                                  ? 'border-gray-500/80 bg-gray-800/60 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30'
                                  : 'border-gray-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
                              }`}
                            >
                              <input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                spellCheck={false}
                                value={
                                  ovRow.D_n != null && String(ovRow.D_n).trim() !== ''
                                    ? ovRow.D_n
                                    : rawInputs['D'] ??
                                      (parameters['D'] != null && !isNaN(Number(parameters['D']))
                                        ? String(parameters['D'])
                                        : '')
                                }
                                onChange={(e) => {
                                  const s = e.target.value
                                  setOv('D_n', s)
                                  handleParameterChange('D', s)
                                }}
                                onBlur={() => handleParameterBlur('D')}
                                className={`min-w-0 flex-1 border-0 bg-transparent py-2.5 text-base focus:outline-none focus:ring-0 ${
                                  darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                                }`}
                                placeholder={language === 'en' ? 'e.g. 0.2' : '如 0.2'}
                              />
                              <span
                                className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
                                  darkMode ? 'bg-gray-900/50 text-gray-400' : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                m
                              </span>
                            </div>
                          </div>
                          <div className="min-w-0 space-y-2 md:col-span-2">
                            <label className={lblCls}>
                              {language === 'en'
                                ? renderDescriptionWithMath('$\\varepsilon$: pipe wall absolute roughness')
                                : renderDescriptionWithMath('$\\varepsilon$：管壁绝对粗糙度')}
                            </label>
                            <div
                              className={`rounded-xl transition-shadow ${
                                darkMode
                                  ? 'ring-1 ring-gray-500/70 focus-within:ring-blue-500/50'
                                  : 'shadow-sm ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-blue-100'
                              }`}
                            >
                              <SlurryEpsilonCombinedRow
                                darkMode={darkMode}
                                language={language}
                                presetKey={pseudoCcaEpsilonPreset}
                                valueMm={pseudoCcaEpsilonCustomMm}
                                onChange={(preset, mmStr) => {
                                  setPseudoCcaEpsilonPreset(preset)
                                  setPseudoCcaEpsilonCustomMm(mmStr)
                                  const epsVal = parseFeiAuxEpsilonMm(preset, mmStr)
                                  if (epsVal != null && Number.isFinite(epsVal))
                                    handleParameterChange('epsilon', String(epsVal))
                                }}
                                onBlur={() => handleParameterBlur('epsilon')}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end mb-4">
                        <button
                          type="button"
                          disabled={pseudoCcaStepBusyKey != null}
                          onClick={() => runPseudoCcaChainStep('fl', sar)}
                          className={calcBtnCls}
                        >
                          {stepBusy('fl') ? '…' : language === 'en' ? 'Calculate' : '计算'}
                        </button>
                      </div>
                      {renderPrimaryResultCallout({
                        nameZh: 'Fanning 摩阻系数',
                        symbolMath: 'f_L',
                        unitZh: '无量纲',
                        value: (
                          <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                            {snap.f_L != null && Number.isFinite(snap.f_L) ? fmtDissipation(snap.f_L) : '—'}
                          </span>
                        ),
                      })}
                    </div>

                    {/* Step 4 · 摩阻流速 U（式 4-5） */}
                    <div
                      className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}
                    >
                      <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                        {language === 'en' ? '4. Calculate friction velocity' : '4. 计算摩阻流速'}
                      </div>
                      <p className={`text-sm mb-3 leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {language === 'en' ? (
                          <span>
                            This step calculates the friction velocity <InlineMath math="U" />. Friction velocity links the
                            cross-sectional average velocity <InlineMath math="V" /> to the Fanning friction factor{' '}
                            <InlineMath math="f_L" />, characterizing the shear-flow intensity near the pipe wall from
                            friction. The resulting <InlineMath math="U" /> serves as the velocity-scale parameter in the
                            subsequent relative volumetric concentration{' '}
                            <InlineMath math="(C/C_A)_i" />
                            , supporting analysis of size-class concentration distributions across the pipe section.
                          </span>
                        ) : (
                          renderDescriptionWithMath(
                            '本步骤用于计算摩阻流速 $U$。摩阻流速将断面平均流速 $V$ 与 Fanning 摩阻系数 $f_L$ 联系起来，用于表征浆体在管道壁面附近由摩阻作用产生的剪切流动强度。计算得到的 $U$ 将作为后续相对体积浓度 $(C/C_A)_i$ 计算中的速度尺度参数，用于进一步分析不同粒径颗粒在管道断面上的浓度分布状态。'
                          )
                        )}
                      </p>
                      <div
                        className={`mb-5 overflow-x-auto rounded-xl border px-3 py-4 md:px-4 ${darkMode ? 'border-gray-500/50 bg-gray-800/40' : 'border-gray-200 bg-gray-50/90'}`}
                      >
                        <BlockMath math={"U = V\\sqrt{f_L/2}"} />
                      </div>
                      <div
                        className={`mb-5 rounded-2xl border px-4 py-5 md:px-6 md:py-6 ${
                          darkMode
                            ? 'border-gray-500/60 bg-gradient-to-b from-gray-700/45 to-gray-800/25 shadow-inner'
                            : 'border-gray-200/90 bg-gradient-to-b from-white to-gray-50/95 shadow-sm'
                        }`}
                      >
                        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
                          <div className="min-w-0 space-y-2">
                            <label className={lblCls}>
                              {language === 'en'
                                ? renderDescriptionWithMath(
                                    '$V$: cross-sectional average velocity — from step 2 / main form when linked; editable here'
                                  )
                                : renderDescriptionWithMath(
                                    '$V$：断面平均流速；取步骤「2」参数输入结果，可修改'
                                  )}
                            </label>
                            <div
                              className={`flex min-h-[2.75rem] items-center gap-3 rounded-xl border px-3 transition-shadow ${
                                darkMode
                                  ? 'border-gray-500/80 bg-gray-800/60 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30'
                                  : 'border-gray-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
                              }`}
                            >
                              <input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                spellCheck={false}
                                value={
                                  rawInputs['v'] ??
                                  (parameters['v'] != null && !isNaN(Number(parameters['v']))
                                    ? String(parameters['v'])
                                    : '')
                                }
                                onChange={(e) => handleParameterChange('v', e.target.value)}
                                onBlur={() => handleParameterBlur('v')}
                                className={`min-w-0 flex-1 border-0 bg-transparent py-2.5 text-base focus:outline-none focus:ring-0 ${
                                  darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                                }`}
                                placeholder={language === 'en' ? 'e.g. from step 2 or type here' : '步骤「2」联动或手填，如 2'}
                              />
                              <span
                                className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
                                  darkMode ? 'bg-gray-900/50 text-gray-400' : 'bg-gray-200/90 text-gray-600'
                                }`}
                              >
                                m/s
                              </span>
                            </div>
                          </div>
                          <div className="min-w-0 space-y-2">
                            <label className={lblCls}>
                              {language === 'en'
                                ? renderDescriptionWithMath(
                                    '$f_L$: Fanning friction factor — defaults to step 3; editable if needed'
                                  )
                                : renderDescriptionWithMath(
                                    '$f_L$：Fanning 摩阻系数；取步骤「3」计算结果，可修改'
                                  )}
                            </label>
                            <div
                              className={`flex min-h-[2.75rem] items-center gap-3 rounded-xl border px-3 transition-shadow ${
                                darkMode
                                  ? 'border-gray-500/80 bg-gray-800/60 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30'
                                  : 'border-gray-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
                              }`}
                            >
                              <input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                spellCheck={false}
                                value={
                                  ovRow.f_L != null && String(ovRow.f_L).trim() !== ''
                                    ? ovRow.f_L
                                    : snap.f_L != null && Number.isFinite(snap.f_L)
                                      ? String(snap.f_L)
                                      : ''
                                }
                                onChange={(e) => setOv('f_L', e.target.value)}
                                className={`min-w-0 flex-1 border-0 bg-transparent py-2.5 text-base focus:outline-none focus:ring-0 ${
                                  darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                                }`}
                                placeholder={language === 'en' ? 'From step 3 or manual' : '步骤 3 结果或手填'}
                              />
                              <span
                                className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium tracking-wide ${
                                  darkMode ? 'bg-gray-900/50 text-gray-400' : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {language === 'en' ? 'nondim.' : '无量纲'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end mb-4">
                        <button
                          type="button"
                          disabled={pseudoCcaStepBusyKey != null}
                          onClick={() => runPseudoCcaChainStep('u', sar)}
                          className={calcBtnCls}
                        >
                          {stepBusy('u') ? '…' : language === 'en' ? 'Calculate' : '计算'}
                        </button>
                      </div>
                      {renderPrimaryResultCallout({
                        nameZh: '摩阻流速',
                        symbolMath: 'U',
                        unitZh: 'm/s',
                        value: (
                          <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                            {snap.U != null && Number.isFinite(snap.U) ? fmtDissipation(snap.U) : '—'}
                          </span>
                        ),
                      })}
                    </div>

                    {/* Step 5 · 计算相对体积浓度（式 4-4） */}
                    <div
                      className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}
                    >
                      <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                        {language === 'en' ? '5. Calculate relative volume concentration' : '5. 计算相对体积浓度'}
                      </div>
                      <p className={`text-sm mb-3 leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {language === 'en' ? (
                          <span>
                            This step calculates the relative volume concentration{' '}
                            <InlineMath math="(C/C_A)_i" /> for each particle size group on the pipe cross-section. The
                            formula uses settling velocity <InlineMath math="\omega_i" />, friction velocity{' '}
                            <InlineMath math="U" />, and empirical coefficients <InlineMath math="K" /> and{' '}
                            <InlineMath math="\beta" /> to estimate how the <InlineMath math="i" />
                            -th size class is distributed in suspension. Larger <InlineMath math="\omega_i" /> tends to
                            drive deposition toward the pipe bottom and usually yields smaller{' '}
                            <InlineMath math="(C/C_A)_i" />
                            ; larger <InlineMath math="U" /> means stronger shear and disturbance, helping particles remain
                            suspended.
                          </span>
                        ) : (
                          renderDescriptionWithMath(
                            '本步骤用于计算各粒径组颗粒在管道断面上的相对体积浓度 $(C/C_A)_i$。该公式根据颗粒沉降速度 $\\omega_i$、摩阻流速 $U$ 以及经验系数 $K$、$\\beta$，估算第 $i$ 个粒径组颗粒在浆体中的悬浮分布状态。颗粒沉降速度越大，颗粒越容易向管底沉积，其相对体积浓度值通常越小；摩阻流速越大，管内剪切和扰动作用越强，颗粒越容易保持悬浮。'
                          )
                        )}
                      </p>
                      <div className={`mb-4 overflow-x-auto ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                        <BlockMath math="\displaystyle \left(\frac{C}{C_A}\right)_i = 10^{-1.8\,\omega_i/(K\beta U)}" />
                      </div>
                      <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <div className="min-w-0 space-y-2 md:col-span-2">
                          <label className={lblCls}>
                            {language === 'en'
                              ? renderDescriptionWithMath('$W_i$: weighted mean settling velocity (m/s)')
                              : <>Wi：似均质中加权平均沉速（m/s）</>}
                          </label>
                          <LiuDezhongOmegaBinghamField
                            darkMode={darkMode}
                            assistContext="flow_judgment"
                            language={language === 'en' ? 'en' : 'zh'}
                            inputValue={phRow.omega ?? ''}
                            onInputChange={(v) => patchPseudoFlowRowField(sar, { omega: v })}
                            onInputBlur={() => {}}
                            placeholder={
                              language === 'en'
                                ? 'Enter or open assist — m/s required'
                                : '点击展开沉速辅助计算，或手动输入'
                            }
                            parameters={{
                              ...parameters,
                              ...(snap.rho_l != null && Number.isFinite(snap.rho_l)
                                ? { rho_k: snap.rho_l }
                                : {}),
                            }}
                            onApplyOmega={(s) => {
                              const n = parseFloat(normalizeDecimalInput(String(s).trim()))
                              if (!Number.isFinite(n)) return
                              const rounded = roundLiuDezhongSlurryVelocity(n)
                              patchPseudoFlowRowField(sar, { omega: formatLiuSlurryVelocityRawInput(rounded) })
                            }}
                          />
                        </div>
                        <div className="min-w-0 space-y-2">
                          <label className={lblCls}>
                            {language === 'en'
                              ? renderDescriptionWithMath(
                                  '$K$: modified von Kármán constant — default 0.36; page-top or below'
                                )
                              : renderDescriptionWithMath('$K$：修正卡门常数；')}
                          </label>
                          <div
                            className={`flex min-h-[2.75rem] items-center gap-3 rounded-xl border px-3 transition-shadow ${
                              darkMode
                                ? 'border-gray-500/80 bg-gray-800/60 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30'
                                : 'border-gray-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
                            }`}
                          >
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              spellCheck={false}
                              value={
                                ovRow.K_karman != null && String(ovRow.K_karman).trim() !== ''
                                  ? ovRow.K_karman
                                  : parameters.K_karman != null && !isNaN(Number(parameters.K_karman))
                                    ? String(parameters.K_karman)
                                    : ''
                              }
                              onChange={(e) => setOv('K_karman', e.target.value)}
                              className={`min-w-0 flex-1 border-0 bg-transparent py-2.5 text-base focus:outline-none focus:ring-0 ${
                                darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                              }`}
                              placeholder="0.36"
                            />
                            <span
                              className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium tracking-wide ${
                                darkMode ? 'bg-gray-900/50 text-gray-400' : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {language === 'en' ? 'nondim.' : '无量纲'}
                            </span>
                          </div>
                        </div>
                        <div className="min-w-0 space-y-2">
                          <label className={lblCls}>
                            {language === 'en'
                              ? renderDescriptionWithMath('$\\beta$: Ismail coefficient — default 1')
                              : renderDescriptionWithMath('$\\beta$：伊斯梅尔系数；')}
                          </label>
                          <div
                            className={`flex min-h-[2.75rem] items-center gap-3 rounded-xl border px-3 transition-shadow ${
                              darkMode
                                ? 'border-gray-500/80 bg-gray-800/60 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30'
                                : 'border-gray-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
                            }`}
                          >
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              spellCheck={false}
                              value={
                                ovRow.beta_ismail != null && String(ovRow.beta_ismail).trim() !== ''
                                  ? ovRow.beta_ismail
                                  : parameters.beta_ismail != null && !isNaN(Number(parameters.beta_ismail))
                                    ? String(parameters.beta_ismail)
                                    : ''
                              }
                              onChange={(e) => setOv('beta_ismail', e.target.value)}
                              className={`min-w-0 flex-1 border-0 bg-transparent py-2.5 text-base focus:outline-none focus:ring-0 ${
                                darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                              }`}
                              placeholder="1"
                            />
                            <span
                              className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium tracking-wide ${
                                darkMode ? 'bg-gray-900/50 text-gray-400' : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {language === 'en' ? 'nondim.' : '无量纲'}
                            </span>
                          </div>
                        </div>
                        <div className="min-w-0 space-y-2">
                          <label className={lblCls}>
                            {language === 'en'
                              ? renderDescriptionWithMath(
                                  '$U$: friction velocity (m/s) — defaults to step 4; editable / override'
                                )
                              : renderDescriptionWithMath(
                                  '$U$：摩阻流速（m/s）；取步骤「4」计算结果，可修改'
                                )}
                          </label>
                          <div
                            className={`flex min-h-[2.75rem] items-center gap-3 rounded-xl border px-3 transition-shadow ${
                              darkMode
                                ? 'border-gray-500/80 bg-gray-800/60 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30'
                                : 'border-gray-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
                            }`}
                          >
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              spellCheck={false}
                              value={
                                ovRow.U != null && String(ovRow.U).trim() !== ''
                                  ? ovRow.U
                                  : snap.U != null && Number.isFinite(snap.U)
                                    ? String(snap.U)
                                    : ''
                              }
                              onChange={(e) => setOv('U', e.target.value)}
                              className={`min-w-0 flex-1 border-0 bg-transparent py-2.5 text-base focus:outline-none focus:ring-0 ${
                                darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                              }`}
                              placeholder={language === 'en' ? 'From step 4 or manual' : '步骤「4」结果或手填'}
                            />
                            <span
                              className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
                                darkMode ? 'bg-gray-900/50 text-gray-400' : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              m/s
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end mb-4">
                        <button
                          type="button"
                          disabled={pseudoCcaStepBusyKey != null || !wiStep5Ok}
                          onClick={() => runPseudoCcaChainStep('ratio', sar)}
                          className={calcBtnCls}
                        >
                          {stepBusy('ratio') ? '…' : language === 'en' ? 'Calculate' : '计算'}
                        </button>
                      </div>
                      {renderPrimaryResultCallout({
                        nameZh: '本档比值',
                        symbolMath: '(C/C_A)_i',
                        unitZh: '无量纲',
                        value: (
                          <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                            {snap.c_over_ca_i != null && Number.isFinite(snap.c_over_ca_i)
                              ? fmtDissipation(snap.c_over_ca_i)
                              : '—'}
                          </span>
                        ),
                      })}
                    </div>

                    {/* Step 6 · 流态判断 */}
                    <div
                      className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}
                    >
                      <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                        {language === 'en' ? '6. Flow regime judgment' : '6. 流态判断'}
                      </div>
                      <p className={`text-sm mb-3 leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {language === 'en' ? (
                          <span>
                            This step computes the overall relative volume concentration{' '}
                            <InlineMath math="C/C_A" /> by weighted summation of each size class’s{' '}
                            <InlineMath math="(C/C_A)_i" /> using the gradation weights{' '}
                            <InlineMath math="\Delta P_i" />. Weights <InlineMath math="\Delta P_i" /> are mass fractions
                            (summing to 1); <InlineMath math="d_{95}" /> is used only to interpolate{' '}
                            <InlineMath math="(C/C_A)_{d95}" /> on the cumulative size distribution—it is not itself a
                            summation weight. After step 5, use the page-wide <strong>开始计算</strong> button to submit:
                            the program returns overall <InlineMath math="C/C_A" />,{' '}
                            <InlineMath math="(C/C_A)_{d95}" />, and the regime class.
                          </span>
                        ) : (
                          <>
                            {renderDescriptionWithMath(
                              '本公式用于计算浆体整体相对体积浓度 $C/C_A$。通过将各粒径组的相对体积浓度 $(C/C_A)_i$ 按其级配比例 $\\Delta P_i$ 进行加权求和，得到最终的整体相对体积浓度结果。'
                            )}
                            <span className="block mt-2 text-sm leading-relaxed">
                              {renderDescriptionWithMath(
                                '说明：加权权重为各粒径档的级配比例 $\\Delta P_i$（质量分数，总和须为 1）；$d_{95}$ 仅用于在累计粒径分布上插值得到 $(C/C_A)_{d95}$，不是求和权重本身。完成各档步骤 5 后，请使用页面右下角「开始计算」提交，由程序给出整体 $C/C_A$、$(C/C_A)_{d95}$ 及流态归类。'
                              )}
                            </span>
                          </>
                        )}
                      </p>
                      <div className={`mb-4 overflow-x-auto ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                        <BlockMath math="\displaystyle \frac{C}{C_A}=\sum_i \left(\frac{C}{C_A}\right)_i \Delta P_i" />
                      </div>
                      <div
                        className={`mb-5 rounded-2xl border px-4 py-5 md:px-6 ${
                          darkMode
                            ? 'border-gray-500/60 bg-gradient-to-b from-gray-700/45 to-gray-800/25 shadow-inner'
                            : 'border-gray-200/90 bg-gradient-to-b from-white to-gray-50/95 shadow-sm'
                        }`}
                      >
                        <div className={`mb-3 text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                          {language === 'en'
                            ? 'Summation-linked parameters (per size class; editable)'
                            : '汇总联动参数（各粒径档；可在此处核对或改写）'}
                        </div>
                        <div className="space-y-4">
                          {phRows.map((r, idx) => {
                            const rowSnap = pseudoCcaChainByFormula[fid]?.[idx] || {}
                            const cci = rowSnap.c_over_ca_i
                            const activeCls =
                              idx === sar
                                ? darkMode
                                  ? 'ring-2 ring-blue-500/35 border-blue-500/40'
                                  : 'ring-2 ring-blue-200 border-blue-200/90'
                                : ''
                            const rowShell = `flex min-h-[2.75rem] items-center gap-3 rounded-xl border px-3 transition-shadow ${
                              darkMode
                                ? 'border-gray-500/80 bg-gray-800/60 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30'
                                : 'border-gray-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100'
                            }`
                            const rowInp = `min-w-0 flex-1 border-0 bg-transparent py-2.5 text-base focus:outline-none focus:ring-0 ${
                              darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                            }`
                            const pill =
                              `shrink-0 rounded-md px-2 py-1 text-xs font-medium tracking-wide ${
                                darkMode ? 'bg-gray-900/50 text-gray-400' : 'bg-gray-100 text-gray-600'
                              }`
                            return (
                              <div
                                key={idx}
                                className={`rounded-xl border px-3 py-3 md:px-4 transition-all ${activeCls} ${
                                  darkMode ? 'border-gray-600/70 bg-gray-900/22' : 'border-gray-200 bg-white'
                                }`}
                              >
                                <div
                                  className={`mb-3 flex flex-wrap items-baseline gap-2 text-xs font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
                                >
                                  {language === 'en' ? `Size class ${idx + 1}` : `第 ${idx + 1} 粒径档`}
                                  {idx === sar ? (
                                    <span className={`text-[10px] font-normal ${darkMode ? 'text-blue-300/90' : 'text-blue-700'}`}>
                                      {language === 'en'
                                        ? '(current row for steps 1–5 above)'
                                        : '（与上方步骤 1～5 当前档一致）'}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                  <div className="min-w-0 space-y-2">
                                    <label className={lblCls}>
                                      {language === 'en'
                                        ? renderDescriptionWithMath('$d_i$ (m): diameter; editable')
                                        : renderDescriptionWithMath('$d_i$（m）；与级配/斯托克斯代表性粒径相关，可修改')}
                                    </label>
                                    <div className={rowShell}>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={rowInp}
                                        value={r.d}
                                        onChange={(e) => patchPseudoFlowRowField(idx, { d: e.target.value })}
                                        placeholder={language === 'en' ? 'e.g. 2e-4' : '如 2e-4'}
                                      />
                                      <span className={pill}>m</span>
                                    </div>
                                  </div>
                                  <div className="min-w-0 space-y-2">
                                    <label className={lblCls}>
                                      {language === 'en'
                                        ? renderDescriptionWithMath('$\\Delta P_i$: mass fraction weight; editable')
                                        : renderDescriptionWithMath(
                                            '$\\Delta P_i$：级配质量分数权重（小数）；可修改，程序汇总时会归一化'
                                          )}
                                    </label>
                                    <div className={rowShell}>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={rowInp}
                                        value={r.delta_P}
                                        onChange={(e) => patchPseudoFlowRowField(idx, { delta_P: e.target.value })}
                                        placeholder={language === 'en' ? 'e.g. 1' : '如 1'}
                                      />
                                      <span className={pill}>{language === 'en' ? 'fraction' : '小数'}</span>
                                    </div>
                                  </div>
                                  <div className="min-w-0 space-y-2">
                                    <label className={lblCls}>
                                      {language === 'en'
                                        ? <>Wi (m/s): weighted settling velocity; editable</>
                                        : <>Wi：似均质中加权平均沉速（m/s）；可修改（改后请重算步骤「5」）</>}
                                    </label>
                                    <div className={rowShell}>
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        autoComplete="off"
                                        spellCheck={false}
                                        className={rowInp}
                                        value={r.omega ?? ''}
                                        onChange={(e) => patchPseudoFlowRowField(idx, { omega: e.target.value })}
                                        placeholder={language === 'en' ? 'Required' : '须填写'}
                                      />
                                      <span className={pill}>m/s</span>
                                    </div>
                                  </div>
                                  <div className="min-w-0 space-y-2">
                                    <label className={lblCls}>
                                      {language === 'en'
                                        ? renderDescriptionWithMath(
                                            '$(C/C_A)_i$: from step 5 (recalc after changing $W_i$ or $U$)'
                                          )
                                        : renderDescriptionWithMath(
                                            '$(C/C_A)_i$：取步骤「5」计算结果（改 $W_i$、$U$ 等后请重算步骤「5」）'
                                          )}
                                    </label>
                                    <div
                                      className={`flex min-h-[2.75rem] items-center gap-3 rounded-xl border px-3 ${
                                        darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-200 bg-gray-50'
                                      }`}
                                    >
                                      <span
                                        className={`min-w-0 flex-1 py-2.5 font-mono text-base font-semibold ${
                                          darkMode ? 'text-gray-200' : 'text-gray-900'
                                        }`}
                                      >
                                        {cci != null && Number.isFinite(cci) ? fmtDissipation(cci) : '—'}
                                      </span>
                                      <span className={pill}>{language === 'en' ? 'nondim.' : '无量纲'}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {language === 'en' ? (
                          <span>
                            Use the bottom-right <strong>Calculate</strong> button for this step (same as the main form).
                          </span>
                        ) : (
                          <>流态判别请使用页面右下角「开始计算」，无需在本框内单独点按钮。</>
                        )}
                      </p>
                    </div>
                  </>
                )
              })()}

              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-3 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>计算结果</div>
                {(() => {
                  const pseudoSumm = formulaResults['pseudo_homogeneous_summarize_ratios']
                  const effResult =
                    result?.success && result.result
                      ? result.result
                      : pseudoSumm?.success && pseudoSumm.result
                        ? pseudoSumm.result
                        : undefined
                  const rgEff = inferredSlurryPipelineFlowRegime(effResult)
                  const isFullIterationPseudo =
                    result?.success &&
                    result.result &&
                    result.result.C1v != null &&
                    !Number.isNaN(Number(result.result.C1v))
                  return (
                    <div className="space-y-4">
                      {pseudoSumm?.success === false ? (
                        <div
                          className={`rounded-lg border px-3 py-3 text-sm ${
                            darkMode ? 'border-amber-500/50 bg-amber-950/30 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-900'
                          }`}
                        >
                          分步汇总：{pseudoSumm?.error || '汇总失败'}
                        </div>
                      ) : null}

                      {result?.error ? (
                        <div
                          className={`rounded-lg border px-3 py-3 text-sm ${
                            darkMode ? 'border-red-500/50 bg-red-950/40 text-red-200' : 'border-red-200 bg-red-50 text-red-800'
                          }`}
                        >
                          {result.error}
                        </div>
                      ) : null}

                      {pseudoSumm?.success && pseudoSumm.result && !result?.success ? (
                        <div className="space-y-3 pb-4 border-b border-dashed border-gray-500/40">
                          <div className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            分步汇总（各档链路）
                          </div>
                          {renderPrimaryResultCallout({
                            titleRow: <>分步链路流态归类</>,
                            unitZh:
                              language === 'en'
                                ? 'From summed C/C_A and interpolated (C/C_A) at d₉₅'
                                : '由本分步汇总得到的 $C/C_A$ 与 $(C/C_A)_{d95}$',
                            value: (
                              <span className={`text-xl font-bold ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>
                                {language === 'en'
                                  ? rgEff === 'pseudo_homogeneous'
                                    ? 'Pseudo-homogeneous'
                                    : rgEff === 'heterogeneous'
                                      ? 'Heterogeneous'
                                      : rgEff === 'composite'
                                        ? 'Composite'
                                        : '—'
                                  : rgEff === 'pseudo_homogeneous'
                                    ? '似均质流态'
                                    : rgEff === 'heterogeneous'
                                      ? '非均质流态'
                                      : rgEff === 'composite'
                                        ? '复合流态'
                                        : '—'}
                              </span>
                            ),
                          })}
                          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            <div className={`rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-500' : 'border-gray-200'}`}>
                              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                <InlineMath math="C/C_A" />
                              </div>
                              <div className="font-mono font-semibold">
                                {pseudoSumm.result.C_over_CA != null
                                  ? fmtDissipation(Number(pseudoSumm.result.C_over_CA))
                                  : '—'}
                              </div>
                            </div>
                            <div className={`rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-500' : 'border-gray-200'}`}>
                              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                <InlineMath math="(C/C_A)_{d95}" />（插值）
                              </div>
                              <div className="font-mono font-semibold">
                                {pseudoSumm.result.C_CA_d95 != null
                                  ? fmtDissipation(Number(pseudoSumm.result.C_CA_d95))
                                  : '—'}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {result?.success && result.result && isFullIterationPseudo ? (
                        <div className="space-y-4">
                          <div className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            {language === 'en' ? 'One-shot iteration' : '迭代一键计算'}
                          </div>
                          {(() => {
                            const rg = inferredSlurryPipelineFlowRegime(result.result)
                            const conclusionZh =
                              rg === 'pseudo_homogeneous'
                                ? '似均质流态'
                                : rg === 'heterogeneous'
                                  ? '非均质流态'
                                  : rg === 'composite'
                                    ? '复合流态'
                                    : '—'
                            const conclusionEn =
                              rg === 'pseudo_homogeneous'
                                ? 'Pseudo-homogeneous regime'
                                : rg === 'heterogeneous'
                                  ? 'Heterogeneous regime'
                                  : rg === 'composite'
                                    ? 'Composite regime'
                                    : '—'
                            return renderPrimaryResultCallout({
                              titleRow: <>{language === 'en' ? 'Regime from C/C_A' : '流态判定结论（迭代）'}</>,
                              unitZh:
                                language === 'en'
                                  ? 'Based on computed C/C_A and (C/C_A) at d₉₅'
                                  : '由迭代得到的 $C/C_A$ 与 $(C/C_A)_{d95}$ 归类',
                              value: (
                                <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                                  {language === 'en' ? conclusionEn : conclusionZh}
                                </span>
                              ),
                            })
                          })()}
                          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            <div className={`rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-500' : 'border-gray-200'}`}>
                              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                <InlineMath math="C/C_A" />
                              </div>
                              <div className="font-mono font-semibold">
                                {result.result.C_over_CA != null ? fmtDissipation(Number(result.result.C_over_CA)) : '—'}
                              </div>
                            </div>
                            <div className={`rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-500' : 'border-gray-200'}`}>
                              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                <InlineMath math="(C/C_A)_{d95}" />（插值）
                              </div>
                              <div className="font-mono font-semibold">
                                {result.result.C_CA_d95 != null ? fmtDissipation(Number(result.result.C_CA_d95)) : '—'}
                              </div>
                            </div>
                            <div className={`rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-500' : 'border-gray-200'}`}>
                              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                <InlineMath math="C_{1V}" />
                              </div>
                              <div className="font-mono font-semibold">
                                {result.result.C1v != null ? fmtDissipation(Number(result.result.C1v)) : '—'}
                              </div>
                            </div>
                            <div className={`rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-500' : 'border-gray-200'}`}>
                              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                <InlineMath math="\rho_l" />
                                <span> · kg/m³</span>
                              </div>
                              <div className="font-mono font-semibold">
                                {result.result.rho_l != null ? fmtDissipation(Number(result.result.rho_l)) : '—'}
                              </div>
                            </div>
                          </div>
                          <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            <div className="mb-1">
                              总体 <InlineMath math="\mathrm{Re}_B" /> ={' '}
                              {result.result.Re_B != null ? fmtDissipation(Number(result.result.Re_B)) : '—'}；Fanning{' '}
                              <InlineMath math="f_L" /> ={' '}
                              {result.result.f_L != null ? fmtDissipation(Number(result.result.f_L)) : '—'}；摩阻流速{' '}
                              <InlineMath math="U" /> ={' '}
                              {result.result.friction_velocity_U != null
                                ? fmtDissipation(Number(result.result.friction_velocity_U))
                                : '—'}{' '}
                              m/s
                            </div>
                          </div>
                          {(() => {
                            const im = result.result.intermediate as Record<string, unknown> | undefined
                            const rowsTbl = im?.rows_final
                            if (!Array.isArray(rowsTbl) || rowsTbl.length === 0) return null
                            return (
                              <div className="overflow-x-auto">
                                <div className={`text-xs mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                  内置粒径档收敛后中间量明细
                                </div>
                                <table className={`min-w-[720px] text-xs border-collapse ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                                  <thead>
                                    <tr className={darkMode ? 'border-b border-gray-500' : 'border-b border-gray-300'}>
                                      {['i', 'd', 'ΔP', 'ω', 'Cv,i', 'C1V,i', 'ρl,i', 'Re', 'fL', 'U', 'C/CA,i'].map((h) => (
                                        <th key={h} className="py-2 pr-2 text-left font-semibold whitespace-nowrap">
                                          {h}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(rowsTbl as Record<string, unknown>[]).map((r, idx) => (
                                      <tr key={idx} className={darkMode ? 'border-b border-gray-600/80' : 'border-b border-gray-100'}>
                                        <td className="py-1.5 pr-2">{String(r.index ?? idx + 1)}</td>
                                        <td className="py-1.5 pr-2 font-mono">{fmtDissipation(Number(r.d_m))}</td>
                                        <td className="py-1.5 pr-2 font-mono">{fmtDissipation(Number(r.delta_P))}</td>
                                        <td className="py-1.5 pr-2 font-mono">{fmtDissipation(Number(r.omega_m_s))}</td>
                                        <td className="py-1.5 pr-2 font-mono">{fmtDissipation(Number(r.Cv_i))}</td>
                                        <td className="py-1.5 pr-2 font-mono">{fmtDissipation(Number(r.C1V_i))}</td>
                                        <td className="py-1.5 pr-2 font-mono">{fmtDissipation(Number(r.rho_li_kg_m3))}</td>
                                        <td className="py-1.5 pr-2 font-mono">{fmtDissipation(Number(r.Re_B_i))}</td>
                                        <td className="py-1.5 pr-2 font-mono">{fmtDissipation(Number(r.f_L_i))}</td>
                                        <td className="py-1.5 pr-2 font-mono">{fmtDissipation(Number(r.U_m_s))}</td>
                                        <td className="py-1.5 pr-2 font-mono">{fmtDissipation(Number(r.C_over_CA_i))}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )
                          })()}
                        </div>
                      ) : null}

                      {result?.success && result.result && !isFullIterationPseudo ? (
                        <div className="space-y-3 pb-4 border-b border-dashed border-gray-500/40">
                          <div className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            {language === 'en' ? 'Weighted summary (after step 5)' : '加权汇总（步骤 5 各档结果）'}
                          </div>
                          {renderPrimaryResultCallout({
                            titleRow: <>{language === 'en' ? 'Regime judgment' : '流态判定结论'}</>,
                            unitZh:
                              language === 'en'
                                ? 'From Σ (C/C_A)ᵢ·ΔPᵢ and (C/C_A) at d₉₅'
                                : '由整体 $C/C_A$ 与 $(C/C_A)_{d95}$ 判别',
                            value: (
                              <span className={`text-xl font-bold ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>
                                {language === 'en'
                                  ? rgEff === 'pseudo_homogeneous'
                                    ? 'Pseudo-homogeneous'
                                    : rgEff === 'heterogeneous'
                                      ? 'Heterogeneous'
                                      : rgEff === 'composite'
                                        ? 'Composite'
                                        : '—'
                                  : rgEff === 'pseudo_homogeneous'
                                    ? '似均质流态'
                                    : rgEff === 'heterogeneous'
                                      ? '非均质流态'
                                      : rgEff === 'composite'
                                        ? '复合流态'
                                        : '—'}
                              </span>
                            ),
                          })}
                          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            <div className={`rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-500' : 'border-gray-200'}`}>
                              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                <InlineMath math="C/C_A" />
                              </div>
                              <div className="font-mono font-semibold">
                                {result.result.C_over_CA != null
                                  ? fmtDissipation(Number(result.result.C_over_CA))
                                  : '—'}
                              </div>
                            </div>
                            <div className={`rounded-lg border px-3 py-2 ${darkMode ? 'border-gray-500' : 'border-gray-200'}`}>
                              <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                <InlineMath math="(C/C_A)_{d95}" />（插值）
                              </div>
                              <div className="font-mono font-semibold">
                                {result.result.C_CA_d95 != null
                                  ? fmtDissipation(Number(result.result.C_CA_d95))
                                  : '—'}
                              </div>
                            </div>
                          </div>
                          {effResult &&
                          effResult.C_over_CA != null &&
                          effResult.C_CA_d95 != null &&
                          !Number.isNaN(Number(effResult.C_over_CA)) &&
                          !Number.isNaN(Number(effResult.C_CA_d95)) ? (
                            <div
                              className={`rounded-lg border px-3 py-2 text-sm leading-relaxed ${
                                darkMode ? 'border-gray-500 bg-gray-900/30 text-gray-200' : 'border-gray-200 bg-white text-gray-800'
                              }`}
                            >
                              <div className={`font-medium mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                                {language === 'en' ? 'Threshold check' : '判据核对（手册阈值）'}
                              </div>
                              {language === 'en' ? (
                                <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm">
                                  <li>
                                    <InlineMath math="C/C_A" /> = {fmtDissipation(Number(effResult.C_over_CA))}:{' '}
                                    {Number(effResult.C_over_CA) <= 0.1
                                      ? '≤ 0.1 (heterogeneous branch)'
                                      : Number(effResult.C_over_CA) >= 0.8
                                        ? '≥ 0.8 (pseudo-homogeneous needs d95 too)'
                                        : 'between 0.1 and 0.8 (often composite-related)'}
                                  </li>
                                  <li>
                                    <InlineMath math="(C/C_A)_{d95}" /> = {fmtDissipation(Number(effResult.C_CA_d95))}:{' '}
                                    {Number(effResult.C_CA_d95) >= 0.5
                                      ? '≥ 0.5 (satisfies pseudo-homogeneous 2nd criterion)'
                                      : '< 0.5 (does not satisfy that item)'}
                                  </li>
                                </ul>
                              ) : (
                                <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm">
                                  <li>
                                    整体{' '}
                                    <InlineMath math="C/C_A" /> = {fmtDissipation(Number(effResult.C_over_CA))}
                                    {Number(effResult.C_over_CA) <= 0.1
                                      ? '：满足非均质判据（$C/C_A \\le 0.1$）。'
                                      : Number(effResult.C_over_CA) >= 0.8
                                        ? '：达到似均质对整体浓度的量级要求（≥ 0.8），是否定类还需结合 $(C/C_A)_{d95}$。'
                                        : '：介于 0.1 与 0.8 之间（常与复合流态相关）。'}
                                  </li>
                                  <li>
                                    <InlineMath math="(C/C_A)_{d95}" /> = {fmtDissipation(Number(effResult.C_CA_d95))}
                                    {Number(effResult.C_CA_d95) >= 0.5
                                      ? '：≥ 0.5，满足似均质流态判别的第二项（代表粗粒级相对浓度较高）。'
                                      : '：< 0.5，不满足上述第二项；若整体浓度已高，仍可能归为复合等综合情形。'}
                                  </li>
                                </ul>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {effResult ? (
                      <div
                        className={`rounded-xl border-2 p-4 ${darkMode ? 'border-gray-500 bg-gray-800/40' : 'border-gray-200 bg-gray-50/80'}`}
                      >
                        <div className={`text-base font-semibold mb-3 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                          三类流态说明与阈值（结果高亮对照）
                        </div>
                        <p className={`text-xs mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {renderDescriptionWithMath(
                            '下列条文与手册判据对应；外框加亮表示当前计算所归入的流态。'
                          )}
                        </p>
                        <div className="space-y-3">
                          <div
                            className={`rounded-lg border-2 px-4 py-3 text-sm leading-relaxed transition-shadow ${
                              rgEff === 'pseudo_homogeneous'
                                ? darkMode
                                  ? 'ring-2 ring-amber-400/90 border-amber-500/70 bg-amber-950/20'
                                  : 'ring-2 ring-blue-500 border-blue-400 bg-blue-50/60'
                                : darkMode
                                  ? 'border-gray-500'
                                  : 'border-gray-200'
                            } ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}
                          >
                            <div className={`font-semibold mb-1 ${darkMode ? 'text-amber-200' : 'text-blue-800'}`}>
                              第一：似均质流态
                            </div>
                            <p>
                              {renderDescriptionWithMath(
                                '第一是 $R=C/C_A \\ge 0.8$ 且 $R_{d95}=(C/C_A)_{d95} \\ge 0.5$，此时称似均质流态，该流态中粒径为细颗粒，此时浆体接近均质流态，为区别单相均质流态称为似均质流态。该流态细颗粒等于或大于 $0.8$ 以上为载体。浆体长输管道输送应采用该流态。'
                              )}
                            </p>
                          </div>
                          <div
                            className={`rounded-lg border-2 px-4 py-3 text-sm leading-relaxed transition-shadow ${
                              rgEff === 'heterogeneous'
                                ? darkMode
                                  ? 'ring-2 ring-amber-400/90 border-amber-500/70 bg-amber-950/20'
                                  : 'ring-2 ring-blue-500 border-blue-400 bg-blue-50/60'
                                : darkMode
                                  ? 'border-gray-500'
                                  : 'border-gray-200'
                            } ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}
                          >
                            <div className={`font-semibold mb-1 ${darkMode ? 'text-amber-200' : 'text-blue-800'}`}>
                              第二：非均质流态
                            </div>
                            <p>
                              {renderDescriptionWithMath(
                                '第二是 $R=C/C_A \\le 0.1$，此时称非均质流态，该流态中粒径为粗颗粒，载体为水。浆体管道输送比较少见。'
                              )}
                            </p>
                          </div>
                          <div
                            className={`rounded-lg border-2 px-4 py-3 text-sm leading-relaxed transition-shadow ${
                              rgEff === 'composite'
                                ? darkMode
                                  ? 'ring-2 ring-amber-400/90 border-amber-500/70 bg-amber-950/20'
                                  : 'ring-2 ring-blue-500 border-blue-400 bg-blue-50/60'
                                : darkMode
                                  ? 'border-gray-500'
                                  : 'border-gray-200'
                            } ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}
                          >
                            <div className={`font-semibold mb-1 ${darkMode ? 'text-amber-200' : 'text-blue-800'}`}>
                              第三：复合流态
                            </div>
                            <p>
                              {language === 'en' ? (
                                <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>
                                  Third:{' '}
                                  <InlineMath math="0.1<R<0.8" /> and <InlineMath math="R_{d95}>0.5" /> (with{' '}
                                  <InlineMath math="R=C/C_A" />
                                  ). Other combinations that fall outside the first two branches are also labeled composite in this module (e.g.{' '}
                                  <InlineMath math="R\ge 0.8" /> with <InlineMath math="R_{d95}\le 0.5" />
                                  ). Typical tailings pipelines often operate in the composite regime.
                                </span>
                              ) : (
                                renderDescriptionWithMath(
                                  '第三是 $0.1 < R < 0.8$ 且 $R_{d95} > 0.5$（$R=C/C_A$，$R_{d95}=(C/C_A)_{d95}$）。不属于前两类的其余情形在本模块中亦归为复合流态（例如 $R \\ge 0.8$ 且 $R_{d95} \\le 0.5$，或 $0.1 < R < 0.8$ 且 $R_{d95} \\le 0.5$ 等）。此时浆体管道中细颗粒似均质部分输送粗颗粒非均质部分的组合流态称复合流态，多数尾矿浆体管道为复合流态。'
                                )
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                      ) : null}

                      {!effResult && !result?.error && !pseudoSumm?.error ? (
                        <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {renderDescriptionWithMath(
                            '请先完成各档步骤 5（相对体积浓度），再点击页面右下角「开始计算」：程序将按级配权重 $\\Delta P_i$ 对各档 $(C/C_A)_i$ 加权得到整体 $C/C_A$，并插值得 $(C/C_A)_{d95}$ 后判别流态。'
                          )}
                        </p>
                      ) : null}
                    </div>
                  )
                })()}
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
                          <InputWithTrailingUnit
                            darkMode={darkMode}
                            value={
                              rawInputs['C_h'] ??
                              (parameters['C_h'] != null && !isNaN(parameters['C_h']!) ? String(parameters['C_h']) : '')
                            }
                            onChange={(e) => handleParameterChange('C_h', e.target.value)}
                            onBlur={() => handleParameterBlur('C_h')}
                            placeholder="海澄-威廉系数，如130"
                          />
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
                        <InputWithTrailingUnit
                          darkMode={darkMode}
                          value={
                            rawInputs[name] ??
                            (parameters[name] != null && !isNaN(parameters[name]!) ? String(parameters[name]) : '')
                          }
                          onChange={(e) => handleParameterChange(name, e.target.value)}
                          onBlur={() => handleParameterBlur(name)}
                          placeholder={ph}
                          unit={suffixText}
                        />
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
                      <BlockMath math="P_k = \dfrac{\rho_k g H}{1000}+\dfrac{\rho_s g\, i_k\, L}{1000}+P_j+P_n+P_z" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {formula.parameters.map((param) => {
                        const placeholders: Record<string, string> = {
                          rho_k: '浆体密度，如1470',
                          g: '重力加速度，默认值 9.81',
                          H: '几何扬程，如120',
                          rho_s: '液体密度 ρ_s（i_k 参照介质，常温清水多用 1000）',
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
                    unitZh: '',
                    omitUnitRow: true,
                    bordered: true,
                    value: result?.success ? (
                      <div className="space-y-2">
                        <span className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                          {result.result?.H_total ?? '—'}
                        </span>
                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {language === 'en' ? 'kPa' : 'kPa（千帕）'}
                        </div>
                        {result.result?.H_total != null &&
                          parameters['rho_k'] != null &&
                          !isNaN(Number(parameters['rho_k'])) &&
                          !isNaN(Number(result.result.H_total)) && (
                            <span className={`block text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              {language === 'en' ? (
                                <>
                                  Equivalent slurry head (<InlineMath math="1000\,P_k/(\rho_k g)" />,{' '}
                                  <InlineMath math="\rho_k" /> = {Number(parameters['rho_k'])} kg/m³): ≈{' '}
                                  <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                                    {kPaToFluidHeadM(
                                      Number(result.result.H_total),
                                      Number(parameters['rho_k']),
                                      Number(parameters['g'] ?? 9.81)
                                    )}{' '}
                                    m
                                  </span>
                                </>
                              ) : (
                                <>
                                  折合浆体液柱高度（<InlineMath math="1000\,P_k/(\rho_k g)" />，<InlineMath math="\rho_k" /> ={' '}
                                  {Number(parameters['rho_k'])} kg/m³）：约{' '}
                                  <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                                    {kPaToFluidHeadM(
                                      Number(result.result.H_total),
                                      Number(parameters['rho_k']),
                                      Number(parameters['g'] ?? 9.81)
                                    )}{' '}
                                    m
                                  </span>
                                </>
                              )}
                            </span>
                          )}
                        {result.result?.H_total != null && !isNaN(Number(result.result.H_total)) && (
                          <span className={`block text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {language === 'en' ? (
                              <>
                                Equivalent freshwater head (<InlineMath math="1000\,P_k/(\rho_w g)" />,{' '}
                                <InlineMath math="\rho_w=1000\ \mathrm{kg/m^3}" />): ≈{' '}
                                <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                                  {kPaToFluidHeadM(
                                    Number(result.result.H_total),
                                    SLURRY_CHART_CLEAR_WATER_RHO,
                                    Number(parameters['g'] ?? 9.81)
                                  )}{' '}
                                  m
                                </span>
                              </>
                            ) : (
                              <>
                                折合清水液柱高度（<InlineMath math="1000\,P_k/(\rho_w g)" />，<InlineMath math="\rho_w=1000\ \mathrm{kg/m^3}" />
                                ）：约{' '}
                                <span className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                                  {kPaToFluidHeadM(
                                    Number(result.result.H_total),
                                    SLURRY_CHART_CLEAR_WATER_RHO,
                                    Number(parameters['g'] ?? 9.81)
                                  )}{' '}
                                  m
                                </span>
                              </>
                            )}
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
                      return renderIntermediateResultsBlock(
                        [
                          ['gravity_pressure', `${String(im.gravity_pressure ?? '—')} kPa`],
                          ['friction_pressure', `${String(im.friction_pressure ?? '—')} kPa`],
                        ],
                        'slurry_total_head',
                        'white'
                      )
                    })()}

                  {result?.success && (
                    <SlurryClearHydraulicGradeChartBlock
                      darkMode={darkMode}
                      Lmax={Number(parameters['L'])}
                      slurryParams={parameters}
                      language={language}
                    />
                  )}
                </>
              ) : (
                /* 清水总扬程：独立算法，rho_k=rho_s=rho_w */
                <>
                  <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                    <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>清水管道输送压力</div>
                    <div className={`mb-4 overflow-x-auto ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      <BlockMath math="P_w = \dfrac{\rho_w\, g\, (H+i_w\, L)}{1000}+P_j+P_n+P_z" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {formula.parameters.map((param) => {
                        const placeholders: Record<string, string> = {
                          rho_w: '液体密度，如1000',
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
                    unitZh: 'kPa（千帕）',
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
                              折合清水液柱高度（<InlineMath math="1000\,P_w/(\rho_w g)" />，<InlineMath math="\rho_w" /> ={' '}
                              {Number(parameters['rho_w'])} kg/m³）：约{' '}
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
                      return renderIntermediateResultsBlock(
                        [
                          ['gravity_pressure', `${String(im.gravity_pressure ?? '—')} kPa`],
                          ['friction_pressure', `${String(im.friction_pressure ?? '—')} kPa`],
                        ],
                        'clear_water_total_head',
                        'white'
                      )
                    })()}

                  {result?.success && (
                    <HydraulicDerivativeResultsSection darkMode={darkMode} parameters={parameters} />
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
                  功率式中液柱项为步骤2 的 <InlineMath math="H_b" />（m）；与 <InlineMath math="\rho_k" />（kg/m³）、<InlineMath math="g" />、{' '}
                  <InlineMath math="Q_k" />、<InlineMath math="K_1" />、<InlineMath math="\eta_j" />、<InlineMath math="\eta_b" /> 共同求{' '}
                  <InlineMath math="N" />（kW）。式中 <InlineMath math="\rho_k" /> 与 <InlineMath math="g" />、<InlineMath math="Q_k" />、<InlineMath math="H_b" /> 均取 SI 相容单位。
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
                        ? renderDescriptionWithMath('自定义')
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
                                    <span>kg/m³</span>
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
                                {renderDescriptionWithMath(' $\\eta自定义')}
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
                    'rho_k_input_kg_m3',
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
          ) : formula?.id === 'density_mixing' ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath('本节由浆体质量浓度与液、固相密度确定浆体密度 $\\rho_k$，作为沿程水力坡降计算的前置量。求得的 $\\rho_k$ 可输入同栏「浆体摩阻损失」分步流程或合并公式，用于后续核算。')}
              </p>
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>计算浆体密度</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('依据浆体质量浓度 $C_w$ 及固体密度 $\\rho_g$、液体密度 $\\rho_s$，按质量加权关系计算浆体密度 $\\rho_k$（kg/m³）。')}
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
                unitZh: 'kg/m³',
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
                      rho_k: '浆体密度，如1470',
                      lambda_coef: '达西摩阻系数，如0.018',
                      V: '断面平均流速，如2',
                      D: '管道内径，如0.2',
                      rho_s: '水密度，常用1000',
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

              {/* 1. 计算浆体体积流量：公式 → 本步参数 → 计算 → 结果 */}
              <div className={`rounded-xl border-2 p-5 mb-5 ${darkMode ? 'bg-gray-600 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>1. 计算浆体体积流量</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath(
                    '步骤1 须完整填写四项：$W$（kg/h）、$C_W$（重量浓度，如 $0.42$）、$\\rho_g$、$\\rho_s$（液相密度；清水常用 $1000\\ \\mathrm{kg/m^3}$，仍须在本栏填写）。式中变量单位与 SI 相容，求得浆体体积流量 $Q_K$（$\\mathrm{m^3/h}$），供步骤2、3 使用。'
                  )}
                </p>
                <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math={'Q_K = W \\left( \\frac{1}{\\rho_g} + \\frac{1-C_W}{C_W\\,\\rho_s} \\right)'} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {formula.parameters.filter((p) => ['W', 'C_w', 'rho_g', 'rho_s'].includes(p.name)).map((param) => (
                    <div key={param.name}>
                      <label className={`block text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {renderDescriptionWithMath(
                          param.name === 'W'
                            ? 'W：干固体质量流量，单位为 kg/h'
                            : param.name === 'C_w'
                              ? '$C_W$：浆体重量浓度（固相质量分数），0～1 小数且不取端点'
                              : param.name === 'rho_g'
                                ? '$\\rho_g$：固体密度，单位为 kg/m³'
                                : '$\\rho_s$：液相密度，单位为 kg/m³（清水常用 1000，须填写）'
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
                          placeholder={
                            param.name === 'C_w'
                              ? '重量浓度，如 0.42'
                              : param.name === 'rho_s'
                                ? '液相密度，清水如 1000'
                                : commonParamPlaceholder(formula?.parameters, param.name)
                          }
                        />
                        {param.name === 'rho_g' || param.name === 'rho_s' ? (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>kg/m³</span>
                        ) : param.name === 'W' ? (
                          <span className={`text-sm shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>kg/h</span>
                        ) : null}
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
                  nameZh: '浆体体积流量',
                  symbolMath: 'Q_K',
                  unitZh: 'm³/h（立方米每小时）',
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
                  {renderDescriptionWithMath('需先完成步骤1得到浆体体积流量 $Q_K$（$\\mathrm{m^3/h}$）。输入尾矿加权平均粒径 $d_p$（mm）和固体物料相对密度修正系数 $\\beta$，根据 $d_p$ 取值范围自动选用对应公式，由 $Q_K$ 反解得到临界管径 $D_L$（mm）。')}
                </p>
                {(() => {
                  const dpRaw = parameters['dp'] ?? rawInputs['dp']
                  const dpNum = typeof dpRaw === 'number' && !isNaN(dpRaw) ? dpRaw : (typeof dpRaw === 'string' ? parseFloat(dpRaw) : NaN)
                  if (dpNum <= 0.07 && !isNaN(dpNum)) {
                    return (
                      <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{renderDescriptionWithMath('当 $d_p\\le0.07$ mm 时使用：')}</span>
                        <BlockMath math="Q_K = 0.157\beta \cdot D_L \cdot (1 + 3.434 \cdot \sqrt[4]{C_d \cdot D_L^{0.15}})" />
                        <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{renderDescriptionWithMath('由 $Q_K$ 反解 $D_L$（$C_d=\\dfrac{C_W}{1-C_W}\\times100$ 由步骤1自动得到）')}</div>
                      </div>
                    )
                  }
                  if (dpNum > 0.07 && dpNum <= 0.15) {
                    return (
                      <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{renderDescriptionWithMath('当 $0.07<d_p\\le0.15$ mm 时使用：')}</span>
                        <BlockMath math="Q_K = 0.2\beta \cdot D_L \cdot (1 + 2.48 \cdot \sqrt[3]{C_d \cdot \sqrt[4]{D_L}})" />
                        <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{renderDescriptionWithMath('由 $Q_K$ 反解 $D_L$（$C_d=\\dfrac{C_W}{1-C_W}\\times100$ 由步骤1自动得到）')}</div>
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
                  {renderDescriptionWithMath('需先完成步骤1、2。由步骤1得到的 $C_d$（$=\\dfrac{C_W}{1-C_W}\\times100$）、步骤2得到的 $D_L$（临界管径 mm）及 $\\beta$，计算临界流速 $V_L$（m/s）。')}
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
                      {renderDescriptionWithMath('$W$：干固体质量流量，单位为 kg/h')}
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
                        placeholder="干固体质量流量 kg/h，如 42000"
                      />
                      <span className="text-sm shrink-0 text-gray-500">kg/h</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700">
                      {renderDescriptionWithMath('$C_W$：浆体重量浓度（与步骤1一致）')}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={rawInputs['C_w'] ?? (parameters['C_w'] != null && !isNaN(parameters['C_w']!) ? String(parameters['C_w']) : '')}
                        onChange={(e) => handleParameterChange('C_w', e.target.value)}
                        onBlur={() => handleParameterBlur('C_w')}
                        className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white border-gray-300 text-gray-900"
                        placeholder="如 0.42"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700">
                      {renderDescriptionWithMath('$\\rho_s$：液相密度（与步骤1一致），单位为 kg/m³')}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={rawInputs['rho_s'] ?? (parameters['rho_s'] != null && !isNaN(parameters['rho_s']!) ? String(parameters['rho_s']) : '')}
                        onChange={(e) => handleParameterChange('rho_s', e.target.value)}
                        onBlur={() => handleParameterBlur('rho_s')}
                        className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white border-gray-300 text-gray-900"
                        placeholder="清水如1000"
                      />
                      <span className="text-sm shrink-0 text-gray-500">kg/m³</span>
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
                          ? `${value} m³/h`
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
              <FormulaFrame darkMode={darkMode}>
                {isSlurryAccelFormula ? (
                  <BlockMath math="\left(Z_1 + \frac{P_1}{\rho_k g}\right) - \left(Z_2 + \frac{P_2}{\rho_k g}\right) > iL" />
                ) : (
                  <BlockMath math={convertFormulaToLatex(formula.formula)} />
                )}
              </FormulaFrame>
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
          {formula?.id !== 'kronodze_pressure' && formula?.id !== 'slurry_friction_loss' && formula?.id !== 'density_mixing' && formula?.id !== 'slurry_friction_workflow' && !isSlurryDissipationFormula && !isClearWaterFrictionLoss && !isTotalHeadFormula && !isPositiveDisplacementPumpFormula && !isCentrifugalPumpTotalHead && !isSlurryDissipationOrifice && !isPseudoHomogeneousFlowJudgment && (
          <div className="mt-4">
            <ParameterFrame darkMode={darkMode} title="参数输入">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(formula.id === 'fei_xiangjun'
                ? formula.parameters.filter(
                    (p) => !['eta_1', 'epsilon', 'fei_iterate_lambda'].includes(p.name)
                  )
                : formula.parameters
              ).map((param) => {
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
                    return formula?.id === 'liu_dezhong'
                      ? '点击输入框展开「体积浓度——辅助计算」'
                      : cvParameterPlaceholder()
                  }
                  if (formula?.id === 'liu_dezhong' && param.name === 'omega') {
                    return param.default !== undefined
                      ? `${param.default}（展开似均质 ω 辅助）`
                      : '点击展开「似均质中加权平均沉速」辅助'
                  }
                  if (formula?.id === 'liu_dezhong' && param.name === 'omega_s') {
                    return param.default !== undefined
                      ? `${param.default}（展开水中 ω_s 斯托克斯辅助）`
                      : '点击展开「水中加权平均沉速（斯托克斯）」辅助'
                  }
                  if (formula?.id === 'fei_xiangjun' && param.name === 'lambda_coef') {
                    return language === 'en'
                      ? 'Click the input to expand the「Darcy λ assist」'
                      : '点击输入框展开「达西摩阻系数——辅助计算」'
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
                        unitText={
                          shouldShowParameterUnitSuffix(param.unit) ? String(param.unit) : null
                        }
                        onApplyCvFromRatio={(s) => handleParameterChange('Cv', s)}
                        assistKind={formula?.id === 'liu_dezhong' ? 'slurry_mass_fraction' : 'solid_volume_ratio'}
                        rhoGKgM3FromForm={
                          formula?.id === 'liu_dezhong' && parameters.rho_g != null && !isNaN(parameters.rho_g)
                            ? parameters.rho_g
                            : undefined
                        }
                      />
                    ) : formula?.id === 'liu_dezhong' && param.name === 'omega' ? (
                      <LiuDezhongOmegaBinghamField
                        darkMode={darkMode}
                        inputValue={displayValue}
                        onInputChange={(v) => handleParameterChange('omega', v)}
                        onInputBlur={() => handleParameterBlur('omega')}
                        placeholder={ph}
                        unitText={
                          shouldShowParameterUnitSuffix(param.unit) ? String(param.unit) : null
                        }
                        parameters={parameters}
                        onApplyOmega={(s, meta) => {
                          liuOmegaManualRef.current = false
                          if (meta?.eta != null && Number.isFinite(meta.eta)) liuBinghamEtaForAutoRef.current = meta.eta
                          const n = parseFloat(normalizeDecimalInput(String(s).trim()))
                          if (!Number.isFinite(n)) return
                          const rounded = roundLiuDezhongSlurryVelocity(n)
                          updateRawInputs((prev) => ({
                            ...prev,
                            omega: formatLiuSlurryVelocityRawInput(rounded),
                          }))
                          updateParameters((prev) => ({ ...prev, omega: rounded }))
                        }}
                        onDiComputed={(dIM) => {
                          if (!formula) return
                          setLiuOmegaDiMByFormula((prev) => ({
                            ...prev,
                            [formula.id]: dIM ?? null,
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
                        unitText={
                          shouldShowParameterUnitSuffix(param.unit) ? String(param.unit) : null
                        }
                        parameters={parameters}
                        diMFromBingham={liuOmegaDiM}
                        onApplyOmegaS={(s, meta) => {
                          liuOmegaSManualRef.current = false
                          if (meta?.dM != null && Number.isFinite(meta.dM) && meta.dM > 0) {
                            liuStokesDiMForAutoRef.current = meta.dM
                          }
                          const n = parseFloat(normalizeDecimalInput(String(s).trim()))
                          if (!Number.isFinite(n)) return
                          const rounded = roundLiuDezhongSlurryVelocity(n)
                          updateRawInputs((prev) => ({
                            ...prev,
                            omega_s: formatLiuSlurryVelocityRawInput(rounded),
                          }))
                          updateParameters((prev) => ({ ...prev, omega_s: rounded }))
                        }}
                      />
                    ) : formula?.id === 'fei_xiangjun' && param.name === 'lambda_coef' ? (
                      <FeiDarcyLambdaAssistField
                        darkMode={darkMode}
                        language={language}
                        inputValue={displayValue}
                        onInputChange={(v) => handleParameterChange('lambda_coef', v)}
                        onInputBlur={() => handleParameterBlur('lambda_coef')}
                        placeholder={ph}
                        computeAssistPreview={computeFeiAssistPreviewNow}
                        unitText={
                          shouldShowParameterUnitSuffix(param.unit) ? String(param.unit) : null
                        }
                        feiLambdaAuxEta1={feiLambdaAuxEta1}
                        setFeiLambdaAuxEta1={setFeiLambdaAuxEta1}
                        feiLambdaAuxEpsilonPreset={feiLambdaAuxEpsilonPreset}
                        setFeiLambdaAuxEpsilonPreset={setFeiLambdaAuxEpsilonPreset}
                        feiLambdaAuxEpsilonCustom={feiLambdaAuxEpsilonCustom}
                        setFeiLambdaAuxEpsilonCustom={setFeiLambdaAuxEpsilonCustom}
                        onApplyLambda={(p) => {
                          if (p.lambda != null) writeFeiLambdaCoefFromPreview({ lambda: p.lambda })
                        }}
                        renderDescriptionWithMath={renderDescriptionWithMath}
                      />
                    ) : formula?.id === 'slurry_accel_energy' && param.name === 'L' ? (
                      <div className="relative">
                        <InputWithTrailingUnit
                          darkMode={darkMode}
                          value={displayValue}
                          onChange={(e) => handleParameterChange(param.name, e.target.value)}
                          onFocus={() => {
                            if (slurryAccelAutoL != null) setSlurryAccelLSuggestOpen(true)
                          }}
                          onBlur={() => {
                            handleParameterBlur(param.name)
                            window.setTimeout(() => setSlurryAccelLSuggestOpen(false), 200)
                          }}
                          placeholder={ph}
                          inputMode="decimal"
                          autoComplete="off"
                          spellCheck={false}
                          unit={
                            shouldShowParameterUnitSuffix(param.unit) ? param.unit ?? null : null
                          }
                        />
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
                      <InputWithTrailingUnit
                        darkMode={darkMode}
                        value={displayValue}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleParameterChange(param.name, e.target.value)}
                        onBlur={() => handleParameterBlur(param.name)}
                        placeholder={ph}
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        unit={
                          shouldShowParameterUnitSuffix(param.unit) ? param.unit ?? null : null
                        }
                      />
                    )}
                  </div>
                )
              })}
            </div>
            </ParameterFrame>
          </div>
          )}
        </div>

        {/* Results Section：克诺罗兹法完成步骤3后联动显示结果与动画；步骤未完成时不显示本区以免与步骤内结果重复 */}
        {(formula?.id !== 'kronodze_pressure' || kronodzeStep3Visible) &&
          formula?.id !== 'slurry_friction_loss' &&
          formula?.id !== 'density_mixing' &&
          formula?.id !== 'slurry_friction_workflow' &&
          formula?.id !== 'pseudo_homogeneous_flow_judgment' &&
          !isSlurryDissipationFormula &&
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
                    const statusText = criticalVelocityComparisonBadgeText(animationType, language)
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
                                  {language === 'en' ? 'Fullscreen' : '全屏展示'}
                                </button>
                              </div>
                              <div className="text-xs leading-relaxed break-words">
                                {language === 'en'
                                  ? 'Flow-regime animation from the critical velocity result.'
                                  : '根据临界流速计算结果展示当前流态动画。'}
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
                    {language === 'en' ? 'Locked critical velocity:' : '锁定的临界流速:'}{' '}
                    <span className={`font-semibold ${
                      darkMode ? 'text-blue-400' : 'text-blue-700'
                    }`}>
                      {lockedVc} m/s
                    </span>
                  </div>
                  {result?.success && result.result?.Vc !== undefined && (() => {
                    const newVc = result.result.Vc
                    // 与后端同一套分档公式；在前端推导可避免因旧后端 / 离线包比例方向搞反而显示反了
                    const nv = Number(newVc)
                    const lv = Number(lockedVc)
                    const velocityRatio = Number.isFinite(nv) && Number.isFinite(lv) && lv > 0 ? nv / lv : (result.velocity_ratio ?? NaN)
                    const animationType =
                      classifyLockedVcAnimation(nv, lv) ?? result.animation_type ?? 'still-flow'
                    
                    const statusText = criticalVelocityComparisonBadgeText(animationType, language)
                    
                    // 根据动画类型设置状态文本和颜色
                    let statusColor: string
                    let bgColor: string
                    let borderColor: string

                    if (animationType === 'settle-30') {
                      statusColor = darkMode ? 'text-red-300' : 'text-red-700'
                      bgColor = darkMode ? 'bg-red-900 bg-opacity-30' : 'bg-red-100'
                      borderColor = darkMode ? 'border-red-600' : 'border-red-300'
                    } else if (animationType === 'settle-20') {
                      statusColor = darkMode ? 'text-orange-300' : 'text-orange-700'
                      bgColor = darkMode ? 'bg-orange-900 bg-opacity-30' : 'bg-orange-100'
                      borderColor = darkMode ? 'border-orange-600' : 'border-orange-300'
                    } else if (animationType === 'settle-10-flow') {
                      statusColor = darkMode ? 'text-yellow-300' : 'text-yellow-700'
                      bgColor = darkMode ? 'bg-yellow-900 bg-opacity-30' : 'bg-yellow-100'
                      borderColor = darkMode ? 'border-yellow-600' : 'border-yellow-300'
                    } else if (animationType === 'still-flow') {
                      statusColor = darkMode ? 'text-blue-300' : 'text-blue-700'
                      bgColor = darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-100'
                      borderColor = darkMode ? 'border-blue-600' : 'border-blue-300'
                    } else if (animationType === 'medium-flow') {
                      statusColor = darkMode ? 'text-green-300' : 'text-green-700'
                      bgColor = darkMode ? 'bg-green-900 bg-opacity-30' : 'bg-green-100'
                      borderColor = darkMode ? 'border-green-600' : 'border-green-300'
                    } else {
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
                                {language === 'en' ? 'Fullscreen' : '全屏展示'}
                              </button>
                            </div>
                            <div className="space-y-1 text-xs leading-relaxed break-words">
                              <div>
                                {language === 'en' ? (
                                  <>
                                    Calculated critical velocity:{' '}
                                    <span className="font-semibold">{newVc} m/s</span>
                                  </>
                                ) : (
                                  <>
                                    当前计算的临界流速: <span className="font-semibold">{newVc} m/s</span>
                                  </>
                                )}
                              </div>
                              <div>
                                {language === 'en' ? (
                                  <>
                                    Locked critical velocity:{' '}
                                    <span className="font-semibold">{lockedVc} m/s</span>
                                  </>
                                ) : (
                                  <>
                                    锁定的临界流速: <span className="font-semibold">{lockedVc} m/s</span>
                                  </>
                                )}
                              </div>
                              <div className="mt-1.5 break-words">
                                {criticalVelocityLockedCompareExplanation(
                                  animationType,
                                  newVc,
                                  velocityRatio,
                                  language
                                )}
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
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>
                                    {criticalVelocityAnimStatusLabel('settle-30', language)}
                                  </span>
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
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>
                                    {criticalVelocityAnimStatusLabel('settle-20', language)}
                                  </span>
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
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>
                                    {criticalVelocityAnimStatusLabel('settle-10-flow', language)}
                                  </span>
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
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>
                                    {criticalVelocityAnimStatusLabel('still-flow', language)}
                                  </span>
                                </>
                              ) : animationType === 'medium-flow' ? (
                                <>
                                  <div className="w-full h-20 bg-green-50 rounded border-2 border-green-400 relative overflow-hidden">
                                    <div className="absolute inset-0">
                                      {/* 液体（正常流动） */}
                                      <div className="absolute inset-0 bg-gradient-to-r from-green-300 via-green-400 to-green-300"
                                           style={{
                                             animation: 'flow-horizontal 2s linear infinite',
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
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>
                                    {criticalVelocityAnimStatusLabel('medium-flow', language)}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <div className="w-full h-20 bg-green-50 rounded border-2 border-green-400 relative overflow-hidden">
                                    <div className="absolute inset-0">
                                      {/* 液体（快速流动） */}
                                      <div className="absolute inset-0 bg-gradient-to-r from-green-300 via-green-400 to-green-300"
                                           style={{
                                             animation: 'flow-horizontal 1.5s linear infinite',
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
                                  <span className={`text-xs font-medium ${statusColor} mt-0.5`}>
                                    {criticalVelocityAnimStatusLabel('fast-flow', language)}
                                  </span>
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
                formula?.id === 'fei_xiangjun'
                  ? sortFeiXiangjunIntermediateEntries(Object.entries(result.result.intermediate))
                  : Object.entries(result.result.intermediate),
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
      </div>
    </div>
  )
}
