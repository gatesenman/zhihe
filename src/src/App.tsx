import React, { useEffect, useState } from 'react'
import { useStore } from './store'
import { Icon } from './ui'
import Assistant from './Assistant'
import { Dashboard, Contracts, ContractDetail, Drafting } from './pages1'
import { Rules, Batch } from './pages2'
import { Performance, Archive, Renewal, Settings } from './pages3'

export const NAV = [
  { group: '工作台', items: [{ k: 'dashboard', t: '仪表盘', i: 'dashboard-3-line' }] },
  { group: '合同生命周期', items: [{ k: 'contracts', t: '合同库', i: 'file-list-3-line' }, { k: 'draft', t: '起草', i: 'draft-line' }, { k: 'batch', t: '批量审查', i: 'shield-check-line' }, { k: 'performance', t: '履约跟踪', i: 'loop-right-line' }, { k: 'renewal', t: '续约 / 到期', i: 'calendar-event-line' }, { k: 'archive', t: '归档与检索', i: 'archive-drawer-line' }] },
  { group: '规则与引擎', items: [{ k: 'rules', t: '规则库', i: 'code-box-line' }, { k: 'settings', t: '设置', i: 'settings-4-line' }] }
]
export function useRoute() {
  const parse = () => { const h = location.hash.replace(/^#\/?/, '') || 'dashboard'; const [path, qs] = h.split('?'); return { parts: path.split('/'), q: new URLSearchParams(qs) } }
  const [r, setR] = useState(parse())
  useEffect(() => { const f = () => setR(parse()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])
  return r
}
export const go = (p: string) => (location.hash = '#/' + p)

export default function App() {
  const { db, set, engine } = useStore()
  const { parts, q } = useRoute()
  const [assist, setAssist] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => { if (q.get('ask')) setAssist(true) }, [q.get('ask')])
  const page = parts[0]
  const expiring = db.contracts.filter((c) => c.status !== 'archived' && c.endDate && (new Date(c.endDate).getTime() - Date.now()) / 864e5 <= db.settings.remindDays).length
  const view = (() => {
    switch (page) {
      case 'contracts': return <Contracts />
      case 'contract': return <ContractDetail id={parts[1]} />
      case 'draft': return <Drafting />
      case 'rules': return <Rules autoTest={!!q.get('test')} />
      case 'batch': return <Batch auto={!!q.get('auto')} />
      case 'performance': return <Performance />
      case 'renewal': return <Renewal />
      case 'archive': return <Archive />
      case 'settings': return <Settings />
      default: return <Dashboard />
    }
  })()
  const ctx = page === 'contract' ? db.contracts.find((c) => c.id === parts[1]) : undefined
  return (
    <div className={'app' + (collapsed ? ' collapsed' : '')}>
      <aside className="sidebar">
        <div className="brand"><div className="logo"><Icon n="contract-line" /></div>{!collapsed && <div><b>智合</b><small>合同全生命周期管理</small></div>}</div>
        <nav>{NAV.map((g) => <div key={g.group} className="nav-group">{!collapsed && <div className="nav-title">{g.group}</div>}{g.items.map((it) => <a key={it.k} className={'nav-item' + (page === it.k || (page === 'contract' && it.k === 'contracts') ? ' active' : '')} onClick={() => go(it.k)} title={it.t}><Icon n={it.i} />{!collapsed && <span>{it.t}</span>}{!collapsed && it.k === 'renewal' && expiring > 0 && <em className="badge">{expiring}</em>}</a>)}</div>)}</nav>
        <div className="side-foot">{!collapsed && <div className="engine-pill" title="默认 AI 引擎（可按阶段在设置中切换）" onClick={() => go('settings')}><Icon n="cpu-line" /><span>{engine.label}</span></div>}<a className="nav-item" onClick={() => setCollapsed(!collapsed)}><Icon n={collapsed ? 'menu-unfold-line' : 'menu-fold-line'} />{!collapsed && <span>收起侧栏</span>}</a></div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumbs"><Icon n="home-4-line" /><span>智合</span><Icon n="arrow-right-s-line" /><b>{NAV.flatMap((g) => g.items).find((i) => i.k === page)?.t || (page === 'contract' ? '合同详情' : '仪表盘')}</b></div>
          <div className="search-global"><Icon n="search-line" /><input placeholder="搜索合同编号、名称、相对方…  (回车跳转合同库)" onKeyDown={(e) => { if (e.key === 'Enter') { sessionStorage.setItem('zh-q', (e.target as HTMLInputElement).value); go('contracts?q=' + encodeURIComponent((e.target as HTMLInputElement).value)) } }} /></div>
          <div className="top-actions">
            <button className="icon-btn" title="切换主题" onClick={() => set((d) => ({ ...d, settings: { ...d.settings, theme: d.settings.theme === 'dark' ? 'light' : 'dark' } }))}><Icon n={db.settings.theme === 'dark' ? 'sun-line' : 'moon-line'} /></button>
            <button className="icon-btn" title="到期提醒" onClick={() => go('renewal')}><Icon n="notification-3-line" />{expiring > 0 && <i className="dot-red" />}</button>
            <button className={'btn jev ' + (assist ? 'on' : '')} onClick={() => setAssist(!assist)}><Icon n="sparkling-2-fill" />AI 助手</button>
            <div className="avatar">王</div>
          </div>
        </header>
        <div className="body"><div className="content">{view}</div>{assist && <Assistant contract={ctx} page={page} onClose={() => setAssist(false)} autoAsk={q.get('ask') ? '哪些合同适用境外法律？' : undefined} />}</div>
      </div>
    </div>
  )
}
