// IPC channel 名常量，main 与 preload/renderer 共用，避免字符串漂移。
export const IPC = {
  dialogOpenFile: 'dialog:openFile',
  reportLoad: 'report:load',
  reportGetSheet: 'report:getSheet',
  compareRun: 'compare:run',
  mappingLoad: 'mapping:load',
  docLoad: 'doc:load',
  docLibraryGet: 'docLibrary:get',
  docLibrarySet: 'docLibrary:set',
  exportRun: 'export:run',
  recentGet: 'recent:get',
  recentSet: 'recent:set',
  appVersion: 'app:version'
} as const
