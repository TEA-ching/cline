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
import { useCallback, useMemo, useEffect, useRef } from 'react'
import { useLocalStorageState } from './useLocalStorageState'
import { listChatModels } from '@/lib/model-utils'
import type { AiConfig } from '@/types/ai-config'

const STORAGE_KEY_PROVIDER = 'selectedProviderId'
const STORAGE_KEY_MODEL = 'selectedModelId'

/**
 * Hook for managing model selection with localStorage persistence.
 * Validates that the stored model still exists in the config, falls back to first available model.
 */
export function useModelSelection(vaultConfig: AiConfig | null) {
  const models = useMemo(() => vaultConfig ? listChatModels(vaultConfig) : [], [vaultConfig])

  // Get default values (first available model) - memoized to avoid recalculation
  const defaultProviderId = useMemo(() => models[0]?.providerId ?? '', [models])
  const defaultModelId = useMemo(() => models[0]?.model.id ?? '', [models])

  // Use localStorage state with empty defaults
  const [storedProviderId, setStoredProviderId] = useLocalStorageState(
    STORAGE_KEY_PROVIDER,
    ''
  )
  const [storedModelId, setStoredModelId] = useLocalStorageState(
    STORAGE_KEY_MODEL,
    ''
  )

  // Track if we've already initialized to avoid repeated writes
  const initializedRef = useRef(false)

  // Determine the effective selected model: stored if valid, otherwise default
  const { selectedProviderId, selectedModelId, needsInitialization } = useMemo(() => {
    if (!vaultConfig || models.length === 0) {
      return { selectedProviderId: '', selectedModelId: '', needsInitialization: false }
    }

    // Check if stored model exists in current config
    const modelExists = storedProviderId && storedModelId && models.some(
      m => m.providerId === storedProviderId && m.model.id === storedModelId
    )

    if (modelExists) {
      return { selectedProviderId: storedProviderId, selectedModelId: storedModelId, needsInitialization: false }
    }

    // Fall back to first available model
    return {
      selectedProviderId: defaultProviderId,
      selectedModelId: defaultModelId,
      needsInitialization: !initializedRef.current,
    }
  }, [vaultConfig, models, storedProviderId, storedModelId, defaultProviderId, defaultModelId])

  // Initialize localStorage with default model on first load
  useEffect(() => {
    if (needsInitialization && selectedProviderId && selectedModelId) {
      setStoredProviderId(selectedProviderId)
      setStoredModelId(selectedModelId)
      initializedRef.current = true
    }
  }, [needsInitialization, selectedProviderId, selectedModelId, setStoredProviderId, setStoredModelId])

  const handleModelChange = useCallback((providerId: string, modelId: string) => {
    initializedRef.current = true
    setStoredProviderId(providerId)
    setStoredModelId(modelId)
  }, [setStoredProviderId, setStoredModelId])

  return {
    selectedProviderId,
    selectedModelId,
    handleModelChange,
  }
}
