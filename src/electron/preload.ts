import { contextBridge, ipcRenderer } from 'electron'
const inv = (c: string) => (a?: any) => ipcRenderer.invoke(c, a)
contextBridge.exposeInMainWorld('zh', {
  load: inv('db:load'), save: inv('db:save'), dataPath: inv('db:path'), setTheme: inv('theme:set'),
  textPut: inv('text:put'), textGet: inv('text:get'), textChunk: inv('text:chunk'), textMeta: inv('text:meta'), textDel: inv('text:del'),
  pickFiles: inv('file:pick'), importFile: inv('file:import'), cancelImport: inv('file:cancel'),
  onImportProgress: (cb: (m: any) => void) => { const f = (_: any, m: any) => cb(m); ipcRenderer.on('import:progress', f); return () => ipcRenderer.off('import:progress', f) },
  saveFile: inv('file:save'), savePdf: inv('file:pdf'), http: inv('ai:http'), cancelAi: inv('ai:cancel'), metrics: inv('sys:metrics'),
  e2eConfig: inv('e2e:config'), e2eWrite: inv('e2e:write'), e2eShot: inv('e2e:shot'), e2eQuit: inv('e2e:quit')
})
