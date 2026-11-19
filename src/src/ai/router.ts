/** 按阶段路由到所选引擎；远程失败时（可配置）自动回退本地规则引擎。 */
import type { AiSettings, AiStage, EngineId } from '../types'
import type { AiEngine } from './types'
import { LocalEngine } from './local'
import { JevEngine } from './jev'
import { LlmEngine } from './llm'
export const ENGINE_LABEL: Record<EngineId, string> = { local: '本地规则（离线）', jev: 'JEV · TypeSafe', ollama: 'Ollama 本地模型', openai: 'OpenAI 兼容服务' }
export const STAGE_LIST: { k: AiStage; t: string; m: string }[] = [
  { k: 'draft', t: '起草', m: '条款生成 / 推荐' }, { k: 'extract', t: '要素提取', m: '合同要素' }, { k: 'review', t: '审核', m: '风险审查 / 批量审查' }, { k: 'approval', t: '审批', m: '审批建议' },
  { k: 'signing', t: '签署', m: '签前一致性' }, { k: 'performing', t: '履约', m: '义务提取 / 预警' }, { k: 'archive', t: '归档', m: '检索 / 问答' }, { k: 'renewal', t: '续约/到期', m: '续约建议' }, { k: 'assistant', t: '全局助手', m: 'AI 助手对话' }
]
const METHOD_STAGE: Record<string, AiStage> = { draftClause: 'draft', recommendClauses: 'draft', extractFacts: 'extract', review: 'review', approvalSummary: 'approval', presignCheck: 'signing', extractObligations: 'performing', riskAlerts: 'performing', search: 'archive', ask: 'archive', renewalAdvice: 'renewal', chat: 'assistant' }
export function build(id: EngineId, s: AiSettings): AiEngine { return id === 'jev' ? new JevEngine(s) : id === 'ollama' || id === 'openai' ? new LlmEngine(id, s) : new LocalEngine() }
export const engineIdFor = (s: AiSettings, st: AiStage): EngineId | 'off' => { const v = s.stageEngine[st]; return !v || v === 'default' ? s.defaultEngine : v }
/** 返回一个代理引擎：每个方法按其阶段选择实际引擎并处理回退 */
export function routed(s: AiSettings): AiEngine & { labelFor(st: AiStage): string } {
  const cache = new Map<EngineId, AiEngine>(); const get = (id: EngineId) => { if (!cache.has(id)) cache.set(id, build(id, s)); return cache.get(id)! }
  const local = get('local')
  const proxy: any = { id: 'routed', kind: 'rules', label: get(s.defaultEngine).label, labelFor: (st: AiStage) => { const id = engineIdFor(s, st); return id === 'off' ? '已停用' : get(id).label } }
  for (const [m, st] of Object.entries(METHOD_STAGE)) {
    proxy[m] = async (...args: any[]) => {
      const id = engineIdFor(s, st); if (id === 'off') throw new Error('该阶段 AI 已停用')
      const eng = get(id)
      try { return await (eng as any)[m](...args) } catch (e: any) {
        if (id === 'local' || !s.fallbackLocal || /已取消/.test(e.message)) throw e
        const r = await (local as any)[m](...args); return { ...r, fallback: `${eng.label} 调用失败，已回退本地：${e.message}` }
      }
    }
  }
  return proxy
}
export const defaultAi = (): AiSettings => ({ defaultEngine: 'local', stageEngine: {}, jev: { baseUrl: 'https://api.typesafe.ai', apiKey: '', model: 'jev-latest' }, ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:0.5b' }, openai: { preset: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', model: '' }, temperature: 0.2, concurrency: 4, maxRetries: 3, timeoutSec: 90, chunkChars: 12000, tokenBudget: 2_000_000, fallbackLocal: true })
