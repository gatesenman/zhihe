import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { useStore, zh } from './store'
import { Icon, VerdictChip, SampleTag, PageHead, Btn, Card, Empty, Fallback, JevBadge, StatusChip, verdictLabel } from './ui'
import { FindingList } from './pages1'
import { go } from './App'
import type { Rule, Facts, ReviewItem, Verdict, Finding } from './types'
import { runRule, aggregate, riskScore, fmtMoney } from './engine'
import { getText } from './textcache'
import { CancelToken, limiter } from './ai/runtime'

export function Rules({ autoTest }: { autoTest?: boolean }) {
  const { db, set, toast } = useStore()
  const [sel, setSel] = useState(autoTest ? 'R005' : db.rules[0]?.id); const [q, setQ] = useState('')
  const rule = db.rules.find((r) => r.id === sel)
  const [cid, setCid] = useState(autoTest ? 'C-2024-003' : db.contracts[0]?.id); const [mode, setMode] = useState<'contract' | 'facts'>('contract')
  const [factJson, setFactJson] = useState(JSON.stringify({ partyA: '甲公司', partyB: '乙公司', amount: 2000000, prepaymentRatio: 50, governingLaw: '中华人民共和国法律' }, null, 2))
  const [result, setResult] = useState<any>(null); const [all, setAll] = useState<any[] | null>(null)
  const upd = (p: Partial<Rule>) => set((d) => ({ ...d, rules: d.rules.map((r) => (r.id === sel ? { ...r, ...p } : r)) }))
  const target = async () => { if (mode === 'contract') { const c0 = db.contracts.find((x) => x.id === cid)!; const c = { ...c0, text: await getText(c0.id) }; return { c, f: c.facts } } const f: Facts = JSON.parse(factJson); return { c: { id: '自定义', title: '自定义要素集', type: '其他', text: '', facts: f } as any, f } }
  const test = async () => { try { const { c, f } = await target(); setResult({ ...runRule(rule!, c, f), facts: f }) } catch (e: any) { setResult({ verdict: 'warn', reason: '要素 JSON 解析失败：' + e.message, ms: 0 }) } }
  const testAll = async () => { const out = []; for (const c of db.contracts) out.push({ c, r: runRule(rule!, { ...c, text: await getText(c.id) }) }); setAll(out) }
  useEffect(() => { if (autoTest) { setTimeout(test, 50); setTimeout(testAll, 80) } }, [])
  const add = () => { const n = db.rules.length + 1; const code = 'R' + String(n + 100).slice(-3); const r: Rule = { id: code + Date.now(), code, name: '新规则', category: '自定义', severity: 'warn', enabled: true, script: 'return f.amount > 0', message: '金额为 ${f.amount}' }; set((d) => ({ ...d, rules: [...d.rules, r] })); setSel(r.id) }
  const list = db.rules.filter((r) => !q || (r.name + r.code + r.category).includes(q))
  return <>
    <PageHead title="规则库" sub={`${db.rules.length} 条规则 · 规则为基于要素 f / 合同 c 的 JavaScript 条件脚本`} icon="code-box-line"><Btn icon="add-line" kind="primary" onClick={add}>新建规则</Btn></PageHead>
    <div className="split">
      <div className="card list-pane"><div className="tb-search"><Icon n="search-line" /><input placeholder="搜索规则" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {list.map((r) => <div key={r.id} className={'rule-item' + (r.id === sel ? ' on' : '')} onClick={() => { setSel(r.id); setResult(null); setAll(null) }}><span className={'sev ' + r.severity}><Icon n={r.severity === 'fail' ? 'close-circle-fill' : 'error-warning-fill'} /></span><div><b>{r.name}</b><small><span className="mono">{r.code}</span> · {r.category}{r.sample ? ' · 示例数据' : ''}</small></div>{!r.enabled && <span className="chip off">停用</span>}</div>)}
      </div>
      {rule ? <div className="rule-main">
        <Card title="规则定义" icon="edit-2-line" extra={<>{rule.sample && <SampleTag />}<label className="switch"><input type="checkbox" checked={rule.enabled} onChange={(e) => upd({ enabled: e.target.checked })} /><span className="knob" />启用</label><Btn icon="delete-bin-6-line" kind="danger" onClick={() => { set((d) => ({ ...d, rules: d.rules.filter((r) => r.id !== sel) })); setSel(db.rules[0]?.id) }}>删除</Btn></>}>
          <div className="form"><label><span>编号</span><input value={rule.code} onChange={(e) => upd({ code: e.target.value })} /></label><label><span>名称</span><input value={rule.name} onChange={(e) => upd({ name: e.target.value })} /></label><label><span>分类</span><input value={rule.category} onChange={(e) => upd({ category: e.target.value })} /></label><label><span>违反时判定</span><select value={rule.severity} onChange={(e) => upd({ severity: e.target.value as any })}><option value="fail">不通过</option><option value="warn">警告</option></select></label>
            <label className="wide"><span>条件脚本（函数体，返回 true 表示通过；也可返回 {'{pass, message}'}）</span><textarea className="code" spellCheck={false} value={rule.script} onChange={(e) => upd({ script: e.target.value })} /></label>
            <label className="wide"><span>不通过时的提示（支持 {'${f.字段}'} 插值）</span><input value={rule.message} onChange={(e) => upd({ message: e.target.value })} /></label></div>
          <div className="hint"><Icon n="information-line" />可用要素字段：partyA, partyB, amount, signDate, startDate, endDate, paymentTerms, prepaymentRatio, penaltyRate, liabilityCap, liability, governingLaw, disputeResolution, confidentiality, terminationNoticeDays, autoRenew, warrantyMonths, ipOwnership；合同字段：c.type, c.amount, c.status, c.text</div>
        </Card>
        <Card title="测试运行器" icon="play-circle-line">
          <div className="toolbar inner"><div className="seg"><button className={mode === 'contract' ? 'on' : ''} onClick={() => setMode('contract')}>选择合同</button><button className={mode === 'facts' ? 'on' : ''} onClick={() => setMode('facts')}>自定义要素集</button></div>
            {mode === 'contract' && <select value={cid} onChange={(e) => setCid(e.target.value)}>{db.contracts.map((c) => <option key={c.id} value={c.id}>{c.id} {c.title}</option>)}</select>}
            <div className="spacer" /><Btn icon="play-fill" kind="primary" onClick={test}>运行规则</Btn><Btn icon="play-list-2-line" onClick={testAll}>对全部合同运行</Btn></div>
          {mode === 'facts' && <textarea className="code" style={{ height: 130 }} value={factJson} onChange={(e) => setFactJson(e.target.value)} />}
          {result && <div className={'test-result v-' + result.verdict}><div className="tr-h"><VerdictChip v={result.verdict} /><b>{rule.code} {rule.name}</b><span className="muted">耗时 {result.ms?.toFixed(2)} ms</span></div><div>{result.reason}</div>{result.facts && <details><summary>输入要素</summary><pre>{JSON.stringify(result.facts, null, 2)}</pre></details>}</div>}
          {all && <table className="tbl"><thead><tr><th>合同</th><th>结果</th><th>原因</th></tr></thead><tbody>{all.map(({ c, r }) => <tr key={c.id}><td><span className="mono muted">{c.id}</span> {c.title}</td><td><VerdictChip v={r.verdict} /></td><td>{r.reason}</td></tr>)}</tbody></table>}
        </Card>
      </div> : <Empty text="请选择规则" />}
    </div>
  </>
}

