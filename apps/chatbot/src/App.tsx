/*
 * MIT License
 *
 * Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import React from 'react'
import { useVault } from '@/hooks/useVault'
import { LoginScreen } from '@/components/auth/LoginScreen'
import { ChatView } from '@/components/chat/ChatView'
import { ErrorBoundary } from '@/components/ErrorBoundary'



const App: React.FC = () => {
  const { isAuthenticated, config, loading, error, refresh, logout } = useVault()

  if (!isAuthenticated) return <LoginScreen />

  if (!config) {
    if (loading) {
      return (
        <div className="flex h-screen items-center justify-center text-default-500 text-sm">
          Loading vault…
        </div>
      )
    }
    if (error) {
      return (
        <div className="flex h-screen items-center justify-center">
          <div className="max-w-md text-center space-y-4 p-6">
            <p className="text-lg font-semibold text-danger-600">Vault error</p>
            <p className="text-sm text-default-600 bg-default-100 rounded-md px-4 py-3 font-mono text-left break-all">
              {error}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={() => void refresh()}
                className="px-4 py-2 rounded-md bg-primary-500 text-white text-sm hover:bg-primary-600 transition-colors"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={logout}
                className="px-4 py-2 rounded-md border border-default-300 text-sm hover:bg-default-100 transition-colors"
              >
                Back to login
              </button>
            </div>
          </div>
        </div>
      )
    }
    // Authenticated but no config yet (initial mount before effect fires)
    return (
      <div className="flex h-screen items-center justify-center text-default-500 text-sm">
        Loading vault…
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <ChatView vaultConfig={config} />
    </ErrorBoundary>
  )
}

export default App
