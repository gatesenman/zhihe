/** 渲染端全文缓存（LRU，按字符数限额），全文本体由主进程分块存储。 */
import { zh } from './store'
const cache = new Map<string, string>(); let total = 0; const LIMIT = 12_000_000
export async function getText(id: string): Promise<string> {
  const hit = cache.get(id); if (hit != null) { cache.delete(id); cache.set(id, hit); return hit }
  const t: string = (await zh.textGet(id)) || ''
  cache.set(id, t); total += t.length
  while (total > LIMIT && cache.size > 1) { const [k, v] = cache.entries().next().value!; cache.delete(k); total -= v.length }
  return t
}
export async function putText(id: string, text: string) { const old = cache.get(id); if (old != null) total -= old.length; cache.set(id, text); total += text.length; return zh.textPut({ id, text }) }
export function dropText(id: string) { const old = cache.get(id); if (old != null) { total -= old.length; cache.delete(id) } }
export const approvedId = (id: string) => id + '__approved'
