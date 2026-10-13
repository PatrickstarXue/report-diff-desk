import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'

/** 允许交给系统浏览器打开的外部协议；其余 scheme（file://、自定义协议等）一律拒绝 */
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

function isSafeExternalUrl(url: string): boolean {
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false // 非法 URL 直接拒绝
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: '报表比对工具',
    // dev 模式窗口图标；打包版由 exe 自带图标（files 不含 resources/）
    icon: process.env['ELECTRON_RENDERER_URL']
      ? join(__dirname, '../../resources/icon.ico')
      : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // 窗口内不允许打开新窗；外部链接仅 http(s) 交系统浏览器，其余协议直接拒绝
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 纵深防御：阻止窗口内导航到外部页面/协议（渲染层被污染时 window.location 跳 file:// 等）
  win.webContents.on('will-navigate', (event, url) => {
    const devOrigin = process.env['ELECTRON_RENDERER_URL']
    const allowed = devOrigin ? url.startsWith(devOrigin) : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
