import React, { useEffect, useState } from 'react'
import { useStore, zh, seed } from './store'
import { Icon, StatusChip, PageHead, Btn, Card, Empty, Fallback, JevBadge, SampleTag } from './ui'
import { go } from './App'
import { daysTo, fmtMoney } from './engine'
import { STAGES } from './types'
import type { EngineId } from './types'
import { ENGINE_LABEL, STAGE_LIST } from './ai/router'
import { listModels, PRESETS } from './ai/llm'

export function Performance() {
  const { db, updateContract, engine, toast } = useStore()
  const [f, setF] = useState<'all' | 'overdue' | 'soon' | 'done'>('all'); const [alerts, setAlerts] = useState<string[]>([])
  const all = db.contracts.flatMap((c) => c.milestones.map((m) => ({ m, c }))).sort((a, b) => a.m.due.localeCompare(b.m.due))
  const st = (m: any) => (m.done ? 'done' : daysTo(m.due) < 0 ? 'overdue' : daysTo(m.due) <= 30 ? 'soon' : 'normal')
  const list = all.filter(({ m }) => f === 'all' || st(m) === f)
  const paid = all.filter((x) => x.m.kind === 'payment' && x.m.done).reduce((s, x) => s + (x.m.amount || 0), 0)
  const unpaid = all.filter((x) => x.m.kind === 'payment' && !x.m.done).reduce((s, x) => s + (x.m.amount || 0), 0)
  const scan = async () => { const out: string[] = []; for (const c of db.contracts.filter((x) => x.status === 'performing')) { const r = await engine.riskAlerts(c); out.push(...r.data.map((a) => `《${c.title}》${a}`)) } setAlerts(out.length ? out : ['未发现履约风险']); toast('履约风险扫描完成') }
  const extractAll = async () => { let n = 0; for (const c of db.contracts.filter((x) => x.status === 'performing' || x.status === 'signing')) { const r = await engine.extractObligations(c); const ex = new Set(c.milestones.map((m) => m.title)); const add = r.data.filter((m) => !ex.has(m.title)).map((m, i) => ({ ...m, id: c.id + '-j' + Date.now() + i })); n += add.length; updateContract(c.id, { milestones: [...c.milestones, ...add] }) } toast(`AI 新增 ${n} 个履约节点`) }
  const L: any = { done: ['已完成', 'v-pass'], overdue: ['已逾期', 'v-fail'], soon: ['30天内', 'v-warn'], normal: ['进行中', 'st-performing'] }
  return <>
    <PageHead title="履约跟踪" sub="里程碑 · 付款 · 义务节点" icon="loop-right-line"><Btn icon="radar-line" kind="jev" onClick={scan}>AI 风险扫描</Btn><Btn icon="sparkling-2-line" kind="jev" onClick={extractAll}>AI 批量提取义务</Btn></PageHead>
    <div className="kpis">{[['节点总数', all.length, 'flag-2-line', 'blue'], ['已逾期', all.filter((x) => st(x.m) === 'overdue').length, 'alarm-warning-line', 'red'], ['30天内到期', all.filter((x) => st(x.m) === 'soon').length, 'time-line', 'amber'], ['已付款', fmtMoney(paid), 'money-cny-circle-line', 'green'], ['待付款', fmtMoney(unpaid), 'wallet-3-line', 'violet']].map(([t, v, i, c]) => <div key={t as string} className={'kpi ' + c}><div className="kpi-i"><Icon n={i as string} /></div><div><span>{t}</span><b>{v}</b></div></div>)}</div>
    {alerts.length > 0 && <Card title="履约风险预警" icon="radar-line" extra={<JevBadge engine={engine.labelFor('performing')} />}><ul className="alerts">{alerts.map((a, i) => <li key={i}><Icon n="alarm-warning-line" />{a}</li>)}</ul></Card>}
    <div className="toolbar"><div className="seg">{[['all', '全部'], ['overdue', '已逾期'], ['soon', '30天内'], ['done', '已完成']].map(([k, t]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k as any)}>{t}</button>)}</div></div>
    <div className="table-wrap"><table className="tbl big"><thead><tr><th>完成</th><th>节点</th><th>类型</th><th>合同</th><th>截止日期</th><th className="r">金额</th><th>状态</th><th>来源</th></tr></thead><tbody>{list.map(({ m, c }) => <tr key={m.id}><td><input type="checkbox" checked={m.done} onChange={(e) => updateContract(c.id, { milestones: c.milestones.map((x) => (x.id === m.id ? { ...x, done: e.target.checked } : x)) })} /></td><td><b>{m.title}</b></td><td>{{ payment: '付款', delivery: '交付', obligation: '义务' }[m.kind]}</td><td><a className="link" onClick={() => go('contract/' + c.id)}>{c.title}</a></td><td>{m.due}</td><td className="r mono">{fmtMoney(m.amount)}</td><td><span className={'chip ' + L[st(m)][1]}>{L[st(m)][0]}</span></td><td>{m.source === 'AI' || m.source === 'JEV' ? <JevBadge engine="AI" /> : '手工'}</td></tr>)}</tbody></table>{!list.length && <Empty text="无节点" />}</div>
  </>
}

