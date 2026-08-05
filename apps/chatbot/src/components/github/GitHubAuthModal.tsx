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
import React, { useState, useEffect, useRef } from 'react'
import { Button, Card } from '@heroui/react'
import { GitBranch, Copy, Check, ExternalLink, X, Loader } from 'lucide-react'
import type { DeviceFlowState } from '@/hooks/useGitHubAuth'

/**
 * GitHub OAuth App setup — https://github.com/settings/developers
 * ─────────────────────────────────────────────────────────────────
 * 1. Click "New OAuth App" (or "Register a new application")
 *
 * Required fields:
 *   • Application name         : anything (e.g. "My GitHub Chatbot Explorer")
 *   • Homepage URL             : your app origin (e.g. https://chatbot.example.com)
 *   • Authorization callback URL: any valid URL — Device Flow ignores it
 *                                 (e.g. https://chatbot.example.com/callback)
 *
 * ⚠️  CHECK "Enable Device Flow" in the app settings — without it GitHub returns 404.
 * ⚠️  Do NOT check "Request user authorization (OAuth) during installation" (GitHub Apps only).
 *
 * 2. After creation, copy the "Client ID" (starts with "Ov23li…")
 *    → set it as the GITHUB_CLIENT_ID environment variable in .env / .env.local:
 *
 *      GITHUB_CLIENT_ID=Ov23liXXXXXXXXXXXXXX
 *
 *    If the variable is absent, the modal shows a text field so users can supply
 *    their own client_id at runtime.
 *
 * 3. Never generate or store a "Client secret" — Device Flow does not need one.
 *
 * Required OAuth scope: "public_repo" (read-only access to public repositories).
 * To also browse private repositories, change SCOPE to "repo" in useGitHubAuth.ts.
 */
interface Props {
  /** Client ID of the GitHub OAuth App (from GITHUB_CLIENT_ID) */
  clientId?: string
  deviceFlow: DeviceFlowState | null
  isPolling: boolean
  justAuthorized: boolean
  authError: string | null
  onStart: (clientId: string) => Promise<void>
  onCancel: () => void
}

export const GitHubAuthModal: React.FC<Props> = ({
  clientId,
  deviceFlow,
  isPolling,
  justAuthorized,
  authError,
  onStart,
  onCancel,
}) => {
  const [manualClientId, setManualClientId] = useState(clientId ?? '')
  const [copied, setCopied] = useState(false)
  // Remaining seconds until device code expires
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Countdown timer
  useEffect(() => {
    if (!deviceFlow) { setSecondsLeft(null); return }
    const tick = () => {
      const left = Math.max(0, Math.floor((deviceFlow.expiresAt - Date.now()) / 1000))
      setSecondsLeft(left)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deviceFlow])

  const handleCopy = () => {
    if (!deviceFlow) return
    navigator.clipboard.writeText(deviceFlow.userCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleOpenGitHub = () => {
    if (!deviceFlow) return
    // Copy code first, then open tab
    navigator.clipboard.writeText(deviceFlow.userCode).catch(() => {})
    window.open(deviceFlow.verificationUri, '_blank', 'noopener,noreferrer')
  }

  const handleStart = () => {
    const id = (clientId ?? manualClientId).trim()
    if (!id) { inputRef.current?.focus(); return }
    void onStart(id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md p-6">
        {/* Header */}
        <Card.Header>
          <div className="flex items-center justify-between w-full">
            <Card.Title className="flex items-center gap-2 text-lg font-semibold">
              <GitBranch className="h-5 w-5 text-default-600" />
              Connect GitHub
            </Card.Title>
            <button
              onClick={onCancel}
              className="rounded-md p-1 text-default-400 hover:text-default-700 hover:bg-default-100 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <Card.Description className="text-xs text-default-500 mt-1">
            Authentication via GitHub Device Flow (RFC 8628) — no client secret required.
          </Card.Description>
        </Card.Header>

        <Card.Content className="mt-4 space-y-4">
          {/* Step 0: no client_id configured */}
          {!clientId && !deviceFlow && (
            <div className="space-y-2">
              <p className="text-sm text-default-600">
                Enter the <strong>Client ID</strong> of your GitHub OAuth App.{' '}
                <a
                  href="https://github.com/settings/developers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-500 underline hover:text-primary-600 inline-flex items-center gap-0.5"
                >
                  Create an app <ExternalLink className="h-3 w-3" />
                </a>
              </p>
              <input
                ref={inputRef}
                type="text"
                value={manualClientId}
                onChange={e => setManualClientId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleStart()}
                placeholder="Ov23li…"
                className="w-full rounded-md border border-default-300 bg-default-50 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
          )}

          {/* Step 1: device flow active */}
          {deviceFlow && (
            <div className="space-y-4">
              <p className="text-sm text-default-600">
                <span className="font-semibold text-default-800">Step 1</span> — Copy this code:
              </p>
              <div className="flex items-center gap-3">
                <span className="flex-1 rounded-lg border border-default-300 bg-default-50 px-4 py-3 text-center font-mono text-2xl font-bold tracking-widest text-default-900 select-all">
                  {deviceFlow.userCode}
                </span>
                <button
                  onClick={handleCopy}
                  title="Copy code"
                  className="rounded-md p-2 text-default-500 hover:text-default-800 hover:bg-default-100 transition-colors"
                >
                  {copied ? <Check className="h-4 w-4 text-success-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>

              <p className="text-sm text-default-600">
                <span className="font-semibold text-default-800">Step 2</span> — Open GitHub and paste the code:
              </p>
              <Button
                variant="secondary"
                className="w-full"
                onPress={handleOpenGitHub}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open github.com/login/device
              </Button>

              {/* Status */}
              <div className="flex items-center justify-between text-xs text-default-500">
                {isPolling ? (
                  <span className="flex items-center gap-1.5">
                    <Loader className="h-3 w-3 animate-spin" />
                    Waiting for authorization…
                  </span>
                ) : (
                  <span>Waiting…</span>
                )}
                {secondsLeft !== null && (
                  <span className={secondsLeft < 30 ? 'text-warning-500 font-semibold' : ''}>
                    Expires in {secondsLeft}s
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Success */}
          {justAuthorized && (
            <div className="flex items-center gap-2 rounded-lg bg-success-50 border border-success-200 px-4 py-3 text-sm text-success-700">
              <Check className="h-4 w-4 shrink-0" />
              GitHub account connected successfully!
            </div>
          )}

          {/* Error */}
          {authError && (
            <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
              {authError}
            </div>
          )}
        </Card.Content>

        <Card.Footer className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onPress={onCancel}>
            Cancel
          </Button>
          {!deviceFlow && (
            <Button
              variant="primary"
              onPress={handleStart}
              isDisabled={!(clientId ?? manualClientId).trim()}
            >
              Start
            </Button>
          )}
        </Card.Footer>
      </Card>
    </div>
  )
}
