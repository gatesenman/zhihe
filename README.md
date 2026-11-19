# 智合 Zhihe

**1.1.0** · 合同全生命周期管理（CLM）桌面应用：起草、要素提取、审核、审批、签署、履约、归档与续约，并可接入本地或远程 AI 引擎。

## 功能特性

- 覆盖合同全流程阶段，每个阶段可单独指定 AI 引擎；远程失败可回退本地规则引擎。
- 引擎：本地规则（离线）、Ollama、OpenAI 兼容接口，以及 JEV · TypeSafe 决策接口。
- 支持大型 PDF / DOCX（分块解析、可取消、虚拟滚动、map-reduce 抽取与审查）。
- API Key 只保存在用户数据目录，源码中不含密钥。

## 技术栈

- Electron + electron-vite + React + TypeScript
- mammoth / pdf-parse 等文档解析

## 从源码运行

源码在仓库根目录。本仓库不包含安装包。

```bash
npm install
npm run dev
npm run build
```
测试相关命令见 `README.original.md`；测试 Key 只通过环境变量传入。

## 文档

- [源码 README](README.original.md)

---

## English

# Zhihe

**1.1.0** · A contract-lifecycle management (CLM) desktop app: draft, extract, review, approve, sign, perform, archive, and renew — with local or remote AI engines at each stage.

## Features

- Covers the full contract lifecycle; each stage can use a different AI engine, with fallback to the local rules engine.
- Engines: offline local rules, Ollama, OpenAI-compatible APIs, and the JEV · TypeSafe decision API.
- Handles large PDF / DOCX files (chunked parsing, cancellation, virtual scrolling, map-reduce extract and review).
- API keys are stored only in the user data directory and are not in the source tree.

## Tech stack

- Electron + electron-vite + React + TypeScript
- mammoth / pdf-parse 等文档解析

## Getting started

Source is at the repository root. This repository does not include installers.

```bash
npm install
npm run dev
npm run build
```
Test commands are in `README.original.md`. Test keys must be passed via environment variables only.

## Documentation

- [源码 README](README.original.md)

