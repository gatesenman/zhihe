/** 分块文本存储：userData/texts/<id>/meta.json + c0000.txt ...（每块 CHUNK 字符）。合同元数据库不再内嵌全文。 */
import { join } from 'path'
import { promises as fs, mkdirSync, writeFileSync, rmSync } from 'fs'
export const CHUNK = 64 * 1024
const safe = (id: string) => id.replace(/[^\w.-]/g, '_')
export const dirOf = (root: string, id: string) => join(root, 'texts', safe(id))
export function putTextSync(root: string, id: string, text: string) {
  const d = dirOf(root, id); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true })
  const n = Math.max(1, Math.ceil(text.length / CHUNK))
  for (let i = 0; i < n; i++) writeFileSync(join(d, `c${String(i).padStart(4, '0')}.txt`), text.slice(i * CHUNK, (i + 1) * CHUNK))
  writeFileSync(join(d, 'meta.json'), JSON.stringify({ chunks: n, length: text.length }))
  return { chunks: n, length: text.length }
}
export async function putText(root: string, id: string, text: string) {
  const d = dirOf(root, id); await fs.rm(d, { recursive: true, force: true }); await fs.mkdir(d, { recursive: true })
  const n = Math.max(1, Math.ceil(text.length / CHUNK))
  for (let i = 0; i < n; i++) await fs.writeFile(join(d, `c${String(i).padStart(4, '0')}.txt`), text.slice(i * CHUNK, (i + 1) * CHUNK))
  await fs.writeFile(join(d, 'meta.json'), JSON.stringify({ chunks: n, length: text.length }))
  return { chunks: n, length: text.length }
}
export async function getMeta(root: string, id: string) { try { return JSON.parse(await fs.readFile(join(dirOf(root, id), 'meta.json'), 'utf8')) } catch { return null } }
export async function getChunk(root: string, id: string, i: number) { return fs.readFile(join(dirOf(root, id), `c${String(i).padStart(4, '0')}.txt`), 'utf8') }
export async function getText(root: string, id: string) { const m = await getMeta(root, id); if (!m) return ''; const parts: string[] = []; for (let i = 0; i < m.chunks; i++) parts.push(await getChunk(root, id, i)); return parts.join('') }
export async function delText(root: string, id: string) { await fs.rm(dirOf(root, id), { recursive: true, force: true }) }
