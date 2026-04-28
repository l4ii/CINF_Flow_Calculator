const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync, spawnSync } = require('child_process')

const root = path.join(__dirname, '..')

/** 与 electron-builder.yml / electron-builder.win7.yml 中 productName 一致，用于 taskkill */
function getPackagedExeName() {
  try {
    const configs = ['electron-builder.yml', 'electron-builder.win7.yml']
    const text = configs
      .map((file) => {
        try {
          return fs.readFileSync(path.join(root, file), 'utf8')
        } catch (_) {
          return ''
        }
      })
      .find((content) => /^productName:\s*(.+)$/m.test(content))
    if (!text) return null
    const m = text.match(/^productName:\s*(.+)$/m)
    if (!m) return null
    let name = m[1].trim()
    if (
      (name.startsWith('"') && name.endsWith('"')) ||
      (name.startsWith("'") && name.endsWith("'"))
    ) {
      name = name.slice(1, -1)
    }
    return `${name}.exe`
  } catch (_) {
    return null
  }
}

/**
 * 结束可执行文件路径位于 win-unpacked 目录下的进程（避免 app.asar 被占用导致 electron-builder 失败）
 */
function killProcessesUnderWinUnpacked(winUnpackedAbs) {
  if (process.platform !== 'win32' || !fs.existsSync(winUnpackedAbs)) return
  const ps1 = [
    'param([Parameter(Mandatory=$true)][string]$Root)',
    '$root = [System.IO.Path]::GetFullPath($Root).TrimEnd([char]92)',
    'foreach ($proc in Get-CimInstance Win32_Process) {',
    '  if (-not $proc.ExecutablePath) { continue }',
    '  try { $ex = [System.IO.Path]::GetFullPath($proc.ExecutablePath) } catch { continue }',
    '  if ($ex.StartsWith($root + [char]92, [StringComparison]::OrdinalIgnoreCase)) {',
    '    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue',
    '  }',
    '}',
  ].join('\n')
  const tmp = path.join(os.tmpdir(), `flow-calc-kill-${process.pid}-${Date.now()}.ps1`)
  fs.writeFileSync(tmp, ps1, 'utf8')
  try {
    spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp, '-Root', path.resolve(winUnpackedAbs)],
      { stdio: 'ignore', windowsHide: true }
    )
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch (_) {}
  }
}

function taskkillPackagedApp() {
  if (process.platform !== 'win32') return
  const exe = getPackagedExeName()
  if (exe) {
    try {
      execSync(`taskkill /f /im "${exe}" 2>nul`, { stdio: 'ignore', windowsHide: true })
    } catch (_) {}
  }
}

function sleepMs(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {}
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return
  fs.readdirSync(dir).forEach((file) => {
    const curPath = path.join(dir, file)
    const stat = fs.lstatSync(curPath)
    if (stat.isDirectory()) removeDir(curPath)
    else try { fs.unlinkSync(curPath) } catch (_) {}
  })
  try { fs.rmdirSync(dir) } catch (_) {}
}

function forceRemoveWin(dir) {
  const full = path.join(root, dir)
  if (!fs.existsSync(full)) return
  const unpacked = path.join(full, 'win-unpacked')
  try {
    execSync('taskkill /f /im electron.exe 2>nul', { stdio: 'ignore', windowsHide: true })
  } catch (_) {}
  taskkillPackagedApp()
  killProcessesUnderWinUnpacked(unpacked)
  sleepMs(400)
  try {
    execSync(`rd /s /q "${full}"`, { stdio: 'ignore', windowsHide: true })
  } catch (e) {
    removeDir(full)
  }
  sleepMs(500)
}

/** 仅删除 release 目录下的 win-unpacked（保留同目录中的安装包等产物） */
function forceRemoveWinUnpackedOnly(relativeReleaseDir) {
  if (process.platform !== 'win32') return
  const unpacked = path.join(root, relativeReleaseDir, 'win-unpacked')
  if (!fs.existsSync(unpacked)) return
  try {
    execSync('taskkill /f /im electron.exe 2>nul', { stdio: 'ignore', windowsHide: true })
  } catch (_) {}
  taskkillPackagedApp()
  killProcessesUnderWinUnpacked(unpacked)
  sleepMs(400)
  try {
    execSync(`rd /s /q "${unpacked}"`, { stdio: 'ignore', windowsHide: true })
  } catch (_) {
    removeDir(unpacked)
  }
  sleepMs(500)
}

function main() {
  const arg = process.argv[2]
  // release: 只清 release；release-win7: 只清 release-win7；frontend: 只清 frontend/dist；legacy: 只清 release-win7+frontend（不动 release）
  const onlyRelease = arg === 'release' || arg === 'release-win7'
  const releaseDir = arg === 'release-win7' ? 'release-win7' : 'release'
  const legacyClean = arg === 'legacy'
  const frontendOnly = arg === 'frontend'

  const toClean = legacyClean
    ? ['release-win7', 'frontend/dist']
    : frontendOnly
      ? ['frontend/dist']
      : onlyRelease
        ? [releaseDir]
        : ['release', 'release-win7', 'frontend/dist']
  toClean.forEach((name) => {
    const dir = path.join(root, name)
    if (!fs.existsSync(dir)) return
    console.log('清理:', dir)
    if (process.platform === 'win32' && (name === 'release' || name === 'release-win7')) forceRemoveWin(name)
    else removeDir(dir)
  })
  console.log('清理完成')
}

if (require.main === module) {
  main()
}

module.exports = {
  forceRemoveWinUnpackedOnly,
  killProcessesUnderWinUnpacked,
  taskkillPackagedApp,
}
