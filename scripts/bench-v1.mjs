// v1.0 基线：在主进程内同步解析 + 全文内嵌进单个 JSON 库 + 渲染线程全量正则提取。测量耗时与事件循环最大阻塞。
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
await build({ entryPoints: ['src/engine.ts'], bundle: true, format: 'cjs', platform: 'node', outfile: '/tmp/zh-engine.cjs', logLevel: 'error' })
const { localExtract } = require('/tmp/zh-engine.cjs')
const lagProbe = () => { let max = 0, last = performance.now(); const t = setInterval(() => { const n = performance.now(); max = Math.max(max, n - last - 10); last = n }, 10); return () => { clearInterval(t); return max } }
const res = {}
for (const ext of ['pdf', 'docx', 'txt']) {
  const p = `/workspace/zhihe-testdata/big-contract-800p.${ext}`
  const stop = lagProbe(); const m0 = process.memoryUsage().rss; const t0 = performance.now(); let text
  if (ext === 'pdf') text = (await require('pdf-parse/lib/pdf-parse.js')(readFileSync(p))).text
  else if (ext === 'docx') text = (await require('mammoth').extractRawText({ path: p })).value
  else text = readFileSync(p, 'utf8')
  const tParse = performance.now() - t0
  const db = { contracts: Array.from({ length: 8 }, (_, i) => ({ id: 'S' + i, text: 'x'.repeat(3000) })).concat([{ id: 'BIG', text }]) }
  const t1 = performance.now(); const json = JSON.stringify(db); writeFileSync('/tmp/zh-v1-db.json', json); const tSave = performance.now() - t1
  const t2 = performance.now(); const f = localExtract(text); const tExtract = performance.now() - t2
  const lag = stop()
  res[ext] = { chars: text.length, parseMs: Math.round(tParse), saveEveryEditMs: Math.round(tSave), dbBytes: json.length, extractSyncMs: Math.round(tExtract), maxEventLoopBlockMs: Math.round(lag), rssDeltaMB: Math.round((process.memoryUsage().rss - m0) / 1048576), partyA: f.partyA, governingLaw: f.governingLaw }
}
console.log(JSON.stringify(res, null, 2)); writeFileSync('/workspace/zhihe-testdata/bench-v1.json', JSON.stringify(res, null, 2))
