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
  const [selectedResearchCenter, setSelectedResearchCenter] = useState<string>('recycling') // 科研创新中心当前选中的子中心
  const [zoomPlatformImageUrl, setZoomPlatformImageUrl] = useState<string | null>(null) // 科研平台图片放大查看
  const [platformImageLoaded, setPlatformImageLoaded] = useState(false) // 当前中心展示图是否已加载完成

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
      
      // 沿程摩阻损失：i_k = λ·(V²·ρ_k)/(2gD·ρ_s)
      'numerator': '流速平方与浆体密度项',
      'denominator': '重力与管径项',
      
      // 密度混合公式：ρ_k = 1/(Cw/ρg+(1-Cw)/ρs)，混合项为浓度与密度加权倒数
      'denom': '浓度与密度加权倒数项',
      
      // 达西摩阻系数公式
      'Re': '雷诺数',
      'flow_regime': '流态',
      'eps_D': '相对粗糙度 ε/D',
      
      // 浆体加速流及消能
      'head_diff': '左侧总水头差',
      'friction_loss_total': '右侧摩阻损失 iL',
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
      'numerator': 'V^2 \\cdot \\rho_k',
      'denominator': '2gD \\cdot \\rho_s',
      'denom': '\\frac{C_w}{\\rho_g} + \\frac{1-C_w}{\\rho_s}',
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
        <div className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
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

    return (
      <div className={`flex-[4] overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <div className="max-w-[calc(100vw*4/5)] mx-auto p-6" style={{ maxWidth: 'min(calc(100vw*4/5), 1440px)' }}>
          {/* 顶部：标题 + 关于本软件 横幅 */}
          <div className="mb-8">
            <h1 className={`text-2xl sm:text-3xl font-bold mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
              设置
            </h1>
            <p className={`text-sm mb-5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              管理显示与语言、检查更新、查看声明与反馈方式
            </p>
            <div className={`rounded-xl border-l-4 ${accentBorder} ${darkMode ? 'bg-gray-700/60 border-gray-600' : 'bg-white border-gray-200'} px-5 py-4`}>
              <div className={`font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                长沙院浆体管道计算工具
              </div>
              <div className={`text-sm mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                版本 {currentVersion || '—'} · 长沙有色冶金设计研究院有限公司
              </div>
            </div>
          </div>

          {/* 一、外观与偏好：两列 */}
          <section className="mb-8">
            <h2 className={`${sectionTitleCls} border-l-4 ${accentBorder} pl-3`}>
              外观与偏好
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={cardCls}>
                <h3 className={`text-base font-semibold mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  显示模式
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => onDarkModeChange && onDarkModeChange(false)}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      !darkModeValue ? 'bg-blue-600 text-white shadow' : darkMode ? 'bg-gray-600/80 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span className="font-medium">浅色</span>
                    <span className={`block text-xs mt-0.5 ${!darkModeValue ? 'opacity-90' : 'opacity-70'}`}>日间</span>
                  </button>
                  <button
                    onClick={() => onDarkModeChange && onDarkModeChange(true)}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      darkModeValue ? 'bg-blue-600 text-white shadow' : darkMode ? 'bg-gray-600/80 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span className="font-medium">暗色</span>
                    <span className={`block text-xs mt-0.5 ${darkModeValue ? 'opacity-90' : 'opacity-70'}`}>护眼</span>
                  </button>
                </div>
              </div>
              <div className={cardCls}>
                <h3 className={`text-base font-semibold mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  界面语言
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
              反馈与更新
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={cardCls}>
                <h3 className={`text-base font-semibold mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  建议与反馈
                </h3>
                <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  功能建议、问题反馈或合作意向，欢迎联系开发团队。
                </p>
                <a
                  href={`mailto:xuqianglai@outlook.com?subject=${encodeURIComponent('【长沙院浆体管道计算工具】软件建议与反馈')}&body=${encodeURIComponent(
                    '软件名称：长沙院浆体管道计算工具\n\n建议/反馈类型：□ 功能建议  □ 问题反馈  □ 其他\n\n内容说明：\n\n\n\n'
                  )}`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  联系开发团队
                </a>
              </div>
              {typeof window !== 'undefined' && (window as any).electronAPI?.update ? (
                <div className={cardCls}>
                  <h3 className={`text-base font-semibold mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    应用更新
                  </h3>
                  <div className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    当前版本 <span className="font-semibold text-blue-600">{currentVersion || '—'}</span>
                  </div>
                  <div className="space-y-3">
                    {updateStatus === 'idle' && (
                      <button onClick={handleCheckForUpdates} className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors">
                        检查更新
                      </button>
                    )}
                    {updateStatus === 'checking' && (
                      <div className={`text-center py-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        <span className="inline-block animate-spin mr-2">⟳</span> 正在检查更新...
                      </div>
                    )}
                    {updateStatus === 'available' && updateInfo && (
                      <div className="space-y-3">
                        <div className={`p-3 rounded-lg text-sm ${darkMode ? 'bg-green-900/30 border border-green-700 text-green-300' : 'bg-green-50 border border-green-200 text-green-800'}`}>
                          <div className="font-medium">发现新版本 {updateInfo.version}</div>
                          {updateInfo.releaseNotes && <div className={`mt-1 text-xs ${darkMode ? 'text-green-400' : 'text-green-700'}`}>{updateInfo.releaseNotes}</div>}
                        </div>
                        <button onClick={handleDownloadUpdate} className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors">下载更新</button>
                      </div>
                    )}
                    {updateStatus === 'downloading' && (
                      <div className="space-y-2">
                        <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>正在下载 {updateProgress}%</div>
                        <div className={`w-full h-2 rounded-full overflow-hidden ${darkMode ? 'bg-gray-600' : 'bg-gray-200'}`}>
                          <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${updateProgress}%` }} />
                        </div>
                      </div>
                    )}
                    {updateStatus === 'downloaded' && (
                      <div className="space-y-3">
                        <div className={`p-3 rounded-lg text-sm ${darkMode ? 'bg-green-900/30 border border-green-700 text-green-300' : 'bg-green-50 border border-green-200 text-green-800'}`}>
                          更新已下载，重启后安装
                        </div>
                        <button onClick={handleInstallUpdate} className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors">立即重启并安装</button>
                      </div>
                    )}
                    {updateStatus === 'error' && (
                      <div className="space-y-3">
                        <div className={`p-3 rounded-lg text-sm ${darkMode ? 'bg-red-900/30 border border-red-700 text-red-300' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                          {updateError || '更新检查失败'}
                        </div>
                        <button onClick={handleCheckForUpdates} className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors">重试</button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className={cardCls}>
                  <h3 className={`text-base font-semibold mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    应用版本
                  </h3>
                  <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    当前版本 <span className="font-semibold">{currentVersion || '—'}</span>（浏览器环境下无自动更新）
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 三、法律与声明：两列 */}
          <section>
            <h2 className={`${sectionTitleCls} border-l-4 ${accentBorder} pl-3`}>
              法律与声明
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={cardCls}>
                <h3 className={`text-base font-semibold mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  免责声明
                </h3>
                <div className={`text-sm leading-relaxed space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  <p>本软件所提供的计算公式及计算结果仅供工程设计参考，不构成任何设计依据或保证。实际工程须结合现行规范、现场条件及专业判断综合决策。</p>
                  <p>使用本软件及其结果所产生的任何直接或间接后果，开发与提供方不承担责任。如有疑问，请以现行国家标准、行业规范及有资质单位出具的正式设计文件为准。</p>
                </div>
              </div>
              <div className={cardCls}>
                <h3 className={`text-base font-semibold mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  数据与隐私
                </h3>
                <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  本软件在本地完成计算，不收集、不上传您的输入数据或计算结果。导出 Word 等操作均在您本机完成，不会将内容发送至外部服务器。
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
    
    // B.C.克诺罗兹法每步独立：只校验步骤1 所需参数（K、G、W、ρg），不要求 dp、β
    const paramsToCheck = formula.id === 'kronodze_pressure'
      ? formula.parameters.filter((p) => ['K', 'G', 'W', 'rho_g'].includes(p.name))
      : formula.parameters

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
          timeout: API_TIMEOUT,
          validateStatus: (status) => status >= 200 && status < 300
        }
      )

      // 检查响应类型
      if (response.data instanceof Blob) {
        // 检查是否是错误响应（JSON格式的blob）
        const contentType = response.headers['content-type'] || ''
        if (contentType.includes('application/json')) {
          // 如果是JSON响应，说明是错误
          const text = await response.data.text()
          try {
            const errorData = JSON.parse(text)
            throw new Error(errorData.error || '导出失败')
          } catch (e) {
            if (e instanceof Error && e.message !== '导出失败') {
              throw e
            }
            throw new Error('导出失败：服务器返回错误')
          }
        }
        
        // 创建下载链接
        const url = window.URL.createObjectURL(response.data)
        const link = document.createElement('a')
        link.href = url
        
        // 从响应头获取文件名（包含序号）
        const contentDisposition = response.headers['content-disposition']
        let filename = `长沙院浆体计算_${formula.name.replace(/\s+/g, '')}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}_001.docx`
        
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
          if (filenameMatch && filenameMatch[1]) {
            filename = filenameMatch[1].replace(/['"]/g, '')
            // 处理UTF-8编码的文件名
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
    <div className={`flex-[4] min-h-0 overflow-y-auto ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
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
            {formula.name}：
          </h2>
          
          {/* B.C.克诺罗兹法：简介 + 三步分块，每步为「标题→公式→该步参数输入→计算按钮→结果」 */}
          {formula?.id === 'kronodze_pressure' ? (
            <>
              <p className={`text-xs leading-relaxed mb-6 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                本模型主要用于计算流体输送系统中压力管道的临界流速和摩阻损失，其计算结果可运用于管材和泵选型。该模型适用于：1、有压隧洞泥沙运输，管道内悬浮液处于第一、第二临界流速情况下；2、适用于固体密度小于3、颗粒粒径小于0.4mm的浆体。在重力流管道情况下，该模型的应用价值有限。当体积浓度＞30%时，该模型计算得出的数据与实际情况偏差较大。
              </p>

              {/* 1. 计算矿浆流量：公式 → 本步参数 → 计算 → 结果 */}
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>1. 计算矿浆流量</div>
                <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="Q_k = K \cdot W \cdot \left(\frac{1}{\rho_g}+\frac{G}{W}\right)" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {formula.parameters.filter((p) => ['K', 'G', 'W', 'rho_g'].includes(p.name)).map((param) => (
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
                <button type="button" onClick={() => handleCalculate(false)} disabled={loading} className={`mb-4 px-4 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}>计算</button>
                <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>计算结果：</div>
                <div className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                  {result?.success && result.result?.intermediate?.step_A_Qk != null ? result.result.intermediate.step_A_Qk : result?.error || '—'}
                </div>
                <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>单位 t/h</div>
              </div>

              {/* 2. 计算临界管径：公式(按dp) → 本步参数 → 计算 → 结果 */}
              <div className={`rounded-xl border-2 p-6 mb-6 ${darkMode ? 'bg-gray-800 border-gray-500' : 'bg-white border-gray-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>2. 计算临界管径</div>
                {(() => {
                  const dpRaw = parameters['dp'] ?? rawInputs['dp']
                  const dpNum = typeof dpRaw === 'number' && !isNaN(dpRaw) ? dpRaw : (typeof dpRaw === 'string' ? parseFloat(dpRaw) : NaN)
                  if (dpNum <= 0.07 && !isNaN(dpNum)) {
                    return (
                      <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>当 dp≤0.07 mm：</span>
                        <BlockMath math="Q_k = 0.157\beta \cdot D_L \cdot (1 + 3.434 \cdot \sqrt[4]{C_d \cdot D_L^{0.15}})" />
                        <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>由 Q_k 反解 D_L</div>
                      </div>
                    )
                  }
                  if (dpNum > 0.07 && dpNum <= 0.15) {
                    return (
                      <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>当 0.07&lt;dp≤0.15 mm：</span>
                        <BlockMath math="Q_k = 0.2\beta \cdot D_L \cdot (1 + 2.48 \cdot \sqrt[3]{C_d \cdot \sqrt[4]{D_L}})" />
                        <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>由 Q_k 反解 D_L</div>
                      </div>
                    )
                  }
                  return <div className={`mb-3 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>根据下方输入的 dp 自动选择（dp≤0.07 或 0.07～0.15 mm）</div>
                })()}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {formula.parameters.filter((p) => ['dp', 'beta'].includes(p.name)).map((param) => (
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
                <button type="button" onClick={() => handleCalculate(false)} disabled={loading} className={`mb-4 px-4 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}>计算</button>
                <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>计算结果：</div>
                <div className={`text-lg font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                  {result?.success && result.result?.intermediate?.step_B_DL_mm != null ? `${result.result.intermediate.step_B_DL_mm} mm` : result?.error || '—'}
                </div>
              </div>

              {/* 3. 计算临界流速：公式 → 由步骤1、2结果计算，无额外参数 → 计算 → 结果 + 动画 */}
              <div className={`rounded-xl border-2 p-6 ${darkMode ? 'bg-blue-900 bg-opacity-30 border-blue-600' : 'bg-blue-50 border-blue-300'}`}>
                <div className={`text-lg font-semibold mb-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>3. 计算临界流速</div>
                <div className={`mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <BlockMath math="V_L = 0.255\beta(1+2.48\sqrt[3]{C_d}\sqrt[4]{D_L})" />
                </div>
                <div className={`text-xs mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>由步骤 1、2 的结果及 β 计算，无需额外输入。点击「计算」得到临界流速。</div>
                <button type="button" onClick={() => handleCalculate(false)} disabled={loading} className={`mb-4 px-4 py-2 rounded-lg font-medium ${darkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'} disabled:opacity-50`}>计算</button>
                <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>计算结果：</div>
                <div className={`text-xl font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                  {result?.success && result.result?.Vc !== undefined ? `${result.result.Vc} m/s` : result?.error || '—'}
                </div>
                {result?.success && result.result?.Vc !== undefined && (
                  <button type="button" onClick={() => { if (lockedVc === null) { updateLockedVc(result.result!.Vc ?? null); setAutoCalculateRef(true); } else { updateLockedVc(null); setAutoCalculateRef(false); } }} className={`mt-2 text-xs px-2 py-1 rounded ${lockedVc !== null ? (darkMode ? 'bg-red-900 bg-opacity-50 text-red-300' : 'bg-red-100 text-red-700') : (darkMode ? 'bg-green-900 bg-opacity-50 text-green-300' : 'bg-green-100 text-green-700')}`}>
                    {lockedVc !== null ? '🔒 已锁定' : '🔓 锁定'}
                  </button>
                )}
                {lockedVc !== null && result?.success && result.result?.Vc !== undefined && (() => {
                  const newVc = result.result.Vc
                  const animationType = result.animation_type || 'still-flow'
                  const velocityRatio = result.velocity_ratio ?? (newVc / lockedVc)
                  let statusText: string, bgColor: string, borderColor: string
                  if (animationType === 'settle-30') { statusText = '⚠️ 严重沉降'; bgColor = darkMode ? 'bg-red-900 bg-opacity-30' : 'bg-red-100'; borderColor = darkMode ? 'border-red-600' : 'border-red-300' }
                  else if (animationType === 'settle-20') { statusText = '⚠️ 中度沉降'; bgColor = darkMode ? 'bg-orange-900 bg-opacity-30' : 'bg-orange-100'; borderColor = darkMode ? 'border-orange-600' : 'border-orange-300' }
                  else if (animationType === 'settle-10-flow') { statusText = '⚠️ 轻度沉降'; bgColor = darkMode ? 'bg-yellow-900 bg-opacity-30' : 'bg-yellow-100'; borderColor = darkMode ? 'border-yellow-600' : 'border-yellow-300' }
                  else if (animationType === 'still-flow') { statusText = '⚡ 临界状态'; bgColor = darkMode ? 'bg-blue-900 bg-opacity-30' : 'bg-blue-100'; borderColor = darkMode ? 'border-blue-600' : 'border-blue-300' }
                  else { statusText = '✅ 正常流动'; bgColor = darkMode ? 'bg-green-900 bg-opacity-30' : 'bg-green-100'; borderColor = darkMode ? 'border-green-600' : 'border-green-300' }
                  return (
                    <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-blue-700' : 'border-blue-200'}`}>
                      <div className={`text-xs mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>锁定的临界流速: <span className="font-semibold">{lockedVc} m/s</span></div>
                      <div className={`py-2 px-3 rounded text-xs ${bgColor} border ${borderColor} ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{statusText} — 当前 {newVc} m/s，锁定 {lockedVc} m/s（{(velocityRatio * 100).toFixed(1)}%）</div>
                    </div>
                  )
                })()}
              </div>
            </>
          ) : (
            <>
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
            </>
          )}

          {/* Input Parameters - 非 B.C.克诺罗兹法 时显示统一参数区 */}
          {formula?.id !== 'kronodze_pressure' && (
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

        {/* Results Section - 仅非 B.C.克诺罗兹法 时显示（克诺罗兹法无单独计算结果区） */}
        {formula?.id !== 'kronodze_pressure' && (
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
                    : formula?.id === 'slurry_accel_energy'
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
                    ? '✅ 浆体加速流及消能条件满足'
                    : '❌ 浆体加速流及消能条件不满足')
                  : result?.success && (result.result?.Vc !== undefined || result.result?.i_k !== undefined || result.result?.rho_k !== undefined || result.result?.lambda_coef !== undefined)
                  ? `${result.result?.Vc ?? result.result?.i_k ?? result.result?.rho_k ?? result.result?.lambda_coef} ${result.result?.unit ?? ''}`
                  : result?.error || '—'}
              </div>
              {result?.success && result.result?.condition_met !== undefined && result.result?.intermediate && (
                <div className={`mt-2 text-sm ${
                  darkMode ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  左侧总水头差 (Z₁+H₁)-(Z₂+H₂) = {result.result.intermediate.head_diff} m
                  <br />
                  右侧摩阻损失 iL = {result.result.intermediate.friction_loss_total} m
                  <br />
                  <span className={result.result.condition_met ? 'text-green-600' : 'text-amber-600'}>
                    {(result.result.intermediate.head_diff ?? 0) > (result.result.intermediate.friction_loss_total ?? 0) ? '前者 > 后者' : '前者 ≤ 后者'}
                  </span>
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

            {result?.success && result.result?.intermediate && formula?.id !== 'kronodze_pressure' && (
              <div className={`mt-4 p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
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
        )}

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
