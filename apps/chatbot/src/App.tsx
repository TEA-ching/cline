import React from 'react'
import { useVault } from '@/hooks/useVault'
import { LoginScreen } from '@/components/auth/LoginScreen'
import { ChatView } from '@/components/chat/ChatView'

const App: React.FC = () => {
  const { isAuthenticated, config } = useVault()

  if (!isAuthenticated) return <LoginScreen />
  if (!config) return (
    <div className="flex h-screen items-center justify-center text-default-500 text-sm">
      Loading vault…
    </div>
  )

  return <ChatView vaultConfig={config} />
}

export default App
