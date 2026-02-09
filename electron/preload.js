// Preload脚本 - 在渲染进程中运行，可以安全地暴露API
const { contextBridge, ipcRenderer } = require('electron')

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isDev: process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged,
  
  // 更新相关 API
  update: {
    // 检查更新
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    
    // 下载更新
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    
    // 安装更新
    installUpdate: () => ipcRenderer.invoke('install-update'),
    
    // 获取当前版本
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // 监听更新事件
    onUpdateChecking: (callback) => {
      ipcRenderer.on('update-checking', () => callback())
    },
    
    onUpdateAvailable: (callback) => {
      ipcRenderer.on('update-available', (event, info) => callback(info))
    },
    
    onUpdateNotAvailable: (callback) => {
      ipcRenderer.on('update-not-available', (event, info) => callback(info))
    },
    
    onUpdateError: (callback) => {
      ipcRenderer.on('update-error', (event, error) => callback(error))
    },
    
    onUpdateDownloadProgress: (callback) => {
      ipcRenderer.on('update-download-progress', (event, progress) => callback(progress))
    },
    
    onUpdateDownloaded: (callback) => {
      ipcRenderer.on('update-downloaded', (event, info) => callback(info))
    },
    
    // 移除监听器
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel)
    }
  }
})
