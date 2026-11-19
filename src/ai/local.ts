import type { Contract, Finding, Milestone } from '../types'
import type { AiEngine, AiResult, Clause, SearchHit, Opt } from './types'
import { localExtract, daysTo, fmtMoney, splitParas, mergeFacts, chunkText } from '../engine'
import { getText, approvedId } from '../textcache'

export const LOCAL = '本地规则引擎'
const ok = <T,>(data: T, note?: string): AiResult<T> => ({ data, engine: LOCAL, note })
const yieldUI = () => new Promise((r) => setTimeout(r, 0))
export const bigrams = (s: string) => { const t = s.replace(/\s+/g, ''); const m = new Map<string, number>(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1) } return m }
export const cos = (a: Map<string, number>, b: Map<string, number>) => { let d = 0, na = 0, nb = 0; a.forEach((v, k) => { na += v * v; d += v * (b.get(k) || 0) }); b.forEach((v) => (nb += v * v)); return d / (Math.sqrt(na * nb) || 1) }
export const TEMPLATES: Record<string, string> = {
  保密: '双方对在履行本合同过程中知悉的对方商业秘密、技术信息及经营信息负有保密义务，未经对方书面同意不得向任何第三方披露。保密期限自本合同生效之日起至合同终止后三年。',
  违约: '任何一方违反本合同约定的，应向守约方支付合同总额10%的违约金；违约金不足以弥补损失的，违约方还应赔偿差额部分。双方累计赔偿责任以合同总金额为上限。',
  付款: '甲方应在乙方交付并经甲方验收合格、且收到乙方开具的合法有效增值税专用发票后30日内支付相应款项。预付款比例不超过合同总额的30%。',
  知识产权: '乙方在履行本合同过程中所产生的全部成果（包括但不限于源代码、文档、设计）的知识产权归甲方所有。乙方保证交付成果不侵犯任何第三方合法权益。',
  争议: '本合同适用中华人民共和国法律。因本合同引起的或与本合同有关的任何争议，双方应友好协商解决；协商不成的，提交甲方所在地有管辖权的人民法院诉讼解决。',
  解除: '任何一方提前解除本合同的，应提前30日书面通知对方，并结清已履行部分的费用。一方严重违约且在收到书面通知后15日内未纠正的，守约方有权立即解除本合同。',
  不可抗力: '因不可抗力导致任何一方不能履行本合同的，应在不可抗力发生后5日内书面通知对方并提供证明，双方可据此部分或全部免除责任。'
}
export const CLAUSE_MARK: Record<string, RegExp> = { 保密: /保密义务|保密期限/, 违约: /违约金|赔偿/, 付款: /付款|支付/, 知识产权: /知识产权/, 争议: /争议|仲裁|管辖/, 解除: /解除/, 不可抗力: /不可抗力/ }
export const fillTemplate = (txt: string, req: string) => { const n = req.match(/(\d+)\s*[%天日]/); return n ? txt.replace(/\d+(?=[%日])/, n[1]) : txt }
export function addDays(d: string, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return isNaN(+x) ? d : x.toISOString().slice(0, 10) }

