const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')
const { spawn, execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const { autoUpdater } = require('electron-updater')

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

// 判断是否为开发环境
// 仅根据是否打包判断：打包后的 exe 始终为生产模式，避免“打开软件就进 dev 模式”
const isDev = !app.isPackaged

// 获取资源路径（开发环境和生产环境不同）
function getResourcePath(...paths) {
  if (isDev) {
    return path.join(__dirname, '..', ...paths)
  } else {
    return path.join(process.resourcesPath, ...paths)
  }
}

// 查找打包的 Python 后端可执行文件或系统 Python
function findBackendExecutable() {
  // 优先查找打包的后端可执行文件（生产环境）
  if (!isDev) {
    const possibleExePaths = [
      getResourcePath('backend', 'dist', 'backend.exe'),
      getResourcePath('backend', 'backend.exe'),
    ]
    for (const exePath of possibleExePaths) {
      if (fs.existsSync(exePath)) {
        console.log('找到打包的后端可执行文件:', exePath)
        return exePath
      }
    }
    console.log('未找到打包的后端可执行文件，将尝试使用系统Python')
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

// Windows：结束占用 5000 端口的进程，避免旧后端占端口导致新后端起不来、前端一直连到旧版
function killProcessOnPort5000() {
  if (process.platform !== 'win32') return
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
      try {
        // /T: kill process tree, avoid child still listening
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true })
        console.log('[后端] 已结束占用 5000 端口的进程 PID:', pid)
      } catch (e) { /* 可能已退出 */ }
    }
  } catch (e) {
    console.warn('[后端] 检查/结束 5000 端口进程时出错:', e.message)
  }
}

// 启动后端服务器
function startBackend() {
  return new Promise((resolve, reject) => {
    // 先释放 5000 端口，确保当前代码启动的后端能绑定成功（否则会连到旧后端）
    killProcessOnPort5000()
    // 给系统一点时间释放端口，再启动后端，减少“端口仍被占用”的误判
    const delayBeforeSpawn = process.platform === 'win32' ? 800 : 400

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

    // 如果是打包的可执行文件，直接运行（exe 在 backend 目录下，cwd 用 backend）
    if (backendCmd.endsWith('.exe') || (!backendCmd.includes('python') && !backendCmd.includes('python3'))) {
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

    backendProcess = spawn(backendCmd, backendProcessArgs, {
      cwd: spawnCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    })
    
    let backendOutput = ''
    let backendError = ''
    
    backendProcess.stdout.on('data', (data) => {
      const output = data.toString()
      backendOutput += output
      console.log(`[后端] ${output}`)
      
      // 检测后端是否成功启动
      if (output.includes('Running on') || output.includes('127.0.0.1:5000')) {
        resolve()
      }
    })
    
    backendProcess.stderr.on('data', (data) => {
      const error = data.toString()
      backendError += error
      console.error(`[后端错误] ${error}`)
    })
    
    backendProcess.on('error', (err) => {
      console.error('后端启动失败:', err)
      reject(err)
    })
    
    backendProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`后端进程异常退出，代码: ${code}`)
        console.error('后端输出:', backendOutput)
        console.error('后端错误:', backendError)
        
        if (!mainWindow || mainWindow.isDestroyed()) {
          return
        }
        
        dialog.showErrorBox(
          '后端服务错误',
          `后端服务启动失败。\n\n错误信息: ${backendError || '未知错误'}\n\n请检查：\n1. Python环境是否正确安装\n2. Python依赖是否已安装 (pip install -r requirements.txt)\n3. 5000端口是否被占用`
        )
      }
    })
    
    // 不做接口检测，启动后稍等即打开窗口（前端自行请求 5000，未就绪时会重试或报错）
    const openDelay = isDev ? 1200 : 2500
    setTimeout(() => resolve(), openDelay)
    } // end doSpawn
    setTimeout(doSpawn, delayBeforeSpawn)
  })
}

// 创建主窗口
function createWindow() {
  const windowOptions = {
    width: 1600,
    height: 1000,
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
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const candidates = isDev
    ? [path.join(__dirname, 'build', iconName)]
    : [getResourcePath('build', iconName), path.join(process.resourcesPath, 'app.asar.unpacked', 'build', iconName)]
  let iconPath = null
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      iconPath = p
      break
    }
  }
  if (iconPath) {
    windowOptions.icon = iconPath
  }
  
  mainWindow = new BrowserWindow(windowOptions)

  // 开发环境加载本地服务器，生产环境加载打包后的文件（不自动打开 DevTools）
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // 需要调试时可在控制台或菜单中手动打开 DevTools
  } else {
    // 生产环境：前端在 extraResources 的 frontend-dist（resources/frontend-dist），安装即覆盖，避免旧版缓存
    const indexPath = path.join(process.resourcesPath, 'frontend-dist', 'index.html')
    if (!fs.existsSync(indexPath)) {
      dialog.showErrorBox('启动失败', `未找到前端页面：\n${indexPath}\n\n请重新安装或使用 start.bat 启动。`)
      app.quit()
      return
    }
    // 清空会话缓存，避免 userData 里旧缓存导致一直看到旧页面
    mainWindow.webContents.session.clearCache().then(() => {
      const buildIdPath = path.join(process.resourcesPath, 'frontend-dist', 'build.json')
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

  // 页面加载完成后显示窗口
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    
    // 聚焦窗口
    if (process.platform === 'darwin') {
      app.dock.show()
    }
  })

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
  // 注意：更新服务器 URL 需要在 electron-builder.yml 或 package.json 的 publish 配置中设置
  // 如果使用 GitHub Releases，需要设置环境变量 GH_TOKEN
  // 如果使用通用服务器，确保 URL 正确配置
  autoUpdater.autoDownload = false // 不自动下载，等待用户确认
  autoUpdater.autoInstallOnAppQuit = true // 应用退出时自动安装更新
  
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

// 应用准备就绪
app.whenReady().then(async () => {
  try {
    // 启动后端服务器
    await startBackend()
    console.log('后端服务器启动成功')
    
    // 等待一下确保后端完全就绪
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 创建窗口
    createWindow()
    
    // 应用启动后延迟检查更新（避免影响启动速度）
    if (!isDev) {
      setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify().catch(err => {
          console.error('自动检查更新失败:', err)
        })
      }, 5000)
    }
  } catch (error) {
    console.error('启动失败:', error)
    const msg = error && error.message
    const suggestPython = msg && !msg.includes('5000') && !msg.includes('端口')
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
