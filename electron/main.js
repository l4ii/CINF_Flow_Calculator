const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')

let mainWindow
let backendProcess

// 判断是否为开发环境
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// 获取资源路径（开发环境和生产环境不同）
function getResourcePath(...paths) {
  if (isDev) {
    return path.join(__dirname, '..', ...paths)
  } else {
    // 生产环境：Windows在resources目录，macOS在app.asar外
    if (process.platform === 'darwin') {
      return path.join(process.resourcesPath, ...paths)
    } else {
      return path.join(process.resourcesPath, ...paths)
    }
  }
}

// 查找Python可执行文件
function findPython() {
  const pythonCommands = ['python3', 'python']
  
  for (const cmd of pythonCommands) {
    try {
      const result = require('child_process').execSync(`${cmd} --version`, { encoding: 'utf-8' })
      if (result) {
        return cmd
      }
    } catch (e) {
      // 继续尝试下一个
    }
  }
  
  // Windows特定路径
  if (process.platform === 'win32') {
    const commonPaths = [
      'C:\\Python311\\python.exe',
      'C:\\Python310\\python.exe',
      'C:\\Python39\\python.exe',
      'C:\\Python38\\python.exe',
      'C:\\Program Files\\Python311\\python.exe',
      'C:\\Program Files\\Python310\\python.exe',
      'C:\\Users\\' + require('os').userInfo().username + '\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
    ]
    
    for (const pythonPath of commonPaths) {
      if (fs.existsSync(pythonPath)) {
        return pythonPath
      }
    }
  }
  
  return null
}

// 启动后端服务器
function startBackend() {
  return new Promise((resolve, reject) => {
    const pythonCmd = findPython()
    
    if (!pythonCmd) {
      reject(new Error('未找到Python环境。请确保已安装Python 3.x并添加到系统PATH。'))
      return
    }
    
    const backendPath = getResourcePath('backend', 'app.py')
    const backendDir = getResourcePath('backend')
    
    // 检查后端文件是否存在
    if (!fs.existsSync(backendPath)) {
      reject(new Error(`后端文件不存在: ${backendPath}`))
      return
    }
    
    console.log(`启动后端服务器: ${pythonCmd} ${backendPath}`)
    console.log(`工作目录: ${backendDir}`)
    
    backendProcess = spawn(pythonCmd, [backendPath], {
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
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
    
    // 超时检测
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        // 检查后端是否真的在运行
        const http = require('http')
        const checkRequest = http.get('http://127.0.0.1:5000/api/formulas', (res) => {
          if (res.statusCode === 200) {
            resolve()
          }
        })
        checkRequest.on('error', () => {
          // 后端可能还在启动中，再等一会
          setTimeout(() => {
            const retryRequest = http.get('http://127.0.0.1:5000/api/formulas', (res) => {
              if (res.statusCode === 200) {
                resolve()
              } else {
                reject(new Error('后端启动超时'))
              }
            })
            retryRequest.on('error', () => reject(new Error('后端启动超时')))
            retryRequest.setTimeout(5000, () => reject(new Error('后端启动超时')))
          }, 2000)
        })
        checkRequest.setTimeout(5000, () => {
          // 可能还在启动，继续等待
        })
      }
    }, 3000)
  })
}

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: isDev 
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, 'preload.js'), // 生产环境路径会自动处理
    },
    icon: getResourcePath('build', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false, // 先不显示，等加载完成后再显示
  })

  // 开发环境加载本地服务器，生产环境加载打包后的文件
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // 生产环境：dist 目录在应用根目录
    const indexPath = path.join(__dirname, '../dist/index.html')
    mainWindow.loadFile(indexPath)
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
  } catch (error: any) {
    return { error: error.message }
  }
})

ipcMain.handle('download-update', async () => {
  if (isDev) {
    return { error: '开发模式下无法下载更新' }
  }
  try {
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (error: any) {
    return { error: error.message }
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
    dialog.showErrorBox(
      '启动失败',
      `应用启动失败：${error.message}\n\n请检查Python环境是否正确配置。`
    )
    app.quit()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 所有窗口关闭时
app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前
app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
})

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error)
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox('应用错误', `发生未预期的错误：${error.message}`)
  }
})
