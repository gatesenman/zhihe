/**
 * TypeSafe JEV 引擎（System One 决策模型）
 * API：POST {baseUrl}/v1/systemone，Authorization: Bearer <key>，body {model, state, questions}
 * 题型：noul（是/否概率）、choice（≤255 选项，含 probabilities/confidence）、score（2–10 级量表）。
 * JEV 不生成文字、不支持流式：本适配器按官方推荐“原子问题 + 代码组合”的方式设计各阶段功能：
 *  - 要素提取：正则预找候选值 → Choice 选取（值来自原文，不会臆造）+ Noul 判定布尔字段
 *  - 风险审查：每个分块一次请求并行扇出多个 Noul 风险问题 + Score 总体风险，map-reduce 取最大概率并定位分块；置信度门控
 *  - 条款起草/推荐：Choice 在条款库与历史条款中选择最匹配者；Noul 检测缺失条款
 *  - 审批：Choice 三档建议 + Score；签署：本地差异 + Noul 判定是否实质性修改
 *  - 履约：日期候选句 → 每句一个 Choice 判定节点类型；检索问答：本地预筛候选段落 → Choice 定位 + Noul 判定是否有答案
 *  - 续约：Choice 续约/重谈/终止；助手：Choice 意图路由到上述功能
 * 限制（官方）：单请求 ≤ 64k token，state + 最长单题 ≤ 32k token；429/529 指数退避（主进程传输层实现）。
 */
import type { AiSettings, Contract, Facts, Finding, Milestone } from '../types'
import type { AiEngine, AiResult, Clause, Opt, SearchHit } from './types'
import { http, limiter, newUsage, addUsage, Usage, estTokens, selectByBudget } from './runtime'
import { getText, approvedId } from '../textcache'
import { chunkText, fmtMoney, daysTo, localExtract } from '../engine'
import { LocalEngine, TEMPLATES, CLAUSE_MARK, fillTemplate, candidateParas, addDays } from './local'

type Q = { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } } | { type: 'choice'; instructions: string; criteria: Record<string, string | null> } | { type: 'score'; instructions: string; criteria: string[] }
export class JevError extends Error { constructor(msg: string, public status = 0) { super(msg) } }

export class JevEngine implements AiEngine {
  id = 'jev'; kind = 'decision' as const; label: string; private local = new LocalEngine()
  private lim: ReturnType<typeof limiter>
  constructor(private s: AiSettings) { this.label = `JEV · ${s.jev.model}`; this.lim = limiter(Math.max(1, s.concurrency)) }

  /** 单次 System One 调用 */
  async ask1(state: any, questions: Record<string, Q>, u: Usage, reqId?: string): Promise<Record<string, any>> {
    if (!this.s.jev.apiKey) throw new JevError('未配置 JEV API Key')
    const r = await this.lim(() => http({ url: this.s.jev.baseUrl.replace(/\/$/, '') + '/v1/systemone', headers: { Authorization: `Bearer ${this.s.jev.apiKey}` }, body: { model: this.s.jev.model, state, questions }, timeoutMs: this.s.timeoutSec * 1000, maxRetries: this.s.maxRetries, reqId }))
    addUsage(u, { calls: 1, ms: r.ms, retries: (r.attempts || 1) - 1 })
    if (!r.ok) throw new JevError(r.status ? `JEV HTTP ${r.status}: ${JSON.stringify(r.json?.detail || r.json?.error || r.text || '').slice(0, 200)}` : `JEV 网络错误：${r.error}`, r.status)
    addUsage(u, { inputTokens: r.json.usage?.input_tokens || 0, outputTokens: r.json.usage?.output_tokens || 0 })
    return r.json.answers
  }
  private res<T>(data: T, u: Usage, note?: string): AiResult<T> { return { data, engine: this.label, usage: u, note } }
  private reqId(o?: Opt) { return o?.cancel ? `${o.cancel.prefix}-${Math.random().toString(36).slice(2)}` : undefined }
  private check(o?: Opt) { if (o?.cancel?.cancelled) throw new JevError('已取消') }