export function Renewal() {
  const { db, engine } = useStore()
  const [adv, setAdv] = useState<Record<string, any>>({})
  const list = db.contracts.filter((c) => c.endDate && c.status !== 'draft').sort((a, b) => daysTo(a.endDate) - daysTo(b.endDate))
  const soon = list.filter((c) => c.status !== 'archived' && daysTo(c.endDate) <= db.settings.remindDays)
  return <>
    <PageHead title="续约 / 到期" sub={`提前 ${db.settings.remindDays} 天提醒（可在设置中调整）`} icon="calendar-event-line"><Btn icon="sparkling-2-line" kind="jev" onClick={async () => { for (const c of soon) { const r = await engine.renewalAdvice(c); setAdv((a) => ({ ...a, [c.id]: r })) } }}>为临期合同生成 AI 续约建议</Btn></PageHead>
    {soon.length > 0 && <div className="banner warn"><Icon n="alarm-warning-line" />有 {soon.length} 份合同将在 {db.settings.remindDays} 天内到期：{soon.map((c) => c.title).join('、')}</div>}
    <div className="table-wrap"><table className="tbl big"><thead><tr><th>合同</th><th>相对方</th><th>到期日</th><th>剩余</th><th>自动续约</th><th>状态</th><th>AI</th></tr></thead><tbody>{list.map((c) => { const d = daysTo(c.endDate); return <React.Fragment key={c.id}><tr><td><a className="link" onClick={() => go('contract/' + c.id)}>{c.title}</a></td><td>{c.counterparty}</td><td>{c.endDate}</td><td><span className={'days ' + (d < 0 ? 'neg' : d <= db.settings.remindDays ? 'soon' : '')}>{d < 0 ? `已过期 ${-d} 天` : `${d} 天`}</span></td><td>{c.facts.autoRenew ? <span className="chip v-warn">是</span> : '否'}</td><td><StatusChip s={c.status} /></td><td><Btn icon="sparkling-2-line" kind="jev sm" onClick={async () => { const r = await engine.renewalAdvice(c); setAdv((a) => ({ ...a, [c.id]: r })) }}>续约建议</Btn></td></tr>{adv[c.id] && <tr className="sub"><td colSpan={7}><Fallback r={adv[c.id]} /><pre className="answer">{adv[c.id].data}</pre></td></tr>}</React.Fragment> })}</tbody></table></div>
  </>
}