const GROUPS: { k: Verdict | 'all'; t: string }[] = [{ k: 'all', t: '全部' }, { k: 'fail', t: '不通过' }, { k: 'warn', t: '警告' }, { k: 'pass', t: '通过' }]
export function Batch({ auto }: { auto?: boolean }) {
  const { db, set, engine, updateContract, toast } = useStore()
  const pre = JSON.parse(sessionStorage.getItem('zh-batch') || 'null')
  const [sel, setSel] = useState<string[]>(pre || db.contracts.filter((c) => c.status !== 'archived').map((c) => c.id))
  const [useRules, setUseRules] = useState(true); const [useJev, setUseJev] = useState(true)
  const [items, setItems] = useState<ReviewItem[] | null>(db.reviews[0]?.items ?? null); const [prog, setProg] = useState(-1)
  const [g, setG] = useState<Verdict | 'all'>('all'); const [q, setQ] = useState(''); const [open, setOpen] = useState<string[]>([]); const [fb, setFb] = useState<string>('')
  const [sub, setSub] = useState<Record<string, string>>({}); const tok = React.useRef<CancelToken | null>(null); const [stats, setStats] = useState<any>(null)
  const run = async () => {
    sessionStorage.removeItem('zh-batch')
    const out: ReviewItem[] = []; setProg(0); setSub({}); setFb(''); const t0 = performance.now(); const ct = (tok.current = new CancelToken()); let calls = 0, tokens = 0
    const lim = limiter(2) // 合同级并发 2；每份合同内部再按引擎并发限制分块调用
    let n = 0
    await Promise.all(sel.map((id) => lim(async () => {
      if (ct.cancelled) return
      const c = db.contracts.find((x) => x.id === id)!; const doc = { ...c, text: await getText(c.id) }
      const fs: Finding[] = useRules ? db.rules.filter((r) => r.enabled).map((r) => { const { error, ms, ...f } = runRule(r, doc); return f }) : []
      let eng = '规则库'
      if (useJev) { try { const m = await engine.review(c, { cancel: ct, onProgress: (d, t) => setSub((s) => ({ ...s, [c.id]: `${d}/${t}` })) }); fs.push(...m.data); eng = m.engine; if (m.fallback) setFb(m.fallback); calls += m.usage?.calls || 0; tokens += m.usage?.inputTokens || 0 } catch (e: any) { fs.push({ ruleId: 'AI-ERR', ruleName: 'AI 审查', source: 'AI', verdict: 'warn', reason: e.message }) } }
      out.push({ contractId: c.id, title: c.title, verdict: aggregate(fs), risk: riskScore(fs), findings: fs, engine: eng, at: new Date().toISOString() })
      setProg(++n); setSub((s) => ({ ...s, [c.id]: '完成' }))
    })))
    out.sort((a, b) => sel.indexOf(a.contractId) - sel.indexOf(b.contractId))
    setStats({ ms: performance.now() - t0, calls, tokens, cancelled: ct.cancelled }); tok.current = null
    set((d) => ({ ...d, contracts: d.contracts.map((c) => { const it = out.find((x) => x.contractId === c.id); return it ? { ...c, lastVerdict: it.verdict, risk: it.risk } : c }), reviews: [{ id: 'RV' + Date.now(), at: new Date().toISOString(), items: out }, ...d.reviews].slice(0, 20) }))
    setItems(out); setProg(-1); setOpen(out.filter((x) => x.verdict === 'fail').map((x) => x.contractId).slice(0, 2)); toast(ct.cancelled ? `已取消，完成 ${out.length} 份` : `批量审查完成：${out.length} 份合同`)
  }
  useEffect(() => { if (auto) setTimeout(run, 100) }, [])
  const shown = (items || []).filter((it) => (g === 'all' || it.verdict === g) && (!q || (it.title + it.contractId + it.findings.map((f) => f.reason + f.ruleName).join()).includes(q)))
  const rows = () => (items || []).flatMap((it) => it.findings.map((f) => ({ 合同编号: it.contractId, 合同名称: it.title, 综合结论: verdictLabel(it.verdict), 风险评分: it.risk, 来源: f.source === '规则库' ? '规则库' : 'AI 模型', 规则编号: f.ruleId, 规则名称: f.ruleName, 规则结果: verdictLabel(f.verdict), 原因: f.reason })))
  const exportCsv = async () => { const r = rows(); const h = Object.keys(r[0]); const csv = [h.join(','), ...r.map((x: any) => h.map((k) => `"${String(x[k]).replace(/"/g, '""')}"`).join(','))].join('\r\n'); const p = await zh.saveFile({ path: (window as any).__exportDir ? (window as any).__exportDir + '/review.csv' : undefined, name: '智合-批量审查结果.csv', data: csv, filters: [{ name: 'CSV', extensions: ['csv'] }] }); p && toast('已导出 ' + p) }
  const exportXlsx = async () => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((items || []).map((it) => ({ 合同编号: it.contractId, 合同名称: it.title, 综合结论: verdictLabel(it.verdict), 风险评分: it.risk, 不通过项: it.findings.filter((f) => f.verdict === 'fail').length, 警告项: it.findings.filter((f) => f.verdict === 'warn').length, 引擎: it.engine }))), '汇总'); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows()), '明细'); const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }); const p = await zh.saveFile({ path: (window as any).__exportDir ? (window as any).__exportDir + '/review.xlsx' : undefined, name: '智合-批量审查结果.xlsx', data: Array.from(new Uint8Array(buf)), filters: [{ name: 'Excel', extensions: ['xlsx'] }] }); p && toast('已导出 ' + p) }
  const exportPdf = async () => {
    const col: any = { pass: '#16a34a', warn: '#d97706', fail: '#dc2626' }
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:12px;color:#111;padding:24px}h1{font-size:20px}h2{font-size:14px;margin:18px 0 6px;border-left:4px solid #2563eb;padding-left:8px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 6px;text-align:left}th{background:#f1f5f9}.v{font-weight:bold}</style></head><body><h1>智合 · AI 批量审查报告</h1><p>生成时间：${new Date().toLocaleString('zh-CN')} · 合同数：${items!.length} · 通过 ${items!.filter((x) => x.verdict === 'pass').length} / 警告 ${items!.filter((x) => x.verdict === 'warn').length} / 不通过 ${items!.filter((x) => x.verdict === 'fail').length}</p>${items!.map((it) => `<h2>${it.contractId} ${it.title} — <span class="v" style="color:${col[it.verdict]}">${verdictLabel(it.verdict)}</span>（风险 ${it.risk}）</h2><table><tr><th>结果</th><th>来源</th><th>规则</th><th>原因</th></tr>${it.findings.filter((f) => f.verdict !== 'pass').map((f) => `<tr><td style="color:${col[f.verdict]}">${verdictLabel(f.verdict)}</td><td>${f.source === '规则库' ? '规则库' : 'AI 模型'}</td><td>${f.ruleId} ${f.ruleName}</td><td>${f.reason}</td></tr>`).join('') || '<tr><td colspan=4>全部通过</td></tr>'}</table>`).join('')}</body></html>`
    const p = await zh.savePdf({ path: (window as any).__exportDir ? (window as any).__exportDir + '/review.pdf' : undefined, name: '智合-批量审查报告.pdf', html }); p && toast('已导出 ' + p)
  }
  const cnt = (v: Verdict | 'all') => (items || []).filter((x) => v === 'all' || x.verdict === v).length
  return <>
    <PageHead title="批量审查" sub="AI 模型 + 规则库联合审查，结果按 通过 / 不通过 / 警告 分组" icon="shield-check-line">{items && <><Btn icon="file-excel-2-line" onClick={exportXlsx}>导出 Excel</Btn><Btn icon="file-text-line" onClick={exportCsv}>导出 CSV</Btn><Btn icon="file-pdf-2-line" onClick={exportPdf}>导出 PDF</Btn></>}</PageHead>
    <div className="batch">
      <Card title={`选择合同（${sel.length}/${db.contracts.length}）`} icon="checkbox-multiple-line" className="pick" extra={<a className="link" onClick={() => setSel(sel.length === db.contracts.length ? [] : db.contracts.map((c) => c.id))}>{sel.length === db.contracts.length ? '全不选' : '全选'}</a>}>
        <div className="pick-list">{db.contracts.map((c) => <label key={c.id} className="pick-item"><input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} /><div><b>{c.title}</b><small>{c.id} · {fmtMoney(c.amount)}{(c.textLen || 0) > 300000 ? ` · ${c.pages || '?'} 页` : ''}{sub[c.id] ? ` · ${sub[c.id]}` : ''}</small></div><StatusChip s={c.status} /></label>)}</div>
        <div className="pick-opts"><label className="switch"><input type="checkbox" checked={useJev} onChange={(e) => setUseJev(e.target.checked)} /><span className="knob" />AI 模型审查 <JevBadge engine={engine.labelFor('review')} /></label><label className="switch"><input type="checkbox" checked={useRules} onChange={(e) => setUseRules(e.target.checked)} /><span className="knob" />规则库（{db.rules.filter((r) => r.enabled).length} 条启用）</label></div>
        <Btn icon={prog >= 0 ? 'loader-4-line spin' : 'play-fill'} kind="primary big" disabled={!sel.length || prog >= 0 || (!useJev && !useRules)} onClick={run}>{prog >= 0 ? `审查中 ${prog}/${sel.length}` : `开始审查 ${sel.length} 份合同`}</Btn>
        {prog >= 0 && <><div className="progress"><i style={{ width: (prog / sel.length) * 100 + '%' }} /></div><Btn icon="stop-circle-line" kind="danger" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} onClick={() => tok.current?.cancel()}>取消审查</Btn></>}
        {stats && <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>耗时 {(stats.ms / 1000).toFixed(1)}s · AI 调用 {stats.calls} 次 · {stats.tokens.toLocaleString()} tokens{stats.cancelled ? ' · 已取消' : ''}</div>}
      </Card>
      <div className="results">
        {fb && <div className="banner bad"><Icon n="alert-line" />{fb}</div>}
        {items ? <>
          <div className="review-sum big">{(['pass', 'warn', 'fail'] as const).map((v) => <div key={v} className={'rs v-' + v + (g === v ? ' on' : '')} onClick={() => setG(g === v ? 'all' : v)}><b>{cnt(v)}</b><VerdictChip v={v} /></div>)}</div>
          <div className="toolbar"><div className="seg">{GROUPS.map((x) => <button key={x.k} className={g === x.k ? 'on' : ''} onClick={() => setG(x.k)}>{x.t} {cnt(x.k)}</button>)}</div><div className="tb-search"><Icon n="filter-3-line" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="按合同 / 规则 / 原因筛选" /></div><div className="spacer" /><Btn icon="expand-up-down-line" onClick={() => setOpen(open.length ? [] : shown.map((x) => x.contractId))}>{open.length ? '全部收起' : '全部展开'}</Btn></div>
          {(['fail', 'warn', 'pass'] as Verdict[]).filter((v) => g === 'all' || g === v).map((v) => { const grp = shown.filter((x) => x.verdict === v); if (!grp.length) return null; return <div key={v} className="group"><div className={'group-h v-' + v}><VerdictChip v={v} /><span>{grp.length} 份合同</span></div>
            {grp.map((it) => { const o = open.includes(it.contractId); const f = it.findings.filter((x) => x.verdict === 'fail').length, w = it.findings.filter((x) => x.verdict === 'warn').length; return <div key={it.contractId} className="res-item"><div className="res-h" onClick={() => setOpen(o ? open.filter((x) => x !== it.contractId) : [...open, it.contractId])}><Icon n={o ? 'arrow-down-s-line' : 'arrow-right-s-line'} /><span className="mono muted">{it.contractId}</span><b>{it.title}</b><span className="spacer" /><span className="cnt fail">{f} 不通过</span><span className="cnt warn">{w} 警告</span><span className="risk-bar"><i style={{ width: it.risk + '%' }} className={it.risk >= 50 ? 'hi' : it.risk >= 20 ? 'mid' : ''} /></span><span className="mono">风险 {it.risk}</span><a className="link" onClick={(e) => { e.stopPropagation(); go('contract/' + it.contractId) }}>详情</a></div>{o && <FindingList fs={it.findings} only={false} />}</div> })}</div> })}
          {!shown.length && <Empty text="没有符合筛选条件的结果" />}
        </> : <Empty text="选择合同后点击「开始审查」" />}
      </div>
    </div>
  </>
}
