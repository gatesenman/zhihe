import React, { useMemo, useState } from 'react'
import { useStore, zh } from './store'
import { go } from './App'
import { Icon, StatusChip, VerdictChip, SampleTag, PageHead, Btn, Card, Empty, Fallback, JevBadge, VirtualText } from './ui'
import { getText, putText, approvedId } from './textcache'
import { importPaths, ImportPanel } from './importer'
import { engineIdFor } from './ai/router'
import { CancelToken } from './ai/runtime'
import { STAGES, FACT_FIELDS, stageLabel } from './types'
import type { Contract, Status, Facts, Finding } from './types'
import { daysTo, fmtMoney, localExtract, runRule, aggregate, riskScore } from './engine'

export function Dashboard() {
  const { db } = useStore()
  const cs = db.contracts
  const active = cs.filter((c) => c.status !== 'archived')
  const total = active.reduce((s, c) => s + c.amount, 0)
  const exp = active.filter((c) => daysTo(c.endDate) <= db.settings.remindDays).sort((a, b) => daysTo(a.endDate) - daysTo(b.endDate))
  const pend = cs.flatMap((c) => c.milestones.filter((m) => !m.done).map((m) => ({ ...m, c }))).sort((a, b) => a.due.localeCompare(b.due))
  const last = db.reviews[0]
  const byType = Object.entries(cs.reduce((m: any, c) => ((m[c.type] = (m[c.type] || 0) + c.amount), m), {})) as [string, number][]
  const maxT = Math.max(...byType.map((x) => x[1]), 1)
  return <>
    <PageHead title="仪表盘" sub="合同全生命周期概览 · 数据含示例数据" icon="dashboard-3-line"><Btn icon="add-line" kind="primary" onClick={() => go('draft')}>起草合同</Btn><Btn icon="shield-check-line" onClick={() => go('batch')}>批量审查</Btn></PageHead>
    <div className="kpis">
      {[['合同总数', cs.length, 'file-list-3-line', 'blue'], ['在途合同金额', fmtMoney(total), 'money-cny-circle-line', 'green'], ['履约中', cs.filter((c) => c.status === 'performing').length, 'loop-right-line', 'violet'], [`${db.settings.remindDays}天内到期`, exp.length, 'alarm-warning-line', 'amber'], ['待审核/审批', cs.filter((c) => c.status === 'review' || c.status === 'approval').length, 'time-line', 'red']].map(([t, v, i, col]) =>
        <div key={t as string} className={'kpi ' + col}><div className="kpi-i"><Icon n={i as string} /></div><div><span>{t}</span><b>{v}</b></div></div>)}
    </div>
    <Card title="生命周期分布" icon="git-branch-line"><div className="pipeline">{STAGES.map((s, i) => { const n = cs.filter((c) => c.status === s.key).length; return <React.Fragment key={s.key}><div className={'pipe st-' + s.key} onClick={() => go('contracts?status=' + s.key)}><Icon n={s.icon.replace('ri-', '')} /><span>{s.label}</span><b>{n}</b></div>{i < STAGES.length - 1 && <Icon n="arrow-right-line" className="pipe-arrow" />}</React.Fragment> })}</div></Card>
    <div className="grid2">
      <Card title="到期 / 续约提醒" icon="calendar-event-line" extra={<a className="link" onClick={() => go('renewal')}>查看全部</a>}>
        {exp.length ? <table className="tbl"><thead><tr><th>合同</th><th>到期日</th><th>剩余</th><th>状态</th></tr></thead><tbody>{exp.map((c) => <tr key={c.id} onClick={() => go('contract/' + c.id)}><td>{c.title}</td><td>{c.endDate}</td><td><span className={'days ' + (daysTo(c.endDate) < 0 ? 'neg' : daysTo(c.endDate) < 45 ? 'soon' : '')}>{daysTo(c.endDate) < 0 ? `已过期 ${-daysTo(c.endDate)} 天` : `${daysTo(c.endDate)} 天`}</span></td><td><StatusChip s={c.status} /></td></tr>)}</tbody></table> : <Empty text="暂无即将到期合同" />}
      </Card>
      <Card title="待办履约节点" icon="flag-2-line" extra={<a className="link" onClick={() => go('performance')}>履约跟踪</a>}>
        <table className="tbl"><thead><tr><th>节点</th><th>合同</th><th>截止</th><th>金额</th></tr></thead><tbody>{pend.slice(0, 6).map((m) => <tr key={m.id} onClick={() => go('contract/' + m.c.id)}><td><Icon n={m.kind === 'payment' ? 'money-cny-box-line' : m.kind === 'delivery' ? 'truck-line' : 'task-line'} /> {m.title}</td><td>{m.c.title}</td><td className={daysTo(m.due) < 0 ? 'red' : ''}>{m.due}</td><td>{fmtMoney(m.amount)}</td></tr>)}</tbody></table>
      </Card>
    </div>
    <div className="grid2">
      <Card title="最近一次批量审查" icon="shield-check-line" extra={last ? <JevBadge engine={last.items[0]?.engine} /> : null}>
        {last ? <div className="review-sum">{(['pass', 'warn', 'fail'] as const).map((v) => <div key={v} className={'rs v-' + v}><b>{last.items.filter((x) => x.verdict === v).length}</b><VerdictChip v={v} /></div>)}<div className="rs-meta">{new Date(last.at).toLocaleString('zh-CN')} · {last.items.length} 份合同</div></div> : <Empty text="尚未运行批量审查" />}
      </Card>
      <Card title="合同金额按类型" icon="bar-chart-2-line">{byType.map(([t, v]) => <div key={t} className="bar-row"><span>{t}</span><div className="bar"><i style={{ width: (v / maxT) * 100 + '%' }} /></div><b>{fmtMoney(v)}</b></div>)}</Card>
    </div>
  </>
}

