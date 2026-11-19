import { app, BrowserWindow, ipcMain, dialog, nativeTheme, utilityProcess } from 'electron'
import { join, extname, basename } from 'path'
import { promises as fs, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { putText, getText, getChunk, getMeta, delText } from './textstore'

let win: BrowserWindow | null = null
const root = () => app.getPath('userData')
const dataFile = () => join(root(), 'zhihe-db.json')
const SHOTS = process.env.ZHIHE_SHOTS
const E2E = process.env.ZHIHE_E2E

function create() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700, title: '智合 · 合同全生命周期管理',
    backgroundColor: '#0f172a', autoHideMenuBar: true, show: !SHOTS,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false, backgroundThrottling: !E2E }
  })
  win.setMenuBarVisibility(false)
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  if (SHOTS) runShots()
}

async function shot(name: string) { const img = await win!.webContents.capturePage(); writeFileSync(join(SHOTS!, `${name}.png`), img.toPNG()) }
async function runShots() {
  const w = win!
  await new Promise((r) => (w.webContents as any).once('did-finish-load', r))
  mkdirSync(SHOTS!, { recursive: true })
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const steps: [string, string, number?][] = JSON.parse(process.env.ZHIHE_SHOT_STEPS || 'null') || [
    ['dashboard', "location.hash='#/dashboard'"],
    ['contracts', "location.hash='#/contracts'"],
    ['batch-review-results', "location.hash='#/batch?auto=1'", 6000],
    ['rule-test', "location.hash='#/rules?test=1'"],
    ['contract-detail-ai', "location.hash='#/contract/C-2024-003'"],
    ['ai-assistant', "location.hash='#/archive?ask=1'", 4000],
    ['settings-ai', "location.hash='#/settings'"],
    ['dashboard-light', "window.__setTheme('light');location.hash='#/dashboard'"]
  ]
  await wait(1500)
  for (const [name, js, ms] of steps) { await w.webContents.executeJavaScript(js); await wait(ms || 2500); await shot(name) }
  app.quit()
}

// ---------- 数据库（仅元数据；原子写入、异步） ----------
let saving: Promise<any> = Promise.resolve(); let pending: string | null = null
ipcMain.handle('db:load', () => {
  if (existsSync(dataFile())) return JSON.parse(readFileSync(dataFile(), 'utf8'))
  const legacy = join(root(), 'zhihe-data.json') // v1.0 内嵌全文的旧库，交由渲染端迁移
  return existsSync(legacy) ? JSON.parse(readFileSync(legacy, 'utf8')) : null
})
ipcMain.handle('db:save', (_e, json: string) => {
  pending = json
  saving = saving.then(async () => { if (pending == null) return; const s = pending; pending = null; await fs.writeFile(dataFile() + '.tmp', s); renameSync(dataFile() + '.tmp', dataFile()) })
  return true
})
ipcMain.handle('db:path', () => root())
ipcMain.handle('theme:set', (_e, t) => { nativeTheme.themeSource = t })
ipcMain.handle('text:put', (_e, { id, text }) => putText(root(), id, text))
ipcMain.handle('text:get', (_e, id) => getText(root(), id))
ipcMain.handle('text:chunk', (_e, { id, i }) => getChunk(root(), id, i))
ipcMain.handle('text:meta', (_e, id) => getMeta(root(), id))
ipcMain.handle('text:del', (_e, id) => delText(root(), id))
ipcMain.handle('sys:metrics', () => ({ main: process.memoryUsage(), procs: app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, mem: m.memory.workingSetSize })) }))

// ---------- 导入：utilityProcess 子进程解析，带进度与取消 ----------
const jobs = new Map<string, Electron.UtilityProcess>()
ipcMain.handle('file:pick', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], filters: [{ name: '合同文件', extensions: ['pdf', 'docx', 'txt'] }] })
  return r.canceled ? [] : r.filePaths
})
ipcMain.handle('file:import', (e, { path, id, jobId }) => new Promise((resolve) => {
  const child = utilityProcess.fork(join(__dirname, 'parse-worker.js'), [], { serviceName: 'zhihe-parse' })
  jobs.set(jobId, child)
  const fin = (v: any) => { jobs.delete(jobId); try { child.kill() } catch {} resolve(v) }
  child.on('message', (m: any) => { if (m.type === 'progress') e.sender.send('import:progress', m); else fin(m) })
  child.on('exit', (code) => { if (jobs.has(jobId)) fin({ jobId, type: 'error', error: code === 0 ? '已取消' : `解析进程退出 (${code})` }) })
  child.postMessage({ jobId, path, root: root(), id })
}))
ipcMain.handle('file:cancel', (_e, jobId) => { const c = jobs.get(jobId); if (c) { jobs.delete(jobId); c.kill() } return true })

