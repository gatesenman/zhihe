import React from 'react'
import { createRoot } from 'react-dom/client'
import 'remixicon/fonts/remixicon.css'
import './styles.css'
import { StoreProvider } from './store'
import App from './App'
createRoot(document.getElementById('root')!).render(<StoreProvider><App /></StoreProvider>)
;(window as any).zh?.e2eConfig?.().then((c: any) => c && import('./e2e').then((m) => setTimeout(m.runE2E, 1500)))