export class LocalEngine implements AiEngine {
  id = 'local'; label = LOCAL; kind = 'rules' as const
  async draftClause(type: string, req: string, history: Contract[]) {
    const key = Object.keys(TEMPLATES).find((k) => type.includes(k) || req.includes(k)) || '违约'
    const txt = fillTemplate(TEMPLATES[key], req)
    let ref = ''
    for (const c of history.filter((c) => c.status === 'archived')) { const p = splitParas(await getText(c.id)).find((p) => CLAUSE_MARK[key].test(p)); if (p) { ref = p; break } }
    return ok(`【${key}条款】\n${txt}${req ? `\n\n（已结合要求：${req}）` : ''}${ref ? `\n\n参考历史合同条款：\n${ref.trim()}` : ''}`)
  }
  async recommendClauses(c: Contract, history: Contract[]) {
    const t = await getText(c.id)
    const out: Clause[] = Object.keys(TEMPLATES).filter((k) => !CLAUSE_MARK[k].test(t)).map((k) => ({ title: `补充「${k}」条款`, text: TEMPLATES[k], from: '标准条款库' }))
    for (const h of history.filter((h) => h.id !== c.id && h.type === c.type && h.status === 'archived')) { const p = splitParas(await getText(h.id)).find((x) => x.includes('违约')); if (p) out.push({ title: `参考：${h.title}`, text: p.trim(), from: h.id }) }
    return ok(out)
  }
  async extractFacts(c: Contract, o?: Opt) {
    const t = await getText(c.id); const parts = chunkText(t, 32768); let f: any = {}
    for (const p of parts) { f = mergeFacts(f, localExtract(t.slice(Math.max(0, p.start - 200), p.start + p.text.length))); o?.onProgress?.(p.i + 1, parts.length); if (parts.length > 1) await yieldUI() }
    return ok(f)
  }
  async review(c: Contract) {
    const t = await getText(c.id), f: Finding[] = []
    const add = (id: string, name: string, verdict: Finding['verdict'], reason: string) => f.push({ ruleId: id, ruleName: name, source: 'AI', verdict, reason })
    add('AI-01', '不可抗力条款', /不可抗力/.test(t) ? 'pass' : 'warn', /不可抗力/.test(t) ? '已约定' : '未发现不可抗力条款，建议补充')
    add('AI-02', '单方解除风险', /不得单方解除/.test(t) ? 'warn' : 'pass', /不得单方解除/.test(t) ? '合同限制单方解除权，退出成本较高' : '解除机制正常')
    const foreign = t.match(/适用[^。\n]{0,12}(新加坡|香港|美国|英国|境外)[^。\n]{0,10}法律/)
    add('AI-03', '境外法律/仲裁', foreign ? 'fail' : 'pass', foreign ? `发现「${foreign[0]}」，维权成本高` : '适用境内法律')
    add('AI-04', '重大金额关注', c.amount >= 5000000 ? 'warn' : 'pass', c.amount >= 5000000 ? `合同金额 ${fmtMoney(c.amount)} 属重大合同，需加强审批` : '金额在常规范围')
    add('AI-05', '验收条款', /验收/.test(t) || ['租赁合同', '保密协议'].includes(c.type) ? 'pass' : 'warn', /验收/.test(t) ? '已约定验收' : '未约定验收标准')
    return ok(f)
  }
  async approvalSummary(c: Contract, fs: Finding[]) {
    const fail = fs.filter((x) => x.verdict === 'fail'), warn = fs.filter((x) => x.verdict === 'warn')
    const recommendation = fail.length ? '建议驳回' : warn.length > 2 ? '有条件批准' : '建议批准'
    const summary = `《${c.title}》与 ${c.counterparty} 签订，金额 ${fmtMoney(c.amount)}，期限至 ${c.endDate || '—'}。\n审查共 ${fs.length} 项：不通过 ${fail.length} 项、警告 ${warn.length} 项。` + (fail.length ? `\n关键问题：${fail.map((x) => x.reason).join('；')}。` : '') + (warn.length ? `\n需关注：${warn.slice(0, 4).map((x) => x.reason).join('；')}。` : '') + `\n建议：${recommendation}。`
    return ok({ recommendation, summary } as any)
  }
  async presignCheck(c: Contract) {
    if (!c.hasApproved) return ok({ consistent: true, diffs: [], note: '无已审批版本记录，已以当前文本作为基准。' })
    const a = (await getText(approvedId(c.id))).split('\n'), b = (await getText(c.id)).split('\n'), diffs: { approved: string; current: string }[] = []
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || '') !== (b[i] || '')) { diffs.push({ approved: a[i] || '', current: b[i] || '' }); if (diffs.length > 200) break }
    return ok({ consistent: !diffs.length, diffs, note: diffs.length ? `发现 ${diffs.length} 处与审批版本不一致，请勿直接签署。` : '签署版本与审批版本一致。' })
  }
  async extractObligations(c: Contract) {
    const f = c.facts, out: Omit<Milestone, 'id'>[] = []; const t = await getText(c.id)
    if (f.prepaymentRatio && f.startDate) out.push({ title: `预付款(${f.prepaymentRatio}%)`, due: addDays(f.startDate, 14), kind: 'payment', amount: Math.round((c.amount * f.prepaymentRatio) / 100), done: false, source: 'AI' })
    if (/验收/.test(t) && f.endDate) out.push({ title: '交付验收', due: addDays(f.endDate, -30), kind: 'delivery', done: false, source: 'AI' })
    if (f.autoRenew && f.endDate) out.push({ title: '续约/不续约书面通知', due: addDays(f.endDate, -30), kind: 'obligation', done: false, source: 'AI' })
    if (f.warrantyMonths && f.endDate) out.push({ title: `质保期届满(${f.warrantyMonths}个月)`, due: addDays(f.endDate, f.warrantyMonths * 30), kind: 'obligation', done: false, source: 'AI' })
    if (f.endDate) out.push({ title: '合同到期结算', due: f.endDate, kind: 'payment', done: false, source: 'AI' })
    return ok(out)
  }
  async riskAlerts(c: Contract) {
    const a: string[] = []
    c.milestones.filter((m) => !m.done && daysTo(m.due) < 0).forEach((m) => a.push(`里程碑「${m.title}」已逾期 ${-daysTo(m.due)} 天`))
    c.milestones.filter((m) => !m.done && daysTo(m.due) >= 0 && daysTo(m.due) <= 30).forEach((m) => a.push(`里程碑「${m.title}」将在 ${daysTo(m.due)} 天后到期`))
    const d = daysTo(c.endDate); if (d >= 0 && d <= 60) a.push(`合同将在 ${d} 天后到期`)
    return ok(a)
  }
  /** 本地语义近似检索（字 bigram 余弦）；大文件逐合同让出主线程 */
  async search(q: string, cs: Contract[], o?: Opt) { return ok(await localSearch(q, cs, 10, o)) }
  async ask(q: string, cs: Contract[], o?: Opt) {
    const intents: [RegExp, (c: Contract) => boolean, (c: Contract) => string][] = [
      [/境外|外国|非中国|新加坡|香港/, (c) => !!c.facts.governingLaw && !/中华人民共和国|中国/.test(c.facts.governingLaw), (c) => `适用${c.facts.governingLaw}；${c.facts.disputeResolution || ''}`],
      [/预付/, (c) => (c.facts.prepaymentRatio || 0) > (Number(q.match(/(\d+)\s*%/)?.[1]) || 30), (c) => `预付款比例 ${c.facts.prepaymentRatio}%`],
      [/自动续/, (c) => !!c.facts.autoRenew, (c) => `含自动续约条款，到期日 ${c.endDate}`],
      [/账期|付款期/, (c) => /\d+日内付款/.test(c.facts.paymentTerms || ''), (c) => c.facts.paymentTerms || ''],
      [/违约金/, (c) => !!c.facts.penaltyRate, (c) => `违约金为合同总额 ${c.facts.penaltyRate}%`]
    ]
    const it = cs.length > 1 ? intents.find(([re]) => re.test(q)) : undefined
    if (it) { const m = cs.filter(it[1]); const cites = m.map((c) => ({ contractId: c.id, title: c.title, score: 1, snippet: it[2](c) })); return ok({ answer: m.length ? `基于合同要素检索到 ${m.length} 份相关合同：\n` + cites.map((h, i) => `${i + 1}. 《${h.title}》(${h.contractId})：${h.snippet}`).join('\n') : '未找到符合条件的合同。', cites }) }
    const hits = await localSearch(q, cs, 3, o, true)
    return ok({ answer: hits.length ? `与「${q}」最相关的条款：\n` + hits.map((h, i) => `${i + 1}. 《${h.title}》(${h.contractId})：${h.snippet.replace(/\n/g, ' ')}`).join('\n') : '未在合同库中找到相关内容。', cites: hits })
  }
  async renewalAdvice(c: Contract) {
    const f = c.facts, d = daysTo(c.endDate), done = c.milestones.filter((m) => m.done).length, all = c.milestones.length, rate = all ? Math.round((done / all) * 100) : 100
    return ok(`《${c.title}》${d < 0 ? `已于 ${-d} 天前到期` : `将于 ${d} 天后（${c.endDate}）到期`}。\n· 自动续约：${f.autoRenew ? '是（须在到期前30日书面提出异议，否则自动续期一年）' : '否'}\n· 履约完成率：${rate}%（${done}/${all}）\n· 建议：${rate >= 80 ? '履约情况良好，建议续约并就价格重新谈判。' : '存在未完成事项，建议先完成结算并评估供应商后再决定是否续约。'}${f.autoRenew ? '\n· 如不续约，请在截止日前发出书面通知。' : ''}`)
  }
  async chat(messages: { role: string; content: string }[], context: string) {
    const q = messages[messages.length - 1]?.content || ''
    return ok(`（本地规则引擎）已收到：「${q}」。\n本地模式支持条款起草、要素提取、审查、审批摘要、签署比对、履约提取、检索问答与续约建议；自由对话请在「设置 → AI 引擎」中为“全局助手”选择 Ollama / OpenAI 兼容模型。`)
  }
}

