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
  const groupOrder: (keyof FlowState)[] = ['临界流速计算', '沿程摩阻损失', '密度混合公式']

  const translations = useMemo(() => ({
    zh: {
      appTitle: 'CINF浆体计算',
      appSubtitle: '浆体管道计算工具',
      criticalVelocity: '临界流速计算',
      frictionLoss: '沿程摩阻损失',
      densityMixing: '密度混合公式',
      aboutUs: '了解我们',
      settings: '设置',
      cinf: '长沙有色冶金设计研究院有限公司',
      municipal: '长沙院市政事业部',
      research: '长沙院科研创新中心',
      footerBy: '由',
      footerDev: '市政事业部、科研创新中心联合开发',
      lightMode: '浅色显示',
      darkMode: '暗色模式',
      language: '语言调节',
      chinese: '中文',
      english: 'English',
      noFormulas: '暂无公式（请检查后端连接）'
    },
    en: {
      appTitle: 'CINF Slurry Calc',
      appSubtitle: 'Slurry Pipeline Calculation Tool',
      criticalVelocity: 'Critical Velocity',
      frictionLoss: 'Friction Loss',
      densityMixing: 'Density Mixing',
      aboutUs: 'About Us',
      settings: 'Settings',
      cinf: 'Changsha Nonferrous Metallurgical Design & Research Institute Co., Ltd.',
      municipal: 'Municipal Division',
      research: 'Research Innovation Center',
      footerBy: 'By',
      footerDev: 'Municipal Division & Research Innovation Center',
      lightMode: 'Light Mode',
      darkMode: 'Dark Mode',
      language: 'Language',
      chinese: '中文',
      english: 'English',
      noFormulas: 'No formulas available (check backend connection)'
    }
  }), [language])

  const formulaNameEn: Record<string, string> = {
    liu_dezhong: 'Liu Dezong Formula',
    wasp: 'E.J. Wasp Formula',
    fei_xiangjun: 'Fei Xiangjun Formula',
    kronodze_pressure: 'B.C. Konoroz Method',
    friction_loss: 'Friction Loss',
    density_mixing: 'Density Mixing',
  }

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
              {t.appTitle}
            </div>
            <div className={`text-xs ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>
              {t.appSubtitle}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto p-3">
        {groupOrder.map((groupKey) => {
          const list = formulas[groupKey] || []
          if (list.length === 0) return null
          const title =
            groupKey === '临界流速计算'
              ? t.criticalVelocity
              : groupKey === '沿程摩阻损失'
              ? t.frictionLoss
              : t.densityMixing
          return (
            <div key={groupKey} className="mb-4">
              <h2 className={`text-base font-semibold mb-2 uppercase tracking-wide ${
                darkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
                {title}
              </h2>
              <div className="space-y-1 pl-2">
                {list.map((formula) => (
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
                    {language === 'en' ? (formulaNameEn[formula.id] ?? formula.name) : formula.name}
                  </button>
                ))}
              </div>
            </div>
          )
        })}

        {groupOrder.every((k) => !(formulas[k]?.length)) ? (
          <div className={`text-sm px-2 py-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {t.noFormulas}
          </div>
        ) : null}

        {/* 了解我们 */}
        <div className="mt-6 mb-4">
          <h2 className={`text-base font-semibold mb-2 uppercase tracking-wide ${
            darkMode ? 'text-gray-300' : 'text-gray-700'
          }`}>
            {t.aboutUs}
          </h2>
          <div className="pl-2 space-y-1">
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
        <div className="mb-4">
          <button
            onClick={onShowSettings}
            className={`w-full text-left px-2 py-1.5 rounded-lg text-base font-semibold uppercase tracking-wide transition-colors ${
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
          <div className="mb-1">{t.footerBy}</div>
          <a
            href="http://www.cinf.com.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className={`font-medium hover:underline ${
              darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'
            }`}
          >
            {t.cinf}
          </a>
          <div className="mt-1">
            {t.footerDev}
          </div>
        </div>
      </div>
    </div>
  )
}