ipcMain.handle('file:save', async (_e, { name, data, filters, path }) => {
  let p = path
  if (!p) { const r = await dialog.showSaveDialog(win!, { defaultPath: name, filters }); if (r.canceled || !r.filePath) return null; p = r.filePath }
  writeFileSync(p, typeof data === 'string' ? '\ufeff' + data : Buffer.from(data)); return p
})
ipcMain.handle('file:pdf', async (_e, { name, html, path }) => {
  let p = path
  if (!p) { const r = await dialog.showSaveDialog(win!, { defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] }); if (r.canceled || !r.filePath) return null; p = r.filePath }
  const w = new BrowserWindow({ show: false })
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const buf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true })
  w.destroy(); writeFileSync(p, buf); return p
})

// ---------- AI HTTP 传输：超时、取消、对 429/5xx/529 指数退避重试（遵循 Retry-After） ----------
const inflight = new Map<string, AbortController>()
ipcMain.handle('ai:http', async (_e, { reqId, url, method, headers, body, timeoutMs, maxRetries }) => {
  const ctl = new AbortController(); if (reqId) inflight.set(reqId, ctl)
  const t0 = Date.now(); let attempt = 0
  try {
    for (;;) {
      const tm = setTimeout(() => ctl.abort('timeout'), timeoutMs || 120000)
      try {
        const res = await fetch(url, { method: method || 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', ...headers }, body: body == null ? undefined : JSON.stringify(body) })
        const txt = await res.text(); clearTimeout(tm)
        const retryable = res.status === 429 || res.status === 529 || res.status >= 500
        if (retryable && attempt < (maxRetries ?? 3)) { const ra = Number(res.headers.get('retry-after')); await new Promise((r) => setTimeout(r, ra ? ra * 1000 : Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5))); attempt++; continue }
        let json: any = null; try { json = JSON.parse(txt) } catch {}
        return { ok: res.ok, status: res.status, json, text: json ? undefined : txt.slice(0, 2000), ms: Date.now() - t0, attempts: attempt + 1 }
      } catch (err: any) {
        clearTimeout(tm)
        if (ctl.signal.aborted) return { ok: false, status: 0, error: ctl.signal.reason === 'timeout' ? '请求超时' : '已取消', ms: Date.now() - t0 }
        if (attempt < (maxRetries ?? 3)) { await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); attempt++; continue }
        return { ok: false, status: 0, error: String(err?.cause?.code || err?.message || err), ms: Date.now() - t0 }
      }
    }
  } finally { if (reqId) inflight.delete(reqId) }
})
ipcMain.handle('ai:cancel', (_e, prefix: string) => { for (const [k, c] of inflight) if (k.startsWith(prefix)) c.abort('cancel'); return true })

// ---------- E2E 测试钩子（仅在设置 ZHIHE_E2E 时启用；测试密钥只来自环境变量，不落入源码） ----------
ipcMain.handle('e2e:config', () => (E2E ? { out: E2E, jevKey: process.env.ZHIHE_TEST_JEV_KEY || '', files: (process.env.ZHIHE_E2E_FILES || '').split(',').filter(Boolean), shots: process.env.ZHIHE_E2E_SHOTS || '', phase: process.env.ZHIHE_E2E_PHASE || 'all' } : null))
ipcMain.handle('e2e:write', (_e, { file, data }) => { writeFileSync(file, data); return true })
ipcMain.handle('e2e:shot', async (_e, path) => { const img = await win!.webContents.capturePage(); writeFileSync(path, img.toPNG()); return true })
ipcMain.handle('e2e:quit', () => { setTimeout(() => app.quit(), 300); return true })

app.whenReady().then(create)
app.on('window-all-closed', () => app.quit())
