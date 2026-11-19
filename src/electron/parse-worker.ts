/** 导入解析子进程（Electron utilityProcess）：PDF/DOCX/TXT 解析、分块落盘、增量要素提取。主进程与界面不被阻塞。 */
import { readFileSync } from 'fs'
import { extname, basename } from 'path'
import { putText } from './textstore'
import { localExtract, mergeFacts } from '../src/engine'

const port: any = (process as any).parentPort
const send = (m: any) => port.postMessage(m)
port.on('message', async (e: any) => {
  const { jobId, path, root, id } = e.data
  const t0 = Date.now()
  try {
    const ext = extname(path).toLowerCase(); let text = ''; let pages = 0
    send({ jobId, type: 'progress', stage: '读取文件', pct: 2 })
    if (ext === '.txt') text = readFileSync(path, 'utf8')
    else if (ext === '.docx') {
      send({ jobId, type: 'progress', stage: '解析 DOCX', pct: 10 })
      const mammoth = require('mammoth'); text = (await mammoth.extractRawText({ path })).value
    } else if (ext === '.pdf') {
      const pdf = require('pdf-parse/lib/pdf-parse.js')
      const buf = readFileSync(path)
      let total = 0, done = 0
      const r = await pdf(buf, {
        pagerender: async (pd: any) => {
          total = pd._transport?.numPages || pd.transport?.numPages || total
          const tc = await pd.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
          let last: any, s = ''
          for (const it of tc.items) { s += last == null || last === it.transform[5] ? it.str : '\n' + it.str; last = it.transform[5] }
          done++; if (done % 10 === 0) send({ jobId, type: 'progress', stage: `解析 PDF 第 ${done}${total ? '/' + total : ''} 页`, pct: 5 + (total ? (done / total) * 75 : Math.min(75, done / 10)) })
          return s
        }
      })
      text = r.text; pages = r.numpages
    } else throw new Error('不支持的格式：' + ext)
    const tParse = Date.now() - t0
    send({ jobId, type: 'progress', stage: '分块存储', pct: 82 })
    const meta = await putText(root, id, text)
    // 增量要素提取：按 32K 字符窗口逐块提取并合并（首个命中优先），每块回报进度
    const W = 32768; let facts: any = {}; const n = Math.ceil(text.length / W)
    for (let i = 0; i < n; i++) {
      const seg = text.slice(Math.max(0, i * W - 200), (i + 1) * W)
      facts = mergeFacts(facts, localExtract(seg))
      if (i % 8 === 0) send({ jobId, type: 'progress', stage: `增量要素提取 ${i + 1}/${n}`, pct: 85 + (i / n) * 14 })
    }
    send({ jobId, type: 'done', name: basename(path, ext), ext, length: text.length, pages, chunks: meta.chunks, preview: text.slice(0, 4000), facts, timings: { parseMs: tParse, totalMs: Date.now() - t0 }, rss: process.memoryUsage().rss })
  } catch (err: any) { send({ jobId, type: 'error', error: String(err?.message || err) }) }
})