  // ---------- 起草 ----------
  async draftClause(type: string, req: string, history: Contract[], o?: Opt) {
    const u = newUsage(); const opts: Record<string, string> = {}; const texts: Record<string, string> = {}
    Object.entries(TEMPLATES).forEach(([k, v]) => { const id = 'T_' + k; opts[id] = `标准条款库·${k}：${v}`; texts[id] = v })
    for (const c of history.filter((c) => c.status === 'archived').slice(0, 20)) {
      const t = await getText(c.id); t.split(/\n(?=第[一二三四五六七八九十百]+条)/).forEach((p, i) => { const s = p.trim(); if (s.length > 20 && s.length < 600 && Object.keys(opts).length < 250) { const id = `H_${c.id}_${i}`; opts[id] = `历史合同《${c.title}》：${s}`; texts[id] = s } })
    }
    const a = await this.ask1(`起草需求：条款类型=${type}；具体要求=${req}`, {
      best: { type: 'choice', instructions: '以下哪一个条款最适合作为满足该起草需求的基础条款？', criteria: opts },
      strict: { type: 'noul', instructions: '该起草需求是否对甲方提出了比市场惯例更严格的保护要求？' }
    }, u, this.reqId(o))
    const top = Object.entries(a.best.probabilities as Record<string, number>).sort((x, y) => y[1] - x[1]).slice(0, 3)
    const chosen = texts[a.best.choice] || TEMPLATES['违约']
    const out = `【基础条款（JEV 选取，置信度 ${(a.best.confidence * 100).toFixed(0)}%）】\n${fillTemplate(chosen, req)}\n\n候选排序：\n${top.map(([k, p]) => `· ${opts[k].slice(0, 40)}…  ${(p * 100).toFixed(1)}%`).join('\n')}\n\n严格保护需求概率：${(a.strict.noul * 100).toFixed(0)}%${a.strict.noul > 0.6 ? '（建议在基础条款上进一步收紧责任上限/违约金）' : ''}\n（JEV 为决策模型，不生成文字：条款文本来自条款库/历史合同，数字参数由规则按需求填充。）`
    return this.res(out, u)
  }
  async recommendClauses(c: Contract, history: Contract[], o?: Opt) {
    const u = newUsage(); const t = await getText(c.id)
    const chunks = selectByBudget(chunkText(t, this.s.chunkChars), this.s.tokenBudget).picked
    const qs: Record<string, Q> = {}; Object.keys(TEMPLATES).forEach((k, i) => (qs['has' + i] = { type: 'noul', instructions: `这段合同文本是否包含关于「${k}」的条款？` }))
    const maxP: number[] = Object.keys(TEMPLATES).map(() => 0)
    await Promise.all(chunks.map(async (ch) => { this.check(o); const a = await this.ask1(ch.text, qs, u, this.reqId(o)); Object.keys(TEMPLATES).forEach((_, i) => (maxP[i] = Math.max(maxP[i], a['has' + i].noul))) }))
    const out: Clause[] = Object.keys(TEMPLATES).map((k, i) => ({ k, p: maxP[i] })).filter((x) => x.p < 0.5).map((x) => ({ title: `补充「${x.k}」条款`, text: TEMPLATES[x.k], from: `JEV：包含该条款概率 ${(x.p * 100).toFixed(0)}%`, prob: x.p }))
    return this.res(out, u, `已检测 ${chunks.length} 个分块`)
  }

