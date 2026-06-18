import React from 'react'
import { createRoot } from 'react-dom/client'
import { VaultProvider } from '@/hooks/useVault'
import App from './App'
import './styles/global.css'

const rootElement = document.getElementById('root')!
createRoot(rootElement).render(
  <VaultProvider>
    <App />
  </VaultProvider>,
)