export function Contracts() {
  const { db, set, toast } = useStore()
  const params = new URLSearchParams(location.hash.split('?')[1])
  const [q, setQ] = useState(params.get('q') || ''); const [st, setSt] = useState<string>(params.get('status') || ''); const [sel, setSel] = useState<string[]>([])
  const list = db.contracts.filter((c) => (!st || c.status === st) && (!q || (c.title + c.id + c.counterparty + c.type).includes(q)))
  const doImport = async () => {
    const paths = await zh.pickFiles(); if (!paths.length) return
    const res = await importPaths(paths, (c) => set((d) => ({ ...d, contracts: [c, ...d.contracts] })))
    const okN = res.filter((j) => j.state === 'done').length; if (okN) toast(`已导入 ${okN} 份合同，已完成增量要素提取`)
    res.filter((j) => j.state === 'error').forEach((j) => toast(`${j.name} 解析失败：${j.error}`, 'err'))
  }
  return <>
    <PageHead title="合同库" sub="历史与在途合同统一管理" icon="file-list-3-line"><Btn icon="upload-2-line" onClick={doImport}>导入 PDF / DOCX / TXT</Btn><Btn icon="add-line" kind="primary" onClick={() => go('draft')}>新建合同</Btn></PageHead>
    <div className="toolbar">
      <div className="tb-search"><Icon n="search-line" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="编号 / 名称 / 相对方 / 类型" /></div>
      <div className="seg"><button className={!st ? 'on' : ''} onClick={() => setSt('')}>全部 {db.contracts.length}</button>{STAGES.map((s) => <button key={s.key} className={st === s.key ? 'on' : ''} onClick={() => setSt(s.key)}>{s.label} {db.contracts.filter((c) => c.status === s.key).length}</button>)}</div>
      <div className="spacer" />
      {sel.length > 0 && <Btn icon="shield-check-line" kind="primary" onClick={() => { sessionStorage.setItem('zh-batch', JSON.stringify(sel)); go('batch') }}>批量审查（{sel.length}）</Btn>}
    </div>
    <ImportPanel />
    <div className="table-wrap"><table className="tbl big"><thead><tr><th style={{ width: 36 }}><input type="checkbox" checked={sel.length === list.length && list.length > 0} onChange={(e) => setSel(e.target.checked ? list.map((c) => c.id) : [])} /></th><th>合同编号</th><th>合同名称</th><th>类型</th><th>相对方</th><th className="r">金额</th><th>到期日</th><th>状态</th><th>最近审查</th><th>负责人</th></tr></thead>
      <tbody>{list.map((c) => <tr key={c.id} onClick={() => go('contract/' + c.id)}><td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} /></td><td className="mono">{c.id}</td><td><b>{c.title}</b> {c.sample && <SampleTag />}{(c.textLen || 0) > 300000 && <span className="chip big-file"><Icon n="file-zip-line" />{c.pages ? c.pages + ' 页' : Math.round(c.textLen! / 10000) + ' 万字'}</span>}</td><td>{c.type}</td><td>{c.counterparty}</td><td className="r mono">{fmtMoney(c.amount)}</td><td>{c.endDate || '—'}{c.status !== 'archived' && daysTo(c.endDate) <= db.settings.remindDays && <Icon n="alarm-warning-fill" className="amber" />}</td><td><StatusChip s={c.status} /></td><td>{c.lastVerdict ? <VerdictChip v={c.lastVerdict} /> : <span className="muted">—</span>}</td><td>{c.owner}</td></tr>)}</tbody></table>{!list.length && <Empty text="没有匹配的合同" />}</div>
  </>
}

