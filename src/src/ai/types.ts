/**
 * 智合 AI 引擎适配层（可插拔）
 * ------------------------------------------------------------------
 * 所有生命周期阶段的 AI 能力都通过 AiEngine 接口调用；设置页可为每个阶段单独选择引擎。
 *  - local  ：离线规则 / 启发式引擎（始终可用，也是所有引擎的回退）
 *  - jev    ：TypeSafe JEV（System One 决策模型，POST /v1/systemone；只返回 Choice/Score/Noul 结构化答案，不生成文字）
 *  - ollama ：Ollama 原生 API（/api/chat、/api/tags），本地开源模型
 *  - openai ：OpenAI 兼容服务（LM Studio / vLLM / llama.cpp server / Xinference / 云端）
 * 新增引擎：实现 AiEngine 并在 ai/router.ts 的 build() 中注册。
 */
import type { Contract, Facts, Finding, Milestone } from '../types'
import type { Usage, CancelToken } from './runtime'
export interface AiResult<T> { data: T; engine: string; fallback?: string; usage?: Usage; note?: string }
export interface Clause { title: string; text: string; from?: string; prob?: number }
export interface SearchHit { contractId: string; title: string; score: number; snippet: string }
export interface Opt { cancel?: CancelToken; onProgress?: (done: number, total: number, label?: string) => void }
export interface AiEngine {
  id: string; label: string; kind: 'decision' | 'generative' | 'rules'
  draftClause(type: string, requirement: string, history: Contract[], o?: Opt): Promise<AiResult<string>>
  recommendClauses(c: Contract, history: Contract[], o?: Opt): Promise<AiResult<Clause[]>>
  extractFacts(c: Contract, o?: Opt): Promise<AiResult<Facts>>
  review(c: Contract, o?: Opt): Promise<AiResult<Finding[]>>
  approvalSummary(c: Contract, findings: Finding[], o?: Opt): Promise<AiResult<{ recommendation: '建议批准' | '有条件批准' | '建议驳回'; summary: string; probs?: Record<string, number> }>>
  presignCheck(c: Contract, o?: Opt): Promise<AiResult<{ consistent: boolean; diffs: { approved: string; current: string; material?: number }[]; note: string }>>
  extractObligations(c: Contract, o?: Opt): Promise<AiResult<Omit<Milestone, 'id'>[]>>
  riskAlerts(c: Contract, o?: Opt): Promise<AiResult<string[]>>
  search(q: string, cs: Contract[], o?: Opt): Promise<AiResult<SearchHit[]>>
  ask(q: string, cs: Contract[], o?: Opt): Promise<AiResult<{ answer: string; cites: SearchHit[] }>>
  renewalAdvice(c: Contract, o?: Opt): Promise<AiResult<string>>
  chat(messages: { role: 'user' | 'assistant'; content: string }[], context: string, o?: Opt): Promise<AiResult<string>>
}
