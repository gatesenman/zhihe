import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { DB, Contract } from './types'
import { sampleContracts, sampleRules } from './sample'
import { localExtract } from './engine'
import { routed, defaultAi } from './ai/router'
import type { AiEngine } from './ai/types'
import type { AiStage } from './types'
import { putText, approvedId } from './textcache'

export const zh = (window as any).zh
export const DB_VERSION = 2

/** 首次启动：写入示例合同全文（分块存储），数据库仅存元数据 */
export async function seed(): Promise<DB> {
  const contracts: Contract[] = []
  for (const c of sampleContracts()) {
    const { text, approvedText, ...meta } = c as any
    await putText(c.id, text); if (approvedText) await putText(approvedId(c.id), approvedText)
    contracts.push({ ...meta, preview: text.slice(0, 4000), textLen: text.length, chunks: 1, hasApproved: !!approvedText, facts: localExtract(text) })
  }
  return { version: DB_VERSION, contracts, rules: sampleRules(), reviews: [], settings: { theme: 'dark', remindDays: 60, ai: defaultAi() } }
}
/** v1.0 → v1.1 迁移：把内嵌全文移入分块存储；JEV 旧设置迁移为 OpenAI 兼容 */
async function migrate(d: any): Promise<DB> {
  if (d.version >= DB_VERSION) { d.settings.ai = { ...defaultAi(), ...d.settings.ai }; return d }
  for (const c of d.contracts) { if (c.text != null) { await putText(c.id, c.text); c.preview = c.text.slice(0, 4000); c.textLen = c.text.length; delete c.text } if (c.approvedText) { await putText(approvedId(c.id), c.approvedText); c.hasApproved = true; delete c.approvedText } }
  const ai = defaultAi(); const j = d.settings.jev
  if (j?.mode === 'remote' && j.endpoint) { ai.defaultEngine = 'openai'; ai.openai = { preset: 'custom', baseUrl: j.endpoint, apiKey: j.apiKey, model: j.model } }
  d.settings = { theme: d.settings.theme, remindDays: d.settings.remindDays, ai }; d.version = DB_VERSION; return d
}
interface Ctx { db: DB; set: (fn: (d: DB) => DB) => void; engine: AiEngine & { labelFor(st: AiStage): string }; updateContract: (id: string, patch: Partial<Contract>) => void; toast: (m: string, kind?: 'ok' | 'err') => void }
const C = createContext<Ctx>(null as any)
export const useStore = () => useContext(C)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DB | null>(null)
  const [toasts, setToasts] = useState<{ id: number; m: string; kind: string }[]>([])
  const timer = useRef<any>()
  useEffect(() => { zh.load().then(async (d: any) => setDb(d && d.contracts ? await migrate(d) : await seed())) }, [])
  useEffect(() => {
    if (!db) return
    document.documentElement.dataset.theme = db.settings.theme; zh.setTheme(db.settings.theme)
    clearTimeout(timer.current); timer.current = setTimeout(() => zh.save(JSON.stringify(db)), 300) // 防抖异步落盘（仅元数据）
  }, [db])
  useEffect(() => { (window as any).__setTheme = (t: any) => setDb((d) => d && { ...d, settings: { ...d.settings, theme: t } }) }, [])
  const engine = useMemo(() => routed(db?.settings.ai ?? defaultAi()), [db?.settings.ai])
  if (!db) return <div className="boot"><i className="ri-loader-4-line spin" /> 正在加载智合…</div>
  const set = (fn: (d: DB) => DB) => setDb((d) => fn(d!))
  const updateContract = (id: string, patch: Partial<Contract>) => set((d) => ({ ...d, contracts: d.contracts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  const toast = (m: string, kind: 'ok' | 'err' = 'ok') => { const id = Date.now() + Math.random(); setToasts((t) => [...t, { id, m, kind }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500) }
  ;(window as any).__store = { db, set, engine, updateContract }
  return <C.Provider value={{ db, set, engine, updateContract, toast }}>{children}<div className="toasts">{toasts.map((t) => <div key={t.id} className={'toast ' + t.kind}><i className={t.kind === 'ok' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} />{t.m}</div>)}</div></C.Provider>
}
