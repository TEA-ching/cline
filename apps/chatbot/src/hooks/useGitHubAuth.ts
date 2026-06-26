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

/**
 * GitHub Device Authorization Grant (RFC 8628) for browser SPAs.
 * No client_secret required — only a client_id from a registered GitHub OAuth App.
 * Unauthenticated: 60 req/h  |  Authenticated: 5 000 req/h
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const LS_KEY = 'chatbot_github_token'

const GH_DEVICE_CODE_URL = 'https://github.com/login/device/code'
const GH_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const SCOPE = 'public_repo'

export interface DeviceFlowState {
  deviceCode: string
  userCode: string
  verificationUri: string
  /** Unix timestamp (ms) when the device code expires */
  expiresAt: number
  /** Polling interval in seconds */
  interval: number
}

export interface UseGitHubAuthReturn {
  /** Current access token, null if not authenticated */
  githubToken: string | null
  /** Active Device Flow challenge, null when flow is not in progress */
  deviceFlow: DeviceFlowState | null
  /** True while polling for authorization */
  isPolling: boolean
  /** True once the user authorised (brief window before auto-close) */
  justAuthorized: boolean
  /** Human-readable error from the last operation */
  authError: string | null
  /** Start the Device Flow. clientId must be a GitHub OAuth App client_id. */
  startDeviceFlow: (clientId: string) => Promise<void>
  /** Cancel an in-progress flow and close the modal */
  cancelDeviceFlow: () => void
  /** Clear the stored token */
  logout: () => void
}

export function useGitHubAuth(): UseGitHubAuthReturn {
  const [githubToken, setGithubToken] = useState<string | null>(
    () => localStorage.getItem(LS_KEY),
  )
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowState | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [justAuthorized, setJustAuthorized] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // Ref so the polling loop can be cancelled without stale-closure issues
  const pollAbortRef = useRef<AbortController | null>(null)

  // Restore token from localStorage on mount (already done in useState initialiser,
  // but sync it if another tab writes to the key)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) setGithubToken(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const cancelDeviceFlow = useCallback(() => {
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
    setDeviceFlow(null)
    setIsPolling(false)
    setJustAuthorized(false)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(LS_KEY)
    setGithubToken(null)
  }, [])

  const startDeviceFlow = useCallback(async (clientId: string) => {
    setAuthError(null)
    setJustAuthorized(false)

    try {
      // ── Step 1: request device & user codes ─────────────────────────────
      const codeRes = await fetch(GH_DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ client_id: clientId, scope: SCOPE }).toString(),
      })
      if (!codeRes.ok) throw new Error(`GitHub ${codeRes.status}: ${codeRes.statusText}`)
      const codeData: {
        device_code: string
        user_code: string
        verification_uri: string
        expires_in: number
        interval: number
      } = await codeRes.json()

      const flow: DeviceFlowState = {
        deviceCode: codeData.device_code,
        userCode: codeData.user_code,
        verificationUri: codeData.verification_uri,
        expiresAt: Date.now() + codeData.expires_in * 1000,
        interval: codeData.interval ?? 5,
      }
      setDeviceFlow(flow)

      // ── Step 2: poll for authorization ──────────────────────────────────
      const abort = new AbortController()
      pollAbortRef.current = abort
      setIsPolling(true)

      let intervalSecs = flow.interval
      while (!abort.signal.aborted) {
        await sleep(intervalSecs * 1000)
        if (abort.signal.aborted) break

        if (Date.now() > flow.expiresAt) {
          setAuthError('Code expired. Please restart the flow.')
          break
        }

        let pollData: Record<string, string>
        try {
          const pollRes = await fetch(GH_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: clientId,
              device_code: flow.deviceCode,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            }).toString(),
            signal: abort.signal,
          })
          pollData = await pollRes.json()
        } catch {
          // Network error — retry after interval
          continue
        }

        if (pollData.access_token) {
          // ✅ Success
          localStorage.setItem(LS_KEY, pollData.access_token)
          setGithubToken(pollData.access_token)
          setIsPolling(false)
          setJustAuthorized(true)
          setDeviceFlow(null)
          // Auto-clear justAuthorized after 2 s
          setTimeout(() => setJustAuthorized(false), 2000)
          break
        }

        switch (pollData.error) {
          case 'authorization_pending':
            // Normal — keep polling
            break
          case 'slow_down':
            // GitHub asks us to poll less frequently
            intervalSecs += 5
            break
          case 'expired_token':
            setAuthError('Code expired. Please restart the flow.')
            abort.abort()
            break
          case 'access_denied':
            setAuthError('Authorization denied by GitHub.')
            abort.abort()
            break
          default:
            setAuthError(pollData.error_description ?? pollData.error ?? 'Unknown error')
            abort.abort()
        }
      }

      setIsPolling(false)
      if (!abort.signal.aborted || pollAbortRef.current === abort) {
        setDeviceFlow(null)
      }
      if (pollAbortRef.current === abort) pollAbortRef.current = null
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err))
      setIsPolling(false)
      setDeviceFlow(null)
    }
  }, [])

  return {
    githubToken,
    deviceFlow,
    isPolling,
    justAuthorized,
    authError,
    startDeviceFlow,
    cancelDeviceFlow,
    logout,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