export function Archive() {
  const { db, engine } = useStore()
  const [q, setQ] = useState('争议解决 仲裁'); const [hits, setHits] = useState<any>(null); const [busy, setBusy] = useState(''); const wrap = (k: string, f: () => Promise<any>, set: any) => async () => { setBusy(k); try { set(await f()) } catch (e: any) { set({ data: k === 's' ? [] : { answer: '出错：' + e.message, cites: [] }, engine: '错误' }) } setBusy('') }; const [qa, setQa] = useState('哪些合同的预付款比例超过 30%？'); const [ans, setAns] = useState<any>(null); const [scope, setScope] = useState<'all' | 'archived'>('all')
  const cs = scope === 'all' ? db.contracts : db.contracts.filter((c) => c.status === 'archived')
  return <>
    <PageHead title="归档与检索" sub="AI 语义检索 · 合同库问答" icon="archive-drawer-line" />
    <div className="toolbar"><div className="seg"><button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>全部合同</button><button className={scope === 'archived' ? 'on' : ''} onClick={() => setScope('archived')}>仅已归档 {db.contracts.filter((c) => c.status === 'archived').length}</button></div></div>
    <div className="grid2">
      <Card title="AI 语义检索" icon="search-2-line" extra={<Fallback r={hits} />}>
        <div className="toolbar inner"><div className="tb-search grow"><Icon n="search-line" /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && wrap('s', () => engine.search(q, cs), setHits)()} /></div><Btn icon={busy === 's' ? 'loader-4-line spin' : 'search-line'} kind="primary" onClick={wrap('s', () => engine.search(q, cs), setHits)}>检索</Btn></div>
        {hits && (hits.data.length ? hits.data.map((h: any) => <div key={h.contractId} className="hit" onClick={() => go('contract/' + h.contractId)}><div><b>{h.title}</b><span className="mono muted">{h.contractId}</span><span className="score">相关度 {(h.score * 100).toFixed(0)}</span></div><p>{h.snippet}</p></div>) : <Empty text="无结果" />)}
      </Card>
      <Card title="AI 合同问答" icon="question-answer-line" extra={<Fallback r={ans} />}>
        <div className="toolbar inner"><div className="tb-search grow"><Icon n="question-line" /><input value={qa} onChange={(e) => setQa(e.target.value)} /></div><Btn icon={busy === 'a' ? 'loader-4-line spin' : 'sparkling-2-line'} kind="jev" onClick={wrap('a', () => engine.ask(qa, cs), setAns)}>提问</Btn></div>
        {ans && <pre className="answer">{ans.data.answer}</pre>}
      </Card>
    </div>
    <Card title="已归档合同" icon="archive-line"><table className="tbl"><thead><tr><th>编号</th><th>名称</th><th>相对方</th><th className="r">金额</th><th>到期日</th></tr></thead><tbody>{db.contracts.filter((c) => c.status === 'archived').map((c) => <tr key={c.id} onClick={() => go('contract/' + c.id)}><td className="mono">{c.id}</td><td>{c.title} {c.sample && <SampleTag />}</td><td>{c.counterparty}</td><td className="r mono">{fmtMoney(c.amount)}</td><td>{c.endDate}</td></tr>)}</tbody></table></Card>
  </>
}