/** 段落级检索：返回每份合同最相关段落 */
export async function localSearch(q: string, cs: Contract[], topN = 10, o?: Opt, perPara = false): Promise<SearchHit[]> {
  const qv = bigrams(q); const hits: SearchHit[] = []
  for (let k = 0; k < cs.length; k++) {
    const c = cs[k]; const paras = splitParas(await getText(c.id))
    for (let j = 0; j < paras.length; j++) { const p = paras[j]; const s = cos(qv, bigrams(p)) + (c.title.includes(q) ? 0.5 : 0); if (s > 0.05) hits.push({ contractId: c.id, title: c.title, score: s, snippet: p.slice(0, 200) }); if (j % 250 === 249) await yieldUI() }
    o?.onProgress?.(k + 1, cs.length)
  }
  hits.sort((a, b) => b.score - a.score)
  if (perPara) return hits.slice(0, topN)
  const best = new Map<string, SearchHit>(); hits.forEach((h) => { if (!best.has(h.contractId)) best.set(h.contractId, h) })
  return [...best.values()].slice(0, topN)
}
/** 为 AI 引擎准备候选段落（跨合同），返回带 id 的段落 */
export async function candidateParas(q: string, cs: Contract[], max: number) {
  const qv = bigrams(q); const all: { pid: string; contractId: string; title: string; text: string; s: number }[] = []
  for (const c of cs) { const ps = splitParas(await getText(c.id), 400); for (let j = 0; j < ps.length; j++) { all.push({ pid: '', contractId: c.id, title: c.title, text: ps[j], s: cos(qv, bigrams(ps[j])) }); if (j % 250 === 249) await yieldUI() } }
  all.sort((a, b) => b.s - a.s); return all.slice(0, max).map((x, i) => ({ ...x, pid: 'P' + String(i).padStart(3, '0') }))
}
