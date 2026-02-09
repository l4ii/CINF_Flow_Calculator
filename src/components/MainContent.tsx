import { useState, useEffect } from 'react';
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
  // 为每个公式独立存储参数（key是formula.id）
  const [formulaParameters, setFormulaParameters] = useState<Record<string, Record<string, number | undefined>>>({})
  const [formulaRawInputs, setFormulaRawInputs] = useState<Record<string, Record<string, string>>>({})
  const [formulaResults, setFormulaResults] = useState<Record<string, CalculationResult | null>>({})
  const [formulaLockedVc, setFormulaLockedVc] = useState<Record<string, number | null>>({})
  
  // 当前公式的参数（从formulaParameters中获取）
  const parameters = formula ? (formulaParameters[formula.id] || {}) : {}
  const rawInputs = formula ? (formulaRawInputs[formula.id] || {}) : {}
  const result = formula ? (formulaResults[formula.id] || null) : null
  const lockedVc = formula ? (formulaLockedVc[formula.id] || null) : null
  
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  // 锁定临界流速功能
  const [autoCalculateRef, setAutoCalculateRef] = useState<boolean>(false) // 是否自动计算（锁定后参数改变时）
  const [selectedCase, setSelectedCase] = useState<number | null>(null) // 选中的案例分析
  
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

  // 将数学符号转换为普通文本（用于参数描述显示）
  const convertMathSymbolsToText = (text: string): string => {
    return text
      .replace(/ω_s/g, 'omega_s')
      .replace(/ω/g, 'omega')
      .replace(/λ/g, 'lambda')
      .replace(/θ/g, 'theta')
      .replace(/Δρ/g, 'Delta rho')
      .replace(/ρg/g, 'rho_g')
      .replace(/ρk/g, 'rho_k')
      .replace(/ρ/g, 'rho')
      .replace(/Cv/g, 'Cv')
      .replace(/d85/g, 'd85')
      .replace(/d90/g, 'd90')
  }

  // 渲染包含LaTeX数学符号的描述文本
  const renderDescriptionWithMath = (text: string): JSX.Element[] => {
    // 匹配 $...$ 格式的LaTeX数学表达式
    const parts: (string | JSX.Element)[] = []
    const regex = /\$([^$]+)\$/g
    let lastIndex = 0
    let match
    
    while ((match = regex.exec(text)) !== null) {
      // 添加匹配前的普通文本
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index))
      }
      // 添加LaTeX数学表达式
      parts.push(
        <InlineMath key={match.index} math={match[1]} />
      )
      lastIndex = regex.lastIndex
    }
    
    // 添加剩余的普通文本
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex))
    }
    
    return parts.length > 0 ? parts as JSX.Element[] : [<span key="text">{text}</span>]
  }

  // 将中间计算结果的key转换为中文显示名称（使用LaTeX数学符号）
  const getIntermediateLabel = (key: string): JSX.Element | string => {
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
      
      // 克诺罗兹法
      'sqrt_term': '平方根项',
      'sin_theta': 'sin(θ)',
    }
    
    const label = labelMap[key] || key
    
    // 根据key返回对应的数学公式显示
    const mathFormulas: Record<string, string> = {
      'delta_rho_ratio': '\\frac{\\Delta\\rho}{\\rho}',
      'density_ratio': '\\frac{\\Delta\\rho}{\\rho}',
      'g': 'g',
      'core_term': '[g \\cdot D \\cdot \\frac{\\Delta\\rho}{\\rho} \\cdot \\omega]^{1/3}',
      'concentration_term': 'C_v^{1/6}',
      'velocity_ratio_term': '(\\frac{\\omega_s}{\\omega})^{1/6}',
      'bracket_term': '[2 \\cdot g \\cdot D \\cdot \\frac{\\Delta\\rho}{\\rho}]^{1/2}',
      'size_ratio_term': '(\\frac{d_{85}}{D})^{1/6}',
      'conc_term': 'C_v^{0.25}',
      'size_term': '(\\frac{d_{90}}{D})^{1/3}',
      'leading_coef': '\\frac{2.26}{\\sqrt{\\lambda}}',
      'sqrt_term': '\\sqrt{gD \\cdot \\frac{\\Delta\\rho}{\\rho}}',
      'sin_theta': '\\sin(\\theta)',
    }
    
    const mathFormula = mathFormulas[key]
    
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
      .replace(/√/g, '\\sqrt')
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
          return { ...prev, [formulaId]: newParams }
        } else {
          // 如果没有记录，初始化所有默认值
          const initialParams: Record<string, number | undefined> = {}
          formula.parameters.forEach(param => {
            if (param.default !== undefined) {
              initialParams[param.name] = param.default
            }
          })
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
          return { ...prev, [formulaId]: newRaw }
        } else {
          // 如果没有记录，初始化所有默认值
          const initialRaw: Record<string, string> = {}
          formula.parameters.forEach(param => {
            if (param.default !== undefined) {
              initialRaw[param.name] = String(param.default)
            }
          })
          return { ...prev, [formulaId]: initialRaw }
        }
      })
      
      // 切换公式时清除锁定状态，但保留用户输入的参数和计算结果
      updateLockedVc(null)
      setAutoCalculateRef(false)
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

  const handleParameterChange = (name: string, value: string) => {
    // 先保存原始文本，避免 type="number" 在部分系统下不接受 “.”
    if (!formula) return
    updateRawInputs(prev => ({ ...prev, [name]: value }))

    if (value === '') {
      updateParameters(prev => ({ ...prev, [name]: undefined }))
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
      municipal: [
        {
          title: '市政污水管道优化设计',
          description: '通过精确的临界流速计算，优化了市政污水管道的设计参数，提高了输送效率，降低了运行成本。',
          highlights: ['优化效果：提升20%效率', '成本节约：15%', '应用范围：全市管网']
        },
        {
          title: '城市给水管道系统',
          description: '采用先进的浆体管道计算技术，设计了高效的城市给水管道系统，确保了供水安全和稳定性。',
          highlights: ['供水能力：50万m³/日', '覆盖人口：200万人', '可靠性：99.9%']
        },
        {
          title: '工业废水处理管道',
          description: '针对工业废水的特殊性质，运用专业公式进行管道设计，实现了工业废水的安全、高效输送。',
          highlights: ['处理能力：10000m³/日', '达标率：100%', '环保效益：显著']
        }
      ],
      research: [
        {
          title: '新型浆体管道输送技术研究',
          description: '科研创新中心在浆体管道输送领域进行了深入研究，开发了多项创新技术，提升了行业技术水平。',
          highlights: ['专利数量：15项', '技术突破：5项', '行业影响：广泛认可']
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

    // 如果是长沙有色冶金设计研究院，显示公司介绍和联系信息
    if (aboutDepartment === 'cinf') {
      return (
        <div className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
          <div className="max-w-[calc(100vw*4/5)] mx-auto p-6" style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}>
            {/* Header */}
            <div className="mb-5">
              <h1 className={`text-2xl font-bold mb-2 ${
                darkMode ? 'text-gray-100' : 'text-gray-900'
              }`}>
                长沙院浆体管道临界流速计算工具
              </h1>
              <p className={`text-xs ${
                darkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                基于行业标准公式计算浆体管道临界流速的专业工具
              </p>
            </div>

            {/* Frame - 公司介绍 */}
            <div className={`rounded-xl shadow-lg border-0 overflow-hidden ${
              darkMode ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-white'
            }`}>
              {/* 公司图片 - 顶部 */}
              <div className="relative w-full">
                <div className="relative overflow-hidden" style={{ maxHeight: '820px' }}>
                  <img 
                    src="/pic1.png" 
                    alt="长沙有色冶金设计研究院" 
                    className="w-full object-cover"
                    style={{ height: '820px', objectPosition: 'center' }}
                  />
                  <div className={`absolute inset-0 bg-gradient-to-t ${
                    darkMode ? 'from-gray-900/80 via-gray-900/40 to-transparent' : 'from-black/60 via-black/30 to-transparent'
                  }`}></div>
                  {/* 标题叠加在图片上 */}
                  <div className="absolute bottom-0 left-0 right-0 px-8 py-8">
                    <h2 className={`text-3xl font-bold tracking-tight mb-2 ${
                      darkMode ? 'text-white' : 'text-white'
                    }`}>
                      公司简介
                    </h2>
                    <div className={`text-base ${
                      darkMode ? 'text-gray-200' : 'text-gray-100'
                    }`}>
                      长沙有色冶金设计研究院有限公司
                    </div>
                  </div>
                </div>
              </div>

              {/* 内容区域 */}
              <div className="px-8 py-8">
                {/* 公司介绍内容 */}
                <div className={`space-y-6 text-base leading-relaxed ${
                  darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {/* 第一段 - 突出显示 */}
                  <div className={`p-6 rounded-lg ${
                    darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-blue-50/50 border border-blue-100'
                  }`}>
                    <p className={`text-lg leading-relaxed ${
                      darkMode ? 'text-gray-200' : 'text-gray-800'
                    }`}>
                      <strong className={`text-xl font-bold block mb-3 ${
                        darkMode ? 'text-white' : 'text-gray-900'
                      }`}>
                        长沙有色冶金设计研究院有限公司
                      </strong>
                      <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                        （简称长沙有色院）于1953年正式成立，国家高新技术企业，国家技术创新示范企业，国家企业技术中心，是我国最早成立的大型综合性设计研究单位之一，隶属于中国铝业集团有限公司，为中铝国际工程股份有限公司的子公司。
                      </span>
                    </p>
                  </div>
                  
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

                {/* 业务联系信息 */}
                <div className={`pt-8 border-t ${
                  darkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                  <h3 className={`text-xl font-bold mb-6 ${
                    darkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                    业务联系
                  </h3>
                  
                  {/* 基础联系信息卡片 */}
                  <div className={`p-6 rounded-xl mb-6 ${
                    darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'
                  }`}>
                        <div className="space-y-4">
                          <div className="flex items-start">
                            <div className={`w-1 h-6 rounded-full mr-3 mt-1 ${
                              darkMode ? 'bg-blue-500' : 'bg-blue-600'
                            }`}></div>
                            <div className="flex-1">
                              <div className={`text-xs font-medium mb-1 uppercase tracking-wide ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                联系地址
                              </div>
                              <div className={`text-sm ${
                                darkMode ? 'text-gray-200' : 'text-gray-800'
                              }`}>
                                湖南省长沙市雨花区木莲东路299号
                              </div>
                            </div>
                          </div>
                          <div className="flex items-start">
                            <div className={`w-1 h-6 rounded-full mr-3 mt-1 ${
                              darkMode ? 'bg-blue-500' : 'bg-blue-600'
                            }`}></div>
                            <div className="flex-1">
                              <div className={`text-xs font-medium mb-1 uppercase tracking-wide ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                邮政编码
                              </div>
                              <div className={`text-sm ${
                                darkMode ? 'text-gray-200' : 'text-gray-800'
                              }`}>
                                410019
                              </div>
                            </div>
                          </div>
                          <div className="flex items-start">
                            <div className={`w-1 h-6 rounded-full mr-3 mt-1 ${
                              darkMode ? 'bg-blue-500' : 'bg-blue-600'
                            }`}></div>
                            <div className="flex-1">
                              <div className={`text-xs font-medium mb-1 uppercase tracking-wide ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                办公室
                              </div>
                              <a 
                                href="tel:0731-84397032"
                                className={`text-sm hover:opacity-80 transition-opacity ${
                                  darkMode ? 'text-blue-400' : 'text-blue-600'
                                }`}
                              >
                                0731-84397032
                              </a>
                            </div>
                          </div>
                          <div className="flex items-start">
                            <div className={`w-1 h-6 rounded-full mr-3 mt-1 ${
                              darkMode ? 'bg-blue-500' : 'bg-blue-600'
                            }`}></div>
                            <div className="flex-1">
                              <div className={`text-xs font-medium mb-1 uppercase tracking-wide ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                传真
                              </div>
                              <div className={`text-sm ${
                                darkMode ? 'text-gray-200' : 'text-gray-800'
                              }`}>
                                0731-82228112
                              </div>
                            </div>
                          </div>
                          <div className="flex items-start">
                            <div className={`w-1 h-6 rounded-full mr-3 mt-1 ${
                              darkMode ? 'bg-blue-500' : 'bg-blue-600'
                            }`}></div>
                            <div className="flex-1">
                              <div className={`text-xs font-medium mb-1 uppercase tracking-wide ${
                                darkMode ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                Email
                              </div>
                              <a 
                                href="mailto:cinf@chinalco.com.cn" 
                                className={`text-sm hover:opacity-80 transition-opacity ${
                                  darkMode ? 'text-blue-400' : 'text-blue-600'
                                }`}
                              >
                                cinf@chinalco.com.cn
                              </a>
                            </div>
                          </div>
                        </div>
                  </div>

                  {/* 各部门联系信息 */}
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

    // 其他部门显示案例分析
    return (
      <div className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <div className="max-w-[calc(100vw*4/5)] mx-auto p-6" style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}>
          {/* Header */}
          <div className="mb-5">
            <h1 className={`text-2xl font-bold mb-2 ${
              darkMode ? 'text-gray-100' : 'text-gray-900'
            }`}>
              长沙院浆体管道临界流速计算工具
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
    return (
      <div className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <div className="max-w-[calc(100vw*4/5)] mx-auto p-6" style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}>
          {/* Header */}
          <div className="mb-5">
            <h1 className={`text-2xl font-bold mb-2 ${
              darkMode ? 'text-gray-100' : 'text-gray-900'
            }`}>
              长沙院浆体管道临界流速计算工具
            </h1>
            <p className={`text-xs ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>
              基于行业标准公式计算浆体管道临界流速的专业工具
            </p>
          </div>

          {/* Frame - 设置 */}
          <div className={`rounded-lg shadow-sm border p-5 mb-5 ${
            darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'
          }`}>
            <h2 className={`text-xl font-semibold mb-4 ${
              darkMode ? 'text-gray-100' : 'text-gray-900'
            }`}>
              设置
            </h2>
            
            {/* 显示模式设置 */}
            <div className={`mb-6 p-4 rounded-lg border ${
              darkMode ? 'bg-gray-600 border-gray-500' : 'bg-gray-50 border-gray-200'
            }`}>
              <h3 className={`text-base font-semibold mb-3 ${
                darkMode ? 'text-gray-200' : 'text-gray-700'
              }`}>
                显示模式
              </h3>
            <div className="space-y-3">
              <button
                onClick={() => onDarkModeChange && onDarkModeChange(false)}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center justify-between ${
                  !darkModeValue
                    ? darkMode
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-600 text-white'
                    : darkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <div>
                  <div className="font-medium">浅色显示</div>
                  <div className={`text-xs mt-1 ${
                    !darkModeValue ? 'opacity-80' : 'opacity-60'
                  }`}>
                    默认模式，适合日间使用
                  </div>
                </div>
                {!darkModeValue && <span className="text-xl">✓</span>}
              </button>
              <button
                onClick={() => onDarkModeChange && onDarkModeChange(true)}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center justify-between ${
                  darkModeValue
                    ? darkMode
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-600 text-white'
                    : darkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <div>
                  <div className="font-medium">暗色模式</div>
                  <div className={`text-xs mt-1 ${
                    darkModeValue ? 'opacity-80' : 'opacity-60'
                  }`}>
                    护眼模式，适合夜间使用
                  </div>
                </div>
                {darkModeValue && <span className="text-xl">✓</span>}
              </button>
            </div>
            </div>

            {/* 语言设置 */}
            <div className={`p-4 rounded-lg border ${
              darkMode ? 'bg-gray-600 border-gray-500' : 'bg-gray-50 border-gray-200'
            }`}>
              <h3 className={`text-base font-semibold mb-3 ${
                darkMode ? 'text-gray-200' : 'text-gray-700'
              }`}>
                语言调节
              </h3>
              <div className="space-y-3">
                <button
                  onClick={() => onLanguageChange && onLanguageChange('zh')}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center justify-between ${
                    language === 'zh'
                      ? darkMode
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-600 text-white'
                      : darkMode
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <div>
                    <div className="font-medium">中文</div>
                    <div className={`text-xs mt-1 ${
                      language === 'zh' ? 'opacity-80' : 'opacity-60'
                    }`}>
                      简体中文
                    </div>
                  </div>
                  {language === 'zh' && <span className="text-xl">✓</span>}
                </button>
                <button
                  onClick={() => onLanguageChange && onLanguageChange('en')}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center justify-between ${
                    language === 'en'
                      ? darkMode
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-600 text-white'
                      : darkMode
                      ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <div>
                    <div className="font-medium">English</div>
                    <div className={`text-xs mt-1 ${
                      language === 'en' ? 'opacity-80' : 'opacity-60'
                    }`}>
                      English
                    </div>
                  </div>
                  {language === 'en' && <span className="text-xl">✓</span>}
                </button>
              </div>
            </div>

            {/* 更新检查 */}
            {typeof window !== 'undefined' && (window as any).electronAPI?.update && (
              <div className={`mt-6 p-4 rounded-lg border ${
                darkMode ? 'bg-gray-600 border-gray-500' : 'bg-gray-50 border-gray-200'
              }`}>
                <h3 className={`text-base font-semibold mb-3 ${
                  darkMode ? 'text-gray-200' : 'text-gray-700'
                }`}>
                  应用更新
                </h3>
                <div className="space-y-3">
                  <div className={`text-sm mb-3 ${
                    darkMode ? 'text-gray-300' : 'text-gray-600'
                  }`}>
                    当前版本: <span className="font-medium">{currentVersion}</span>
                  </div>
                  
                  {updateStatus === 'idle' && (
                    <button
                      onClick={handleCheckForUpdates}
                      className={`w-full px-4 py-2 rounded-lg transition-colors ${
                        darkMode
                          ? 'bg-blue-600 hover:bg-blue-700 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      检查更新
                    </button>
                  )}

                  {updateStatus === 'checking' && (
                    <div className={`text-center py-2 ${
                      darkMode ? 'text-gray-300' : 'text-gray-600'
                    }`}>
                      <div className="inline-block animate-spin mr-2">⟳</div>
                      正在检查更新...
                    </div>
                  )}

                  {updateStatus === 'available' && updateInfo && (
                    <div className="space-y-3">
                      <div className={`p-3 rounded-lg ${
                        darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-200'
                      }`}>
                        <div className={`font-medium mb-1 ${
                          darkMode ? 'text-green-300' : 'text-green-800'
                        }`}>
                          发现新版本: {updateInfo.version}
                        </div>
                        {updateInfo.releaseNotes && (
                          <div className={`text-xs mt-2 ${
                            darkMode ? 'text-green-400' : 'text-green-700'
                          }`}>
                            {updateInfo.releaseNotes}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={handleDownloadUpdate}
                        className={`w-full px-4 py-2 rounded-lg transition-colors ${
                          darkMode
                            ? 'bg-green-600 hover:bg-green-700 text-white'
                            : 'bg-green-600 hover:bg-green-700 text-white'
                        }`}
                      >
                        下载更新
                      </button>
                    </div>
                  )}

                  {updateStatus === 'downloading' && (
                    <div className="space-y-3">
                      <div className={`text-sm mb-2 ${
                        darkMode ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                        正在下载更新: {updateProgress}%
                      </div>
                      <div className={`w-full h-2 rounded-full overflow-hidden ${
                        darkMode ? 'bg-gray-700' : 'bg-gray-200'
                      }`}>
                        <div
                          className={`h-full transition-all duration-300 ${
                            darkMode ? 'bg-blue-500' : 'bg-blue-600'
                          }`}
                          style={{ width: `${updateProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {updateStatus === 'downloaded' && (
                    <div className="space-y-3">
                      <div className={`p-3 rounded-lg ${
                        darkMode ? 'bg-green-900/30 border border-green-700' : 'bg-green-50 border border-green-200'
                      }`}>
                        <div className={`font-medium ${
                          darkMode ? 'text-green-300' : 'text-green-800'
                        }`}>
                          更新下载完成，重启应用以安装更新
                        </div>
                      </div>
                      <button
                        onClick={handleInstallUpdate}
                        className={`w-full px-4 py-2 rounded-lg transition-colors ${
                          darkMode
                            ? 'bg-green-600 hover:bg-green-700 text-white'
                            : 'bg-green-600 hover:bg-green-700 text-white'
                        }`}
                      >
                        立即重启并安装
                      </button>
                    </div>
                  )}

                  {updateStatus === 'error' && (
                    <div className="space-y-3">
                      <div className={`p-3 rounded-lg ${
                        darkMode ? 'bg-red-900/30 border border-red-700' : 'bg-red-50 border border-red-200'
                      }`}>
                        <div className={`text-sm ${
                          darkMode ? 'text-red-300' : 'text-red-800'
                        }`}>
                          {updateError || '更新检查失败'}
                        </div>
                      </div>
                      <button
                        onClick={handleCheckForUpdates}
                        className={`w-full px-4 py-2 rounded-lg transition-colors ${
                          darkMode
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        重试
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // 验证参数
  const validateParameters = (): string | null => {
    if (!formula) return '请选择公式'
    
    // 检查所有必填参数是否已填写
    for (const param of formula.parameters) {
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
      }
    }
    
    return null
  }

  const handleCalculate = async (isAutoCalculate: boolean = false) => {
    if (!formula) return

    // 验证参数
    const validationError = validateParameters()
    if (validationError) {
      updateResult({
        success: false,
        error: validationError
      })
      return
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
        formula_id: formula.id,
        parameters: validParameters,
        locked_vc: lockedVc // 发送锁定的临界流速到后端
      }, {
        timeout: API_TIMEOUT
      })
      updateResult(response.data)
    } catch (error: any) {
      updateResult({
        success: false,
        error: error.response?.data?.error || '计算失败，请检查输入参数'
      })
    } finally {
      if (!isAutoCalculate) {
        setLoading(false)
      }
    }
  }

  const handleExport = async () => {
    if (!formula || !result?.success) return

    setExporting(true)
    try {
      // 过滤掉undefined值，只发送有效参数
      const validParameters: Record<string, number> = {}
      for (const [key, value] of Object.entries(parameters)) {
        if (value !== undefined && value !== null && !isNaN(value)) {
          validParameters[key] = value as number
        }
      }
      
      const response = await axios.post(
        `${API_BASE_URL}/export`,
        {
          formula_id: formula.id,
          formula_info: formula,
          parameters: validParameters,
          result: result.result
        },
        {
          responseType: 'blob',
          timeout: API_TIMEOUT
        }
      )

      // 创建下载链接
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      // 文件名格式：长沙院浆体计算_公式名_日期
      const date = new Date().toISOString().split('T')[0].replace(/-/g, '')
      const formulaName = formula.name.replace(/\s+/g, '')
      link.setAttribute('download', `长沙院浆体计算_${formulaName}_${date}.docx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error: any) {
      console.error('导出失败:', error)
      let errorMessage = '导出失败'
      
      if (error.code === 'ECONNABORTED') {
        errorMessage = '请求超时，请检查后端服务是否正常运行'
      } else if (error.message && error.message.includes('Network Error')) {
        errorMessage = '网络错误：无法连接到后端服务器。请确保后端服务已启动（运行 python backend/app.py）'
      } else if (error.response) {
        // 服务器返回了响应
        if (error.response.data instanceof Blob) {
          // 如果是blob响应，尝试读取错误信息
          error.response.data.text().then((text: string) => {
            try {
              const errorData = JSON.parse(text)
              alert(errorData.error || errorMessage)
            } catch {
              alert(`导出失败: ${error.response.status} ${error.response.statusText}`)
            }
          }).catch(() => {
            alert(`导出失败: ${error.response.status} ${error.response.statusText}`)
          })
          return
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
      
      alert(errorMessage)
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

  return (
    <div className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
      <div className="max-w-[calc(100vw*4/5)] mx-auto p-6" style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}>
        {/* Header */}
        <div className="mb-5">
          <h1 className={`text-2xl font-bold mb-2 ${
            darkMode ? 'text-gray-100' : 'text-gray-900'
          }`}>
            长沙院浆体管道临界流速计算工具
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
            {formula.name}:
          </h2>
          
          {/* 数学公式显示 */}
          <div className={`mb-4 p-3 rounded-lg overflow-x-auto ${
            darkMode ? 'bg-gray-600' : 'bg-gray-50'
          }`}>
            <BlockMath math={convertFormulaToLatex(formula.formula)} />
          </div>
          
          <p className={`text-xs leading-relaxed mb-4 ${
            darkMode ? 'text-gray-300' : 'text-gray-500'
          }`}>
            {renderDescriptionWithMath(formula.description)}
          </p>

          {/* Input Parameters - Two Column Layout */}
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
                    {(() => {
                      const labelText = (param.label || param.name) as string
                      const parts = labelText.split(/(d85|d90)/g)
                      // 如果不包含 d85/d90，就原样显示
                      if (parts.length === 1) return labelText
                      return (
                        <span className="inline-flex flex-wrap items-baseline gap-x-1">
                          {parts.map((part, idx) => {
                            if (part === 'd85') return <InlineMath key={`${param.name}-d85-${idx}`} math={'d_{85}'} />
                            if (part === 'd90') return <InlineMath key={`${param.name}-d90-${idx}`} math={'d_{90}'} />
                            return <span key={`${param.name}-txt-${idx}`}>{part}</span>
                          })}
                        </span>
                      )
                    })()}
                    {param.description && (
                      <span className="ml-2 text-gray-400 text-xs">
                        ({convertMathSymbolsToText(param.description)})
                      </span>
                    )}
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      // 允许输入小数点，且可用键盘/滚轮按 6 位精度微调（由逻辑侧控制精度）
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
                    <span className={`text-sm w-20 ${
                      darkMode ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      {param.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Results Section - Below Input Parameters */}
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
                  临界流速计算结果:
                </div>
                {result?.success && result.result?.Vc !== undefined && (
                  <button
                    onClick={() => {
                      if (lockedVc === null) {
                        // 锁定当前临界流速
                        updateLockedVc(result.result!.Vc)
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
                {result?.success
                  ? `${result.result?.Vc} ${result.result?.unit || 'm/s'}`
                  : result?.error || 'N/A m/s'}
              </div>
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
                      statusText = '⚡ 临界状态'
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
                            <div className="font-semibold mb-1.5">
                              {statusText}
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

            {result?.success && result.result?.intermediate && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <div className={`text-sm font-medium mb-3 ${
                  darkMode ? 'text-gray-200' : 'text-gray-700'
                }`}>
                  中间计算结果:
                </div>
                <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm ${
                  darkMode ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {Object.entries(result.result.intermediate).map(([key, value]) => {
                    const labelElement = getIntermediateLabel(key)
                    const isReactElement = typeof labelElement !== 'string'
                    return (
                      <div key={key} className="flex flex-col">
                        <div className="text-gray-500 text-xs mb-1">
                          {isReactElement ? labelElement : `${labelElement}:`}
                        </div>
                        <span className="font-mono font-semibold">{value}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
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

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={() => {
              if (!formula) return
              
              // 清除计算结果、锁定状态和用户输入，重置为默认值
              updateResult(null)
              updateLockedVc(null)
              setAutoCalculateRef(false)
              
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
            onClick={() => handleCalculate(false)}
            disabled={loading || lockedVc !== null}
            className={`px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              darkMode
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            title={lockedVc !== null ? '已锁定临界流速，系统会自动计算' : ''}
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
      </div>
    </div>
  )
}
