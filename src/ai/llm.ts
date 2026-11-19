/**
 * 生成式 LLM 引擎：Ollama 原生 API（POST /api/chat, GET /api/tags）与 OpenAI 兼容 API（POST /v1/chat/completions, GET /v1/models）。
 * 适用于 LM Studio(:1234/v1) / vLLM(:8000/v1) / llama.cpp server(:8080/v1) / Xinference(:9997/v1) / 云端服务。
 * 大文件：按 chunkChars 分块 map-reduce，受令牌预算与并发限制约束。
 */
import type { AiSettings, Contract, Facts, Finding } from '../types'
import type { AiEngine, AiResult, Clause, Opt } from './types'
import { http, limiter, newUsage, addUsage, Usage, selectByBudget, estTokens } from './runtime'
import { getText } from '../textcache'
import { chunkText, mergeFacts, fmtMoney } from '../engine'
import { LocalEngine, candidateParas } from './local'

export const PRESETS: Record<string, string> = { lmstudio: 'http://127.0.0.1:1234/v1', vllm: 'http://127.0.0.1:8000/v1', llamacpp: 'http://127.0.0.1:8080/v1', xinference: 'http://127.0.0.1:9997/v1', openai: 'https://api.openai.com/v1', custom: '' }
export async function listModels(kind: 'ollama' | 'openai', baseUrl: string, apiKey?: string): Promise<string[]> {
  const url = kind === 'ollama' ? baseUrl.replace(/\/$/, '') + '/api/tags' : baseUrl.replace(/\/$/, '') + '/models'
  const r = await http({ url, method: 'GET', headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, timeoutMs: 8000, maxRetries: 0 })
  if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`)
  return kind === 'ollama' ? (r.json?.models || []).map((m: any) => m.name) : (r.json?.data || r.json?.models || []).map((m: any) => m.id || m.name)
}
const SYS = '你是智合合同管理系统内的合同 AI 助手，熟悉中国合同法律实务。回答使用简体中文。'
const parseJson = (t: string) => { const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); const s = m ? m[1] : t; const k = s.search(/[\[{]/); if (k < 0) throw new Error('模型未返回 JSON'); const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']')); return JSON.parse(s.slice(k, end + 1)) }

export class LlmEngine implements AiEngine {
  kind = 'generative' as const; label: string; private local = new LocalEngine(); private lim
  constructor(public id: 'ollama' | 'openai', private s: AiSettings) { this.label = id === 'ollama' ? `Ollama · ${s.ollama.model}` : `OpenAI 兼容 · ${s.openai.model}`; this.lim = limiter(Math.max(1, id === 'ollama' ? Math.min(2, s.concurrency) : s.concurrency)) }
  async complete(user: string, u: Usage, o?: Opt, json = false, system = SYS): Promise<string> {
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }]
    const reqId = o?.cancel ? `${o.cancel.prefix}-${Math.random().toString(36).slice(2)}` : undefined
    const r = await this.lim(() => this.id === 'ollama'
      ? http({ url: this.s.ollama.baseUrl.replace(/\/$/, '') + '/api/chat', body: { model: this.s.ollama.model, messages, stream: false, ...(json ? { format: 'json' } : {}), options: { temperature: this.s.temperature, num_ctx: 8192, num_predict: 1024, repeat_penalty: 1.15 } }, timeoutMs: this.s.timeoutSec * 1000, maxRetries: this.s.maxRetries, reqId })
      : http({ url: this.s.openai.baseUrl.replace(/\/$/, '') + '/chat/completions', headers: this.s.openai.apiKey ? { Authorization: `Bearer ${this.s.openai.apiKey}` } : {}, body: { model: this.s.openai.model, messages, temperature: this.s.temperature, max_tokens: 1024, ...(json ? { response_format: { type: 'json_object' } } : {}) }, timeoutMs: this.s.timeoutSec * 1000, maxRetries: this.s.maxRetries, reqId }))
    addUsage(u, { calls: 1, ms: r.ms, retries: (r.attempts || 1) - 1 })
    if (!r.ok) throw new Error(r.status ? `HTTP ${r.status}: ${JSON.stringify(r.json?.error || r.text || '').slice(0, 160)}` : r.error)
    if (this.id === 'ollama') { addUsage(u, { inputTokens: r.json.prompt_eval_count || 0, outputTokens: r.json.eval_count || 0 }); return r.json.message?.content || '' }
    addUsage(u, { inputTokens: r.json.usage?.prompt_tokens || 0, outputTokens: r.json.usage?.completion_tokens || 0 }); return r.json.choices?.[0]?.message?.content || ''
  }
  private res<T>(data: T, u: Usage, note?: string): AiResult<T> { return { data, engine: this.label, usage: u, note } }
  private size() { return this.id === 'ollama' ? Math.min(this.s.chunkChars, 4000) : this.s.chunkChars }
  async draftClause(type: string, req: string, _h: Contract[], o?: Opt) { const u = newUsage(); return this.res(await this.complete(`请起草一条「${type}」合同条款。要求：${req}。只输出条款正文。`, u, o), u) }
  async recommendClauses(c: Contract, _h: Contract[], o?: Opt) {
    const u = newUsage(); const t = (await getText(c.id)).slice(0, this.size() * 2)
    const j = parseJson(await this.complete(`阅读合同（节选），列出缺失或应优化的条款，JSON 数组 [{"title":"","text":"建议条款全文"}]，最多 5 条。\n${t}`, u, o, true))
    return this.res((Array.isArray(j) ? j : j.items || j.clauses || []).map((x: any) => ({ ...x, from: this.label })) as Clause[], u)
  }
  async extractFacts(c: Contract, o?: Opt) {
    const u = newUsage(); const base = (await this.local.extractFacts(c)).data
    const t = await getText(c.id); const { picked, skipped } = selectByBudget(chunkText(t, this.size()), Math.min(this.s.tokenBudget, 60000))
    let f: Facts = {}; let done = 0
    await Promise.all(picked.slice(0, 12).map(async (ch) => {
      if (o?.cancel?.cancelled) return
      try { const j = parseJson(await this.complete(`从合同片段提取要素，输出 JSON（缺失填 null）：partyA,partyB,amount(数字,元),startDate,endDate,signDate(YYYY-MM-DD),paymentTerms,prepaymentRatio(数字%),penaltyRate(数字%),governingLaw,disputeResolution,confidentiality(bool),autoRenew(bool),terminationNoticeDays(数字)。\n片段：\n${ch.text}`, u, o, true)); const clean: any = {}; Object.entries(j).forEach(([k, v]) => { if (v !== null && v !== '' && v !== 'null') clean[k] = v }); f = mergeFacts(f, clean) } catch {}
      o?.onProgress?.(++done, Math.min(12, picked.length))
    }))
    return this.res(mergeFacts(f, base), u, skipped ? `预算内处理 ${picked.length} 块` : undefined)
  }
  async review(c: Contract, o?: Opt) {
    const u = newUsage(); const t = await getText(c.id); const all = chunkText(t, this.size()); const { picked, skipped } = selectByBudget(all, this.s.tokenBudget, 800)
    u.chunks = all.length; u.skippedChunks = skipped
    const found = new Map<string, Finding>(); let done = 0
    await Promise.all(picked.map(async (ch) => {
      if (o?.cancel?.cancelled) return
      try {
        const j = parseJson(await this.complete(`审查以下合同片段对甲方的风险，输出 JSON {"findings":[{"name":"风险名称","verdict":"fail|warn","reason":"原因"}]}；无风险输出空数组。\n${ch.text}`, u, o, true))
        for (const x of j.findings || j || []) { if (!x?.name) continue; const k = String(x.name).slice(0, 20); const prev = found.get(k); const v = x.verdict === 'fail' ? 'fail' : 'warn'; if (!prev || (v === 'fail' && prev.verdict !== 'fail')) found.set(k, { ruleId: 'LLM-' + (found.size + 1), ruleName: k, source: 'AI', verdict: v, reason: `${x.reason || ''}（分块 #${ch.i + 1}）` }) }
      } catch {}
      o?.onProgress?.(++done, picked.length, `${this.label} 审查分块 ${done}/${picked.length}`)
    }))
    const fs = [...found.values()]; if (!fs.length) fs.push({ ruleId: 'LLM-0', ruleName: '模型审查', source: 'AI', verdict: 'pass', reason: '模型未发现明显风险' })
    return this.res(fs, u, skipped ? `跳过 ${skipped} 块（令牌预算）` : undefined)
  }
  async approvalSummary(c: Contract, fs: Finding[], o?: Opt) {
    const u = newUsage(); const j = parseJson(await this.complete(`根据审查结果给出审批意见，输出 JSON {"recommendation":"建议批准|有条件批准|建议驳回","summary":"200字内摘要"}。\n合同：${c.title}，${c.counterparty}，${fmtMoney(c.amount)}\n审查：${fs.filter((f) => f.verdict !== 'pass').map((f) => f.ruleName + '：' + f.reason).join('；')}`, u, o, true))
    let rec = ['建议批准', '有条件批准', '建议驳回'].includes(j.recommendation) ? j.recommendation : '有条件批准'; if (fs.some((f) => f.verdict === 'fail') && rec === '建议批准') rec = '有条件批准'
    return this.res({ recommendation: rec, summary: String(j.summary || '') }, u)
  }
  presignCheck(c: Contract) { return this.local.presignCheck(c) }
  async extractObligations(c: Contract, o?: Opt) {
    const u = newUsage(); const t = (await getText(c.id)).slice(0, this.size() * 2)
    try { const j = parseJson(await this.complete(`提取付款/交付/义务节点，输出 JSON {"items":[{"title":"","due":"YYYY-MM-DD","kind":"payment|delivery|obligation","amount":数字或null}]}。合同生效日 ${c.facts.startDate || '未知'}。\n${t}`, u, o, true)); return this.res((j.items || j).filter((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(x.due)).map((x: any) => ({ ...x, done: false, source: 'AI' })), u) } catch (e: any) { const r = await this.local.extractObligations(c); return { ...r, fallback: '模型输出无法解析，已用本地结果：' + e.message } }
  }
  riskAlerts(c: Contract) { return this.local.riskAlerts(c) }
  search(q: string, cs: Contract[], o?: Opt) { return this.local.search(q, cs, o) }
  async ask(q: string, cs: Contract[], o?: Opt) {
    const u = newUsage(); const cands = (await candidateParas(q, cs, 8))
    const ans = await this.complete(`根据以下合同片段回答问题，并注明引用的合同编号；若片段中没有答案请直说。\n${cands.map((p) => `[${p.contractId}《${p.title}》] ${p.text}`).join('\n')}\n问题：${q}`, u, o)
    return this.res({ answer: ans, cites: cands.slice(0, 4).map((p) => ({ contractId: p.contractId, title: p.title, score: p.s, snippet: p.text.slice(0, 200) })) }, u)
  }
  async renewalAdvice(c: Contract, o?: Opt) { const u = newUsage(); return this.res(await this.complete(`给出续约/到期处理建议（150字内）。合同《${c.title}》到期 ${c.endDate}，自动续约 ${c.facts.autoRenew ? '是' : '否'}，履约节点：${c.milestones.map((m) => `${m.title}${m.done ? '已完成' : '未完成'}`).join('、')}`, u, o), u) }
  async chat(m: { role: 'user' | 'assistant'; content: string }[], context: string, o?: Opt) { const u = newUsage(); const ctx = context.length > 6000 ? context.slice(0, 6000) : context; return this.res(await this.complete(m.map((x) => `${x.role === 'user' ? '用户' : '助手'}：${x.content}`).join('\n'), u, o, false, SYS + '\n上下文：' + ctx), u) }
}