const NEXT: Record<Status, Status | null> = { draft: 'review', review: 'approval', approval: 'signing', signing: 'performing', performing: 'archived', archived: null }

export function ContractDetail({ id }: { id: string }) {
  const { db, updateContract, engine, toast } = useStore()
  const c = db.contracts.find((x) => x.id === id)
  const [tab, setTab] = useState('jev')
  if (!c) return <Empty text="合同不存在" />
  const advance = async () => { const n = NEXT[c.status]; if (!n) return; if (c.status === 'approval') await putText(approvedId(c.id), await getText(c.id)); updateContract(c.id, { status: n, hasApproved: c.status === 'approval' ? true : c.hasApproved, history: [...c.history, { at: new Date().toISOString().slice(0, 10), status: n, note: '流转至' + stageLabel(n) }] }); toast(`已流转至「${stageLabel(n)}」`) }
  const idx = STAGES.findIndex((s) => s.key === c.status)
  return <>
    <PageHead title={c.title} sub={`${c.id} · ${c.type} · 相对方：${c.counterparty} · 负责人：${c.owner}`} icon="file-text-line">{c.sample && <SampleTag />}<Btn icon="arrow-left-line" onClick={() => go('contracts')}>返回</Btn>{NEXT[c.status] && <Btn icon="arrow-right-circle-line" kind="primary" onClick={advance}>流转至「{stageLabel(NEXT[c.status]!)}」</Btn>}</PageHead>
    <div className="stepper">{STAGES.map((s, i) => <div key={s.key} className={'step ' + (i < idx ? 'done' : i === idx ? 'cur' : '')}><div className="step-i"><Icon n={i < idx ? 'check-line' : s.icon.replace('ri-', '')} /></div><span>{s.label}</span></div>)}</div>
    <div className="tabs">{[['jev', 'AI 阶段能力', 'sparkling-2-line'], ['facts', '要素提取', 'list-check-3'], ['text', '合同全文', 'article-line'], ['perf', '履约节点', 'flag-2-line'], ['hist', '流转记录', 'history-line']].map(([k, t, i]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon n={i} />{t}</button>)}</div>
    {tab === 'jev' && <JevStages c={c} />}
    {tab === 'facts' && <FactsEditor c={c} />}
    {tab === 'text' && <FullText c={c} />}
    {tab === 'perf' && <MilestoneTable c={c} />}
    {tab === 'hist' && <Card title="流转记录" icon="history-line"><ul className="timeline">{c.history.map((h, i) => <li key={i}><StatusChip s={h.status} /><span>{h.at}</span><span className="muted">{h.note}</span></li>)}</ul></Card>}
  </>
}

function FullText({ c }: { c: Contract }) {
  const { toast, updateContract } = useStore(); const [t, setT] = useState<string | null>(null); const [edit, setEdit] = useState(false); const [ms, setMs] = useState(0)
  React.useEffect(() => { const t0 = performance.now(); getText(c.id).then((x) => { setT(x); setMs(performance.now() - t0) }) }, [c.id])
  if (t == null) return <Card title="合同全文" icon="article-line"><Empty text="正在加载分块文本…" /></Card>
  const big = t.length > 200000
  return <Card title="合同全文" icon="article-line" extra={<><span className="muted">{c.chunks || 1} 个存储分块 · 加载 {ms.toFixed(0)} ms</span>{!big && <Btn icon={edit ? 'save-line' : 'edit-line'} onClick={async () => { if (edit) { await putText(c.id, t); updateContract(c.id, { preview: t.slice(0, 4000), textLen: t.length }); toast('已保存') } setEdit(!edit) }}>{edit ? '保存' : '编辑'}</Btn>}</>}>
    {edit ? <textarea className="doc" value={t} onChange={(e) => setT(e.target.value)} /> : <VirtualText text={t} />}
    {big && <div className="hint"><Icon n="information-line" />大文件（{t.length.toLocaleString()} 字）以只读虚拟滚动方式显示。</div>}
  </Card>
}

export function FactsEditor({ c }: { c: Contract }) {
  const { updateContract, engine, toast } = useStore()
  const [busy, setBusy] = useState(false); const [meta, setMeta] = useState<any>(null)
  const f = c.facts
  const setF = (k: keyof Facts, v: any) => updateContract(c.id, { facts: { ...f, [k]: v }, ...(k === 'amount' ? { amount: Number(v) || 0 } : {}), ...(k === 'endDate' ? { endDate: v } : {}) })
  const [prog, setProg] = useState('')
  const run = async () => { setBusy(true); try { const r: any = await engine.extractFacts(c, { onProgress: (d, n) => setProg(`${d}/${n}`) }); setMeta(r); updateContract(c.id, { facts: { ...f, ...r.data }, amount: r.data.amount ?? c.amount, endDate: r.data.endDate ?? c.endDate }); toast('AI 要素提取完成') } catch (e: any) { toast(e.message, 'err') } setBusy(false); setProg('') }
  return <Card title="合同要素（可编辑）" icon="list-check-3" extra={<><Fallback r={meta} /><Btn icon={busy ? 'loader-4-line spin' : 'sparkling-2-line'} kind="jev" onClick={run}>{busy ? `提取中 ${prog}` : 'AI 重新提取'}</Btn></>}>
    <div className="facts">{FACT_FIELDS.map((fd) => <label key={fd.key} className={fd.type === 'text' && ['paymentTerms', 'liability', 'disputeResolution', 'liabilityCap', 'ipOwnership'].includes(fd.key) ? 'wide' : ''}><span>{fd.label}{meta?.confidence && confKey(fd.key) && meta.confidence[confKey(fd.key)!] != null && <em className={'conf ' + (meta.confidence[confKey(fd.key)!] < 0.5 ? 'low' : '')}>{(meta.confidence[confKey(fd.key)!] * 100).toFixed(0)}%</em>}</span>
      {fd.type === 'bool' ? <select value={f[fd.key] === true ? '1' : f[fd.key] === false ? '0' : ''} onChange={(e) => setF(fd.key, e.target.value === '' ? undefined : e.target.value === '1')}><option value="">未识别</option><option value="1">是</option><option value="0">否</option></select>
        : <input type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text'} value={(f[fd.key] as any) ?? ''} placeholder="未识别" onChange={(e) => setF(fd.key, fd.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)} />}</label>)}</div>
  </Card>
}

const confKey = (k: string) => (({ partyA: 'partyA', partyB: 'partyB', amount: 'amount', startDate: 'startDate', endDate: 'endDate', signDate: 'signDate', prepaymentRatio: 'prepay', penaltyRate: 'penalty', terminationNoticeDays: 'notice', governingLaw: 'law', disputeResolution: 'dispute', confidentiality: 'conf', autoRenew: 'renew', liabilityCap: 'cap' }) as any)[k] as string | undefined

export function MilestoneTable({ c }: { c: Contract }) {
  const { updateContract, engine, toast } = useStore(); const [meta, setMeta] = useState<any>(null)
  const extract = async () => { const r = await engine.extractObligations(c); setMeta(r); const exist = new Set(c.milestones.map((m) => m.title)); const add = r.data.filter((m) => !exist.has(m.title)).map((m, i) => ({ ...m, id: `${c.id}-j${Date.now()}${i}` })); updateContract(c.id, { milestones: [...c.milestones, ...add] }); toast(`AI 提取 ${add.length} 个新履约节点`) }
  return <Card title="履约节点（里程碑 / 付款 / 义务）" icon="flag-2-line" extra={<><Fallback r={meta} /><Btn icon="sparkling-2-line" kind="jev" onClick={extract}>AI 提取履约义务</Btn><Btn icon="add-line" onClick={() => updateContract(c.id, { milestones: [...c.milestones, { id: c.id + '-m' + Date.now(), title: '新节点', due: new Date().toISOString().slice(0, 10), kind: 'obligation', done: false, source: '手工' }] })}>新增</Btn></>}>
    {c.milestones.length ? <table className="tbl"><thead><tr><th>完成</th><th>节点</th><th>类型</th><th>截止日期</th><th className="r">金额</th><th>来源</th><th /></tr></thead><tbody>{c.milestones.map((m) => { const up = (p: any) => updateContract(c.id, { milestones: c.milestones.map((x) => (x.id === m.id ? { ...x, ...p } : x)) }); return <tr key={m.id}><td><input type="checkbox" checked={m.done} onChange={(e) => up({ done: e.target.checked })} /></td><td><input className="cell" value={m.title} onChange={(e) => up({ title: e.target.value })} /></td><td><select className="cell" value={m.kind} onChange={(e) => up({ kind: e.target.value })}><option value="payment">付款</option><option value="delivery">交付</option><option value="obligation">义务</option></select></td><td><input className="cell" type="date" value={m.due} onChange={(e) => up({ due: e.target.value })} /></td><td className="r"><input className="cell r" type="number" value={m.amount ?? ''} onChange={(e) => up({ amount: e.target.value ? Number(e.target.value) : undefined })} /></td><td>{m.source === 'AI' || m.source === 'JEV' ? <JevBadge engine="AI" /> : '手工'}</td><td><button className="icon-btn" onClick={() => updateContract(c.id, { milestones: c.milestones.filter((x) => x.id !== m.id) })}><Icon n="delete-bin-6-line" /></button></td></tr> })}</tbody></table> : <Empty text="暂无履约节点，可点击「AI 提取履约义务」" />}
  </Card>
}

/** 每个生命周期阶段的 AI 能力面板（各阶段引擎可在设置中独立选择） */
function JevStages({ c }: { c: Contract }) {
  const { db, engine, updateContract, set, toast } = useStore()
  const [out, setOut] = useState<Record<string, any>>({}); const [busy, setBusy] = useState('')
  const [prog, setProg] = useState('')
  const run = async (k: string, fn: () => Promise<any>) => { setBusy(k); try { setOut((o) => ({ ...o, [k]: null })); const r = await fn(); setOut((o) => ({ ...o, [k]: r })) } catch (e: any) { toast(e.message, 'err') } finally { setBusy(''); setProg('') } }
  const fullReview = async () => { const doc = { ...c, text: await getText(c.id) }; const rules = db.rules.filter((r) => r.enabled).map((r) => runRule(r, doc)); const m = await engine.review(c, { onProgress: (d, n) => setProg(`${d}/${n}`) }); const all: Finding[] = [...rules, ...m.data]; updateContract(c.id, { lastVerdict: aggregate(all), risk: riskScore(all) }); return { ...m, data: all } }
  const AIST: Record<string, any> = { rec: 'draft', review: 'review', appr: 'approval', sign: 'signing', perf: 'performing', arch: 'archive', renew: 'renewal' }
  const blocks: { k: string; stage: Status | 'renewal'; title: string; desc: string; icon: string; act: () => Promise<any>; render: (r: any) => React.ReactNode }[] = [
    { k: 'rec', stage: 'draft', title: '起草 · 条款推荐', desc: '基于标准条款库与历史同类合同推荐缺失/优化条款', icon: 'draft-line', act: () => engine.recommendClauses(c, db.contracts),
      render: (r) => <div className="clauses">{r.data.map((x: any, i: number) => <div key={i} className="clause"><b>{x.title}</b><small>{x.from}</small><p>{x.text}</p><Btn icon="add-line" onClick={async () => { const t = (await getText(c.id)) + '\n\n补充条款：' + x.text; await putText(c.id, t); updateContract(c.id, { textLen: t.length }); toast('已插入合同正文') }}>插入正文</Btn></div>)}</div> },
    { k: 'review', stage: 'review', title: '审核 · 风险审查与评分', desc: '规则库 + AI 模型联合审查，输出 通过 / 不通过 / 警告', icon: 'search-eye-line', act: fullReview,
      render: (r) => <><div className="risk-line">综合结论 <VerdictChip v={aggregate(r.data)} /> 风险评分 <b className="risk">{riskScore(r.data)}</b>/100</div><FindingList fs={r.data} /></> },
    { k: 'appr', stage: 'approval', title: '审批 · 审批建议与摘要', desc: '自动生成审批摘要、关键风险与批准建议', icon: 'shield-check-line', act: async () => { const rv = await fullReview(); return engine.approvalSummary(c, rv.data) },
      render: (r) => <div className="summary"><span className={'chip ' + (r.data.recommendation === '建议批准' ? 'v-pass' : r.data.recommendation === '建议驳回' ? 'v-fail' : 'v-warn')}>{r.data.recommendation}</span><pre>{r.data.summary}</pre></div> },
    { k: 'sign', stage: 'signing', title: '签署 · 签前一致性校验', desc: '比对待签文本与审批通过版本，防止私改', icon: 'quill-pen-line', act: () => engine.presignCheck(c),
      render: (r) => <><div className={'banner ' + (r.data.consistent ? 'ok' : 'bad')}><Icon n={r.data.consistent ? 'checkbox-circle-line' : 'error-warning-line'} />{r.data.note}</div>{r.data.diffs.map((d: any, i: number) => <div key={i} className="diff">{d.material != null && <div className={'mat ' + (d.material >= 0.5 ? 'bad' : '')}>实质性修改概率 {(d.material * 100).toFixed(0)}%</div>}<div className="del">审批版：{d.approved}</div><div className="ins">待签版：{d.current}</div></div>)}</> },
    { k: 'perf', stage: 'performing', title: '履约 · 义务提取与风险预警', desc: '从条款中提取付款/交付/义务节点，监控逾期与临期', icon: 'loop-right-line', act: async () => { const a = await engine.riskAlerts(c); const o = await engine.extractObligations(c); return { ...a, data: { alerts: a.data, obl: o.data } } },
      render: (r) => <><ul className="alerts">{r.data.alerts.length ? r.data.alerts.map((a: string, i: number) => <li key={i}><Icon n="alarm-warning-line" />{a}</li>) : <li className="ok"><Icon n="checkbox-circle-line" />暂无履约风险</li>}</ul><div className="muted">识别到 {r.data.obl.length} 个义务节点：{r.data.obl.map((m: any) => `${m.title}(${m.due})`).join('、')}（可在「履约节点」页一键导入）</div></> },
    { k: 'arch', stage: 'archived', title: '归档 · 合同问答', desc: '针对本合同进行语义检索问答', icon: 'archive-line', act: () => engine.ask('违约责任与争议解决如何约定', [c]),
      render: (r) => <pre className="answer">{r.data.answer}</pre> },
    { k: 'renew', stage: 'renewal', title: '续约 / 到期 · 续约建议', desc: '结合到期日、自动续约条款与履约完成率给出建议', icon: 'calendar-event-line', act: () => engine.renewalAdvice(c),
      render: (r) => <pre className="answer">{r.data}</pre> }
  ]
  return <div className="jev-grid">{blocks.map((b) => { const r = out[b.k]; const cur = b.stage === c.status; const off = engineIdFor(db.settings.ai, AIST[b.k]) === 'off'; return <div key={b.k} className={'jev-card' + (cur ? ' current' : '')}>
    <div className="jc-h"><div className="jc-i"><Icon n={b.icon} /></div><div><b>{b.title}</b><p>{b.desc}</p><JevBadge engine={engine.labelFor(AIST[b.k])} /></div>{cur && <span className="chip cur">当前阶段</span>}<Btn icon={busy === b.k ? 'loader-4-line spin' : 'sparkling-2-line'} kind="jev" disabled={off || !!busy} onClick={() => run(b.k, b.act)}>{off ? '已停用' : busy === b.k ? `运行中 ${prog}` : '运行 AI'}</Btn></div>
    {r && <div className="jc-b"><Fallback r={r} />{b.render(r)}</div>}</div> })}</div>
}

export function FindingList({ fs, only }: { fs: Finding[]; only?: boolean }) {
  return <table className="tbl findings"><thead><tr><th>结果</th><th>来源</th><th>规则</th><th>原因</th></tr></thead><tbody>{fs.filter((f) => !only || f.verdict !== 'pass').map((f, i) => <tr key={i}><td><VerdictChip v={f.verdict} /></td><td>{f.source !== '规则库' ? <JevBadge engine="AI 模型" /> : <span className="chip rule"><Icon n="code-box-line" />规则库</span>}</td><td><span className="mono muted">{f.ruleId}</span> {f.ruleName}</td><td>{f.reason}</td></tr>)}</tbody></table>
}

export function Drafting() {
  const { db, engine, set, toast } = useStore()
  const [type, setType] = useState('违约'); const [req, setReq] = useState('违约金不超过合同总额 15%，设赔偿上限'); const [res, setRes] = useState<any>(null); const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ title: '新合同', ctype: '服务合同', b: '', amount: 100000, start: '2026-11-01', end: '2027-10-31' })
  const gen = async () => { setBusy(true); try { setRes(await engine.draftClause(type, req, db.contracts)) } catch (e: any) { toast(e.message, 'err') } setBusy(false) }
  const create = async () => {
    const id = `C-2026-D${Date.now().toString().slice(-4)}`
    const text = `${form.title}\n合同编号：${id}\n\n甲方：星海科技（上海）有限公司\n乙方：${form.b}\n\n第一条 合同标的\n（待补充）\n\n第二条 合同金额\n本合同总金额为人民币${form.amount.toLocaleString('zh-CN')}元（含税）。\n\n第三条 合同期限\n本合同自${form.start}起生效，至${form.end}止。\n\n第四条 违约责任\n${(res?.data?.split('\n')[1]) || ''}\n\n第五条 适用法律与争议解决\n本合同适用中华人民共和国法律。争议提交上海仲裁委员会仲裁。\n`
    await putText(id, text)
    set((d) => ({ ...d, contracts: [{ id, title: form.title, type: form.ctype, counterparty: form.b || '—', owner: '王敏', status: 'draft', amount: form.amount, endDate: form.end, preview: text.slice(0, 4000), textLen: text.length, chunks: 1, facts: localExtract(text), milestones: [], history: [{ at: new Date().toISOString().slice(0, 10), status: 'draft', note: 'AI 模板起草' }], createdAt: new Date().toISOString() }, ...d.contracts] }))
    toast('已创建草稿合同'); go('contract/' + id)
  }
  return <>
    <PageHead title="起草" sub="模板填充 · AI 条款生成 · 历史条款推荐" icon="draft-line"><JevBadge engine={engine.labelFor('draft')} /></PageHead>
    <div className="grid2">
      <Card title="模板填充 · 新建合同" icon="file-add-line">
        <div className="form">{[['合同名称', 'title'], ['乙方（相对方）', 'b']].map(([l, k]) => <label key={k}><span>{l}</span><input value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>)}
          <label><span>合同类型</span><select value={form.ctype} onChange={(e) => setForm({ ...form, ctype: e.target.value })}>{['服务合同', '采购合同', '技术开发', '租赁合同', '保密协议', '其他'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>金额（元）</span><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></label>
          <label><span>生效日期</span><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
          <label><span>到期日期</span><input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label></div>
        <Btn icon="file-add-line" kind="primary" onClick={create}>按模板生成草稿（含右侧 AI 条款）</Btn>
      </Card>
      <Card title="AI 条款生成" icon="sparkling-2-line" extra={<Fallback r={res} />}>
        <div className="form"><label><span>条款类型</span><select value={type} onChange={(e) => setType(e.target.value)}>{['违约', '保密', '付款', '知识产权', '争议', '解除', '不可抗力'].map((x) => <option key={x}>{x}</option>)}</select></label><label className="wide"><span>起草要求</span><input value={req} onChange={(e) => setReq(e.target.value)} /></label></div>
        <Btn icon={busy ? 'loader-4-line spin' : 'sparkling-2-line'} kind="jev" onClick={gen}>生成条款</Btn>
        {res && <pre className="answer">{res.data}</pre>}
      </Card>
    </div>
  </>
}
