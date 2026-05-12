/**
 * 打包 Win7/8 兼容版：临时切换到 Electron 22，打包后恢复执行前的 Electron 版本
 * 输出目录默认为 release-win7；Qwen 变体见 electron-builder.win7.qwen.yml（→ release-win7-qwen）
 * 需先完成前端构建与（可选）后端打包，再执行本脚本
 */
const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const { forceRemoveWinUnpackedOnly } = require('./clean')

const root = path.join(__dirname, '..')
const packagePath = path.join(root, 'package.json')
const ELECTRON_WIN7 = '22.3.27'
const BUILDER_CONFIG = (process.env.CINF_ELECTRON_BUILDER_CONFIG || 'electron-builder.win7.yml').trim()
/** 与 yml 中 directories.output 一致；可通过环境变量覆盖（dist:win7:ai 使用 release-win7-qwen） */
const WIN7_OUT_DIR = (process.env.CINF_WIN7_OUTPUT_DIR || 'release-win7').trim()
function readPackage() {
  return JSON.parse(fs.readFileSync(packagePath, 'utf8'))
}

function writePackage(pkg) {
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
}

function run(cmd, opts = {}) {
  console.log('>', cmd)
  execSync(cmd, { cwd: root, stdio: 'inherit', windowsHide: true, ...opts })
}

let savedElectron
try {
  const pkg = readPackage()
  savedElectron = pkg.devDependencies && pkg.devDependencies.electron
  if (!savedElectron) {
    console.error('package.json 中未找到 devDependencies.electron')
    process.exit(1)
  }

  console.log('\n[Win7 兼容版] 切换到 Electron', ELECTRON_WIN7, '...')
  console.log('[Win7 兼容版] 使用构建配置:', BUILDER_CONFIG)
  pkg.devDependencies.electron = ELECTRON_WIN7
  writePackage(pkg)

  run('npm install')
  // electron-builder 需重写 win-unpacked\app.asar；若上次解包程序仍在运行会报「文件正由另一进程使用」
  if (process.platform === 'win32') {
    console.log(`[build-win7] 释放 ${WIN7_OUT_DIR}\\win-unpacked（结束可能占用 app.asar 的进程）…`)
    forceRemoveWinUnpackedOnly(WIN7_OUT_DIR)
  }
  run(`npx electron-builder --win --config ${BUILDER_CONFIG}`)

  console.log('\n[Win7 兼容版] 打包完成，恢复 Electron', savedElectron, '...')
  pkg.devDependencies.electron = savedElectron
  writePackage(pkg)
  run('npm install')

  console.log(`\nWin7/8 兼容版已输出到: ${WIN7_OUT_DIR}/`)
} catch (e) {
  if (savedElectron !== undefined) {
    try {
      const pkg = readPackage()
      pkg.devDependencies.electron = savedElectron
      writePackage(pkg)
      run('npm install')
      console.log('已恢复 package.json 中的 Electron 版本')
    } catch (_) {}
  }
  throw e
}
