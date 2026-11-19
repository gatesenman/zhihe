export type Status = 'draft' | 'review' | 'approval' | 'signing' | 'performing' | 'archived'
export const STAGES: { key: Status; label: string; icon: string }[] = [
  { key: 'draft', label: '起草', icon: 'ri-draft-line' },
  { key: 'review', label: '审核', icon: 'ri-search-eye-line' },
  { key: 'approval', label: '审批', icon: 'ri-shield-check-line' },
  { key: 'signing', label: '签署', icon: 'ri-quill-pen-line' },
  { key: 'performing', label: '履约', icon: 'ri-loop-right-line' },
  { key: 'archived', label: '归档', icon: 'ri-archive-line' }
]
export const stageLabel = (s: Status) => STAGES.find((x) => x.key === s)?.label ?? s
export interface Facts {
  partyA?: string; partyB?: string; amount?: number; currency?: string
  signDate?: string; startDate?: string; endDate?: string
  paymentTerms?: string; prepaymentRatio?: number; penaltyRate?: number; liabilityCap?: string; liability?: string
  governingLaw?: string; disputeResolution?: string; confidentiality?: boolean; terminationNoticeDays?: number
  autoRenew?: boolean; warrantyMonths?: number; ipOwnership?: string
}
export const FACT_FIELDS: { key: keyof Facts; label: string; type: 'text' | 'number' | 'date' | 'bool' }[] = [
  { key: 'partyA', label: '甲方', type: 'text' }, { key: 'partyB', label: '乙方', type: 'text' },
  { key: 'amount', label: '合同金额(元)', type: 'number' }, { key: 'currency', label: '币种', type: 'text' },
  { key: 'signDate', label: '签订日期', type: 'date' }, { key: 'startDate', label: '生效日期', type: 'date' },
  { key: 'endDate', label: '到期日期', type: 'date' }, { key: 'paymentTerms', label: '付款条款', type: 'text' },
  { key: 'prepaymentRatio', label: '预付款比例(%)', type: 'number' }, { key: 'penaltyRate', label: '违约金比例(%)', type: 'number' },
  { key: 'liabilityCap', label: '责任上限', type: 'text' }, { key: 'liability', label: '违约责任', type: 'text' },
  { key: 'governingLaw', label: '适用法律', type: 'text' }, { key: 'disputeResolution', label: '争议解决', type: 'text' },
  { key: 'confidentiality', label: '含保密条款', type: 'bool' }, { key: 'terminationNoticeDays', label: '解除通知期(天)', type: 'number' },
  { key: 'autoRenew', label: '自动续约', type: 'bool' }, { key: 'warrantyMonths', label: '质保期(月)', type: 'number' },
  { key: 'ipOwnership', label: '知识产权归属', type: 'text' }
]
export interface Milestone { id: string; title: string; due: string; kind: 'payment' | 'delivery' | 'obligation'; amount?: number; done: boolean; source?: 'AI' | 'JEV' | '手工' }
export interface Contract {
  id: string; title: string; type: string; counterparty: string; owner: string; status: Status
  amount: number; endDate?: string
  /** v1.1 起全文分块存储在 userData/texts/<id>/，此处仅保留预览与统计 */
  text?: string; preview?: string; textLen?: number; chunks?: number; pages?: number; sourceFile?: string; hasApproved?: boolean
  facts: Facts
  milestones: Milestone[]; history: { at: string; status: Status; note: string }[]; sample?: boolean; createdAt: string; tags?: string[]
  risk?: number; lastVerdict?: Verdict
}
export type Severity = 'fail' | 'warn'
export interface Rule { id: string; code: string; name: string; category: string; severity: Severity; enabled: boolean; script: string; message: string; sample?: boolean }
export type Verdict = 'pass' | 'fail' | 'warn'
export interface Finding { ruleId: string; ruleName: string; source: '规则库' | 'AI'; verdict: Verdict; reason: string }
export interface ReviewItem { contractId: string; title: string; verdict: Verdict; risk: number; findings: Finding[]; engine: string; at: string }
export type EngineId = 'local' | 'jev' | 'ollama' | 'openai'
export type AiStage = 'draft' | 'extract' | 'review' | 'approval' | 'signing' | 'performing' | 'archive' | 'renewal' | 'assistant'
export interface AiSettings {
  defaultEngine: EngineId
  stageEngine: Partial<Record<AiStage, EngineId | 'default' | 'off'>>
  jev: { baseUrl: string; apiKey: string; model: string }
  ollama: { baseUrl: string; model: string }
  openai: { preset: string; baseUrl: string; apiKey: string; model: string }
  temperature: number; concurrency: number; maxRetries: number; timeoutSec: number
  chunkChars: number; tokenBudget: number; fallbackLocal: boolean
}
export interface DB { contracts: Contract[]; rules: Rule[]; reviews: { id: string; at: string; items: ReviewItem[] }[]; settings: { theme: 'dark' | 'light'; ai: AiSettings; remindDays: number; jev?: any } ; version: number }
