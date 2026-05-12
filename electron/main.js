const { app, BrowserWindow, dialog, ipcMain, nativeImage, Menu } = require('electron')
const path = require('path')
const http = require('http')
const { spawn, execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const { autoUpdater } = require('electron-updater')
const license = require('./license')

/**
 * 打包后固定 userData 目录，避免 package name / productName 与 Electron 默认规则变化时，
 * 应用更新后 userData 路径漂移导致读不到 offline-license.dat、反复要求激活。
 * 若稳定目录尚无许可文件，则从当前默认路径及历史常见目录名尝试复制一份。
 */
function prepareStableUserDataPath() {
  if (!app.isPackaged) return
  const appData = app.getPath('appData')
  const stableDir = path.join(appData, 'CINF_FlowCalc')
  const licenseFile = license.LICENSE_BASENAME

  const legacyDirs = new Set()
  try {
    legacyDirs.add(app.getPath('userData'))
  } catch (_) {
    /* ignore */
  }
  for (const folderName of ['flow-calculation-tool', '长沙院浆体管道计算工具', 'CINF长沙院浆体计算软件']) {
    legacyDirs.add(path.join(appData, folderName))
  }

  const destLicense = path.join(stableDir, licenseFile)
  if (!fs.existsSync(destLicense)) {
    for (const dir of legacyDirs) {
      if (!dir) continue
      if (path.resolve(dir) === path.resolve(stableDir)) continue
      const src = path.join(dir, licenseFile)
      if (fs.existsSync(src)) {
        try {
          fs.mkdirSync(stableDir, { recursive: true })
          fs.copyFileSync(src, destLicense)
        } catch (e) {
          console.error('离线许可迁移失败:', e)
        }
        break
      }
    }
  }

  try {
    app.setPath('userData', stableDir)
  } catch (e) {
    console.error('setPath userData 失败:', e)
  }
}

prepareStableUserDataPath()

// 减轻 Windows 下缓存目录权限导致的 ERROR: Unable to move the cache / Gpu Cache Creation failed
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  app.commandLine.appendSwitch('disable-application-cache')
  const cacheDir = path.join(app.getPath('userData'), 'Cache')
  try {
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
    app.commandLine.appendSwitch('disk-cache-dir', cacheDir)
  } catch (e) {
    // 忽略，使用默认缓存路径
  }
}

let mainWindow
let backendProcess
let splashWindow

// 判断是否为开发环境
// 仅根据是否打包判断：打包后的 exe 始终为生产模式，避免“打开软件就进 dev 模式”
const isDev = !app.isPackaged
const APP_DISPLAY_NAME = 'CINF长沙院浆体计算软件'

function parseEnvBool(raw) {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (!v) return null
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return null
}

function resolveLocalAiDeploymentEnabled() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      if (typeof pkg.cinfAssistantLocalDeploy === 'boolean') {
        return pkg.cinfAssistantLocalDeploy
      }
    }
  } catch (_) {
    /* ignore and fallback */
  }
  const envPreferred =
    parseEnvBool(process.env.CINF_ASSISTANT_LOCAL_DEPLOYMENT) ??
    parseEnvBool(process.env.CINF_PACK_LOCAL_AI)
  if (envPreferred !== null) return envPreferred
  return true
}

const LOCAL_AI_DEPLOYMENT_ENABLED = resolveLocalAiDeploymentEnabled()

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// 顶部菜单当前语言（默认中文，由渲染进程切换）
let currentLanguage = 'zh'

