import { useState, useEffect, useRef } from 'react'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import LicenseActivation from './components/LicenseActivation'
import { FormulaInfo, FlowState } from './types'
import { API_BASE_URL, API_TIMEOUT } from './config/api'
import { APP_TAGLINE_ZH } from './constants/appCopy'

function initialLicenseGate(): 'unknown' | 'ok' | 'blocked' {
  if (typeof window === 'undefined') return 'ok'
  return (window as { electronAPI?: { license?: unknown } }).electronAPI?.license ? 'unknown' : 'ok'
}

function App() {
  const [formulas, setFormulas] = useState<FlowState>({
    临界流速计算: [],
    清水摩阻损失: [],
    浆体摩阻损失: [],
    压力与扬程: [],
    浆体加速流: [],
    浆体消能: []
  })
  const [selectedFormula, setSelectedFormula] = useState<FormulaInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingHint, setLoadingHint] = useState<string | null>(null) // 如「正在连接后端，请稍候…」
  const [error, setError] = useState<string | null>(null)
  const [darkMode, setDarkMode] = useState(false)
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const [currentView, setCurrentView] = useState<'formula' | 'about' | 'settings'>('formula')
  const [aboutDepartment, setAboutDepartment] = useState<string | null>(null)
  const [licenseGate, setLicenseGate] = useState<'unknown' | 'ok' | 'blocked'>(initialLicenseGate)
  const appReadySent = useRef(false)

  useEffect(() => {
    const lic = (window as { electronAPI?: { license?: { getStatus: () => Promise<{ ok: boolean }> } } }).electronAPI?.license
    if (!lic) return
    lic.getStatus().then((s) => {
      setLicenseGate(s.ok ? 'ok' : 'blocked')
    })
  }, [])

  useEffect(() => {
    if (loading || licenseGate === 'unknown') return
    if (appReadySent.current) return
    appReadySent.current = true
    ;(window as { electronAPI?: { appReady?: () => void } }).electronAPI?.appReady?.()
  }, [loading, licenseGate])

  // 从localStorage加载设置
  useEffect(() => {
    const savedDarkMode = localStorage.getItem('darkMode')
    const savedLanguage = localStorage.getItem('language')
    if (savedDarkMode === 'true') setDarkMode(true)
    if (savedLanguage === 'en' || savedLanguage === 'zh') setLanguage(savedLanguage as 'zh' | 'en')
  }, [])

  // 保存设置到localStorage
  useEffect(() => {
    localStorage.setItem('darkMode', darkMode.toString())
  }, [darkMode])

  useEffect(() => {
    localStorage.setItem('language', language)
    // 通知 Electron 主进程切换菜单语言（若在 Electron 环境中）
    if (typeof window !== 'undefined' && (window as any).electronAPI?.setLanguage) {
      ;(window as any).electronAPI.setLanguage(language)
    }
  }, [language])

  // 应用暗色模式到body
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  useEffect(() => {
    fetchFormulas()
  }, [])

  // 科研创新中心配图：启动即预加载缩略图；浏览器空闲后再预加载高清原图，便于列表与放大时命中缓存
  const RESEARCH_PLATFORM_THUMB_URLS = [
    './info1-thumb.jpg',
    './info2-thumb.jpg',
    './info3-thumb.jpg',
    './info4-thumb.jpg',
    './info5-thumb.jpg',
  ] as const
  const RESEARCH_PLATFORM_FULL_URLS = [
    './info1.jpg',
    './info2.jpg',
    './info3.jpg',
    './info4.jpg',
    './info5.jpg',
  ] as const

  useEffect(() => {
    const warm = (urls: readonly string[]) => {
      urls.forEach((src) => {
        const img = new Image()
        img.src = src
      })
    }
    warm(RESEARCH_PLATFORM_THUMB_URLS)
    const runFull = () => warm(RESEARCH_PLATFORM_FULL_URLS)
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(runFull, { timeout: 4000 })
    } else {
      setTimeout(runFull, 1200)
    }
  }, [])

  const MAX_RETRIES = 4
  const RETRY_DELAY_MS = 2500

  const fetchFormulas = async () => {
    setError(null)
    setLoadingHint(null)
    let lastError: any = null
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) {
          setLoadingHint(`正在连接后端，请稍候…（第 ${attempt}/${MAX_RETRIES} 次尝试）`)
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
        }
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)
        const response = await fetch(`${API_BASE_URL}/formulas`, {
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
        })
        clearTimeout(timeoutId)
        if (!response.ok) {
          throw new Error(`后端服务器响应错误: ${response.status} ${response.statusText}`)
        }
        const raw = await response.json()
        const data: FlowState = {}
        const hasSlurryAccel = raw.apiVersion >= 3
          || (raw['浆体加速流及消能'] !== undefined && Array.isArray(raw['浆体加速流及消能']))
          || (raw['浆体加速流'] !== undefined && Array.isArray(raw['浆体加速流']))
          || (raw['浆体消能'] !== undefined && Array.isArray(raw['浆体消能']))
        if (hasSlurryAccel) {
          const combinedFormulas = Array.isArray(raw['浆体加速流及消能']) ? raw['浆体加速流及消能'] : []
          const rawAccelList = Array.isArray(raw['浆体加速流']) ? raw['浆体加速流'].filter((f: any) => f?.id === 'slurry_accel_energy') : []
          const accelFormulas = rawAccelList.length > 0
            ? rawAccelList
            : combinedFormulas.filter((f: any) => f?.id === 'slurry_accel_energy')
          const rawEnergyList = Array.isArray(raw['浆体消能'])
            ? raw['浆体消能'].filter(
                (f: any) =>
                  f?.id === 'slurry_dissipation' ||
                  f?.id === 'slurry_energy_dissipation' ||
                  f?.id === 'slurry_dissipation_orifice'
              )
            : []
          const normalizeDissipation = (f: any) =>
            f?.id === 'slurry_energy_dissipation' ? { ...f, id: 'slurry_dissipation' } : f
          const energyFormulas = rawEnergyList.length > 0
            ? rawEnergyList.map(normalizeDissipation)
            : (() => {
                const fromCombined = combinedFormulas.filter(
                  (f: any) =>
                    f?.id === 'slurry_dissipation' ||
                    f?.id === 'slurry_energy_dissipation' ||
                    f?.id === 'slurry_dissipation_orifice'
                )
                if (fromCombined.length > 0) return fromCombined.map(normalizeDissipation)
                return [{
                  id: 'slurry_dissipation',
                  name: '浆体消能',
                  formula: '步骤1：K_{QL}=((6.3755×10^-9)λ_dL_s)/d^5；步骤2：Δh=K_{QL}Q^2',
                  description: '介绍：该公式是浆体输送工程中一个专用的工程计算式，其核心目的是计算沿程缩径增阻管道的流量消能系数。所谓“沿程缩径增阻管道”，是指在输送线路上，通过人为缩小管径、增加局部阻力来消耗浆体多余能量的管段或装置，例如孔板、文丘里管、锥形缩径段或专门的消能短管。计算出后，即可代入下方基本消能公式，快速求得特定流量下浆体通过该装置时的水头损失（消能量）。这在设计泵送系统、控制管道末端流速与压力、防止管道汽蚀与磨损等方面至关重要。',
                  parameters: [
                    { name: 'lambda_d', label: '$\\lambda_d$：沿程缩径增阻管道达西摩阻系数', unit: '' },
                    { name: 'L_s', label: '$L_s$：沿程缩径增阻管道长度，单位为 m', unit: 'm' },
                    { name: 'd', label: '$d$：消能管径内径，单位为 m', unit: 'm' },
                    { name: 'Q', label: '$Q$：浆体流量，单位为 m³/h', unit: 'm³/h' },
                    { name: 'K_QL', label: '$K_{QL}$：流量消能系数（可直接输入，单位 h²/m⁵）', unit: 'h²/m⁵' }
                  ]
                }]
              })()
          data.临界流速计算 = raw['临界流速计算'] ?? []
          data.清水摩阻损失 = raw['清水摩阻损失'] ?? []
          data.浆体摩阻损失 = raw['浆体摩阻损失'] ?? []
          if (
            (!data.清水摩阻损失?.length && !data.浆体摩阻损失?.length) &&
            (raw['摩阻损失'] || raw['沿程摩阻损失'])
          ) {
            const legacy = [...(raw['摩阻损失'] || raw['沿程摩阻损失'] || [])]
            data.清水摩阻损失 = legacy.filter((f: any) => f?.id === 'clear_water_friction_loss')
            const slurryWf = legacy.find((f: any) => f?.id === 'slurry_friction_workflow')
            if (slurryWf) {
              data.浆体摩阻损失 = [slurryWf]
            } else {
              data.浆体摩阻损失 = legacy.filter((f: any) =>
                ['density_mixing', 'slurry_friction_loss'].includes(f?.id)
              )
            }
          }
          data.压力与扬程 = raw['压力与扬程'] ?? raw['总扬程'] ?? []
          data.浆体加速流 = accelFormulas
          data.浆体消能 = energyFormulas
        } else if (raw['临界流速计算'] || raw['摩阻损失'] || raw['沿程摩阻损失'] || raw['密度混合公式']) {
          data.临界流速计算 = raw['临界流速计算'] ?? []
          const legacyM = [...(raw['摩阻损失'] || raw['沿程摩阻损失'] || []), ...(raw['密度混合公式'] || [])]
          data.清水摩阻损失 = legacyM.filter((f: any) => f?.id === 'clear_water_friction_loss')
          data.浆体摩阻损失 = legacyM.filter((f: any) =>
            ['density_mixing', 'slurry_friction_loss', 'slurry_friction_workflow'].includes(f?.id)
          )
          data.压力与扬程 = raw['压力与扬程'] ?? raw['总扬程'] ?? []
          data.浆体加速流 = []
          data.浆体消能 = []
        } else if (raw['似均质流态'] || raw['非均质流态']) {
          data.临界流速计算 = [...(raw['似均质流态'] || []), ...(raw['非均质流态'] || [])]
          data.清水摩阻损失 = []
          data.浆体摩阻损失 = []
          data.压力与扬程 = []
          data.浆体加速流 = []
          data.浆体消能 = []
        } else {
          throw new Error('后端返回的数据格式不正确')
        }
        // 仅保存公式列表，不自动选择首个公式
        setFormulas(data)
        setLoadingHint(null)
        setLoading(false)
        return
      } catch (err: any) {
        lastError = err
        const isNetworkError =
          err.name === 'AbortError' ||
          err.message?.includes('Failed to fetch') ||
          err.message?.includes('NetworkError') ||
          err.message?.includes('ECONNREFUSED') ||
          err.message?.includes('ERR_CONNECTION_REFUSED')
        if (!isNetworkError || attempt === MAX_RETRIES) {
          setLoading(false)
          setLoadingHint(null)
          if (err.name === 'AbortError') {
            setError(`请求超时（${API_TIMEOUT / 1000}秒）。请检查后端服务是否正常运行。`)
          } else if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
            setError(`无法连接到后端服务器 (${API_BASE_URL})。\n\n请确保：\n1. 后端服务已启动\n2. 运行命令: python backend/app.py\n3. 检查防火墙设置\n\n（Win7 用户若首次连接失败，可点击下方「重试连接」多试几次）`)
          } else {
            setError(`连接错误: ${err.message}`)
          }
          return
        }
      }
    }
    setLoading(false)
    setLoadingHint(null)
    if (lastError) {
      setError(`无法连接到后端服务器 (${API_BASE_URL})。\n\n请确保：\n1. 后端服务已启动\n2. 运行命令: python backend/app.py\n3. 检查防火墙设置\n\n（Win7 用户若首次连接失败，可点击下方「重试连接」多试几次）`)
    }
  }

  const handleFormulaSelect = (formula: FormulaInfo) => {
    setSelectedFormula(formula)
    setCurrentView('formula')
    setAboutDepartment(null) // 清除"了解我们"状态
  }

  const handleShowAbout = (department: string) => {
    setAboutDepartment(department)
    setCurrentView('about')
    setSelectedFormula(null) // 清除公式选择
  }

  const handleShowSettings = () => {
    setCurrentView('settings')
    setSelectedFormula(null) // 清除公式选择
    setAboutDepartment(null) // 清除"了解我们"状态
  }

  const elecLicense = typeof window !== 'undefined' && (window as { electronAPI?: { license?: unknown } }).electronAPI?.license
  const waitingLicense = !!elecLicense && licenseGate === 'unknown'

  if (loading || waitingLicense) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-b from-gray-50 to-white">
        <div className="text-center px-6">
          <div className="mx-auto mb-5 w-20 h-20 rounded-2xl bg-white shadow-md border border-gray-200 flex items-center justify-center">
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
              <rect x="4" y="4" width="36" height="36" rx="10" fill="#2563EB" />
              <path d="M16.3 29V15.1H24.9V17.7H19.4V20.8H24.3V23.3H19.4V29H16.3Z" fill="white"/>
              <path d="M26.4 29V15.1H29.5V26.4H34.9V29H26.4Z" fill="white"/>
            </svg>
          </div>
          <div className="text-lg font-semibold text-gray-800 mb-1">长沙院浆体管道计算工具</div>
          <div className="text-xs text-gray-600 max-w-md mx-auto leading-relaxed mb-2 px-2">
            {APP_TAGLINE_ZH}
          </div>
          <div className="text-sm text-gray-600">
            {waitingLicense && !loading ? '正在验证本机授权…' : loadingHint || '正在连接后端服务器…'}
          </div>
          <div className="mt-4 flex justify-center">
            <div className="h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  if (licenseGate === 'blocked') {
    return <LicenseActivation language={language} onActivated={() => setLicenseGate('ok')} />
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg border border-red-200">
          <div className="text-red-600 font-semibold text-lg mb-3">⚠️ 连接后端失败</div>
          <div className="text-gray-700 text-sm mb-4 whitespace-pre-line">{error}</div>
          <div className="text-gray-600 text-xs mb-4">
            <div className="font-semibold mb-2">解决方法：</div>
            <div>1. 若为安装包安装：请完全关闭本软件后重新打开；若仍失败，请向发布者索取最新安装包并重新安装。</div>
            <div>2. 若为开发运行：在项目目录运行 <code className="bg-gray-100 px-1 rounded">python backend/app.py</code> 启动后端。</div>
          </div>
          <button
            onClick={fetchFormulas}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            重试连接
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex h-screen overflow-hidden ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <Sidebar 
        formulas={formulas}
        selectedFormula={selectedFormula}
        onFormulaSelect={handleFormulaSelect}
        darkMode={darkMode}
        language={language}
        onShowAbout={handleShowAbout}
        onShowSettings={handleShowSettings}
        currentView={currentView}
        aboutDepartment={aboutDepartment}
      />
      <div className="flex-[4] min-w-0 min-h-0 flex flex-col overflow-hidden">
        <MainContent 
          formula={selectedFormula}
          darkMode={darkMode}
          currentView={currentView}
          aboutDepartment={aboutDepartment}
          language={language}
          darkModeValue={darkMode}
          onDarkModeChange={setDarkMode}
          onLanguageChange={setLanguage}
          onLicenseResolved={() => setLicenseGate('ok')}
        />
      </div>
    </div>
  )
}

export default App
