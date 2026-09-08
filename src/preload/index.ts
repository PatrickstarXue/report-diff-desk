import { contextBridge } from 'electron'

// M3 起逐 channel 暴露 window.api；当前为空壳，保证 M0 可运行。
contextBridge.exposeInMainWorld('api', {})
