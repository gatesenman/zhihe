# 智合 Zhihe — 合同全生命周期管理（CLM）v1.1.0

Electron 33 + electron-vite + React 18 + TypeScript，中文界面，Remix Icon 图标。

## 开发 / 构建
```
npm install
npm run dev                              # 开发
npx electron-vite build && npx electron-builder --win nsis --x64   # Windows 安装包 → release/
```
## AI 引擎（设置 → AI 引擎与阶段路由）
| 引擎 | 说明 |
|---|---|
| 本地规则（离线） | 默认；正则提取、规则库、模板，无需网络 |
| JEV · TypeSafe | `POST https://api.typesafe.ai/v1/systemone`，Bearer Key；决策模型（Noul / Choice / Score），不生成文本。功能按其能力设计：候选值 + Choice 提取、逐段 Noul 风险判定 + map-reduce、Score 打分、置信度门控 |
| Ollama | 原生 `/api/chat`（format=json），`/api/tags` 列出本地模型 |
| OpenAI 兼容 | LM Studio / vLLM / llama.cpp server / Xinference 预设，`/v1/chat/completions` |

每个阶段（起草、要素提取、审核、审批、签署、履约、归档、续约、全局助手）可单独指定引擎；远程失败可自动回退本地规则引擎。
API Key 只保存在用户数据目录的设置中，源码中不含任何 Key。

适配器接口见 `src/ai/types.ts`（AiEngine），实现：`local.ts`、`jev.ts`、`llm.ts`，路由：`router.ts`，并发/重试/预算：`runtime.ts`。

## 大文件设计（800 页 PDF/DOCX）
- 导入在 Electron utilityProcess（`electron/parse-worker.ts`）中解析，进度事件 + 可取消
- 正文按 64K 字分块存盘（`userData/texts/<id>/`），元数据 JSON 原子写、防抖保存
- 渲染端 LRU 文本缓存 + 虚拟滚动正文查看器
- AI 调用分块 map-reduce，限流并发、429/529/5xx 指数退避重试、token 预算按关键词优先选块
- 增量要素提取（worker 内 32K 窗口合并）；批量审查合同级并发 2、可取消、不阻塞 UI

## 测试
```
node scripts/gen-bigdoc.mjs <outdir>           # 生成 800 页测试文档
ZHIHE_E2E=out.json ZHIHE_E2E_PHASE=perf|jev|ollama ZHIHE_TEST_JEV_KEY=... npx electron .
```
测试 Key 仅通过环境变量传入，不写入仓库。