function buildAppMenu() {
  const zh = [
    {
      label: '文件',
      submenu: [
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '切换开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭窗口' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { role: 'about', label: '关于' }
      ]
    }
  ]

  const en = [
    {
      label: 'File',
      submenu: [
        { role: 'quit', label: 'Quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Reset Zoom' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Minimize' },
        { role: 'close', label: 'Close Window' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { role: 'about', label: 'About' }
      ]
    }
  ]

  if (!isDev) {
    zh[2].submenu = zh[2].submenu.filter((item) => item.role !== 'toggleDevTools')
    en[2].submenu = en[2].submenu.filter((item) => item.role !== 'toggleDevTools')
  }

  const template = currentLanguage === 'en' ? en : zh
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// 获取资源路径（开发环境和生产环境不同）
function getResourcePath(...paths) {
  if (isDev) {
    return path.join(__dirname, '..', ...paths)
  } else {
    return path.join(process.resourcesPath, ...paths)
  }
}

function resolveAppIconPath() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const candidates = isDev
    ? [path.join(__dirname, 'build', iconName)]
    : [getResourcePath('build', iconName), path.join(process.resourcesPath, 'app.asar.unpacked', 'build', iconName)]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

// 创建启动页（Splash Screen）窗口：点击图标后立即展示
function createSplashWindow() {
  try {
    splashWindow = new BrowserWindow({
      width: 520,
      height: 320,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      backgroundColor: '#FFFFFF',
      show: false,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    const splashPath = path.join(__dirname, 'splash.html')
    // 启动页图标（优先用 build/icon.ico）
    const splashIconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
    const splashIconCandidates = isDev
      ? [path.join(__dirname, 'build', splashIconName)]
      : [getResourcePath('build', splashIconName), path.join(process.resourcesPath, 'app.asar.unpacked', 'build', splashIconName)]
    let splashIconPath = ''
    for (const p of splashIconCandidates) {
      if (p && fs.existsSync(p)) { splashIconPath = p; break }
    }
    // 将 icon.ico 转为 png dataURL，避免 <img> 对 .ico 的兼容性问题
    let splashIconPngDataUrl = ''
    if (splashIconPath) {
      try {
        const img = nativeImage.createFromPath(splashIconPath)
        const png = img && !img.isEmpty() ? img.toPNG() : null
        if (png && png.length) splashIconPngDataUrl = `data:image/png;base64,${png.toString('base64')}`
      } catch (_) {}
    }

    if (fs.existsSync(splashPath)) {
      splashWindow.loadFile(splashPath, {
        query: {
          iconPng: splashIconPngDataUrl,
          name: APP_DISPLAY_NAME,
        }
      })
    } else {
      const fallbackSplashHtml = encodeURIComponent(
        '<!doctype html><html><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Noto Sans SC,Microsoft YaHei,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#475569;">正在启动，请稍候...</body></html>'
      )
      splashWindow.loadURL(`data:text/html;charset=utf-8,${fallbackSplashHtml}`)
    }

    splashWindow.once('ready-to-show', () => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show()
    })

    splashWindow.on('closed', () => {
      splashWindow = null
    })
  } catch (e) {
    splashWindow = null
  }
}

/** Win7 内核为 6.1.x；Win10/11 为 10.0.x。旧系统上 PyInstaller 用新版 Python 打的 exe 可能无法加载。 */
function isWindows7KernelOrOlder() {
  if (process.platform !== 'win32') return false
  const parts = (os.release() || '').split('.')
  const major = parseInt(parts[0], 10) || 0
  const minor = parseInt(parts[1], 10) || 0
  if (major < 6) return true
  if (major === 6 && minor <= 1) return true
  return false
}

// 查找打包的 Python 后端可执行文件或系统 Python
function findBackendExecutable() {
  // 生产环境：优先策略随系统内核变化（见下方注释）
  if (!isDev) {
    const bundledPython = getResourcePath('backend', 'python38', 'python.exe')
    // 注意顺序：onedir（dist/backend/backend.exe）必须优先于 onefile（dist/backend.exe）。
    // 若两种产物同时存在，否则会一直跑 onefile（Temp\_MEI*），与「已改为 onedir 打包」的预期不一致。
    const possibleExePaths = [
      getResourcePath('backend', 'dist', 'backend', 'backend.exe'),
      getResourcePath('backend', 'dist', 'backend.exe'),
      getResourcePath('backend', 'backend.exe'),
    ]

    // 始终优先 PyInstaller 打包的 backend（含 Flask 与 llama_cpp）；安装包不再分发 .py 源码。
    // Win7：若系统无法运行该 exe，再回退内置 Python 3.8（仅当安装包仍带 app.py 时可用；现以 exe 为主）。
    const tryWin7Order = isWindows7KernelOrOlder()

    for (const exePath of possibleExePaths) {
      if (fs.existsSync(exePath)) {
        console.log('找到打包的后端可执行文件:', exePath)
        return exePath
      }
    }

    if (tryWin7Order && fs.existsSync(bundledPython)) {
      console.log('Win7/旧内核：未找到 backend.exe，尝试内置 Python 3.8（无 app.py 时无法启动，请重新打包并包含 dist/backend.exe）:', bundledPython)
      return bundledPython
    }

    if (!tryWin7Order && fs.existsSync(bundledPython)) {
      console.log('未找到 backend.exe，回退内置 Python 3.8:', bundledPython)
      return bundledPython
    }

    console.log('未找到内置 Python 或打包的后端可执行文件，将尝试使用系统Python')
  }

  // 先尝试当前进程 PATH 中的 python（开发环境或终端里装的通常能拿到）
  const pythonCommands = ['python3', 'python']
  for (const cmd of pythonCommands) {
    try {
      const result = execSync(`${cmd} --version`, { encoding: 'utf-8' })
      if (result) {
        console.log('使用系统Python:', cmd)
        return cmd
      }
    } catch (e) {
      // 继续尝试下一个
    }
  }

  // Windows：写死的常见安装路径 + 从用户环境 PATH 里找（解决从快捷方式启动时 PATH 不全的问题）
  if (process.platform === 'win32') {
    const u = os.userInfo().username
    const localAppData = process.env.LOCALAPPDATA || `C:\\Users\\${u}\\AppData\\Local`
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const commonPaths = [
      'C:\\Python313\\python.exe', 'C:\\Python312\\python.exe', 'C:\\Python311\\python.exe',
      'C:\\Python310\\python.exe', 'C:\\Python39\\python.exe', 'C:\\Python38\\python.exe',
      `${programFiles}\\Python313\\python.exe`, `${programFiles}\\Python312\\python.exe`,
      `${programFiles}\\Python311\\python.exe`, `${programFiles}\\Python310\\python.exe`,
      `${localAppData}\\Programs\\Python\\Python313\\python.exe`,
      `${localAppData}\\Programs\\Python\\Python312\\python.exe`,
      `${localAppData}\\Programs\\Python\\Python311\\python.exe`,
      `${localAppData}\\Programs\\Python\\Python310\\python.exe`,
      `C:\\Users\\${u}\\AppData\\Local\\Programs\\Python\\Python311\\python.exe`,
      `C:\\Users\\${u}\\AppData\\Local\\Programs\\Python\\Python312\\python.exe`,
      `C:\\Users\\${u}\\AppData\\Local\\Programs\\Python\\Python310\\python.exe`,
    ]
    for (const pythonPath of commonPaths) {
      if (fs.existsSync(pythonPath)) {
        console.log('找到Python:', pythonPath)
        return pythonPath
      }
    }
    // 打包且从快捷方式启动时，process.env.PATH 常不包含用户 PATH，从注册表读用户 Path 再在目录里找 python.exe
    if (!isDev) {
      try {
        const pathStr = execSync(
          'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"',
          { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
        )
        const dirs = (pathStr || '').trim().split(';').filter(Boolean)
        for (const dir of dirs) {
          const exe = path.join(dir.trim(), 'python.exe')
          if (fs.existsSync(exe)) {
            console.log('从用户 PATH 找到 Python:', exe)
            return exe
          }
        }
      } catch (e) {
        console.warn('读取用户 PATH 查找 Python 时出错:', e.message)
      }
    }
  }

  return null
}

function isManagedBackendPid(pid) {
  if (process.platform !== 'win32') return false
  try {
    const out = execSync(`wmic process where processid=${pid} get CommandLine,ExecutablePath /format:list`, {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000,
    })
    const text = String(out || '').toLowerCase().replace(/\//g, '\\')
    const resourceRoot = (!isDev ? process.resourcesPath : path.join(__dirname, '..')).toLowerCase().replace(/\//g, '\\')
    const backendRoot = getResourcePath('backend').toLowerCase().replace(/\//g, '\\')
    const isBackendCmd = text.includes('backend.exe') || text.includes('backend\\app.py') || text.includes('backend\\\\app.py')
    return isBackendCmd && (text.includes(resourceRoot) || text.includes(backendRoot))
  } catch (e) {
    console.warn('[后端] 无法确认 5000 端口进程归属，跳过结束 PID:', pid, e.message)
    return false
  }
}

// Windows：仅结束本应用旧后端占用的 5000 端口，避免误杀其它本机服务
function killProcessOnPort5000() {
  if (process.platform !== 'win32') return []
  const unmanagedPids = []
  try {
    const out = execSync('netstat -ano', { encoding: 'utf-8', windowsHide: true })
    const lines = out.split(/\r?\n/)
    const pids = new Set()
    for (const line of lines) {
      if (!line.includes(':5000') || !line.includes('LISTENING')) continue
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid)
    }
    for (const pid of pids) {
      if (!isManagedBackendPid(pid)) {
        unmanagedPids.push(pid)
        console.warn('[后端] 5000 端口被非本应用进程占用，未结束 PID:', pid)
        continue
      }
      try {
        // /T: kill process tree, avoid child still listening
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true })
        console.log('[后端] 已结束占用 5000 端口的进程 PID:', pid)
      } catch (e) { /* 可能已退出 */ }
    }
  } catch (e) {
    console.warn('[后端] 检查/结束 5000 端口进程时出错:', e.message)
  }
  return unmanagedPids
}

/** Werkzeug/Flask 启动信息多在 stderr；PyInstaller --noconsole 时子进程可能几乎无输出，不能只靠日志判断就绪 */
function looksLikeBackendListenLog(chunk) {
  const s = String(chunk)
  return s.includes('Running on') || s.includes('127.0.0.1:5000')
}

/**
 * 轮询 http://127.0.0.1:5000/api/formulas，确认后端真正可响应（Win7 + 机械盘 + onefile 解压往往远超 4s）
 */
function waitForBackendHttpReady(maxMs, intervalMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tryOnce = () => {
      if (Date.now() - t0 > maxMs) {
        reject(
          new Error(
            `后端在 ${Math.round(maxMs / 1000)} 秒内未就绪（127.0.0.1:5000 无响应）。若使用 Win7 或较慢硬盘，请稍候再启动；也可检查防火墙/杀毒是否拦截 Python 或本程序。`
          )
        )
        return
      }
      const req = http.get('http://127.0.0.1:5000/api/formulas', { timeout: 3000 }, (res) => {
        res.resume()
        if (res.statusCode === 200) resolve()
        else setTimeout(tryOnce, intervalMs)
      })
      req.on('error', () => setTimeout(tryOnce, intervalMs))
      req.on('timeout', () => {
        try {
          req.destroy()
        } catch (_) {}
        setTimeout(tryOnce, intervalMs)
      })
    }
    tryOnce()
  })
}

// 启动后端服务器
function startBackend() {
  return new Promise((resolve, reject) => {
    // 仅释放本应用旧后端占用的 5000 端口；遇到其它服务时直接提示，避免误连或误杀。
    const unmanagedPids = killProcessOnPort5000()
    if (unmanagedPids.length > 0) {
      reject(new Error(`5000 端口已被非本应用进程占用（PID: ${unmanagedPids.join(', ')}）。请关闭该服务或释放端口后重试。`))
      return
    }
    // 给系统一点时间释放端口，再启动后端，减少“端口仍被占用”的误判
    const delayBeforeSpawn = process.platform === 'win32' ? 800 : 400

    const pollMaxMs = isDev
      ? 20000
      : isWindows7KernelOrOlder()
        ? 120000
        : 60000
    const pollIntervalMs = isWindows7KernelOrOlder() ? 600 : 400

    function doSpawn() {
    const backendCmd = findBackendExecutable()
    
    if (!backendCmd) {
      reject(new Error('未找到 Python 或打包的后端。从快捷方式启动时系统可能未加载您的 PATH。\n\n建议：\n1) 用 start.bat 启动（与安装包同目录）；\n2) 或先打包后端再安装：在项目目录运行 npm run dist:win:full 后重新安装。'))
      return
    }
    
    // 与 start.bat 一致：start.bat 在项目根目录执行 python backend/app.py，工作目录为项目根
    const appRoot = getResourcePath()
    const backendDir = getResourcePath('backend')
    let backendProcessArgs = []
    const useShell = false

    // 仅 backend.exe 直接运行；内置 python38 或系统 Python 均用 python app.py 运行
    const isBackendExe = backendCmd.replace(/\\/g, '/').endsWith('backend.exe')
    if (isBackendExe) {
      console.log(`启动打包的后端可执行文件: ${backendCmd}`)
      backendProcessArgs = []
    } else {
      // 使用系统 Python 运行 app.py，与 start.bat 一致：cwd 为项目根，参数为 backend/app.py
      const backendPath = getResourcePath('backend', 'app.py')
      if (!fs.existsSync(backendPath)) {
        reject(new Error(`后端文件不存在: ${backendPath}`))
        return
      }
      console.log(`使用系统 Python 启动后端: ${backendCmd} ${backendPath}`)
      backendProcessArgs = [backendPath]
    }

    const spawnCwd = backendProcessArgs.length === 0 ? backendDir : appRoot
    console.log(`工作目录: ${spawnCwd}`)

    const backendEnv = {
      ...process.env,
      // assistant_api：GGUF / models / knowledge 路径解析（尤其对 PyInstaller backend.exe）
      CINF_RESOURCE_ROOT: backendDir,
      CINF_ASSISTANT_LOCAL_DEPLOYMENT: LOCAL_AI_DEPLOYMENT_ENABLED ? '1' : '0',
    }
    console.log('[后端] 本地 AI 部署开关:', LOCAL_AI_DEPLOYMENT_ENABLED ? 'ON' : 'OFF')
    if (!isDev) {
      // 客户机优先稳态：避免 status 探针在少数环境触发原生初始化访问冲突。
      if (!backendEnv.CINF_LLAMACPP_NATIVE_PROBE) backendEnv.CINF_LLAMACPP_NATIVE_PROBE = '0'
      // 降低 OpenMP/线程争用概率；用户可通过外部环境变量覆盖。
      if (!backendEnv.CINF_LLAMACPP_N_THREADS) backendEnv.CINF_LLAMACPP_N_THREADS = '1'
      if (!backendEnv.CINF_LLAMACPP_N_THREADS_BATCH) backendEnv.CINF_LLAMACPP_N_THREADS_BATCH = '1'
    }
    try {
      const ggufDefault = path.join(backendDir, 'models', 'assistant.gguf')
      if (fs.existsSync(ggufDefault)) {
        backendEnv.CINF_LLAMACPP_GGUF = ggufDefault
      }
    } catch (_) {
      /* ignore */
    }

    let settled = false
    function settleOk(tag) {
      if (settled) return
      settled = true
      console.log('[后端] 就绪', tag ? `(${tag})` : '')
      resolve()
    }
    function settleFail(err) {
      if (settled) return
      settled = true
      reject(err)
    }

    backendProcess = spawn(backendCmd, backendProcessArgs, {
      cwd: spawnCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
      env: backendEnv,
    })
    
    let backendOutput = ''
    let backendError = ''
    
    backendProcess.stdout.on('data', (data) => {
      const output = data.toString()
      backendOutput += output
      console.log(`[后端] ${output}`)
      if (looksLikeBackendListenLog(output)) settleOk('stdout')
    })
    
    backendProcess.stderr.on('data', (data) => {
      const error = data.toString()
      backendError += error
      console.error(`[后端 stderr] ${error}`)
      if (looksLikeBackendListenLog(error)) settleOk('stderr')
    })
    
    backendProcess.on('error', (err) => {
      console.error('后端启动失败:', err)
      settleFail(err)
    })
    
    backendProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`后端进程异常退出，代码: ${code}`)
        console.error('后端输出:', backendOutput)
        console.error('后端错误:', backendError)
        if (!settled) {
          settleFail(
            new Error(
              `后端进程已退出（代码 ${code}）。输出：${(backendError || backendOutput || '').slice(0, 500)}`
            )
          )
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          dialog.showErrorBox(
            '后端服务错误',
            `后端服务启动失败。\n\n错误信息: ${backendError || '未知错误'}\n\n请检查：\n1. Python环境是否正确安装\n2. Python依赖是否已安装 (pip install -r requirements.txt)\n3. 5000端口是否被占用`
          )
        }
      }
    })

    waitForBackendHttpReady(pollMaxMs, pollIntervalMs)
      .then(() => settleOk('http'))
      .catch((e) => {
        if (!settled) settleFail(e)
      })
    } // end doSpawn
    setTimeout(doSpawn, delayBeforeSpawn)
  })
}

