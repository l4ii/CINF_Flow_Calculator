import { useMemo } from 'react'
import { FormulaInfo, FlowState } from '../types'

interface SidebarProps {
  formulas: FlowState
  selectedFormula: FormulaInfo | null
  onFormulaSelect: (formula: FormulaInfo) => void
  darkMode: boolean
  language: 'zh' | 'en'
  onShowAbout: (department: string) => void
  onShowSettings: () => void
  currentView: 'formula' | 'about' | 'settings'
  aboutDepartment?: string | null
}

export default function Sidebar({ 
  formulas, 
  selectedFormula, 
  onFormulaSelect,
  darkMode,
  language,
  onShowAbout,
  onShowSettings,
  currentView,
  aboutDepartment
}: SidebarProps) {
  const allFormulas = useMemo(() => {
    return [...(formulas.似均质流态 || []), ...(formulas.非均质流态 || [])]
  }, [formulas])

  const translations = useMemo(() => ({
    zh: {
      selectFormula: '选择计算公式',
      aboutUs: '了解我们',
      settings: '设置',
      cinf: '长沙有色冶金设计研究院',
      municipal: '长沙院市政事业部',
      research: '长沙院科研创新中心',
      lightMode: '浅色显示',
      darkMode: '暗色模式',
      language: '语言调节',
      chinese: '中文',
      english: 'English',
      noFormulas: '暂无公式（请检查后端连接）'
    },
    en: {
      selectFormula: 'Select Formula',
      aboutUs: 'About Us',
      settings: 'Settings',
      cinf: 'Changsha Nonferrous Metallurgical Design & Research Institute',
      municipal: 'Municipal Division',
      research: 'Research Innovation Center',
      lightMode: 'Light Mode',
      darkMode: 'Dark Mode',
      language: 'Language',
      chinese: '中文',
      english: 'English',
      noFormulas: 'No formulas available (check backend connection)'
    }
  }), [language])

  const t = translations[language]

  return (
    <div className={`flex-[1] border-r flex flex-col min-w-[200px] max-w-[300px] ${
      darkMode 
        ? 'bg-gray-900 border-gray-700' 
        : 'bg-white border-gray-200'
    }`}>
      {/* Logo */}
      <div className={`p-4 border-b ${
        darkMode ? 'border-gray-700' : 'border-gray-200'
      }`}>
        <div className="flex items-center space-x-3">
          <img 
            src="/icon.png" 
            alt="CINF Logo" 
            className="w-14 h-14 object-contain"
          />
          <div>
            <div className={`text-lg font-bold ${
              darkMode ? 'text-gray-100' : 'text-gray-900'
            }`}>
              CINF浆体计算
            </div>
            <div className={`text-xs ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>
              浆体管道计算工具
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto p-3">
        <h2 className={`text-base font-semibold mb-3 uppercase tracking-wide ${
          darkMode ? 'text-gray-300' : 'text-gray-700'
        }`}>
          {t.selectFormula}
        </h2>

        {allFormulas.length === 0 ? (
          <div className={`text-sm px-2 py-2 ${
            darkMode ? 'text-gray-500' : 'text-gray-400'
          }`}>
            {t.noFormulas}
          </div>
        ) : (
          <div className="space-y-1 pl-2">
            {allFormulas.map((formula) => (
              <button
                key={formula.id}
                onClick={() => onFormulaSelect(formula)}
                className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${
                  selectedFormula?.id === formula.id
                    ? darkMode
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-600 text-white'
                    : darkMode
                    ? 'text-gray-300 hover:bg-gray-800'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {formula.name}
              </button>
            ))}
          </div>
        )}

        {/* 了解我们 */}
        <div className="mt-6">
          <div className={`w-full text-left px-2 py-2 rounded-lg text-sm font-medium ${
            darkMode ? 'text-gray-300' : 'text-gray-700'
          }`}>
            <span>{t.aboutUs}</span>
          </div>
          <div className="mt-2 pl-4 space-y-1">
            <button
              onClick={() => onShowAbout('cinf')}
              className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                currentView === 'about' && aboutDepartment === 'cinf'
                  ? darkMode
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-600 text-white'
                  : darkMode
                  ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {t.cinf}
            </button>
            <button
              onClick={() => onShowAbout('municipal')}
              className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                currentView === 'about' && aboutDepartment === 'municipal'
                  ? darkMode
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-600 text-white'
                  : darkMode
                  ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {t.municipal}
            </button>
            <button
              onClick={() => onShowAbout('research')}
              className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                currentView === 'about' && aboutDepartment === 'research'
                  ? darkMode
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-600 text-white'
                  : darkMode
                  ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {t.research}
            </button>
          </div>
        </div>

        {/* 设置 */}
        <div className="mt-4">
          <button
            onClick={onShowSettings}
            className={`w-full text-left px-2 py-2 rounded-lg text-sm font-medium transition-colors ${
              currentView === 'settings'
                ? darkMode
                  ? 'bg-blue-600 text-white'
                  : 'bg-blue-600 text-white'
                : darkMode
                ? 'text-gray-300 hover:bg-gray-800'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {t.settings}
          </button>
        </div>
      </div>

      {/* Footer Section - 公司信息 */}
      <div className={`border-t p-3 ${
        darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className={`text-sm leading-relaxed ${
          darkMode ? 'text-gray-400' : 'text-gray-600'
        }`}>
          <div className="mb-1">由</div>
          <a
            href="http://www.cinf.com.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className={`font-medium hover:underline ${
              darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'
            }`}
          >
            长沙有色冶金设计研究院有限公司
          </a>
          <div className="mt-1">
            市政事业部、科研创新中心联合开发
          </div>
        </div>
      </div>
    </div>
  )
}
