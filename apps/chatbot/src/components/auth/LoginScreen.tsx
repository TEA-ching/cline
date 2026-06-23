// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
import React, { useState, useEffect } from 'react'
import { Alert, Button, Card, Form, Input, Label, TextField } from '@heroui/react'
import { LogIn, Plus } from 'lucide-react'
import { useVault } from '@/hooks/useVault'
import { fetchPublicModels } from '@/lib/vault-api'
import type { AiConfig } from '@/types/ai-config'

export const LoginScreen: React.FC = () => {
  const [isBYOK, setIsBYOK] = useState(false)
  const [token, setToken] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<AiConfig | null>(null)
  const [localConfig, setLocalConfig] = useState<AiConfig | null>(null)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [crawlerKey, setCrawlerKey] = useState('')
  const [selectedCrawler, setSelectedCrawler] = useState('')

  const { login, loading, switchToBYOK } = useVault()

  // Load public models when BYOK mode is enabled
  useEffect(() => {
    if (isBYOK && !availableModels) {
      fetchPublicModels()
        .then(setAvailableModels)
        .catch(err => setLocalError(err.message))
    }
  }, [isBYOK, availableModels])

  // Initialize local config from localStorage if available
  useEffect(() => {
    if (isBYOK) {
      const storedConfig = localStorage.getItem('byok_config')
      if (storedConfig) {
        setLocalConfig(JSON.parse(storedConfig))
      }
    }
  }, [isBYOK])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLocalError(null)
    try {
      await login(token)
    } catch {
      setLocalError('Login failed. Please check your token.')
    }
  }

  const handleAddKey = () => {
    if (!availableModels || !selectedProvider || !apiKey) return

    const newConfig = localConfig ? { ...localConfig } : { ...availableModels }

    // Add the key to the selected provider
    const provider = newConfig.providers[selectedProvider]
    if (provider) {
      // Check if key already exists
      const keyExists = provider.keys.some(k => k.key === apiKey)
      if (!keyExists) {
        provider.keys.push({ key: apiKey, owner: 'user' })
        setLocalConfig(newConfig)
        setApiKey('') // Clear the input
      }
    }
  }

  const handleAddCrawlerKey = () => {
    if (!availableModels || !selectedCrawler || !crawlerKey) return

    const newConfig = localConfig ? { ...localConfig } : { ...availableModels }

    // Add the key to the selected crawler
    const crawler = newConfig.crawlers[selectedCrawler]
    if (crawler) {
      // Check if key already exists
      const keyExists = crawler.keys.some(k => k.key === crawlerKey)
      if (!keyExists) {
        crawler.keys.push({ key: crawlerKey, owner: 'user' })
        setLocalConfig(newConfig)
        setCrawlerKey('') // Clear the input
      }
    }
  }

  const handleConnect = () => {
    if (!localConfig) return

    // Store selected model preference
    if (selectedProvider && selectedModel) {
      localStorage.setItem('selectedProviderId', selectedProvider)
      localStorage.setItem('selectedModelId', selectedModel)
    }

    // Switch to BYOK mode
    switchToBYOK(localConfig)
  }

  const getConfigSummary = () => {
    if (!localConfig) return null

    const providerSummary = Object.entries(localConfig.providers)
      .filter(([_, provider]) => provider.keys.length > 0)
      .map(([providerId, provider]) => ({
        type: 'ai',
        name: providerId,
        keyCount: provider.keys.length
      }))

    const crawlerSummary = Object.entries(localConfig.crawlers)
      .filter(([_, crawler]) => crawler.keys.length > 0)
      .map(([crawlerId, crawler]) => ({
        type: 'crawler',
        name: crawlerId,
        keyCount: crawler.keys.length
      }))

    return [...providerSummary, ...crawlerSummary]
  }

  const configSummary = getConfigSummary()

  return (
    <div className="flex min-h-screen items-center justify-center bg-default-50 p-4">
      <Card className="w-full max-w-md p-6">
        <Card.Header className="flex flex-col gap-1 text-center">
          <Card.Title className="text-2xl font-bold">SCTG Chatbot</Card.Title>
          <Card.Description>
            {isBYOK ? 'Bring Your Own Key (BYOK)' : 'Enter your vault token to connect to the AI proxy.'}
          </Card.Description>
        </Card.Header>

        <Card.Content className="mt-4">
          <div className="flex items-center gap-2 mb-4">
            <input
              type="checkbox"
              id="byok-switch"
              checked={isBYOK}
              onChange={(e) => setIsBYOK(e.target.checked)}
              className="h-4 w-4 text-primary-600 border-default-300 rounded focus:ring-primary-500"
            />
            <Label htmlFor="byok-switch">Bring Your Own Key (BYOK)</Label>
          </div>

          {!isBYOK ? (
            <Form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <TextField isRequired name="token">
                <Label>Vault Token</Label>
                <Input type="hidden" autoComplete="username" value="SCTG Chatbot" readOnly className="hidden" />
                <Input
                  type="password"
                  placeholder="Paste your token here…"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  autoComplete="current-password"
                  variant="secondary"
                />
              </TextField>

              {localError && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Title>Authentication error</Alert.Title>
                    <Alert.Description>{localError}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}

              <Button type="submit" fullWidth isPending={loading} className="mt-2">
                <LogIn className="mr-2 h-4 w-4" />
                Connect
              </Button>
            </Form>
          ) : (
            <div className="space-y-4">
              {availableModels ? (
                <>
                  {/* Configuration Summary */}
                  {configSummary && configSummary.length > 0 && (
                    <div className="border border-default-200 rounded-lg p-3 bg-default-50">
                      <p className="text-sm font-semibold mb-2">Current Configuration:</p>
                      <ul className="text-xs space-y-1">
                        {configSummary.map((item, idx) => (
                          <li key={idx} className="flex justify-between">
                            <span>{item.type === 'ai' ? '🤖' : '🔍'} {item.name}</span>
                            <span className="font-mono">{item.keyCount} key{item.keyCount > 1 ? 's' : ''}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Provider Key Section */}
                  <div className="space-y-2">
                    <Label>Add AI Provider Key</Label>
                    <select
                      value={selectedProvider}
                      onChange={(e) => setSelectedProvider(e.target.value)}
                      className="w-full p-2 border rounded"
                    >
                      <option value="">Select a provider</option>
                      {Object.keys(availableModels.providers).map((providerId) => (
                        <option key={providerId} value={providerId}>
                          {providerId}
                        </option>
                      ))}
                    </select>

                    <Input
                      type="password"
                      placeholder="Enter API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      variant="secondary"
                      className="w-full"
                    />

                    <Button
                      onPress={handleAddKey}
                      fullWidth
                      isDisabled={!selectedProvider || !apiKey}
                      className="mt-1"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Key
                    </Button>
                  </div>

                  {/* Crawler Key Section */}
                  <div className="space-y-2">
                    <Label>Add Crawler Key</Label>
                    <select
                      value={selectedCrawler}
                      onChange={(e) => setSelectedCrawler(e.target.value)}
                      className="w-full p-2 border rounded"
                    >
                      <option value="">Select a crawler</option>
                      {Object.keys(availableModels.crawlers).map((crawlerId) => (
                        <option key={crawlerId} value={crawlerId}>
                          {crawlerId}
                        </option>
                      ))}
                    </select>

                    <Input
                      type="password"
                      placeholder="Enter crawler API key"
                      value={crawlerKey}
                      onChange={(e) => setCrawlerKey(e.target.value)}
                      variant="secondary"
                      className="w-full"
                    />

                    <Button
                      onPress={handleAddCrawlerKey}
                      fullWidth
                      isDisabled={!selectedCrawler || !crawlerKey}
                      className="mt-1"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Crawler Key
                    </Button>
                  </div>

                  {/* Connect Button */}
                  <Button
                    onPress={handleConnect}
                    fullWidth
                    isDisabled={!configSummary || configSummary.length === 0}
                    className="mt-2"
                  >
                    <LogIn className="mr-2 h-4 w-4" />
                    {configSummary && configSummary.length > 0 ? 'Connect' : 'Add at least one key to connect'}
                  </Button>
                </>
              ) : (
                <div className="text-center py-4">
                  <p>Loading available models...</p>
                </div>
              )}
            </div>
          )}
        </Card.Content>

        <Card.Footer className="mt-4 text-center">
          <p className="text-xs text-default-400">
            {isBYOK
              ? 'Your keys are stored locally and never sent to any server except to the AI API endpoints.'
              : 'Token stored in sessionStorage only — cleared on tab close.'}
          </p>
        </Card.Footer>
      </Card>
    </div>
  )
}
