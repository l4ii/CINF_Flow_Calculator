/**
 * electron-builder 自带 NSIS 模板的幂等补丁，改善安装过程的用户体验：
 *
 *   1) assistedInstaller.nsh：安装页 / 卸载页默认展开详情面板（自动点击按钮 ID 1027）
 *   2) assistedInstaller.nsh：在「选择安装目录」之前插入 customPageBeforeChangeDir，
 *      让 installer.nsh 里的序列号页能嵌到「许可 → 序列号 → 选目录 → 安装」之间
 *   3) installSection.nsh：把底层文件操作日志静音，改为显示几条中文阶段提示
 *      - 顶部 SetDetailsPrint 规范化为 textonly（只显示 DetailPrint 文字，
 *        不显示 `File / CopyFiles / Nsis7z` 插件自身的文件名与错误）
 *      - 「卸载旧版本」期间整段 SetDetailsPrint none，避免 electron-builder
 *        打印 `Uninstall was not successful` / `Can't modify ... files` 等易引起
 *        用户困惑的原始日志
 *      - 「解压程序文件」期间整段 SetDetailsPrint none，让 Nsis7z 插件的重试/
 *        占用提示也不可见；改为单条 `正在解压程序文件...` 稳定文字
 *      - 阶段切换点前先 DetailPrint 中文阶段提示（会同时刷新底部状态栏）
 *
 * 补丁具有严格的幂等性：检测到 v2 标记即跳过；从旧 v1 补丁状态或原始状态都能升级。
 */
const fs = require('fs')
const path = require('path')

const MARK_INSTALL = '; [FlowCal] MUI_PAGE_INSTFILES show details'
const MARK_UNINSTALL = '; [FlowCal] MUI_UNPAGE_INSTFILES show details'
const MARK_BEFORE_DIR = '; [FlowCal] customPageBeforeChangeDir (serial before directory)'
const MARK_SECTION_V2 = '; [FlowCal v2] friendly install stages'

const assistedPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'assistedInstaller.nsh'
)
const installSectionPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'installSection.nsh'
)

function patchAssistedInstaller() {
  if (!fs.existsSync(assistedPath)) {
    console.warn('[apply-nsis-patches] 跳过：未找到', assistedPath)
    return
  }
  let s = fs.readFileSync(assistedPath, 'utf8')
  let changed = false

  if (!s.includes(MARK_INSTALL)) {
    const blockInstall =
      '\n  ' +
      MARK_INSTALL +
      '\n  !define MUI_PAGE_CUSTOMFUNCTION_SHOW FlowCalMuiInstFilesShow\n' +
      '  Function FlowCalMuiInstFilesShow\n' +
      '    FindWindow $R9 "#32770" "" $HWNDPARENT\n' +
      '    GetDlgItem $R8 $R9 1027\n' +
      '    IntCmp $R8 0 FlowCalSkipInstClick\n' +
      '    SendMessage $R8 0xF5 0 0\n' +
      '    FlowCalSkipInstClick:\n' +
      '  FunctionEnd\n' +
      '\n  !insertmacro MUI_PAGE_INSTFILES'

    const needleInstall = '\n  !insertmacro MUI_PAGE_INSTFILES'
    if (!s.includes(needleInstall)) {
      console.error('[apply-nsis-patches] 无法定位 MUI_PAGE_INSTFILES，请检查 app-builder-lib 版本')
      process.exit(1)
    }
    s = s.replace(needleInstall, blockInstall)
    changed = true
  }

  if (!s.includes(MARK_UNINSTALL)) {
    const blockUn =
      '\n  ' +
      MARK_UNINSTALL +
      '\n  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.FlowCalMuiUnInstFilesShow\n' +
      '  Function un.FlowCalMuiUnInstFilesShow\n' +
      '    FindWindow $R9 "#32770" "" $HWNDPARENT\n' +
      '    GetDlgItem $R8 $R9 1027\n' +
      '    IntCmp $R8 0 FlowCalSkipUnClick\n' +
      '    SendMessage $R8 0xF5 0 0\n' +
      '    FlowCalSkipUnClick:\n' +
      '  FunctionEnd\n' +
      '\n  !insertmacro MUI_UNPAGE_INSTFILES'
    const needleUn = '\n  !insertmacro MUI_UNPAGE_INSTFILES'
    if (!s.includes(needleUn)) {
      console.error('[apply-nsis-patches] 无法定位 MUI_UNPAGE_INSTFILES')
      process.exit(1)
    }
    s = s.replace(needleUn, blockUn)
    changed = true
  }

  if (!s.includes(MARK_BEFORE_DIR)) {
    const needleBeforeDir =
      '  !ifndef INSTALL_MODE_PER_ALL_USERS\n' +
      '    !insertmacro PAGE_INSTALL_MODE\n' +
      '  !endif\n' +
      '\n' +
      '  !ifdef allowToChangeInstallationDirectory'
    const blockBeforeDir =
      '  !ifndef INSTALL_MODE_PER_ALL_USERS\n' +
      '    !insertmacro PAGE_INSTALL_MODE\n' +
      '  !endif\n' +
      '\n' +
      '  ' +
      MARK_BEFORE_DIR +
      '\n' +
      '  !ifmacrodef customPageBeforeChangeDir\n' +
      '    !insertmacro customPageBeforeChangeDir\n' +
      '  !endif\n' +
      '\n' +
      '  !ifdef allowToChangeInstallationDirectory'
    if (!s.includes(needleBeforeDir)) {
      console.error(
        '[apply-nsis-patches] 无法定位 PAGE_INSTALL_MODE / allowToChangeInstallationDirectory，请检查 app-builder-lib 版本'
      )
      process.exit(1)
    }
    s = s.replace(needleBeforeDir, blockBeforeDir)
    changed = true
  }

  if (changed) {
    fs.writeFileSync(assistedPath, s, 'utf8')
    console.log('[apply-nsis-patches] 已更新 assistedInstaller.nsh')
  } else {
    console.log('[apply-nsis-patches] assistedInstaller.nsh 无需更新（已含全部补丁）')
  }
}

