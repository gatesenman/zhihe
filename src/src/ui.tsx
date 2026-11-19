import React from 'react'
import type { Status, Verdict } from './types'
import { stageLabel } from './types'
export const Icon = ({ n, className = '' }: { n: string; className?: string }) => <i className={`ri-${n} ${className}`} />
export const StatusChip = ({ s }: { s: Status }) => <span className={`chip st-${s}`}><span className="dot" />{stageLabel(s)}</span>
const VL: Record<Verdict, [string, string]> = { pass: ['通过', 'checkbox-circle-fill'], fail: ['不通过', 'close-circle-fill'], warn: ['警告', 'error-warning-fill'] }
export const VerdictChip = ({ v }: { v: Verdict }) => <span className={`chip v-${v}`}><Icon n={VL[v][1]} />{VL[v][0]}</span>
export const verdictLabel = (v: Verdict) => VL[v][0]
export const SampleTag = () => <span className="chip sample"><Icon n="flask-line" />示例数据</span>
export const JevBadge = ({ engine }: { engine?: string }) => <span className="jev-badge"><Icon n="sparkling-2-fill" />{engine || 'AI'}</span>
export const AiBadge = JevBadge
export function PageHead({ title, sub, icon, children }: { title: string; sub?: string; icon: string; children?: React.ReactNode }) {
  return <div className="page-head"><div className="ph-title"><Icon n={icon} /><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div></div><div className="ph-actions">{children}</div></div>
}
export const Btn = ({ icon, children, kind = '', ...p }: any) => <button className={`btn ${kind}`} {...p}>{icon && <Icon n={icon} />}{children}</button>
export const Card = ({ title, icon, extra, children, className = '' }: any) => <div className={'card ' + className}>{title && <div className="card-h"><span>{icon && <Icon n={icon} />}{title}</span>{extra}</div>}<div className="card-b">{children}</div></div>
export const Empty = ({ text }: { text: string }) => <div className="empty"><Icon n="inbox-2-line" /><span>{text}</span></div>
export function Fallback({ r }: { r?: { engine: string; fallback?: string; usage?: any; note?: string } | null }) {
  if (!r) return null
  const u = r.usage
  return <div className="jev-meta"><JevBadge engine={r.engine} />{u && u.calls > 0 && <span className="muted usage"><Icon n="pulse-line" />{u.calls} 次调用 · {u.inputTokens.toLocaleString()} tokens · {(u.ms / 1000).toFixed(1)}s{u.retries ? ` · 重试 ${u.retries}` : ''}{u.chunks ? ` · ${u.chunks} 块` : ''}</span>}{r.note && <span className="muted">{r.note}</span>}{r.fallback && <span className="warn-text"><Icon n="alert-line" />{r.fallback}</span>}</div>
}
/** 虚拟化文本查看器：仅渲染可视区域行，支撑 800+ 页合同 */
export function VirtualText({ text, height = 560, highlight }: { text: string; height?: number; highlight?: string }) {
  const lines = React.useMemo(() => { const out: string[] = []; for (const l of text.split('\n')) { if (l.length <= 90) out.push(l); else for (let i = 0; i < l.length; i += 90) out.push(l.slice(i, i + 90)) } return out }, [text])
  const LH = 24; const [top, setTop] = React.useState(0); const ref = React.useRef<HTMLDivElement>(null)
  const start = Math.max(0, Math.floor(top / LH) - 20), end = Math.min(lines.length, Math.ceil((top + height) / LH) + 20)
  const [q, setQ] = React.useState(highlight || ''); const [hit, setHit] = React.useState(-1)
  const find = () => { if (!q) return; for (let k = 1; k <= lines.length; k++) { const i = (hit + k) % lines.length; if (lines[i].includes(q)) { setHit(i); ref.current!.scrollTop = i * LH - height / 3; return } } }
  return <div className="vtext"><div className="vt-bar"><span className="muted">{text.length.toLocaleString()} 字 · {lines.length.toLocaleString()} 行 · 虚拟滚动</span><span className="spacer" /><div className="tb-search"><Icon n="search-line" /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} placeholder="文内查找，回车下一个" /></div></div>
    <div className="vt-body" ref={ref} style={{ height }} onScroll={(e) => setTop((e.target as HTMLDivElement).scrollTop)}><div style={{ height: lines.length * LH, position: 'relative' }}>{lines.slice(start, end).map((l, k) => <div key={start + k} className={'vt-line' + (start + k === hit ? ' hit' : '')} style={{ top: (start + k) * LH }}><span className="ln">{start + k + 1}</span>{l || ' '}</div>)}</div></div></div>
}