// 创建主窗口
function createWindow() {
  const windowOptions = {
    width: 1600,
    height: 1080,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false, // 先不显示，等加载完成后再显示
  }
  
  // 设置窗口图标：需在 electron/build 下放置 icon.ico（Windows）或 icon.png（macOS）
  const iconPath = resolveAppIconPath()
  if (iconPath) {
    windowOptions.icon = iconPath
  }
  
  mainWindow = new BrowserWindow(windowOptions)

  // 开发环境加载本地服务器，生产环境加载打包后的文件（不自动打开 DevTools）
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // 需要调试时可在控制台或菜单中手动打开 DevTools
  } else {
    // 生产环境：前端在 app.asar 内 frontend/dist（见 electron-builder.yml files 映射）
    const indexPath = path.join(app.getAppPath(), 'frontend', 'dist', 'index.html')
    if (!fs.existsSync(indexPath)) {
      dialog.showErrorBox('启动失败', `未找到前端页面：\n${indexPath}\n\n请重新安装或使用 start.bat 启动。`)
      app.quit()
      return
    }
    // 清空会话缓存，避免 userData 里旧缓存导致一直看到旧页面
    mainWindow.webContents.session.clearCache().then(() => {
      const buildIdPath = path.join(app.getAppPath(), 'frontend', 'dist', 'build.json')
      let buildId = ''
      try {
        if (fs.existsSync(buildIdPath)) {
          buildId = JSON.parse(fs.readFileSync(buildIdPath, 'utf8')).buildId || ''
        }
      } catch (_) {}
      const loadOpts = buildId ? { query: { v: buildId } } : {}
      mainWindow.loadFile(indexPath, loadOpts)
    })
  }

  // 页面加载完成后不立即显示，等待前端完成公式加载后再显示（实现闪屏→主内容无缝切换，跳过“连接后端”中间页）
  let appReadyReceived = false
  const showMainAndCloseSplash = () => {
    if (appReadyReceived) return
    appReadyReceived = true
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
      splashWindow = null
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      if (process.platform === 'darwin') app.dock.show()
    }
  }

  mainWindow.once('ready-to-show', () => {
    // 不在此处显示窗口，等待前端发送 app:ready 后再显示
    // 安全超时：若 90 秒内未收到 app:ready，仍显示主窗口（避免前端异常时卡死）
    setTimeout(showMainAndCloseSplash, 90000)
  })

  ipcMain.on('app:ready', () => showMainAndCloseSplash())

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 处理窗口错误
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('页面加载失败:', errorCode, errorDescription)
    if (!isDev) {
      dialog.showErrorBox(
        '页面加载失败',
        `无法加载应用页面。\n\n错误代码: ${errorCode}\n错误描述: ${errorDescription}`
      )
    }
  })
}

