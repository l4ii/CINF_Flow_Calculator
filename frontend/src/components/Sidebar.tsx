import { useMemo } from 'react'
import { FormulaInfo, FlowState } from '../types'
import {
  APP_ORG_NAME_EN,
  APP_TAGLINE_SIDEBAR_EN,
  APP_TAGLINE_SIDEBAR_ZH,
  APP_TAGLINE_SIDEBAR_ZH_LINE1,
  APP_TAGLINE_SIDEBAR_ZH_LINE2,
  APP_TITLE_SIDEBAR_EN,
  APP_TITLE_SIDEBAR_ZH,
} from '../constants/appCopy'

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
  const groupOrder: (keyof FlowState)[] = ['临界流速计算']

  const translations = useMemo(
    () => ({
      zh: {
        appTitle: APP_TITLE_SIDEBAR_ZH,
        appSubtitle: APP_TAGLINE_SIDEBAR_ZH,
        criticalVelocity: '临界流速计算',
        frictionLossParent: '摩阻损失计算',
        pressureHead: '压力与扬程计算',
        slurryAccelEnergy: '加速流与消能计算',
        slurryAccel: '浆体加速流',
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
        noFormulas: '暂无公式（请检查后端连接）',
        noAccelEnergyFormulas: '暂无公式，请重启后端以加载'
      },
      en: {
        appTitle: APP_TITLE_SIDEBAR_EN,
        appSubtitle: APP_TAGLINE_SIDEBAR_EN,
        criticalVelocity: 'Critical Velocity',
        frictionLossParent: 'Friction Loss',
        pressureHead: 'Pressure & Head',
        slurryAccelEnergy: 'Accelerating Flow & Energy Dissipation',
        slurryAccel: 'Slurry Accelerating Flow',
        aboutUs: 'About Us',
        settings: 'Settings',
        cinf: APP_ORG_NAME_EN,
        municipal: 'Municipal Division',
        research: 'Research Innovation Center',
        footerBy: 'By',
        footerDev: 'Municipal Division & Research Innovation Center',
        lightMode: 'Light Mode',
        darkMode: 'Dark Mode',
        language: 'Language',
        chinese: '中文',
        english: 'English',
        noFormulas: 'No formulas available (check backend connection)',
        noAccelEnergyFormulas: 'No formulas available. Restart the backend to reload.'
      }
    }),
    []
  )

  const formulaNameEn: Record<string, string> = {
    liu_dezhong: 'Liu Dezong Formula',
    wasp: 'E.J. Wasp Formula',
    fei_xiangjun: 'Fei Xiangjun Formula',
    kronodze_pressure: 'B.C. Kronodze Method',
    friction_loss: 'Friction Loss',
    density_mixing: 'Density Mixing',
    slurry_friction_loss: 'Slurry Friction Loss',
    slurry_friction_workflow: 'Slurry Friction (5-Step)',
    clear_water_friction_loss: 'Clear Water Friction Loss',
    slurry_total_head: 'Slurry Total Head / Pressure',
    clear_water_total_head: 'Clear Water Total Head / Pressure',
    centrifugal_pump_total_head: 'Centrifugal Pump Total Head',
    positive_displacement_pump_outlet_pressure: 'Positive Displacement Pump Total Head',
    slurry_accel_energy: 'Slurry Accelerating Flow',
    slurry_dissipation: 'Reducer Dissipation',
    slurry_dissipation_orifice: 'Orifice Dissipation',
    slurry_energy_dissipation: 'Slurry Energy Dissipation'
  }

  const t = translations[language]

  const slurryAccelFormula =
    formulas['浆体加速流']?.find((f) => f.id === 'slurry_accel_energy') ?? null

  const dissipationFormulas =
    formulas['浆体消能']?.filter(
      (f) =>
        f.id === 'slurry_dissipation' ||
        f.id === 'slurry_energy_dissipation' ||
        f.id === 'slurry_dissipation_orifice'
    ) ?? []
  const normalizeDissipation = (f: FormulaInfo): FormulaInfo =>
    f.id === 'slurry_energy_dissipation' ? { ...f, id: 'slurry_dissipation' } : f
  const dissipationList = dissipationFormulas.map(normalizeDissipation)
  const dissipationReducer = dissipationList.find((f) => f.id === 'slurry_dissipation') ?? null
  const dissipationOrifice = dissipationList.find((f) => f.id === 'slurry_dissipation_orifice') ?? null

  const btnCls = (active: boolean) =>
    `w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${
      active
        ? 'bg-blue-600 text-white'
        : darkMode
          ? 'text-gray-300 hover:bg-gray-800'
          : 'text-gray-700 hover:bg-gray-100'
    }`

  const clearFrictionList = formulas['清水摩阻损失'] ?? []
  const slurryFrictionList = formulas['浆体摩阻损失'] ?? []
  const pressureHeadList = formulas['压力与扬程'] ?? formulas['总扬程'] ?? []

  const hasAnyFriction = clearFrictionList.length > 0 || slurryFrictionList.length > 0
  const hasAnyFormula =
    (formulas['临界流速计算']?.length ?? 0) > 0 ||
    hasAnyFriction ||
    pressureHeadList.length > 0 ||
    !!slurryAccelFormula ||
    dissipationReducer != null ||
    dissipationOrifice != null

  return (
    <div
      className={`w-[270px] shrink-0 border-r flex flex-col ${
        darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}
    >
      <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="flex items-center space-x-3">
          <img src="./icon.png" alt="CINF Logo" className="w-14 h-14 object-contain" />
          <div>
            <div className={`text-lg font-bold ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
              {t.appTitle}
            </div>
            <div
              className={`text-xs leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
            >
              {language === 'zh' ? (
                <div className="text-right">
                  <div className="block">{APP_TAGLINE_SIDEBAR_ZH_LINE1}</div>
                  <div className="block">{APP_TAGLINE_SIDEBAR_ZH_LINE2}</div>
                </div>
              ) : (
                t.appSubtitle
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="sidebar-scroll flex-1 overflow-y-auto p-3 min-h-0">
        {groupOrder.map((groupKey) => {
          const list = formulas[groupKey] || []
          if (list.length === 0) return null
          return (
            <div key={String(groupKey)} className="mb-4">
              <h2
                className={`text-base font-semibold mb-2 uppercase tracking-wide ${
                  darkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                {t.criticalVelocity}
              </h2>
              <div className="space-y-1 pl-2">
                {list.map((formula) => (
                  <button
                    key={formula.id}
                    onClick={() => onFormulaSelect(formula)}
                    className={btnCls(selectedFormula?.id === formula.id)}
                  >
                    {language === 'en' ? formulaNameEn[formula.id] ?? formula.name : formula.name}
                  </button>
                ))}
              </div>
            </div>
          )
        })}

        {hasAnyFriction ? (
          <div className="mb-4">
            <h2
              className={`text-base font-semibold mb-2 uppercase tracking-wide ${
                darkMode ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              {t.frictionLossParent}
            </h2>
            <div className="space-y-1 pl-2">
              {clearFrictionList.map((formula) => (
                <button
                  key={formula.id}
                  onClick={() => onFormulaSelect(formula)}
                  className={btnCls(selectedFormula?.id === formula.id)}
                >
                  {language === 'en' ? formulaNameEn[formula.id] ?? formula.name : formula.name}
                </button>
              ))}
              {slurryFrictionList.map((formula) => (
                <button
                  key={formula.id}
                  onClick={() => onFormulaSelect(formula)}
                  className={btnCls(selectedFormula?.id === formula.id)}
                >
                  {language === 'en' ? formulaNameEn[formula.id] ?? formula.name : formula.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {pressureHeadList.length > 0 ? (
          <div className="mb-4">
            <h2
              className={`text-base font-semibold mb-2 uppercase tracking-wide ${
                darkMode ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              {t.pressureHead}
            </h2>
            <div className="space-y-1 pl-2">
              {pressureHeadList.map((formula) => (
                <button
                  key={formula.id}
                  onClick={() => onFormulaSelect(formula)}
                  className={btnCls(selectedFormula?.id === formula.id)}
                >
                  {language === 'en' ? formulaNameEn[formula.id] ?? formula.name : formula.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mb-4">
          <h2
            className={`text-base font-semibold mb-2 uppercase tracking-wide ${
              darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}
          >
            {t.slurryAccelEnergy}
          </h2>
          <div className="space-y-1 pl-2">
            <button
              onClick={() => slurryAccelFormula && onFormulaSelect(slurryAccelFormula)}
              disabled={!slurryAccelFormula}
              className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${
                !slurryAccelFormula
                  ? darkMode
                    ? 'text-gray-500 cursor-not-allowed'
                    : 'text-gray-400 cursor-not-allowed'
                  : selectedFormula?.id === slurryAccelFormula.id
                    ? 'bg-blue-600 text-white'
                    : darkMode
                      ? 'text-gray-300 hover:bg-gray-800'
                      : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {t.slurryAccel}
            </button>
            <button
              onClick={() => dissipationOrifice && onFormulaSelect(dissipationOrifice)}
              disabled={!dissipationOrifice}
              className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${
                !dissipationOrifice
                  ? darkMode
                    ? 'text-gray-500 cursor-not-allowed'
                    : 'text-gray-400 cursor-not-allowed'
                  : selectedFormula?.id === 'slurry_dissipation_orifice'
                    ? 'bg-blue-600 text-white'
                    : darkMode
                      ? 'text-gray-300 hover:bg-gray-800'
                      : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {language === 'en' ? formulaNameEn.slurry_dissipation_orifice : '孔板消能'}
            </button>
            <button
              onClick={() => dissipationReducer && onFormulaSelect(dissipationReducer)}
              disabled={!dissipationReducer}
              className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${
                !dissipationReducer
                  ? darkMode
                    ? 'text-gray-500 cursor-not-allowed'
                    : 'text-gray-400 cursor-not-allowed'
                  : selectedFormula?.id === 'slurry_dissipation'
                    ? 'bg-blue-600 text-white'
                    : darkMode
                      ? 'text-gray-300 hover:bg-gray-800'
                      : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {language === 'en' ? formulaNameEn.slurry_dissipation : '缩径消能'}
            </button>
            {!slurryAccelFormula && !dissipationReducer && !dissipationOrifice && (
              <div className={`text-xs py-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {t.noAccelEnergyFormulas}
              </div>
            )}
          </div>
        </div>

        {!hasAnyFormula ? (
          <div className={`text-sm px-2 py-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {t.noFormulas}
          </div>
        ) : null}
      </div>

      <div className={`flex-shrink-0 border-t p-3 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <h2
          className={`text-base font-semibold mb-2 uppercase tracking-wide ${
            darkMode ? 'text-gray-300' : 'text-gray-700'
          }`}
        >
          {t.aboutUs}
        </h2>
        <div className="pl-2 space-y-1 mb-3">
          <button
            onClick={() => onShowAbout('cinf')}
            className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
              currentView === 'about' && aboutDepartment === 'cinf'
                ? 'bg-blue-600 text-white'
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
                ? 'bg-blue-600 text-white'
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
                ? 'bg-blue-600 text-white'
                : darkMode
                  ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            {t.research}
          </button>
        </div>
        <button
          onClick={() => onShowSettings()}
          className={`w-full text-left px-2 py-1.5 rounded-lg text-base font-semibold uppercase tracking-wide transition-colors ${
            currentView === 'settings'
              ? 'bg-blue-600 text-white'
              : darkMode
                ? 'text-gray-300 hover:bg-gray-800'
                : 'text-gray-700 hover:bg-gray-100'
          }`}
        >
          {t.settings}
        </button>
      </div>

      <div className={`border-t p-3 ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
        <div className={`text-sm leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
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
          <div className="mt-1">{t.footerDev}</div>
        </div>
      </div>
    </div>
  )
}
