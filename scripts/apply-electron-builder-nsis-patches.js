/**
 * electron-builder 自带 NSIS 模板会：
 * 1) installSection.nsh 里 SetDetailsPrint none —— 安装过程不输出“解压缩 xxx”等明细
 * 2) MUI2 安装页默认折叠详情，需点“显示详细信息”（按钮 ID 1027）
 *
 * 本脚本在安装前对 node_modules 内模板做幂等补丁，使安装/卸载页默认展开详情并打印文件级日志。
 */
const fs = require('fs')
const path = require('path')

const MARK_INSTALL = '; [FlowCal] MUI_PAGE_INSTFILES show details'
const MARK_UNINSTALL = '; [FlowCal] MUI_UNPAGE_INSTFILES show details'
const MARK_SECTION = '; [FlowCal] SetDetailsPrint both'

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
  if (s.includes(MARK_INSTALL)) {
    console.log('[apply-nsis-patches] assistedInstaller.nsh 已打过补丁')
    return
  }

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
  // 只替换第一处（安装向导分支里的 InstFiles）
  s = s.replace(needleInstall, blockInstall)

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
  }

  fs.writeFileSync(assistedPath, s, 'utf8')
  console.log('[apply-nsis-patches] 已更新 assistedInstaller.nsh')
}

function patchInstallSection() {
  if (!fs.existsSync(installSectionPath)) {
    console.warn('[apply-nsis-patches] 跳过：未找到', installSectionPath)
    return
  }
  let s = fs.readFileSync(installSectionPath, 'utf8')
  if (s.includes(MARK_SECTION)) {
    console.log('[apply-nsis-patches] installSection.nsh 已打过补丁')
    return
  }
  const old =
    '${IfNot} ${Silent}\n' + '  SetDetailsPrint none\n' + '${endif}'
  const neu =
    MARK_SECTION +
    '\n' +
    '${IfNot} ${Silent}\n' +
    '  SetDetailsPrint both\n' +
    '${endif}'
  if (!s.includes(old)) {
    console.error(
      '[apply-nsis-patches] installSection.nsh 中未找到 SetDetailsPrint none，请检查 app-builder-lib 版本'
    )
    process.exit(1)
  }
  s = s.replace(old, neu)
  fs.writeFileSync(installSectionPath, s, 'utf8')
  console.log('[apply-nsis-patches] 已更新 installSection.nsh')
}

patchAssistedInstaller()
patchInstallSection()
