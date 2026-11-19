/** 导入中心：每个文件在独立 utilityProcess 中解析，界面实时显示进度，可取消。 */
import React, { useEffect, useState } from 'react'
import { zh } from './store'
import { Icon, Btn } from './ui'
import type { Contract } from './types'
export interface Job { jobId: string; path: string; name: string; stage: string; pct: number; state: 'running' | 'done' | 'error' | 'cancelled'; error?: string; t0: number; ms?: number; result?: any }
let jobs: Job[] = []; const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const upd = (id: string, p: Partial<Job>) => { jobs = jobs.map((j) => (j.jobId === id ? { ...j, ...p } : j)); emit() }
let wired = false
export function useJobs() { const [, f] = useState(0); useEffect(() => { const s = () => f((x) => x + 1); subs.add(s); return () => { subs.delete(s) } }, []); return jobs }
export async function importPaths(paths: string[], addContract: (c: Contract) => void): Promise<Job[]> {
  if (!wired) { zh.onImportProgress((m: any) => upd(m.jobId, { stage: m.stage, pct: m.pct })); wired = true }
  const now = new Date().toISOString().slice(0, 10)
  return Promise.all(paths.map(async (path, i) => {
    const jobId = 'imp' + Date.now() + i; const id = `C-${now.slice(0, 4)}-I${Date.now().toString().slice(-5)}${i}`
    jobs = [{ jobId, path, name: path.split(/[\\/]/).pop()!, stage: '排队', pct: 0, state: 'running', t0: performance.now() }, ...jobs]; emit()
    const r = await zh.importFile({ path, id, jobId })
    const ms = performance.now() - jobs.find((j) => j.jobId === jobId)!.t0
    if (r.type !== 'done') { upd(jobId, { state: r.error === '已取消' ? 'cancelled' : 'error', error: r.error, ms }); return jobs.find((j) => j.jobId === jobId)! }
    const f = r.facts
    addContract({ id, title: r.name, type: '其他', counterparty: f.partyB || '—', owner: '王敏', status: 'review', amount: f.amount || 0, endDate: f.endDate, preview: r.preview, textLen: r.length, chunks: r.chunks, pages: r.pages, sourceFile: path, facts: f, milestones: [], history: [{ at: now, status: 'review', note: `导入 ${r.ext}` }], createdAt: now, tags: r.pages > 100 || r.length > 300000 ? ['大文件'] : [] })
    upd(jobId, { state: 'done', pct: 100, stage: `完成：${r.pages ? r.pages + ' 页 · ' : ''}${r.length.toLocaleString()} 字 · ${r.chunks} 块`, ms, result: { ...r, preview: undefined, contractId: id } })
    return jobs.find((j) => j.jobId === jobId)!
  }))
}
export function ImportPanel() {
  const list = useJobs(); if (!list.length) return null
  return <div className="card import-panel"><div className="card-h"><span><Icon n="upload-cloud-2-line" />导入任务（后台子进程解析，不阻塞界面）</span><a className="link" onClick={() => { jobs = jobs.filter((j) => j.state === 'running'); emit() }}>清除已完成</a></div>
    <div className="card-b">{list.map((j) => <div key={j.jobId} className={'job ' + j.state}><Icon n={j.state === 'running' ? 'loader-4-line spin' : j.state === 'done' ? 'checkbox-circle-fill' : 'close-circle-fill'} /><div className="job-main"><div><b>{j.name}</b><span className="muted"> {j.error || j.stage}{j.ms ? ` · ${(j.ms / 1000).toFixed(1)}s` : ''}</span></div><div className="progress"><i style={{ width: j.pct + '%' }} /></div></div>{j.state === 'running' && <Btn icon="stop-circle-line" kind="sm danger" onClick={() => zh.cancelImport(j.jobId)}>取消</Btn>}</div>)}</div></div>
}
