import { useState, useEffect, useRef, type ReactNode } from 'react';
import type { FormulaInfo, CalculationResult } from '../types';
import axios from 'axios';
import { API_BASE_URL, API_TIMEOUT } from '../config/api';
// @ts-ignore - react-katex types
import { BlockMath, InlineMath } from 'react-katex';
import 'katex/dist/katex.min.css';

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
  const isSlurryDissipationFormula =
    formula?.id === 'slurry_dissipation' ||
    formula?.id === 'slurry_energy_dissipation' ||
    formula?.name === '浆体消能'
  const isSlurryEnergyPlaceholder = false
  
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  // 锁定临界流速功能
  const [autoCalculateRef, setAutoCalculateRef] = useState<boolean>(false) // 是否自动计算（锁定后参数改变时）
  const [selectedCase, setSelectedCase] = useState<number | null>(null) // 选中的案例分析
  const [selectedResearchCenter, setSelectedResearchCenter] = useState<string>('recycling') // 科研创新中心当前选中的子中心
  const [zoomPlatformImageUrl, setZoomPlatformImageUrl] = useState<string | null>(null) // 科研平台图片放大查看
  const [platformImageLoaded, setPlatformImageLoaded] = useState(false) // 当前中心展示图是否已加载完成
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

  // 了解我们-科研创新中心：预加载 info 图片，减少切换中心时的等待
  useEffect(() => {
    const urls = ['./info1.jpg', './info2.jpg', './info3.jpg', './info4.jpg', './info5.jpg']
    urls.forEach((src) => {
      const img = new Image()
      img.src = src
    })
  }, [])

  // 切换科研中心时重置图片加载状态，以便显示加载中
  useEffect(() => {
    if (aboutDepartment === 'research') setPlatformImageLoaded(false)
  }, [aboutDepartment, selectedResearchCenter])

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
  }, [formula])

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

  // 渲染"了解我们"页面
  const renderAboutPage = () => {

    const caseStudies = {
      research: [
        {
          title: '科研创新中心科技创新成效',
          description: '科技创新多点突破，赋能发展成效彰显。一是重大科技项目取得新突破。新签科研项目33项，涵盖欧盟“地平线欧洲”计划、马来西亚、安哥拉等国际科研合作项目，以及自然资源部部省合作项目、广西科技计划项目、湖南省科技成果转化示范项目、甘肃省创新联合攻关项目等。合同额2209万元，合同收费3204万元，科研项目数量和质量实现双提升。二是重大科技成果再上新台阶。获省部级科技进步特等奖1项、一等奖6项、二等奖5项、三等奖1项；获全国优秀工程勘察设计奖一等奖1项、二等奖2项、三等奖1项；“固废高值化生态化梯级集成利用技术”等4项成果入选国家和省级绿色先进适用技术目录，填补了近十年来国家级工程勘察设计一等奖空白；新增立项国家、行业和团体标准14部，创历年新高；获评长沙市“科技创新突出贡献企业”。三是闭环创新链贯通落地取得新成效。积极落实公司党委提出的“科研-设计-应用”闭环创新链项目实施，取得阶段性成果。新疆美盛矿业非爆机械连续采矿方法研究项目、贵州铝业大竹园铝土矿采矿方法研究项目、湖北大冶大红山铜矿废弃露天坑生态修复科研项目、西部鑫兴稀贵金属钼氧压技术创新项目等，实现了科研项目从设计和现场中来，研发成果通过设计转化到应用中去，高效服务公司主业，为公司主业发展赋能提速。四是科研管理提质增效开创新局面。高效完成2025年55项新立项科研项目开题和2026年42项新增科研项目立项；组织重点在研项目专项攻坚，解决14项政府重大科研课题进度和质量管理难题；完成18项科研项目验收，涵盖国家重点研发计划项目、广西重大科技专项、湖南省发改委两业融合专项、湖南省知识产权战略推进专项、中铝集团重大专项、中铝国际重点科研项目等。',
          highlights: ['重大科研项目：33项', '省部级及国家级奖励多项', '科研-设计-应用闭环贯通']
        },
        {
          title: '智能化管道监控系统',
          description: '结合物联网和大数据技术，开发了智能化管道监控系统，实现了管道运行的实时监测和智能管理。',
          highlights: ['监测精度：99%', '响应时间：实时', '应用案例：50+项目']
        },
        {
          title: '节能减排技术应用',
          description: '通过优化管道设计和运行参数，实现了显著的节能减排效果，为绿色环保做出了贡献。',
          highlights: ['节能效果：25%', '减排效果：30%', '经济效益：显著']
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

    // 特殊：科研创新中心页面，展示 5 个中心 + 平台展示图（可放大、可下载）
    if (aboutDepartment === 'research') {
      const researchCenters: Record<string, { name: string; image: string | null }> = {
        recycling: { name: '湖南省再生金属资源循环利用工程技术研究中心', image: './info1.jpg' },
        leadZinc: { name: '湖南省铅锌清洁冶炼工程技术研究中心', image: './info2.jpg' },
        deepMining: { name: '深井矿山安全高效开采技术湖南省工程研究中心', image: './info3.jpg' },
        safetyMonitor: { name: '湖南省矿山安全智能化监控技术与装备工程技术研究中心', image: './info4.jpg' },
        smartSmelting: { name: '湖南省有色冶金智能制造工程技术研究中心', image: './info5.jpg' },
      }

      const centerOrder = ['recycling', 'leadZinc', 'deepMining', 'safetyMonitor', 'smartSmelting']
      const currentKey = centerOrder.includes(selectedResearchCenter) ? selectedResearchCenter : centerOrder[0]
      const currentCenter = researchCenters[currentKey]

      return (
        <div ref={scrollContainerRef} className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
          <div
            className="max-w-[calc(100vw*4/5)] mx-auto p-6"
            style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}
          >
            {/* Header：保持软件名称与介绍在顶部 */}
            <div className="mb-5">
              <h1 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>长沙院浆体管道计算工具</h1>
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                基于行业标准公式计算浆体管道临界流速的专业工具
              </p>
            </div>

            {/* 科研创新中心：介绍 + 平台选择 */}
            <div className={`rounded-xl shadow-sm border p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <h2 className={`text-xl font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>科研创新中心</h2>
              <p className={`text-sm leading-relaxed mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                科研创新中心统筹公司科技创新与成果转化，依托再生金属、铅锌冶炼、深井开采、安全监控、智能制造等方向，建设并运行五个省级工程技术研究中心/工程研究中心，为行业提供关键技术支撑。
              </p>

              <h3 className={`text-sm font-semibold mb-3 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>中心与平台</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {centerOrder.map((key) => {
                  const center = researchCenters[key]
                  const active = key === currentKey
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedResearchCenter(key)}
                      className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                        active
                          ? darkMode
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-blue-600 border-blue-500 text-white'
                          : darkMode
                          ? 'bg-gray-800 border-gray-600 text-gray-200 hover:border-blue-400'
                          : 'bg-gray-50 border-gray-200 text-gray-800 hover:border-blue-400'
                      }`}
                    >
                      <div className="text-sm font-semibold leading-snug">{center.name}</div>
                      <div className={`text-xs mt-1 ${active ? 'text-white/80' : darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        点击查看详情
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 当前中心详情：仅标题 + 平台展示图（图片内已含简介与研究方向） */}
            <div
              className={`rounded-xl shadow-sm border p-6 mb-6 ${
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
              }`}
            >
              <h2 className={`text-xl font-semibold mb-4 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                {currentCenter.name}
              </h2>

              {/* 平台展示图：frame 随图片尺寸契合，可放大、可下载；预加载 + 加载状态减轻延迟感 */}
              {currentCenter.image ? (
                <div className={`inline-block rounded-lg border overflow-hidden max-w-full ${darkMode ? 'border-gray-600 bg-gray-800/40' : 'border-gray-300 bg-white'}`}>
                  <div className="relative min-h-[200px]">
                    {!platformImageLoaded && (
                      <div className={`absolute inset-0 flex items-center justify-center ${darkMode ? 'text-gray-400 bg-gray-800/60' : 'text-gray-500 bg-gray-100'}`}>
                        <span className="text-sm">加载中...</span>
                      </div>
                    )}
                    <img
                      src={currentCenter.image}
                      alt={currentCenter.name}
                      className={`block max-w-full h-auto cursor-pointer transition-opacity duration-200 ${platformImageLoaded ? 'opacity-100' : 'opacity-0'}`}
                      style={{ maxHeight: 'none' }}
                      onLoad={() => setPlatformImageLoaded(true)}
                      onError={() => setPlatformImageLoaded(true)}
                      onClick={() => setZoomPlatformImageUrl(currentCenter.image)}
                    />
                    <div className="absolute bottom-2 right-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setZoomPlatformImageUrl(currentCenter.image)}
                        className="px-3 py-1.5 rounded bg-black/60 text-white text-xs hover:bg-black/80"
                      >
                        放大
                      </button>
                      <a
                        href={currentCenter.image}
                        download={currentKey === 'recycling' ? '再生中心-info1.jpg' : currentKey === 'leadZinc' ? '铅锌中心-info2.jpg' : currentKey === 'deepMining' ? '深井矿山-info3.jpg' : currentKey === 'safetyMonitor' ? '安全监测-info4.jpg' : currentKey === 'smartSmelting' ? '有色冶金智能制造-info5.jpg' : '平台展示.jpg'}
                        className="px-3 py-1.5 rounded bg-black/60 text-white text-xs hover:bg-black/80 inline-block"
                      >
                        下载
                      </a>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`rounded-lg border-2 border-dashed p-8 text-center ${darkMode ? 'border-gray-600 bg-gray-800/40 text-gray-400' : 'border-gray-300 bg-gray-50 text-gray-500'}`}>
                  暂无图片，后续可补充本平台展示图
                </div>
              )}
            </div>

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
                  className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 text-white hover:bg-white/30 flex items-center justify-center text-xl"
                  onClick={() => setZoomPlatformImageUrl(null)}
                  aria-label="关闭"
                >
                  ×
                </button>
                <img
                  src={zoomPlatformImageUrl}
                  alt="放大查看"
                  className="max-w-full max-h-[90vh] w-auto h-auto object-contain cursor-pointer"
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
        <div ref={scrollContainerRef} className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
          <div className="max-w-[calc(100vw*4/5)] mx-auto p-6" style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}>
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
                基于行业标准公式计算浆体管道临界流速的专业工具
              </p>
            </div>

            {/* Frame - 公司介绍：左图右文，下方信息栏 */}
            <div className={`rounded-xl shadow-lg border-0 overflow-hidden ${
              darkMode ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-white'
            }`}>
              {/* 上区：图片左侧 + 文字右侧 */}
              <div className="flex flex-row gap-6 p-6 pb-4">
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
              <div className="px-8 pb-8 pt-2">
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

    // 市政事业部：与长沙院主页、科研中心一致的「顶栏 + 多块卡片」逻辑，文案概括公开资质与典型方向
    if (aboutDepartment === 'municipal') {
      return (
        <div ref={scrollContainerRef} className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
          <div className="max-w-[calc(100vw*4/5)] mx-auto p-6" style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}>
            <div className="mb-5">
              <h1 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                长沙院浆体管道计算工具
              </h1>
              <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                基于行业标准公式计算浆体管道临界流速的专业工具
              </p>
            </div>

            <div
              className={`rounded-xl shadow-sm border overflow-hidden mb-6 ${
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex flex-col sm:flex-row gap-6 p-6">
                <div className="flex-shrink-0 w-full sm:w-64">
                  <img
                    src="./pic1.png"
                    alt="长沙有色冶金设计研究院有限公司"
                    className="w-full h-44 sm:h-52 object-cover rounded-lg"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className={`text-xl font-bold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>市政事业部</h2>
                  <p className={`text-sm font-medium mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    长沙有色冶金设计研究院有限公司
                  </p>
                  <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    市政事业部隶属于长沙有色院，面向城镇与工业片区市政基础设施，开展给水排水、热力、载人索道等方向的工程咨询、设计与相关技术服务，与公司建筑、环境、勘察测绘等多专业协同，承担省内外市政类项目。
                  </p>
                </div>
              </div>
            </div>

            <div
              className={`rounded-xl shadow-sm border p-6 mb-6 ${
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
              }`}
            >
              <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                资质与专业方向
              </h3>
              <p className={`text-sm leading-relaxed mb-4 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                公司持有市政行业甲级资质，覆盖排水工程、热力工程、载人索道工程等专业，可与冶金、建筑、环境等甲级资质组合，提供从方案到施工图及现场配合的全流程服务。
              </p>
              <div className="flex flex-wrap gap-2">
                {['市政行业甲级', '排水工程', '热力工程', '载人索道工程', '多专业协同设计'].map((tag) => (
                  <span
                    key={tag}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                      darkMode ? 'bg-gray-700 border border-gray-600 text-gray-200' : 'bg-blue-50 border border-blue-200 text-blue-900'
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div
              className={`rounded-xl shadow-sm border p-6 mb-6 ${
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
              }`}
            >
              <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                工程实践与行业成果（公开信息摘要）
              </h3>
              <ul className={`space-y-3 text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                <li className="flex gap-2">
                  <span className="text-blue-500 shrink-0">•</span>
                  <span>
                    山岳型景区客运索道等载人索道工程：公司在该类项目上形成成套设计咨询能力；公开报道显示，广西猫儿山生态旅游索道（一期）等项目在有色金属建设行业优秀工程咨询成果等评选中获得奖项，具体以公司新闻与获奖通报为准。
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-blue-500 shrink-0">•</span>
                  <span>
                    市政给水排水、管网与泵站、热力管线等常规市政项目，与长沙有色院万余项咨询设计积累及近年大批省部级、行业优秀设计咨询奖的整体实力相一致。
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-blue-500 shrink-0">•</span>
                  <span>
                    详细项目清单、合同与业绩证明以公司市场与档案部门正式资料为准；本页仅作背景介绍，不构成商务承诺。
                  </span>
                </li>
              </ul>
            </div>

            <div
              className={`rounded-xl shadow-sm border p-6 ${
                darkMode ? 'bg-gray-800/80 border-gray-700' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <h3 className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                与本软件的关系
              </h3>
              <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                本工具由市政事业部与科研创新中心联合开发，面向浆体与压力流管网的水力校核与方案比选，计算结果仅供设计参考，须结合现行规范与项目条件综合判断。
              </p>
            </div>
          </div>
        </div>
      )
    }

    // 其他部门显示案例分析
    return (
      <div className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <div className="max-w-[calc(100vw*4/5)] mx-auto p-6" style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}>
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
              基于行业标准公式计算浆体管道临界流速的专业工具
            </p>
          </div>

          {/* Frame - 了解我们 */}
          <div className={`rounded-lg shadow-sm border p-5 mb-5 ${
            darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'
          }`}>
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
      <div className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <div className="max-w-[calc(100vw*4/5)] mx-auto p-6" style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}>
          {/* 顶部：标题 + 关于本软件 横幅 */}
          <div className="mb-8">
            <h1 className={`text-2xl sm:text-3xl font-bold mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
              {t.title}
            </h1>
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
    const calcResult = await handleCalculate(false, true, true)
    if (step === 1) {
      updateKronodzeStep2Ready(false)
      updateKronodzeStep3Visible(false)
      updateLockedVc(null)
      setAutoCalculateRef(false)
      return
    }
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
    requestAnimationFrame(() => {
      document.getElementById('slurry-dissipation-input-Q')?.focus()
    })
  }

  const handleCalculate = async (
    isAutoCalculate: boolean = false,
    skipValidation: boolean = false,
    preserveResultOnError: boolean = false
  ): Promise<CalculationResult | null> => {
    if (!formula) return null
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
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null && !isNaN(value)) {
        validParameters[key] = value as number
      }
    }
    const payload = {
      formula_id: effectiveFormulaId,
      formula_info: { ...formula, id: effectiveFormulaId },
      parameters: validParameters,
      result: result.result
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
      className={`flex-[4] min-h-0 overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}
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
      <div className="max-w-[calc(100vw*4/5)] mx-auto p-6" style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}>
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
            基于行业标准公式计算浆体管道临界流速的专业工具
          </p>
        </div>

        {/* Formula Section with Input Parameters */}
        <div className={`rounded-lg shadow-sm border p-5 mb-5 ${
          darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'
        }`}>
          <h2 className={`text-xl font-semibold mb-3 ${
            darkMode ? 'text-gray-100' : 'text-gray-900'
          }`}>
            {(formula?.id === 'slurry_accel_energy' ? '浆体加速流' : formula.name)}：
          </h2>
          
          {/* 浆体消能：与其它模块一致的圆角卡片单列布局 */}
          {isSlurryDissipationFormula ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath('该公式是浆体输送工程中一个专用的工程计算式，其核心目的是计算沿程缩径增阻管道的流量消能系数。所谓“沿程缩径增阻管道”，是指在输送线路上，通过人为缩小管径、增加局部阻力来消耗浆体多余能量的管段或装置，例如孔板、文丘里管、锥形缩径段或专门的消能短管。计算出后，即可代入下方基本消能公式，快速求得特定流量下浆体通过该装置时的水头损失（消能量）。这在设计泵送系统、控制管道末端流速与压力、防止管道汽蚀与磨损等方面至关重要。')}
              </p>

              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>1) 计算流量消能系数</div>
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

              <div className={`rounded-xl border-2 p-6 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>2) 计算消能水头</div>
                <p className={`text-xs mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  填写流量与系数后，点击页面底部「开始计算」。
                </p>
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
          ) : isSlurryEnergyPlaceholder ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath('浆体消能模块用于评估输送过程中的能量衰减与消耗特征。当前界面为占位版本，后续将补充完整的模型说明、参数定义、计算过程与结果判据。')}
              </p>
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>参数输入</div>
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  当前版本暂未开放参数配置。
                </p>
              </div>
              <div className={`rounded-xl border-2 p-6 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果：</div>
                <div className={`text-base ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  功能建设中，后续版本补充。
                </div>
              </div>
            </>
          ) : formula?.id === 'density_mixing' ? (
            <>
              <p className={`text-sm leading-relaxed mb-6 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {renderDescriptionWithMath('本部分为沿程摩阻损失的前置计算，用于由固体质量浓度及液相、固相密度求得浆体当量密度 $\\rho_k$。所得 $\\rho_k$ 将作为达西-魏斯巴赫型浆体摩阻损失公式的输入，可在侧栏「浆体摩阻损失」模块中使用。')}
              </p>
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
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
              <div className={`rounded-xl border-2 p-6 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果：</div>
                <div className={`space-y-1 text-base ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {result?.success ? (
                    <div><InlineMath math="\rho_k" /> = <span className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.rho_k ?? '—'}</span> t/m³</div>
                  ) : (
                    <span className={darkMode ? 'text-red-300' : 'text-red-600'}>{result?.error || '—'}</span>
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
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
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
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
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
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
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
              <div className={`rounded-xl border-2 p-6 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果：</div>
                <div className={`space-y-1 text-base ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {result?.success ? (
                    <>
                      <div><InlineMath math="\rho_1" /> = <span className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.intermediate?.step_A_rho_1 ?? result.result?.rho_1 ?? '—'}</span> kg/m³</div>
                      <div><InlineMath math="Re_B" /> = <span className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.intermediate?.step_B_Re_B ?? result.result?.Re_B ?? '—'}</span></div>
                      <div><InlineMath math="\lambda" /> = <span className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.lambda_coef ?? '—'}</span> {result.result?.intermediate?.flow_regime ? `（${result.result.intermediate.flow_regime}）` : ''}</div>
                    </>
                  ) : (
                    <span className={darkMode ? 'text-red-300' : 'text-red-600'}>{result?.error || '—'}</span>
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
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
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
              <div className={`rounded-xl border-2 p-6 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-sm mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>计算结果：</div>
                <div className={`space-y-1 text-base ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {result?.success ? (
                    <div><InlineMath math="i_k" /> = <span className={`font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.result?.intermediate?.step_B_i_k ?? result.result?.i_k ?? '—'}</span> mH₂O/m</div>
                  ) : (
                    <span className={darkMode ? 'text-red-300' : 'text-red-600'}>{result?.error || '—'}</span>
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
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
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
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
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
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>3. 计算临界流速</div>
                <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {renderDescriptionWithMath('需先完成步骤1、2。由步骤1得到的 $C_d$（重量砂水比 $=W/G\\times100$）、步骤2得到的 $D_L$（临界管径 mm）及 $\\beta$，计算临界流速 $V_L$（m/s）。无需额外输入。')}
                </p>
                <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="V_L = 0.255\beta(1+2.48\sqrt[3]{C_d}\sqrt[4]{D_L})" />
                </div>
                <div className="flex items-center justify-between mb-2">
                  <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>计算结果：</div>
                  {kronodzeStep3Visible && result?.success && result.result?.Vc !== undefined && (
                    <button type="button" onClick={() => { if (lockedVc === null) { updateLockedVc(result.result!.Vc ?? null); setAutoCalculateRef(true); } else { updateLockedVc(null); setAutoCalculateRef(false); } }} className={`text-xs px-2 py-1 rounded transition-colors ${lockedVc !== null ? (darkMode ? 'bg-red-900 bg-opacity-50 text-red-300 hover:bg-red-800' : 'bg-red-100 text-red-700 hover:bg-red-200') : (darkMode ? 'bg-green-900 bg-opacity-50 text-green-300 hover:bg-green-800' : 'bg-green-100 text-green-700 hover:bg-green-200')}`} title={lockedVc !== null ? '点击解锁临界流速' : '点击锁定临界流速'}>
                      {lockedVc !== null ? '🔒 已锁定' : '🔓 锁定'}
                    </button>
                  )}
                </div>
                <div className={`text-xl font-bold ${kronodzeStep3Visible ? (darkMode ? 'text-blue-400' : 'text-blue-600') : (darkMode ? 'text-gray-500' : 'text-gray-400')}`}>
                  {kronodzeStep3Visible && result?.success && result.result?.Vc !== undefined ? `${result.result.Vc} m/s` : '—'}
                </div>
                {!kronodzeStep3Visible && (
                  <div className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>请先完成步骤2并点击底部「开始计算」</div>
                )}
                {kronodzeStep3Visible && lockedVc !== null && result?.success && result.result?.Vc !== undefined && (() => {
                  const newVc = result.result.Vc
                  const animationType = result.animation_type || 'still-flow'
                  const velocityRatio = result.velocity_ratio ?? (newVc / lockedVc)
                  let statusText: string, statusColor: string, bgColor: string, borderColor: string
                  if (animationType === 'settle-30') { statusText = '⚠️ 严重沉降'; statusColor = darkMode ? 'text-red-300' : 'text-red-700'; bgColor = darkMode ? 'bg-red-900 bg-opacity-30' : 'bg-red-100'; borderColor = darkMode ? 'border-red-600' : 'border-red-300' }
                  else if (animationType === 'settle-20') { statusText = '⚠️ 中度沉降'; statusColor = darkMode ? 'text-orange-300' : 'text-orange-700'; bgColor = darkMode ? 'bg-orange-900 bg-opacity-30' : 'bg-orange-100'; borderColor = darkMode ? 'border-orange-600' : 'border-orange-300' }
                  else if (animationType === 'settle-10-flow') { statusText = '⚠️ 轻度沉降'; statusColor = darkMode ? 'text-yellow-300' : 'text-yellow-700'; bgColor = darkMode ? 'bg-yellow-900 bg-opacity-30' : 'bg-yellow-100'; borderColor = darkMode ? 'border-yellow-600' : 'border-yellow-300' }
                  else if (animationType === 'still-flow') { statusText = '临界状态'; statusColor = darkMode ? 'text-blue-300' : 'text-blue-700'; bgColor = darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-100'; borderColor = darkMode ? 'border-blue-600' : 'border-blue-300' }
                  else if (animationType === 'medium-flow') { statusText = '✅ 正常流动'; statusColor = darkMode ? 'text-green-300' : 'text-green-700'; bgColor = darkMode ? 'bg-green-900 bg-opacity-30' : 'bg-green-100'; borderColor = darkMode ? 'border-green-600' : 'border-green-300' }
                  else { statusText = '✅ 快速流动'; statusColor = darkMode ? 'text-green-300' : 'text-green-700'; bgColor = darkMode ? 'bg-green-900 bg-opacity-30' : 'bg-green-100'; borderColor = darkMode ? 'border-green-600' : 'border-green-300' }
                  return (
                    <div className={`mt-4 pt-4 border-t ${darkMode ? 'border-blue-700' : 'border-blue-200'}`}>
                      <div className={`text-xs mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>锁定的临界流速: <span className="font-semibold">{lockedVc} m/s</span></div>
                      <div className={`py-3 px-3 rounded-lg ${bgColor} border ${borderColor} ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                        <div className="flex items-start gap-3">
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
                                className={`shrink-0 px-2 py-1 rounded text-[11px] border transition-colors ${darkMode ? 'bg-gray-800/50 border-gray-500 text-gray-200 hover:bg-gray-800' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                              >
                                全屏展示
                              </button>
                            </div>
                            <div className="space-y-1 text-xs leading-relaxed break-words">
                              <div>当前计算的临界流速: <span className="font-semibold">{newVc} m/s</span></div>
                              <div>锁定的临界流速: <span className="font-semibold">{lockedVc} m/s</span></div>
                              <div className="mt-1.5 break-words">
                                {animationType === 'settle-30' ? `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，严重沉降风险` :
                                 animationType === 'settle-20' ? `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，中度沉降风险` :
                                 animationType === 'settle-10-flow' ? `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，轻度沉降风险` :
                                 animationType === 'still-flow' ? `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，临界状态，需要保持稳定流速` :
                                 animationType === 'medium-flow' ? `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，正常流动，安全` :
                                 `当前临界流速 (${newVc} m/s) 为锁定临界流速的 ${(velocityRatio * 100).toFixed(1)}%，快速流动，安全`}
                              </div>
                            </div>
                          </div>
                          <div className="flex-shrink-0" style={{ flex: '1', minWidth: '120px', maxWidth: '33.333%' }}>
                            <div className="flex flex-col items-center">
                              {renderFlowAnimation(animationType, statusColor, 'small')}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}
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
          {formula?.id !== 'kronodze_pressure' && formula?.id !== 'slurry_friction_loss' && formula?.id !== 'darcy_friction' && formula?.id !== 'density_mixing' && !isSlurryDissipationFormula && !isSlurryEnergyPlaceholder && (
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

        {/* Results Section - 仅非 B.C.克诺罗兹法、非浆体摩阻损失、非达西摩阻系数、非密度混合 时显示统一结果区 */}
        {formula?.id !== 'kronodze_pressure' && formula?.id !== 'slurry_friction_loss' && formula?.id !== 'darcy_friction' && formula?.id !== 'density_mixing' && !isSlurryDissipationFormula && !isSlurryEnergyPlaceholder && (
        <div className={`rounded-lg shadow-sm border p-5 mb-5 ${
          darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'
        }`}>
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
                {result?.success && result.result?.Vc !== undefined && formula?.id !== 'kronodze_pressure' && (
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
              <div className={`text-xl font-bold ${
                darkMode ? 'text-blue-400' : 'text-blue-600'
              }`}>
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

        {/* Action Buttons */}
        {!isSlurryEnergyPlaceholder && (
        <div className="flex justify-end space-x-3">
          <button
            onClick={() => {
              if (!formula) return
              
              // 清除计算结果、锁定状态和用户输入，重置为默认值
              updateResult(null)
              updateLockedVc(null)
              setAutoCalculateRef(false)
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
              
              // 重置参数为默认值
              const initialParams: Record<string, number | undefined> = {}
              const initialRaw: Record<string, string> = {}
              formula.parameters.forEach(param => {
                if (param.default !== undefined) {
                  initialParams[param.name] = param.default
                  initialRaw[param.name] = String(param.default)
                } else {
                  // 如果没有默认值，清除该参数
                  initialParams[param.name] = undefined
                  initialRaw[param.name] = ''
                }
              })
              updateParameters(() => initialParams)
              updateRawInputs(() => initialRaw)
              if (formula.id === 'kronodze_pressure') {
                updateKronodzeStep2Ready(false)
                updateKronodzeStep3Visible(false)
              }
            }}
            disabled={loading || !result}
            className={`px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              darkMode
                ? 'bg-orange-600 text-white hover:bg-orange-700'
                : 'bg-orange-500 text-white hover:bg-orange-600'
            }`}
          >
            重新计算
          </button>
          <button
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
              || (formula?.id === 'kronodze_pressure' && !kronodzeStep2Ready)
              || (isSlurryDissipationFormula && dissipationStep2ValidateMsg !== null)
              || (!isSlurryDissipationFormula && formula?.id !== 'kronodze_pressure' && lockedVc !== null)
            }
            className={`px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              darkMode
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            title={
              isSlurryDissipationFormula
                ? dissipationStep2ValidateMsg || '填写 Q 与系数后点击开始计算'
                : lockedVc !== null
                ? '已锁定临界流速，系统会自动计算'
                : (formula?.id === 'kronodze_pressure' && !kronodzeStep2Ready)
                  ? '请先完成步骤2（计算临界管径）'
                  : ''
            }
          >
            {loading ? '计算中...' : '开始计算'}
          </button>
          <button
            onClick={handleExport}
            disabled={!result?.success || exporting}
            className={`px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              darkMode
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {exporting ? '导出中...' : '导出计算书'}
          </button>
        </div>
        )}
      </div>
    </div>
  )
}
