import React, { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { Icon, JevBadge } from './ui'
import type { Contract } from './types'
import { stageLabel } from './types'
import { getText } from './textcache'

interface Msg { role: 'user' | 'assistant'; content: string; engine?: string }
export default function Assistant({ contract, page, onClose, autoAsk }: { contract?: Contract; page: string; onClose: () => void; autoAsk?: string }) {
  const { db, engine } = useStore()
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', content: '您好，我是智合 AI 助手。可以帮您起草条款、解读合同、生成审批意见、检索合同库并回答问题。', engine: engine.labelFor('assistant') }])
  const [input, setInput] = useState(''); const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs])
  const dispatch = async (intent: string, text: string) => {
    const scope = contract ? [contract] : db.contracts
    if (intent === 'approval' && contract) { const rv = await engine.review(contract); const s = await engine.approvalSummary(contract, rv.data); return { data: s.data.summary, engine: s.engine } }
    if (intent === 'renewal' && contract) return engine.renewalAdvice(contract)
    if (intent === 'review' && contract) { const r = await engine.review(contract); return { data: r.data.filter((f) => f.verdict !== 'pass').map((f) => `· [${f.verdict === 'fail' ? '不通过' : '警告'}] ${f.ruleName}：${f.reason}`).join('\n') || '未发现风险', engine: r.engine } }
    if (intent === 'draft') return engine.draftClause(text, text, db.contracts)
    const a = await engine.ask(text, scope); return { data: a.data.answer, engine: a.engine, fallback: a.fallback }
  }
  const send = async (text: string) => {
    if (!text.trim() || busy) return
    const next = [...msgs, { role: 'user' as const, content: text }]; setMsgs(next); setInput(''); setBusy(true)
    let r: any
    try {
      const ctx = contract ? `合同《${contract.title}》(${contract.id})，阶段：${stageLabel(contract.status)}。\n${(await getText(contract.id)).slice(0, 6000)}` : `页面：${page}；合同库共 ${db.contracts.length} 份`
      const c = await engine.chat(next.map(({ role, content }) => ({ role, content })), ctx)
      const m = /^__intent:(\w+):([\d.]+)/.exec(c.data)
      if (m) { // 决策模型（JEV）：意图路由到具体功能
        const d = await dispatch(m[1] === 'other' ? 'ask' : m[1], text); r = { ...d, engine: `${c.engine} 意图=${m[1]}(${(Number(m[2]) * 100).toFixed(0)}%) → ${d.engine}` }
      } else if (c.engine.startsWith('本地')) {
        const intent = /摘要|审批/.test(text) ? 'approval' : /续约|到期/.test(text) ? 'renewal' : /起草|条款/.test(text) && !/哪些|是否|？|\?/.test(text) ? 'draft' : /风险|审查/.test(text) ? 'review' : 'ask'
        r = await dispatch(intent, text)
      } else r = c
    } catch (e: any) { r = { data: '出错：' + e.message, engine: '错误' } }
    setMsgs([...next, { role: 'assistant', content: r.data + (r.fallback ? `\n\n⚠ ${r.fallback}` : ''), engine: r.engine }]); setBusy(false)
  }
  useEffect(() => { if (autoAsk) send(autoAsk) }, [autoAsk])
  const quick = contract ? ['生成审批意见', '续约建议', '起草保密条款', '本合同违约金是多少？'] : ['哪些合同适用境外法律？', '起草知识产权条款', '哪些合同含自动续约？', '付款账期最长的合同？']
  return (
    <aside className="assistant">
      <div className="as-head"><div><Icon n="sparkling-2-fill" /><b>AI 助手</b></div><JevBadge engine={engine.labelFor('assistant')} /><button className="icon-btn" onClick={onClose}><Icon n="close-line" /></button></div>
      {contract && <div className="as-ctx"><Icon n="file-text-line" />上下文：{contract.title} · {stageLabel(contract.status)}</div>}
      <div className="as-msgs">{msgs.map((m, i) => <div key={i} className={'msg ' + m.role}>{m.role === 'assistant' && <div className="msg-ava"><Icon n="sparkling-2-fill" /></div>}<div className="bubble">{m.content}{m.engine && <small>{m.engine}</small>}</div></div>)}{busy && <div className="msg assistant"><div className="msg-ava"><Icon n="loader-4-line spin" /></div><div className="bubble">思考中…</div></div>}<div ref={end} /></div>
      <div className="as-quick">{quick.map((q) => <button key={q} onClick={() => send(q)}>{q}</button>)}</div>
      <div className="as-input"><textarea value={input} placeholder="向 AI 提问，Enter 发送" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }} /><button className="btn primary" onClick={() => send(input)}><Icon n="send-plane-2-fill" /></button></div>
    </aside>
  )
}
