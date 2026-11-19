/** 端到端测试驱动（仅当主进程设置 ZHIHE_E2E 时运行）。密钥只从环境变量经主进程传入，不写入源码。 */
import { zh } from './store'
import { routed, defaultAi } from './ai/router'
import { importPaths } from './importer'
import { getText } from './textcache'
import { runRule, aggregate, riskScore } from './engine'
import type { AiSettings, Contract } from './types'

const S = () => (window as any).__store
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** 监测主线程卡顿：rAF 最长帧间隔 */
function frameMon() { let max = 0, last = performance.now(), on = true; const f = () => { const n = performance.now(); max = Math.max(max, n - last); last = n; if (on) requestAnimationFrame(f) }; requestAnimationFrame(f); return () => { on = false; return Math.round(max) } }
const clip = (x: any, n = 1500) => { const s = typeof x === 'string' ? x : JSON.stringify(x); return s.length > n ? s.slice(0, n) + '…' : s }
async function timed<T>(name: string, fn: () => Promise<T>, log: any[]) {
  const stop = frameMon(); const t0 = performance.now(); let r: any, err
  try { r = await fn() } catch (e: any) { err = e.message }
  const rec = { step: name, ms: Math.round(performance.now() - t0), maxFrameMs: stop(), engine: r?.engine, fallback: r?.fallback, usage: r?.usage, error: err, output: err ? undefined : clip(r?.data ?? r) }
  log.push(rec); console.log('[e2e]', name, rec.ms, 'ms', err || ''); return r
}
const setAi = (p: Partial<AiSettings>) => S().set((d: any) => ({ ...d, settings: { ...d.settings, ai: { ...d.settings.ai, ...p } } }))
async function shot(cfg: any, name: string, hash: string, ms = 2500, js?: string) { if (!cfg.shots) return; location.hash = hash; await wait(ms); if (js) { eval(js); await wait(ms) } await zh.e2eShot(`${cfg.shots}/${name}.png`) }
const clickText = (sel: string, txt: string) => { const b = [...document.querySelectorAll(sel)].find((x) => x.textContent?.includes(txt)) as HTMLElement; b?.click(); return !!b }