// 配置自动更新（仅在生产环境）
if (!isDev) {
  // 注意：更新服务器在 electron-builder.yml 的 publish 中配置。
  // GitHub：匿名可访问的仓库才能在不带令牌时检查 release（见下方 GH_TOKEN 说明）。
  autoUpdater.autoDownload = false // 不自动下载，等待用户确认
  autoUpdater.autoInstallOnAppQuit = true // 应用退出时自动安装更新
  if (isWindows7KernelOrOlder()) {
    autoUpdater.channel = 'win7'
  }

  // 私有仓拉 releases 会 404。仅建议在「内网/受控机」为进程配置令牌；公网分发改用「公开库」或 generic 静态地址，勿把 token 写进安装包。
  const gh = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (gh) {
    const t = String(gh).trim()
    const auth = /^(?:token|Bearer)\s/i.test(t) ? t : `token ${t}`
    autoUpdater.addAuthHeader(auth)
  }
  
  // 更新检查事件（仅在生产环境）
  autoUpdater.on('checking-for-update', () => {
    console.log('正在检查更新...')
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-checking')
    }
  })

  autoUpdater.on('update-available', (info) => {
    console.log('发现新版本:', info.version)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes || '新版本可用'
      })
    }
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log('当前已是最新版本:', info.version)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-not-available', {
        version: info.version
      })
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('更新检查错误:', err)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', {
        message: err.message || '更新检查失败'
      })
    }
  })

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', {
        percent: Math.round(progressObj.percent),
        transferred: progressObj.transferred,
        total: progressObj.total
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('更新下载完成:', info.version)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', {
        version: info.version
      })
    }
  })
}

