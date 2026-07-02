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
import { VaultProvider, type VaultProviderProps } from '@/hooks/useVault'
import App from './App'

export interface ChatbotProps extends Omit<VaultProviderProps, 'children'> {
  /** Applied to the wrapping element. The chatbot fills its container's height (`h-full`). */
  className?: string
}

/**
 * Reusable KeypoolLive chatbot for React 19 host apps.
 *
 * Requires the host app to import '@sctg/cline-chatbot/style.css' once, and to size
 * the wrapping element (the chatbot fills 100% width/height of its container).
 */
export const Chatbot: React.FC<ChatbotProps> = ({ vaultUrl, usageDbUrl, githubClientId, className }) => {
  return (
    <VaultProvider vaultUrl={vaultUrl} usageDbUrl={usageDbUrl} githubClientId={githubClientId}>
      <div className={className ? `h-full ${className}` : 'h-full'}>
        <App />
      </div>
    </VaultProvider>
  )
}

export default Chatbot