/**
 * 对 installSection.nsh 做"友好阶段提示"补丁（v2）。
 * 做 4 个改动：
 *   [A] 顶部 SetDetailsPrint 规范化为 textonly（同时兼容 v1 的 `both` / 原始的 `none`）
 *   [B] 卸载旧版本前：DetailPrint 中文 + 整段 SetDetailsPrint none
 *   [C] 解压程序文件前：DetailPrint 中文 + 整段 SetDetailsPrint none
 *   [D] 写注册表/快捷方式前：DetailPrint 中文 + 恢复 SetDetailsPrint textonly
 */
function patchInstallSection() {
  if (!fs.existsSync(installSectionPath)) {
    console.warn('[apply-nsis-patches] 跳过：未找到', installSectionPath)
    return
  }
  let s = fs.readFileSync(installSectionPath, 'utf8')

  if (s.includes(MARK_SECTION_V2)) {
    console.log('[apply-nsis-patches] installSection.nsh 已打过 v2 补丁')
    return
  }

  // ---- [A] 规范化顶部的 SetDetailsPrint 块 ----
  // 可能的状态：
  //   · 原始：        `${IfNot} ${Silent}\n  SetDetailsPrint none\n${endif}`
  //   · v1 补丁：     `; [FlowCal] SetDetailsPrint both\n${IfNot} ${Silent}\n  SetDetailsPrint both\n${endif}`
  // 一律替换为 v2 形态：
  //   `; [FlowCal v2] friendly install stages\n${IfNot} ${Silent}\n  SetDetailsPrint textonly\n${endif}`
  const topRegex =
    /(?:; \[FlowCal\] SetDetailsPrint both\r?\n)?\$\{IfNot\} \$\{Silent\}\r?\n\s*SetDetailsPrint (?:none|both|textonly)\r?\n\$\{endif\}/
  const topReplacement =
    MARK_SECTION_V2 +
    '\n${IfNot} ${Silent}\n  SetDetailsPrint textonly\n${endif}'
  if (!topRegex.test(s)) {
    console.error(
      '[apply-nsis-patches] installSection.nsh 未找到顶部 SetDetailsPrint 块，请检查 app-builder-lib 版本'
    )
    process.exit(1)
  }
  s = s.replace(topRegex, topReplacement)

  // ---- [B] 卸载旧版本前：静音底层日志，仅显示"正在清理旧版本..."
  const uninstallAnchor = '!insertmacro uninstallOldVersion SHELL_CONTEXT'
  const uninstallBlock =
    '; [FlowCal v2] stage: clean old version\n' +
    '${IfNot} ${Silent}\n' +
    '  DetailPrint "正在清理旧版本（如有）..."\n' +
    '  SetDetailsPrint none\n' +
    '${endif}\n' +
    uninstallAnchor
  if (s.indexOf(uninstallAnchor) === -1) {
    console.error('[apply-nsis-patches] installSection.nsh 未找到 uninstallOldVersion，请检查 app-builder-lib 版本')
    process.exit(1)
  }
  // 只替换第一处（另外两处可能在条件分支内）
  s = s.replace(uninstallAnchor, uninstallBlock)

  // ---- [C] 解压程序文件前：静音底层日志，仅显示"正在解压程序文件..."
  // 锚点为 `SetOutPath $INSTDIR`（installApplicationFiles 之前的固定句）
  const extractAnchor = 'SetOutPath $INSTDIR\n\n!ifdef UNINSTALLER_ICON'
  const extractBlock =
    '; [FlowCal v2] stage: extract program files\n' +
    '${IfNot} ${Silent}\n' +
    '  SetDetailsPrint textonly\n' +
    '  DetailPrint "正在解压程序文件..."\n' +
    '  SetDetailsPrint none\n' +
    '${endif}\n' +
    'SetOutPath $INSTDIR\n\n!ifdef UNINSTALLER_ICON'
  if (s.indexOf(extractAnchor) === -1) {
    console.error('[apply-nsis-patches] installSection.nsh 未找到 SetOutPath $INSTDIR / UNINSTALLER_ICON 锚点')
    process.exit(1)
  }
  s = s.replace(extractAnchor, extractBlock)

  // ---- [D] 写注册表/快捷方式前：恢复 textonly，显示"正在配置注册信息与快捷方式..."
  const registryAnchor = '!insertmacro registryAddInstallInfo'
  const registryBlock =
    '; [FlowCal v2] stage: registry & shortcuts\n' +
    '${IfNot} ${Silent}\n' +
    '  SetDetailsPrint textonly\n' +
    '  DetailPrint "正在配置注册信息与快捷方式..."\n' +
    '${endif}\n' +
    registryAnchor
  if (s.indexOf(registryAnchor) === -1) {
    console.error('[apply-nsis-patches] installSection.nsh 未找到 registryAddInstallInfo 锚点')
    process.exit(1)
  }
  s = s.replace(registryAnchor, registryBlock)

  fs.writeFileSync(installSectionPath, s, 'utf8')
  console.log('[apply-nsis-patches] 已更新 installSection.nsh（v2 friendly stages）')
}

patchAssistedInstaller()
patchInstallSection()