  // ---------- 审核：要素提取（预解析候选 + Choice 选择） ----------
  async extractFacts(c: Contract, o?: Opt) {
    const u = newUsage(); const t = await getText(c.id); const base = localExtract(t.slice(0, 60000))
    const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].slice(0, 120)
    const ctx = (re: RegExp, w = 50) => { const out: string[] = []; let m; const g = new RegExp(re.source, 'g'); while ((m = g.exec(t)) && out.length < 120) out.push(t.slice(Math.max(0, m.index - w), m.index + m[0].length + w).replace(/\s+/g, ' ')); return out }
    const companies = uniq(t.match(/[\u4e00-\u9fa5（）()A-Za-z.\s]{2,40}?(?:有限公司|股份有限公司|有限责任公司|集团|Pte\. Ltd\.|Ltd\.|Inc\.)/g) || []).map((s) => s.replace(/^.*?[：:]/, '').trim())
    const money = uniq((t.match(/(?:人民币)?[\d,，]+(?:\.\d+)?\s*(?:万)?元/g) || []))
    const dates = uniq(t.match(/\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?/g) || [])
    const pcts = uniq(t.match(/\d+(?:\.\d+)?\s*%/g) || [])
    const days = uniq(t.match(/\d+\s*(?:日|天)/g) || [])
    // state：候选值所在上下文窗口（控制在令牌预算内），而非整本合同
    let state = [...ctx(/甲方|乙方/, 40).slice(0, 10), ...ctx(/总金额|合同金额|总价/, 60).slice(0, 8), ...ctx(/生效|止|签订日期/, 40).slice(0, 12), ...ctx(/预付|违约金/, 60).slice(0, 10), ...ctx(/适用.{0,15}法律|仲裁|法院/, 60).slice(0, 10), ...ctx(/保密|续期|续约|质保|知识产权/, 60).slice(0, 12), ...ctx(/书面通知/, 40).slice(0, 6)].join('\n')
    if (estTokens(state) > 28000) state = state.slice(0, 26000)
    const opt = (xs: string[]) => Object.fromEntries([...xs.slice(0, 250).map((x) => [x, null]), ['none', '以上都不是']]) as Record<string, null | string>
    const qs: Record<string, Q> = {}
    if (companies.length) { qs.partyA = { type: 'choice', instructions: '合同的甲方是哪一家公司？', criteria: opt(companies) }; qs.partyB = { type: 'choice', instructions: '合同的乙方（相对方）是哪一家公司？', criteria: opt(companies) } }
    if (money.length) qs.amount = { type: 'choice', instructions: '哪一个金额是合同总金额？', criteria: opt(money) }
    if (dates.length) { qs.startDate = { type: 'choice', instructions: '合同生效（起始）日期是哪一个？', criteria: opt(dates) }; qs.endDate = { type: 'choice', instructions: '合同到期（截止）日期是哪一个？', criteria: opt(dates) }; qs.signDate = { type: 'choice', instructions: '合同签订日期是哪一个？', criteria: opt(dates) } }
    if (pcts.length) { qs.prepay = { type: 'choice', instructions: '预付款占合同总额的比例是多少？', criteria: opt(pcts) }; qs.penalty = { type: 'choice', instructions: '违约金占合同总额的比例是多少？', criteria: opt(pcts) } }
    if (days.length) qs.notice = { type: 'choice', instructions: '提前解除合同需要提前多少天书面通知？', criteria: opt(days) }
    qs.law = { type: 'choice', instructions: '合同约定适用哪个法域的法律？', criteria: { cn: '中华人民共和国法律', hk: '香港特别行政区法律', sg: '新加坡法律', us: '美国法律', uk: '英国法律', other: '其他或未约定' } }
    qs.dispute = { type: 'choice', instructions: '合同约定的争议解决方式是什么？', criteria: { arb: '仲裁', court: '法院诉讼', none: '未约定' } }
    qs.conf = { type: 'noul', instructions: '合同是否约定了保密义务？' }
    qs.renew = { type: 'noul', instructions: '合同是否约定期满自动续期/续约？' }
    qs.cap = { type: 'noul', instructions: '合同是否为违约赔偿责任设定了上限？' }
    const a = await this.ask1(state, qs, u, this.reqId(o))
    const pick = (k: string, min = 0.3) => (a[k] && a[k].choice !== 'none' && a[k].confidence >= min ? a[k].choice : undefined)
    const num = (s?: string) => (s ? Number(s.replace(/[^\d.]/g, '')) * (/万/.test(s) ? 10000 : 1) : undefined)
    const date = (s?: string) => s?.replace(/[年/.]/g, '-').replace(/月/, '-').replace(/日/, '').replace(/-(\d)(?=-|$)/g, '-0$1')
    const LAW: any = { cn: '中华人民共和国法律', hk: '香港特别行政区法律', sg: '新加坡法律', us: '美国法律', uk: '英国法律' }
    const conf: Record<string, number> = {}; Object.entries(a).forEach(([k, v]: any) => (conf[k] = v.confidence ?? v.noul))
    const f: Facts = {
      ...base,
      partyA: pick('partyA') || base.partyA, partyB: pick('partyB') || base.partyB,
      amount: num(pick('amount')) ?? base.amount, startDate: date(pick('startDate')) || base.startDate, endDate: date(pick('endDate')) || base.endDate, signDate: date(pick('signDate')) || base.signDate,
      prepaymentRatio: num(pick('prepay', 0.5)) ?? base.prepaymentRatio, penaltyRate: num(pick('penalty', 0.5)) ?? base.penaltyRate, terminationNoticeDays: num(pick('notice', 0.5)) ?? base.terminationNoticeDays,
      governingLaw: a.law.choice !== 'other' ? LAW[a.law.choice] : base.governingLaw, confidentiality: a.conf.noul > 0.5, autoRenew: a.renew.noul > 0.5,
      liabilityCap: a.cap.noul > 0.5 ? base.liabilityCap || '已约定（JEV 判定）' : undefined
    }
    return { ...this.res(f, u, `候选：公司 ${companies.length} / 金额 ${money.length} / 日期 ${dates.length} / 比例 ${pcts.length}`), confidence: conf } as any
  }

  // ---------- 审核：风险审查（分块 map-reduce） ----------
  static RISKS: { id: string; name: string; q: string; sev: 'fail' | 'warn'; absent?: boolean }[] = [
    { id: 'JEV-01', name: '境外法律/境外仲裁', q: '本段是否约定适用中国大陆以外的法律，或约定由境外（含港澳台）仲裁机构或法院解决争议？', sev: 'fail' },
    { id: 'JEV-02', name: '甲方无上限责任', q: '本段是否有条款要求甲方承担无限责任或无限连带责任，或者对乙方的赔偿责任设置了明显偏低的上限？', sev: 'fail' },
    { id: 'JEV-03', name: '对方单方解除/变更权', q: '本段是否赋予乙方单方解除、变更合同或调价的权利，而甲方没有对等权利？', sev: 'warn' },
    { id: 'JEV-04', name: '高额预付款', q: '本段是否要求甲方预付超过合同总额30%的款项？', sev: 'warn' },
    { id: 'JEV-05', name: '自动续约', q: '本段是否约定合同期满自动续期或自动续约？', sev: 'warn' },
    { id: 'JEV-06', name: '排他/独家限制', q: '本段是否包含排他或独家合作条款，限制甲方与第三方合作？', sev: 'warn' },
    { id: 'JEV-07', name: '知识产权归属对方', q: '本段是否约定为甲方开发的工作成果的知识产权归乙方或第三方所有？', sev: 'warn' },
    { id: 'JEV-08', name: '数据出境/个人信息', q: '本段是否允许将甲方数据或个人信息传输、存储至中国境外？', sev: 'warn' },
    { id: 'JEV-09', name: '不可抗力条款缺失', q: '本段是否包含不可抗力条款？', sev: 'warn', absent: true },
    { id: 'JEV-10', name: '验收标准缺失', q: '本段是否约定了交付物的验收标准或验收程序？', sev: 'warn', absent: true }
  ]
  async review(c: Contract, o?: Opt) {
    const u = newUsage(); const t = await getText(c.id)
    const all = chunkText(t, this.s.chunkChars); const { picked, skipped } = selectByBudget(all, this.s.tokenBudget, 900)
    u.chunks = all.length; u.skippedChunks = skipped
    const qs: Record<string, Q> = {}; JevEngine.RISKS.forEach((r, i) => (qs['r' + i] = { type: 'noul', instructions: r.q }))
    qs.overall = { type: 'score', instructions: '本段合同条款对甲方（我方）的整体风险程度', criteria: ['低风险：条款公平或有利于甲方', '中等风险：存在需关注的不利条款', '高风险：存在严重不利于甲方的条款'] }
    const best = JevEngine.RISKS.map(() => ({ p: 0, at: -1 })); let maxScore = 0, sumScore = 0, done = 0
    await Promise.all(picked.map(async (ch) => {
      this.check(o); const a = await this.ask1(ch.text, qs, u, this.reqId(o))
      JevEngine.RISKS.forEach((_, i) => { const p = a['r' + i].noul; if (p > best[i].p) best[i] = { p, at: ch.i } })
      maxScore = Math.max(maxScore, a.overall.score); sumScore += a.overall.score; o?.onProgress?.(++done, picked.length, `JEV 审查分块 ${done}/${picked.length}`)
    }))
    const page = (i: number) => (c.pages && t.length ? `约第 ${Math.max(1, Math.round(((all[i]?.start || 0) / t.length) * c.pages))} 页` : `分块 #${i + 1}`)
    const fs: Finding[] = JevEngine.RISKS.map((r, i) => {
      const p = best[i].p
      if (r.absent) { return p >= 0.5 ? { ruleId: r.id, ruleName: r.name, source: 'AI', verdict: 'pass', reason: `已约定（${page(best[i].at)}，P=${p.toFixed(2)}）` } : { ruleId: r.id, ruleName: r.name, source: 'AI', verdict: p < 0.25 ? r.sev : 'warn', reason: `未可靠识别到相关条款（最高 P=${p.toFixed(2)}）${p >= 0.25 ? '，置信不足需人工复核' : ''}` } }
      if (p >= 0.7) return { ruleId: r.id, ruleName: r.name, source: 'AI', verdict: r.sev, reason: `JEV 判定存在风险（P=${p.toFixed(2)}，${page(best[i].at)}）` }
      if (p >= 0.4) return { ruleId: r.id, ruleName: r.name, source: 'AI', verdict: 'warn', reason: `疑似存在（P=${p.toFixed(2)}，${page(best[i].at)}），置信度不足需人工复核` }
      return { ruleId: r.id, ruleName: r.name, source: 'AI', verdict: 'pass', reason: `未发现（最高 P=${p.toFixed(2)}）` }
    }) as Finding[]
    fs.push({ ruleId: 'JEV-S', ruleName: '整体风险评分', source: 'AI', verdict: maxScore >= 1.5 ? 'warn' : 'pass', reason: `分块最高风险 ${maxScore.toFixed(2)}/2，平均 ${(sumScore / Math.max(1, picked.length)).toFixed(2)}/2（已审 ${picked.length}/${all.length} 块${skipped ? `，超出令牌预算跳过 ${skipped} 块低相关分块` : ''}）` })
    return this.res(fs, u)
  }

  // ---------- 审批 ----------
  async approvalSummary(c: Contract, findings: Finding[], o?: Opt) {
    const u = newUsage(); const issues = findings.filter((f) => f.verdict !== 'pass')
    const state = { 合同: c.title, 相对方: c.counterparty, 金额: fmtMoney(c.amount), 到期: c.endDate, 类型: c.type, 审查问题: issues.map((f) => `[${f.verdict === 'fail' ? '不通过' : '警告'}] ${f.ruleName}：${f.reason}`) }
    const a = await this.ask1(state, {
      rec: { type: 'choice', instructions: '作为法务审批人，对该合同应给出何种审批意见？', criteria: { approve: '建议批准：无实质风险', conditional: '有条件批准：需修改个别条款或补充授权', reject: '建议驳回：存在不可接受的重大风险' } },
      sev: { type: 'score', instructions: '审查问题的总体严重程度', criteria: ['轻微', '一般', '严重', '重大'] },
      escalate: { type: 'noul', instructions: '该合同是否需要提交更高层级（如总经理/董事会）审批？' }
    }, u, this.reqId(o))
    const map: any = { approve: '建议批准', conditional: '有条件批准', reject: '建议驳回' }
    let rec = map[a.rec.choice]; const lowConf = a.rec.confidence < 0.4
    if (findings.some((f) => f.verdict === 'fail') && rec === '建议批准') rec = '有条件批准' // 代码层硬约束：存在不通过项不得直接批准
    const summary = `《${c.title}》· ${c.counterparty} · ${fmtMoney(c.amount)}\n审查问题 ${issues.length} 项（不通过 ${findings.filter((f) => f.verdict === 'fail').length}）。\nJEV 审批意见：${map[a.rec.choice]}（置信度 ${(a.rec.confidence * 100).toFixed(0)}%${lowConf ? '，偏低，建议人工复核' : ''}）\n概率分布：批准 ${(a.rec.probabilities.approve * 100).toFixed(0)}% / 有条件 ${(a.rec.probabilities.conditional * 100).toFixed(0)}% / 驳回 ${(a.rec.probabilities.reject * 100).toFixed(0)}%\n问题严重度：${a.sev.legend[String(Math.round(a.sev.score))]}（${a.sev.score.toFixed(2)}/3）\n需上级审批概率：${(a.escalate.noul * 100).toFixed(0)}%\n${issues.slice(0, 6).map((f) => '· ' + f.ruleName + '：' + f.reason).join('\n')}\n最终建议：${rec}`
    return this.res({ recommendation: rec, summary, probs: a.rec.probabilities }, u)
  }
  // ---------- 签署 ----------
  async presignCheck(c: Contract, o?: Opt) {
    const r = await this.local.presignCheck(c); if (!r.data.diffs.length) return { ...r, engine: this.label + '（确定性比对）' }
    const u = newUsage(); const diffs = r.data.diffs.slice(0, 40)
    const qs: Record<string, Q> = {}; diffs.forEach((_, i) => (qs['d' + i] = { type: 'noul', instructions: `第 ${i} 处修改是否实质性改变了双方的权利、义务、金额或期限？` }))
    const a = await this.ask1(diffs.map((d, i) => `第 ${i} 处修改：\n审批版：${d.approved}\n待签版：${d.current}`).join('\n\n'), qs, u, this.reqId(o))
    const out = diffs.map((d, i) => ({ ...d, material: a['d' + i].noul })); const mat = out.filter((d) => d.material! >= 0.5).length
    return this.res({ consistent: false, diffs: out, note: `发现 ${r.data.diffs.length} 处与审批版本不一致，其中 JEV 判定实质性修改 ${mat} 处，请勿直接签署。` }, u)
  }
  // ---------- 履约 ----------
  async extractObligations(c: Contract, o?: Opt) {
    const u = newUsage(); const t = await getText(c.id)
    const sents: { s: string; d: string }[] = []; const re = /[^。\n]*?(\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?|\d+\s*(?:个)?(?:工作日|日|天|个月)内)[^。\n]*/g; let m
    while ((m = re.exec(t)) && sents.length < 60) sents.push({ s: m[0].trim().slice(0, 160), d: m[1] })
    if (!sents.length) return this.local.extractObligations(c)
    const qs: Record<string, Q> = {}; sents.forEach((_, i) => (qs['s' + i] = { type: 'choice', instructions: `第 ${i} 句描述的是哪一类履约节点？`, criteria: { payment: '付款节点（甲方付款）', delivery: '交付/验收节点', obligation: '其他需在期限内履行的义务（通知、续约、报告等）', none: '不是履约节点' } }))
    const a = await this.ask1(sents.map((x, i) => `第 ${i} 句：${x.s}`).join('\n'), qs, u, this.reqId(o))
    const f = c.facts; const out: Omit<Milestone, 'id'>[] = []
    sents.forEach((x, i) => {
      const ans = a['s' + i]; if (!ans || ans.choice === 'none' || ans.confidence < 0.3) return
      let due = /\d{4}/.test(x.d) ? x.d.replace(/[年/.]/g, '-').replace(/月/, '-').replace(/日/, '') : (() => { const n = Number(x.d.match(/\d+/)![0]); return addDays(f.startDate || new Date().toISOString().slice(0, 10), /月/.test(x.d) ? n * 30 : /工作日/.test(x.d) ? Math.ceil(n * 1.4) : n) })()
      out.push({ title: x.s.replace(/^[^，,：:]*?(甲方|乙方)/, '$1').slice(0, 36), due, kind: ans.choice, done: false, source: 'AI' })
    })
    return this.res(out, u, `候选句 ${sents.length} 个`)
  }
  riskAlerts(c: Contract) { return this.local.riskAlerts(c) } // 纯日期计算，确定性本地执行
  // ---------- 归档：检索与问答 ----------
  async search(q: string, cs: Contract[], o?: Opt) {
    const u = newUsage(); const cands = await candidateParas(q, cs, 120)
    if (!cands.length) return this.res([], u)
    const a = await this.ask1(cands.map((p) => `${p.pid}| 《${p.title}》${p.text.replace(/\s+/g, ' ')}`).join('\n'), {
      where: { type: 'choice', instructions: `哪一段最能回答或匹配检索需求：「${q}」？`, criteria: Object.fromEntries(cands.map((p) => [p.pid, null])) }
    }, u, this.reqId(o))
    const pr = a.where.probabilities as Record<string, number>
    const best = new Map<string, SearchHit>()
    cands.map((p) => ({ p, s: pr[p.pid] || 0 })).sort((x, y) => y.s - x.s).forEach(({ p, s }) => { if (!best.has(p.contractId) && s > 0.001) best.set(p.contractId, { contractId: p.contractId, title: p.title, score: s, snippet: p.text.slice(0, 200) }) })
    return this.res([...best.values()].slice(0, 10), u, `本地预筛 ${cands.length} 段 → JEV 重排`)
  }
  async ask(q: string, cs: Contract[], o?: Opt) {
    const u = newUsage(); const cands = await candidateParas(q, cs, 150)
    if (!cands.length) return this.res({ answer: '合同库为空。', cites: [] }, u)
    const a = await this.ask1(cands.map((p) => `${p.pid}| [${p.contractId}《${p.title}》] ${p.text.replace(/\s+/g, ' ')}`).join('\n'), {
      where: { type: 'choice', instructions: `哪一段包含问题「${q}」的答案？`, criteria: Object.fromEntries(cands.map((p) => [p.pid, null])) },
      exists: { type: 'noul', instructions: `是否有任何一段陈述或直接隐含了问题「${q}」的答案？`, criteria: { true: '至少一段给出或直接隐含答案', false: '没有任何一段涉及该问题' } }
    }, u, this.reqId(o))
    const pr = a.where.probabilities as Record<string, number>
    const top = cands.map((p) => ({ p, s: pr[p.pid] || 0 })).sort((x, y) => y.s - x.s).slice(0, 4).filter((x, i) => i === 0 || x.s >= 0.05)
    const ex = a.exists.noul; const verdict = ex >= 0.7 ? '合同库中有明确答案' : ex < 0.35 ? '合同库中未找到答案' : '仅部分涉及'
    const cites = top.map(({ p, s }) => ({ contractId: p.contractId, title: p.title, score: s, snippet: p.text.slice(0, 220) }))
    const answer = `JEV 判定：${verdict}（P=${ex.toFixed(2)}）\n${ex >= 0.35 ? '依据条款（按相关度）：\n' + cites.map((h, i) => `${i + 1}. 《${h.title}》(${h.contractId}) 相关度 ${(h.score * 100).toFixed(0)}%\n   “${h.snippet.replace(/\s+/g, ' ')}”`).join('\n') : ''}\n（JEV 为决策模型：答案以原文引用呈现，不生成改写文字。）`
    return this.res({ answer, cites }, u)
  }
  // ---------- 续约/到期 ----------
  async renewalAdvice(c: Contract, o?: Opt) {
    const u = newUsage(); const d = daysTo(c.endDate); const done = c.milestones.filter((m) => m.done).length
    const state = { 合同: c.title, 类型: c.type, 相对方: c.counterparty, 金额: fmtMoney(c.amount), 距到期天数: d, 自动续约: !!c.facts.autoRenew, 履约节点: c.milestones.map((m) => `${m.title} ${m.due} ${m.done ? '已完成' : daysTo(m.due) < 0 ? '已逾期' : '未完成'}`), 最近审查结论: c.lastVerdict || '未审查', 风险评分: c.risk ?? '—' }
    const a = await this.ask1(state, {
      act: { type: 'choice', instructions: '对该合同到期应采取的最佳行动是什么？', criteria: { renew: '按原条件续约', renegotiate: '续约但重新谈判价格或条款', terminate: '不续约并按期终止', urgent: '立即处理：已逾期或临近不可撤销节点' } },
      perf: { type: 'score', instructions: '相对方的履约表现', criteria: ['差', '一般', '良好', '优秀'] },
      notice: { type: 'noul', instructions: '是否需要在近期发出续约或不续约的书面通知？' }
    }, u, this.reqId(o))
    const L: any = { renew: '按原条件续约', renegotiate: '续约并重新谈判', terminate: '到期终止、不续约', urgent: '立即处理' }
    return this.res(`《${c.title}》${d < 0 ? `已过期 ${-d} 天` : `距到期 ${d} 天`}，履约 ${done}/${c.milestones.length}\nJEV 建议行动：${L[a.act.choice]}（置信度 ${(a.act.confidence * 100).toFixed(0)}%）\n各选项概率：${Object.entries(a.act.probabilities).map(([k, p]: any) => `${L[k]} ${(p * 100).toFixed(0)}%`).join(' / ')}\n相对方履约表现：${a.perf.legend[String(Math.round(a.perf.score))]}（${a.perf.score.toFixed(2)}/3）\n需近期发出书面通知概率：${(a.notice.noul * 100).toFixed(0)}%${c.facts.autoRenew ? '\n提示：含自动续约条款，若不续约须在到期前 30 日书面提出异议。' : ''}`, u)
  }
  // ---------- 助手：意图路由 ----------
  async chat(messages: { role: 'user' | 'assistant'; content: string }[], context: string, o?: Opt) {
    const u = newUsage(); const q = messages[messages.length - 1]?.content || ''
    const a = await this.ask1({ 用户请求: q, 当前上下文: context.slice(0, 1500) }, { intent: { type: 'choice', instructions: '用户想做什么？', criteria: { ask: '查询合同内容/问答检索', draft: '起草或推荐条款', approval: '生成审批意见', renewal: '续约或到期建议', review: '风险审查', other: '闲聊或其他' } } }, u)
    return this.res(`__intent:${a.intent.choice}:${a.intent.confidence.toFixed(2)}`, u)
  }
}