export function Settings() {
  const { db, set, engine, toast } = useStore()
  const a = db.settings.ai; const [path, setPath] = useState(''); const [test, setTest] = useState<Record<string, string>>({}); const [models, setModels] = useState<Record<string, string[]>>({})
  useEffect(() => { zh.dataPath().then(setPath) }, [])
  const sa = (p: any) => set((d) => ({ ...d, settings: { ...d.settings, ai: { ...d.settings.ai, ...p } } }))
  const sub = (k: 'jev' | 'ollama' | 'openai', p: any) => sa({ [k]: { ...a[k], ...p } })
  const probe = async (k: EngineId) => {
    setTest((t) => ({ ...t, [k]: '测试中…' }))
    try {
      if (k === 'jev') { const r = await zh.http({ url: a.jev.baseUrl.replace(/\/$/, '') + '/v1/models', method: 'GET', headers: { Authorization: `Bearer ${a.jev.apiKey}` }, timeoutMs: 10000, maxRetries: 0 }); if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`); const ms = r.json.models.map((m: any) => m.name); setModels((m) => ({ ...m, jev: ms })); setTest((t) => ({ ...t, jev: `连接成功 · 可用模型：${ms.join(', ')}` })) }
      else { const ms = await listModels(k as any, k === 'ollama' ? a.ollama.baseUrl : a.openai.baseUrl, k === 'openai' ? a.openai.apiKey : undefined); setModels((m) => ({ ...m, [k]: ms })); setTest((t) => ({ ...t, [k]: `连接成功 · ${ms.length} 个模型` })) }
    } catch (e: any) { setTest((t) => ({ ...t, [k]: '连接失败：' + e.message })) }
  }
  const ENG: EngineId[] = ['local', 'jev', 'ollama', 'openai']
  const ModelSel = ({ k, v, on }: { k: string; v: string; on: (x: string) => void }) => <label><span>模型</span>{models[k]?.length ? <select value={v} onChange={(e) => on(e.target.value)}>{[...new Set([v, ...models[k]])].filter(Boolean).map((m) => <option key={m}>{m}</option>)}</select> : <input value={v} onChange={(e) => on(e.target.value)} />}</label>
  return <>
    <PageHead title="设置" sub="外观 · AI 引擎（JEV / Ollama / OpenAI 兼容 / 本地规则）· 性能 · 数据" icon="settings-4-line" />
    <Card title="AI 引擎与阶段路由" icon="route-line" extra={<JevBadge engine={engine.label} />}>
      <div className="form"><label><span>默认引擎</span><select value={a.defaultEngine} onChange={(e) => sa({ defaultEngine: e.target.value })}>{ENG.map((k) => <option key={k} value={k}>{ENGINE_LABEL[k]}</option>)}</select></label>
        <label className="switch row" style={{ alignSelf: 'end' }}><input type="checkbox" checked={a.fallbackLocal} onChange={(e) => sa({ fallbackLocal: e.target.checked })} /><span className="knob" />远程失败时自动回退本地规则引擎</label></div>
      <table className="tbl stage-tbl"><thead><tr><th>阶段</th><th>能力</th><th>使用引擎</th><th>当前生效</th></tr></thead><tbody>{STAGE_LIST.map((st) => <tr key={st.k}><td><b>{st.t}</b></td><td className="muted">{st.m}</td><td><select value={a.stageEngine[st.k] || 'default'} onChange={(e) => sa({ stageEngine: { ...a.stageEngine, [st.k]: e.target.value } })}><option value="default">跟随默认</option>{ENG.map((k) => <option key={k} value={k}>{ENGINE_LABEL[k]}</option>)}<option value="off">停用</option></select></td><td><JevBadge engine={engine.labelFor(st.k)} /></td></tr>)}</tbody></table>
    </Card>
    <div className="grid2">
      <Card title="JEV · TypeSafe（决策模型）" icon="cpu-line">
        <div className="form"><label className="wide"><span>API Base URL</span><input value={a.jev.baseUrl} onChange={(e) => sub('jev', { baseUrl: e.target.value })} /></label>
          <label><span>API Key</span><input type="password" value={a.jev.apiKey} onChange={(e) => sub('jev', { apiKey: e.target.value })} placeholder="在 console.typesafe.ai 创建" /></label>
          {ModelSel({ k: "jev", v: a.jev.model, on: (m) => sub('jev', { model: m }) })}</div>
        <Btn icon="plug-line" onClick={() => probe('jev')}>测试连接 / 列出模型</Btn> <span className="muted">{test.jev}</span>
        <div className="hint"><Icon n="information-line" />JEV 是 System One 决策模型：返回 Choice / Score / Noul 结构化答案与概率、置信度，不生成文字、不支持流式。智合用它做要素选取、风险判定、审批建议、检索定位与意图路由；条款文本来自条款库。</div>
      </Card>
      <Card title="Ollama（本地开源模型）" icon="server-line">
        <div className="form"><label className="wide"><span>Ollama 地址</span><input value={a.ollama.baseUrl} onChange={(e) => sub('ollama', { baseUrl: e.target.value })} /></label>{ModelSel({ k: "ollama", v: a.ollama.model, on: (m) => sub('ollama', { model: m }) })}</div>
        <Btn icon="list-check" onClick={() => probe('ollama')}>列出本地模型</Btn> <span className="muted">{test.ollama}</span>
        <div className="hint"><Icon n="information-line" />原生 API：/api/tags 列模型，/api/chat 对话（format=json 结构化输出）。推荐 qwen2.5:7b 及以上用于合同审查。</div>
      </Card>
      <Card title="OpenAI 兼容服务" icon="cloud-line">
        <div className="form"><label><span>预设</span><select value={a.openai.preset} onChange={(e) => sub('openai', { preset: e.target.value, baseUrl: PRESETS[e.target.value] || a.openai.baseUrl })}>{Object.entries({ lmstudio: 'LM Studio', vllm: 'vLLM', llamacpp: 'llama.cpp server', xinference: 'Xinference', openai: 'OpenAI 云端', custom: '自定义' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {ModelSel({ k: "openai", v: a.openai.model, on: (m) => sub('openai', { model: m }) })}
          <label className="wide"><span>Base URL（含 /v1）</span><input value={a.openai.baseUrl} onChange={(e) => sub('openai', { baseUrl: e.target.value })} /></label>
          <label className="wide"><span>API Key（本地服务可留空）</span><input type="password" value={a.openai.apiKey} onChange={(e) => sub('openai', { apiKey: e.target.value })} /></label></div>
        <Btn icon="list-check" onClick={() => probe('openai')}>测试 / 列出模型</Btn> <span className="muted">{test.openai}</span>
      </Card>
      <Card title="大文件与调用控制" icon="speed-up-line">
        <div className="form">
          {([['concurrency', '并发请求数', 1, 16], ['maxRetries', '最大重试次数（429/5xx/529）', 0, 8], ['timeoutSec', '单次超时（秒）', 10, 600], ['chunkChars', '分块大小（字符）', 1000, 28000], ['tokenBudget', '单任务令牌预算', 10000, 20000000]] as const).map(([k, l, mn, mx]) => <label key={k}><span>{l}</span><input type="number" min={mn} max={mx} value={(a as any)[k]} onChange={(e) => sa({ [k]: Math.max(mn, Math.min(mx, Number(e.target.value) || mn)) })} /></label>)}
          <label><span>Temperature（生成式）</span><input type="number" step="0.1" min="0" max="2" value={a.temperature} onChange={(e) => sa({ temperature: Number(e.target.value) })} /></label></div>
        <div className="hint"><Icon n="information-line" />超出令牌预算时，优先审查含违约/法律/付款/解除等关键词的分块，并在结果中注明跳过数量。JEV 单请求 state+最长问题 ≤ 32k token。</div>
      </Card>
      <Card title="外观与提醒" icon="palette-line">
        <div className="seg big"><button className={db.settings.theme === 'dark' ? 'on' : ''} onClick={() => set((d) => ({ ...d, settings: { ...d.settings, theme: 'dark' } }))}><Icon n="moon-line" />深色</button><button className={db.settings.theme === 'light' ? 'on' : ''} onClick={() => set((d) => ({ ...d, settings: { ...d.settings, theme: 'light' } }))}><Icon n="sun-line" />浅色</button></div>
        <div className="form"><label><span>到期提前提醒（天）</span><input type="number" value={db.settings.remindDays} onChange={(e) => set((d) => ({ ...d, settings: { ...d.settings, remindDays: Number(e.target.value) || 30 } }))} /></label></div>
      </Card>
      <Card title="数据" icon="database-2-line">
        <p className="muted">数据目录：<span className="mono">{path}</span><br />元数据：zhihe-db.json（原子写入）；合同全文：texts/&lt;合同ID&gt;/ 分块存储（64K 字符/块）</p>
        <Btn icon="download-2-line" onClick={async () => { const p = await zh.saveFile({ name: 'zhihe-backup.json', data: JSON.stringify(db, null, 2), filters: [{ name: 'JSON', extensions: ['json'] }] }); p && toast('已备份到 ' + p) }}>备份元数据</Btn>
        <Btn icon="refresh-line" kind="danger" onClick={async () => { if (confirm('将清空当前数据并恢复示例数据，确定？')) { const s0 = await seed(); set((d) => ({ ...s0, settings: { ...s0.settings, ai: d.settings.ai } })); toast('已恢复示例数据') } }}>恢复示例数据</Btn>
        <p className="muted">智合 v1.1.0 · Electron + React + TypeScript</p>
      </Card>
    </div>
  </>
}
