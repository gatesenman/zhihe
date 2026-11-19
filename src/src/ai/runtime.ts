/** AI 运行时：并发限制、令牌预算、调用统计、取消。 */
import { zh } from '../store'
export interface Usage { calls: number; inputTokens: number; outputTokens: number; ms: number; retries: number; chunks?: number; skippedChunks?: number }
export const newUsage = (): Usage => ({ calls: 0, inputTokens: 0, outputTokens: 0, ms: 0, retries: 0 })
export function addUsage(a: Usage, b: Partial<Usage>) { a.calls += b.calls || 0; a.inputTokens += b.inputTokens || 0; a.outputTokens += b.outputTokens || 0; a.ms += b.ms || 0; a.retries += b.retries || 0; return a }
/** 简单信号量 */
export function limiter(n: number) {
  let active = 0; const q: (() => void)[] = []
  const next = () => { if (active >= n || !q.length) return; active++; q.shift()!() }
  return <T,>(fn: () => Promise<T>) => new Promise<T>((res, rej) => { q.push(() => fn().then(res, rej).finally(() => { active--; next() })); next() })
}
/** 粗略令牌估算：CJK 约 1 token/字，其它约 1 token/4 字符 */
export function estTokens(s: string) { let cjk = 0; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x2e80) cjk++; return cjk + Math.ceil((s.length - cjk) / 4) }
let seq = 0
export const jobPrefix = () => `job${Date.now()}-${seq++}`
export async function http(req: { url: string; method?: string; headers?: any; body?: any; timeoutMs?: number; maxRetries?: number; reqId?: string }) {
  return zh.http(req) as Promise<{ ok: boolean; status: number; json?: any; text?: string; error?: string; ms: number; attempts?: number }>
}
export class CancelToken { cancelled = false; prefix = jobPrefix(); cancel() { this.cancelled = true; zh.cancelAi(this.prefix) } }
/** 关键词优先的分块选择：超出令牌预算时，优先保留含高风险关键词的分块 */
const KW = /违约|赔偿|责任|适用|法律|仲裁|管辖|付款|预付|解除|终止|续|知识产权|保密|不可抗力|排他|独家|数据|出境|验收|质保|罚/g
export function selectByBudget<T extends { text: string }>(chunks: T[], budget: number, perCallOverhead = 600): { picked: T[]; skipped: number } {
  const cost = chunks.map((c) => estTokens(c.text) + perCallOverhead)
  const total = cost.reduce((a, b) => a + b, 0)
  if (total <= budget) return { picked: chunks, skipped: 0 }
  const scored = chunks.map((c, i) => ({ c, i, s: (c.text.match(KW)?.length || 0) / Math.max(1, c.text.length / 1000) + (i === 0 || i === chunks.length - 1 ? 100 : 0) }))
  scored.sort((a, b) => b.s - a.s)
  const keep = new Set<number>(); let used = 0
  for (const x of scored) { if (used + cost[x.i] > budget) continue; keep.add(x.i); used += cost[x.i] }
  return { picked: chunks.filter((_, i) => keep.has(i)), skipped: chunks.length - keep.size }
}