export async function runE2E() {
  const cfg = await zh.e2eConfig(); if (!cfg) return
  await wait(1200)
  const report: any = { startedAt: new Date().toISOString(), phases: {} }
  const save = () => zh.e2eWrite({ file: cfg.out, data: JSON.stringify(report, null, 2) })
  const byId = (id: string): Contract => S().db.contracts.find((c: any) => c.id === id)
  const phases = cfg.phase === 'all' ? ['perf', 'jev', 'ollama'] : cfg.phase.split('+')

  if (phases.includes('perf')) {
    const log: any[] = []; report.phases.perf = log
    const m0 = await zh.metrics(); report.memBefore = m0
    const ids: string[] = []
    for (const f of cfg.files) {
      const r = await timed(`导入 ${f.split('/').pop()}`, async () => { const [j] = await importPaths([f], (c) => S().set((d: any) => ({ ...d, contracts: [c, ...d.contracts] }))); return { data: { state: j.state, stage: j.stage, worker: j.result?.timings, workerRssMB: Math.round((j.result?.rss || 0) / 1048576), facts: j.result?.facts }, engine: 'utilityProcess' } }, log)
      await wait(400); const c = S().db.contracts[0]; ids.push(c.id)
    }
    // 并发导入三份（测试多文件不阻塞）
    await timed('并发导入 3 个大文件', async () => { const js = await importPaths(cfg.files, (c) => S().set((d: any) => ({ ...d, contracts: [c, ...d.contracts] }))); return { data: js.map((j) => `${j.name} ${j.state} ${Math.round(j.ms!)}ms`) } }, log)
    await wait(500)
    const big = byId(ids[0])
    await timed('分块文本加载（首次，PDF 文本）', async () => ({ data: (await getText(big.id)).length }), log)
    await timed('分块文本加载（缓存命中）', async () => ({ data: (await getText(big.id)).length }), log)
    const eng = routed({ ...defaultAi(), defaultEngine: 'local' })
    await timed('本地增量要素提取（大文件）', () => eng.extractFacts(big), log)
    await timed('本地风险审查（大文件）', () => eng.review(big), log)
    await timed('规则库 15 条（大文件）', async () => { const doc = { ...big, text: await getText(big.id) }; const fs = S().db.rules.map((r: any) => runRule(r, doc)); return { data: { verdict: aggregate(fs), risk: riskScore(fs), fails: fs.filter((x: any) => x.verdict === 'fail').map((x: any) => x.reason) } } }, log)
    await timed('本地检索（全库含 6 个大文件）', () => eng.search('适用法律 争议 仲裁', S().db.contracts), log)
    // UI：打开大文件全文页（虚拟滚动）并测帧
    await timed('打开大文件全文视图（虚拟滚动）', async () => { location.hash = '#/contract/' + big.id; await wait(800); clickText('.tabs button', '合同全文'); await wait(1500); const el = document.querySelector('.vt-body') as HTMLElement; for (let i = 0; i < 20; i++) { el.scrollTop += 4000; await wait(30) } return { data: { renderedLines: document.querySelectorAll('.vt-line').length } } }, log)
    if (cfg.shots) await zh.e2eShot(`${cfg.shots}/large-file-viewer.png`)
    // 批量审查：UI 驱动，本地引擎，含 3 个大文件
    setAi({ defaultEngine: 'local' }); await wait(300)
    await timed('批量审查 UI（本地引擎，含大文件）', async () => { sessionStorage.setItem('zh-batch', JSON.stringify(S().db.contracts.slice(0, 11).map((c: any) => c.id))); location.hash = '#/contracts'; await wait(300); location.hash = '#/batch'; await wait(600); clickText('.btn.big', '开始审查'); for (let i = 0; i < 600; i++) { await wait(100); if (!document.querySelector('.btn.big .spin')) break } return { data: document.querySelector('.review-sum')?.textContent } }, log)
    // v1.0 基线对照（同一环境内复现旧做法）：整段 textarea 渲染全文 + 每次改动序列化内嵌全文的整库 JSON
    const bigText = await getText(big.id)
    await timed('v1 基线：textarea 渲染 69 万字全文并滚动', async () => { const ta = document.createElement('textarea'); ta.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:560px;z-index:9999'; document.body.appendChild(ta); ta.value = bigText; await wait(50); for (let i = 0; i < 20; i++) { ta.scrollTop += 4000; await wait(30) } ta.remove(); return { data: 'ok' } }, log)
    await timed('v1 基线：每次保存序列化内嵌全文的整库（×10 次编辑）', async () => { const db = { ...S().db, contracts: S().db.contracts.map((c: any) => ({ ...c, text: (c.textLen || 0) > 300000 ? bigText : 'x'.repeat(3000) })) }; let n = 0; for (let i = 0; i < 10; i++) { n = JSON.stringify(db).length; await zh.e2eWrite({ file: '/tmp/zh-v1-sim.json', data: JSON.stringify(db) }) } return { data: n } }, log)
    await timed('v1.1：每次保存仅序列化元数据（×10 次编辑）', async () => { let n = 0; for (let i = 0; i < 10; i++) { const j = JSON.stringify(S().db); n = j.length; await zh.save(j) } return { data: n } }, log)
    report.memAfter = await zh.metrics(); report.bigIds = ids; await save()
  }

  if (phases.includes('jev') && cfg.jevKey) {
    const log: any[] = []; report.phases.jev = log
    setAi({ defaultEngine: 'jev', jev: { baseUrl: 'https://api.typesafe.ai', apiKey: cfg.jevKey, model: 'jev-latest' }, fallbackLocal: false }); await wait(300)
    const eng = S().engine; const sample = byId('C-2024-003'); const sign = byId('C-2026-008'); const lease = byId('C-2024-002')
    const big = S().db.contracts.find((c: any) => (c.textLen || 0) > 500000)
    await timed('JEV 连接 /v1/models', async () => ({ data: (await zh.http({ url: 'https://api.typesafe.ai/v1/models', method: 'GET', headers: { Authorization: 'Bearer ' + cfg.jevKey }, maxRetries: 1 })).json }), log)
    await timed('起草·条款生成（JEV Choice 选条款）', () => eng.draftClause('违约', '违约金不超过合同总额15%，设赔偿上限', S().db.contracts), log)
    await timed('起草·条款推荐（Noul 检测缺失）', () => eng.recommendClauses(sample, S().db.contracts), log)
    await timed('审核·要素提取（样例 C-2024-003）', () => eng.extractFacts(sample), log)
    if (big) await timed('审核·要素提取（800 页大文件）', () => eng.extractFacts(big), log)
    const rv = await timed('审核·风险审查（样例）', () => eng.review(sample), log)
    if (big) await timed('审核·风险审查（800 页大文件，分块 map-reduce）', () => eng.review(big, { onProgress: () => {} }), log)
    await timed('审批·审批建议', () => eng.approvalSummary(sample, rv?.data || []), log)
    await timed('签署·签前一致性（C-2026-008）', () => eng.presignCheck(sign), log)
    await timed('履约·义务节点提取', () => eng.extractObligations(sample), log)
    await timed('履约·风险预警', () => eng.riskAlerts(sample), log)
    await timed('归档·语义检索', () => eng.search('数据传输到境外', S().db.contracts.filter((c: any) => c.sample)), log)
    await timed('归档·问答（样例库）', () => eng.ask('哪份合同适用新加坡法律？', S().db.contracts.filter((c: any) => c.sample)), log)
    if (big) await timed('归档·问答（大文件）', () => eng.ask('合同争议提交哪个仲裁机构？', [big]), log)
    await timed('续约·续约建议', () => eng.renewalAdvice(lease), log)
    await timed('助手·意图路由', () => eng.chat([{ role: 'user', content: '帮我看看这份合同能不能批' }], '合同 C-2024-003'), log)
    await save()
    // 批量审查 UI（JEV + 规则库）：样例 + 1 个大文件
    await timed('批量审查 UI（JEV + 规则库，8 样例 + 1 大文件）', async () => { const ids = S().db.contracts.filter((c: any) => c.sample).map((c: any) => c.id).concat(big ? [big.id] : []); sessionStorage.setItem('zh-batch', JSON.stringify(ids)); location.hash = '#/contracts'; await wait(300); location.hash = '#/batch'; await wait(600); clickText('.btn.big', '开始审查'); for (let i = 0; i < 3000; i++) { await wait(100); if (!document.querySelector('.btn.big .spin')) break } await wait(500); return { data: { summary: document.querySelector('.review-sum')?.textContent, stats: [...document.querySelectorAll('.pick .muted')].map((x) => x.textContent).join(' ') } } }, log)
    if (cfg.shots) { (window as any).__exportDir = cfg.shots.replace(/zhihe-shots.*/, 'zhihe-testdata'); clickText('.ph-actions .btn', '导出 Excel'); await wait(800); clickText('.ph-actions .btn', '导出 CSV'); await wait(500); clickText('.ph-actions .btn', '导出 PDF'); await wait(2500); await zh.e2eShot(`${cfg.shots}/jev-batch-review.png`) }
    await shot(cfg, 'jev-contract-stages', '#/contract/C-2024-003', 1500, "document.querySelectorAll('.jev-card .btn')[1].click();setTimeout(()=>document.querySelectorAll('.jev-card .btn')[2].click(),4000)")
    await wait(5000); if (cfg.shots) await zh.e2eShot(`${cfg.shots}/jev-contract-stages.png`)
    await shot(cfg, 'jev-presign', '#/contract/C-2026-008', 1500, "document.querySelectorAll('.jev-card .btn')[3].click()")
    await shot(cfg, 'jev-archive-qa', '#/archive', 1200, "document.querySelectorAll('.card .btn.jev')[0].click()")
    await shot(cfg, 'settings-engines', '#/settings', 1500)
    await save()
  }

  if (phases.includes('ollama')) {
    const log: any[] = []; report.phases.ollama = log
    setAi({ defaultEngine: 'ollama', ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:0.5b' }, fallbackLocal: false, tokenBudget: 40000 }); await wait(300)
    const eng = S().engine; const sample = byId('C-2024-003'); const lease = byId('C-2024-002')
    await timed('Ollama /api/tags 列模型', async () => ({ data: (await zh.http({ url: 'http://127.0.0.1:11434/api/tags', method: 'GET', maxRetries: 0 })).json?.models?.map((m: any) => m.name) }), log)
    await timed('起草·条款生成', () => eng.draftClause('保密', '保密期限五年', []), log)
    await timed('审核·要素提取（样例）', () => eng.extractFacts(sample), log)
    const rv = await timed('审核·风险审查（样例）', () => eng.review(sample), log)
    await timed('审批·审批建议', () => eng.approvalSummary(sample, rv?.data || []), log)
    await timed('履约·义务节点提取', () => eng.extractObligations(sample), log)
    await timed('归档·问答', () => eng.ask('哪份合同适用新加坡法律？', S().db.contracts.filter((c: any) => c.sample)), log)
    await timed('续约·续约建议', () => eng.renewalAdvice(lease), log)
    await timed('助手·自由对话', () => eng.chat([{ role: 'user', content: '预付款比例过高有什么风险？' }], ''), log)
    const big = S().db.contracts.find((c: any) => (c.textLen || 0) > 500000)
    if (big) await timed('审核·风险审查（大文件，预算 4 万 token）', () => eng.review(big), log)
    // 混合路由：审核用 JEV，其余用 Ollama
    if (cfg.jevKey) { setAi({ stageEngine: { review: 'jev', extract: 'jev', approval: 'jev' } }); await wait(300); await shot(cfg, 'settings-per-stage', '#/settings', 1500) }
    await save()
  }
  report.finishedAt = new Date().toISOString(); report.memEnd = await zh.metrics(); await save(); zh.e2eQuit()
}
