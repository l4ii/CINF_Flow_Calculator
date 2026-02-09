import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import { FormulaInfo, FlowState } from './types'
import { API_BASE_URL, API_TIMEOUT } from './config/api'

function App() {
  const [formulas, setFormulas] = useState<FlowState>({
    似均质流态: [],
    非均质流态: []
  })
  const [selectedFormula, setSelectedFormula] = useState<FormulaInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [darkMode, setDarkMode] = useState(false)
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const [currentView, setCurrentView] = useState<'formula' | 'about' | 'settings'>('formula')
  const [aboutDepartment, setAboutDepartment] = useState<string | null>(null)

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

  const fetchFormulas = async () => {
    try {
      setError(null)
      
      // 使用AbortController实现超时控制
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)
      
      const response = await fetch(`${API_BASE_URL}/formulas`, {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        }
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        throw new Error(`后端服务器响应错误: ${response.status} ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // 检查数据是否有效
      if (!data || (!data['似均质流态'] && !data['非均质流态'])) {
        throw new Error('后端返回的数据格式不正确')
      }
      
      setFormulas(data)
      
      // 默认选择第一个公式
      if (data['似均质流态'] && data['似均质流态'].length > 0) {
        setSelectedFormula(data['似均质流态'][0])
      }
    } catch (error: any) {
      console.error('获取公式列表失败:', error)
      if (error.name === 'AbortError') {
        setError(`请求超时（${API_TIMEOUT / 1000}秒）。请检查后端服务是否正常运行。`)
      } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        setError(`无法连接到后端服务器 (${API_BASE_URL})。\n\n请确保：\n1. 后端服务已启动\n2. 运行命令: python backend/app.py\n3. 检查防火墙设置`)
      } else {
        setError(`连接错误: ${error.message}`)
      }
    } finally {
      setLoading(false)
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="text-lg text-gray-600 mb-2">加载中...</div>
          <div className="text-sm text-gray-500">正在连接后端服务器...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg border border-red-200">
          <div className="text-red-600 font-semibold text-lg mb-3">⚠️ 连接后端失败</div>
          <div className="text-gray-700 text-sm mb-4 whitespace-pre-line">{error}</div>
          <div className="text-gray-600 text-xs mb-4">
            <div className="font-semibold mb-2">解决方法：</div>
            <div>1. 确保后端服务已启动</div>
            <div>2. 在终端运行: <code className="bg-gray-100 px-1 rounded">python backend/app.py</code></div>
            <div>3. 检查后端是否运行在: <code className="bg-gray-100 px-1 rounded">{API_BASE_URL}</code></div>
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
    <div className={`flex h-screen ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
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
      <MainContent 
        formula={selectedFormula}
        darkMode={darkMode}
        currentView={currentView}
        aboutDepartment={aboutDepartment}
        language={language}
        darkModeValue={darkMode}
        onDarkModeChange={setDarkMode}
        onLanguageChange={setLanguage}
      />
    </div>
  )
}

export default App
