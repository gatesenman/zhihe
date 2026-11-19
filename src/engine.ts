import type { Contract, Facts, Rule, Finding, Verdict } from './types'

/** 本地规则式要素提取（JEV 离线回退）。 */
export function localExtract(text: string): Facts {
  const g = (re: RegExp) => text.match(re)?.[1]?.trim()
  const num = (s?: string) => (s ? Number(s.replace(/[,，]/g, '')) : undefined)
  const date = (s?: string) => s?.replace(/[年月/.]/g, '-').replace(/日/, '')
  const amt = g(/(?:总金额|合同金额|总价)[^0-9]{0,12}([\d,，.]+)\s*(万)?元/)
  const wan = /(?:总金额|合同金额|总价)[^0-9]{0,12}[\d,，.]+\s*万元/.test(text)
  const lawLine = g(/适用([^。\n]{2,30}?法律)/)
  return {
    partyA: g(/甲方[^：:\n]{0,6}[：:][ \t]*([^\n]+?)(?=[ \t]{2,}|\n|$)/), partyB: g(/乙方[^：:\n]{0,6}[：:][ \t]*([^\n]+?)(?=[ \t]{2,}|\n|$)/),
    amount: amt ? (num(amt)! * (wan ? 10000 : 1)) : undefined, currency: /美元|USD/.test(text) ? 'USD' : '人民币',
    signDate: date(g(/签订日期[：:]\s*(\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2})/)),
    startDate: date(g(/自\s*(\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2})日?\s*起/)), endDate: date(g(/至\s*(\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2})日?\s*止/)),
    paymentTerms: g(/付款方式\s*\n([^\n]+)/)?.split('甲方应于合同生效后')[0] || g(/(?:\n|。)([^\n。]*付款[^\n。]*)/),
    prepaymentRatio: num(g(/(\d+)%\s*作为预付款/)) ?? num(g(/预付\s*(\d+)%/)),
    penaltyRate: num(g(/合同总额\s*(\d+)%\s*的违约金/)),
    liabilityCap: g(/([^。\n]*(?:为上限|不超过合同总额[^。\n]*))/),
    liability: g(/违约责任\s*\n([^\n]+)/),
    governingLaw: lawLine, disputeResolution: g(/(争议[^。\n]*(?:仲裁|法院)[^。\n]*)/),
    confidentiality: /保密义务|保密期限/.test(text), terminationNoticeDays: num(g(/提前\s*(\d+)\s*日书面通知/)),
    autoRenew: /自动续期|自动续约|自动顺延/.test(text), warrantyMonths: num(g(/(\d+)\s*个月的质保期/)),
    ipOwnership: g(/知识产权\s*\n([^\n]+)/)
  }
}

export const interp = (tpl: string, f: Facts, c: Contract) => tpl.replace(/\$\{f\.(\w+)\}/g, (_, k) => String((f as any)[k] ?? '—')).replace(/\$\{c\.(\w+)\}/g, (_, k) => String((c as any)[k] ?? '—'))

/** 执行单条规则。脚本为函数体，可访问 f（要素）与 c（合同），返回 true/false 或 {pass, message}。 */
export function runRule(rule: Rule, c: Contract, facts?: Facts): Finding & { error?: string; ms: number } {
  const f = facts ?? c.facts
  const t0 = performance.now()
  try {
    // eslint-disable-next-line no-new-func
    const r = new Function('f', 'c', '"use strict";' + rule.script)(f, c)
    const pass = typeof r === 'object' && r !== null ? !!r.pass : !!r
    const msg = typeof r === 'object' && r?.message ? r.message : interp(rule.message, f, c)
    return { ruleId: rule.code, ruleName: rule.name, source: '规则库', verdict: pass ? 'pass' : rule.severity, reason: pass ? '符合' : msg, ms: performance.now() - t0 }
  } catch (e: any) {
    return { ruleId: rule.code, ruleName: rule.name, source: '规则库', verdict: 'warn', reason: '规则脚本执行出错：' + e.message, error: e.message, ms: performance.now() - t0 }
  }
}
export const aggregate = (fs: Finding[]): Verdict => (fs.some((x) => x.verdict === 'fail') ? 'fail' : fs.some((x) => x.verdict === 'warn') ? 'warn' : 'pass')
export const riskScore = (fs: Finding[]) => Math.min(100, fs.reduce((s, x) => s + (x.verdict === 'fail' ? 25 : x.verdict === 'warn' ? 8 : 0), 0))
export const daysTo = (d?: string) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 864e5) : Infinity)
export const fmtMoney = (n?: number) => (n == null ? '—' : '¥' + n.toLocaleString('zh-CN'))
/** 合并增量提取结果：已有值优先（合同首部通常是权威定义），缺失字段由后续分块补齐。 */
export function mergeFacts(a: Facts, b: Facts): Facts { const o: any = { ...a }; for (const [k, v] of Object.entries(b)) if (o[k] == null || o[k] === '' || (o[k] === false && v === true)) if (v != null && v !== '') o[k] = v; return o }
/** 段落切分（用于检索/分块） */
export function splitParas(t: string, max = 600): string[] { const out: string[] = []; for (const p of t.split(/\n{2,}|\n(?=第[一二三四五六七八九十百千\d]+[条章节])/)) { const s = p.trim(); if (!s) continue; for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)) } return out }
/** 按字符预算切块（尽量在段落边界） */
export function chunkText(t: string, size: number): { i: number; start: number; text: string }[] { const out = []; let s = 0, i = 0; while (s < t.length) { let e = Math.min(t.length, s + size); if (e < t.length) { const nl = t.lastIndexOf('\n', e); if (nl > s + size * 0.6) e = nl } out.push({ i: i++, start: s, text: t.slice(s, e) }); s = e } return out }