// IPC 处理程序
ipcMain.handle('check-for-updates', async () => {
  if (isDev) {
    return { error: '开发模式下无法检查更新' }
  }
  try {
    await autoUpdater.checkForUpdates()
    return { success: true }
  } catch (error) {
    return { error: (error && error.message) || String(error) }
  }
})

ipcMain.handle('download-update', async () => {
  if (isDev) {
    return { error: '开发模式下无法下载更新' }
  }
  try {
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (error) {
    return { error: (error && error.message) || String(error) }
  }
})

ipcMain.handle('install-update', async () => {
  if (isDev) {
    return { error: '开发模式下无法安装更新' }
  }
  autoUpdater.quitAndInstall(false, true)
  return { success: true }
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('license:get-status', () => {
  return license.getLicenseStatus(isDev)
})

ipcMain.handle('license:activate', async (_e, token) => {
  return license.activateWithToken(isDev, token)
})

// 顶部菜单语言切换（由渲染进程触发）
ipcMain.on('set-language', (_event, lang) => {
  if (lang === 'zh' || lang === 'en') {
    currentLanguage = lang
    buildAppMenu()
  }
})

// 导出计算书：弹出“另存为”对话框，返回用户选择的路径（取消则返回 null）
ipcMain.handle('show-save-dialog-export', async (event, defaultFileName) => {
  const win = BrowserWindow.getFocusedWindow()
  const { filePath, canceled } = await dialog.showSaveDialog(win || mainWindow, {
    title: currentLanguage === 'en' ? 'Export Calculation Report' : '导出计算书',
    defaultPath: defaultFileName || (currentLanguage === 'en' ? 'CINF_Calculation_Report.docx' : 'CINF长沙院浆体计算_计算书.docx'),
    filters: [
      { name: currentLanguage === 'en' ? 'Word Document' : 'Word 文档', extensions: ['docx'] }
    ]
  })
  return canceled ? null : filePath
})

// 通用提示弹窗（保留弹窗交互，但支持统一标题与图标）
ipcMain.handle('show-app-alert', async (_event, payload) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow
  const title = payload?.title || APP_DISPLAY_NAME
  const message = payload?.message || (currentLanguage === 'en' ? 'Notice' : '操作提示')
  const detail = payload?.detail || ''
  const iconPath = resolveAppIconPath()
  const options = {
    type: 'info',
    title,
    message,
    detail,
    buttons: [currentLanguage === 'en' ? 'OK' : '确定'],
    defaultId: 0,
    noLink: true,
  }
  if (iconPath) {
    options.icon = iconPath
  }
  await dialog.showMessageBox(win, options)
  return true
})

// 应用准备就绪
app.whenReady().then(async () => {
  try {
    license.setElectronApp(app)
    createSplashWindow()
    // 启动后端服务器
    await startBackend()
    console.log('后端服务器启动成功')
    // startBackend 已通过 HTTP 轮询确认可访问，此处仅短延迟便于端口完全稳定
    await new Promise((resolve) => setTimeout(resolve, 300))
    
    // 创建窗口和应用菜单
    createWindow()
    buildAppMenu()
    
    // 应用启动后延迟检查更新（避免影响启动速度）
    if (!isDev) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch(err => {
          console.error('自动检查更新失败:', err)
        })
      }, 5000)
    }
  } catch (error) {
    console.error('启动失败:', error)
    const msg = error && error.message
    const suggestPython = msg && !msg.includes('5000') && !msg.includes('端口')
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
      splashWindow = null
    }
    dialog.showErrorBox(
      '启动失败',
      `应用启动失败：${msg || error}\n\n${suggestPython ? '请检查 Python 环境是否正确配置；若使用 start.bat 能正常打开，可优先用 start.bat 启动。' : '可尝试用 start.bat 启动（先关闭本窗口），或检查 5000 端口是否被占用。'}`
    )
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 彻底结束后端进程（含子进程），避免关闭软件后进程残留
function killBackendAndQuit() {
  if (!backendProcess) return
  const pid = backendProcess.pid
  if (pid == null) {
    backendProcess = null
    return
  }
  try {
    if (process.platform === 'win32') {
      // Windows: 用 taskkill /T /F 结束该进程及其子进程树，避免 Python/Flask 子进程残留导致 Electron 不退出
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true })
    } else {
      backendProcess.kill('SIGKILL')
    }
  } catch (e) {
    try { backendProcess.kill('SIGKILL') } catch (_) {}
  }
  backendProcess = null
}

// 所有窗口关闭时
app.on('window-all-closed', () => {
  killBackendAndQuit()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前
app.on('before-quit', () => {
  killBackendAndQuit()
})

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error)
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox('应用错误', `发生未预期的错误：${error.message}`)
  }
})
