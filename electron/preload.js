// Preload脚本 - 在渲染进程中运行，可以安全地暴露API
const { contextBridge, ipcRenderer } = require('electron')

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
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
  },
  // 导出计算书：显示“另存为”对话框，返回用户选择的路径或 null
  showSaveDialogForExport: (defaultFileName) => ipcRenderer.invoke('show-save-dialog-export', defaultFileName),
  // 设置主进程菜单语言
  setLanguage: (lang) => ipcRenderer.send('set-language', lang),
  // 统一应用提示弹窗（标题、图标由主进程控制）
  showAlert: (payload) => ipcRenderer.invoke('show-app-alert', payload),
  // 通知主进程：前端已完成公式加载（成功或失败），可关闭闪屏并显示主窗口
  appReady: () => ipcRenderer.send('app:ready'),
  // 离线一机一证：设备码 + 授权码
  license: {
    getStatus: () => ipcRenderer.invoke('license:get-status'),
    activate: (token) => ipcRenderer.invoke('license:activate', token),
  },
})
