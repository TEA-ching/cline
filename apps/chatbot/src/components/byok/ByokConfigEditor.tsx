// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
import React, { useState, useEffect } from 'react'
import { Button, Input, Label, Alert } from '@heroui/react'
import { Trash2, Plus, Save } from 'lucide-react'
import type { AiConfig } from '@/types/ai-config'
import { useVault } from '@/hooks/useVault'

interface ByokConfigEditorProps {
  onClose: () => void
}

export const ByokConfigEditor: React.FC<ByokConfigEditorProps> = ({ onClose }) => {
  const { config, switchToBYOK } = useVault()
  const [localConfig, setLocalConfig] = useState<AiConfig | null>(null)
  const [newProviderKey, setNewProviderKey] = useState('')
  const [newCrawlerKey, setNewCrawlerKey] = useState('')
  const [newWeatherKey, setNewWeatherKey] = useState('')
  const [weatherSharedSecret, setWeatherSharedSecret] = useState('')
  const [weatherSignatureType, setWeatherSignatureType] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('')
  const [selectedCrawler, setSelectedCrawler] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Initialize with current config
  useEffect(() => {
    if (config) {
      setLocalConfig(JSON.parse(JSON.stringify(config)))
    }
  }, [config])

  const handleAddProviderKey = () => {
    if (!localConfig || !selectedProvider || !newProviderKey) return

    const newConfig = { ...localConfig }
    const provider = newConfig.providers[selectedProvider]

    if (provider) {
      // Check if key already exists
      const keyExists = provider.keys.some(k => k.key === newProviderKey)
      if (!keyExists) {
        provider.keys.push({ key: newProviderKey, owner: 'user' })
        setLocalConfig(newConfig)
        setNewProviderKey('')
        setSuccess('Provider key added successfully')
        setError(null)
      } else {
        setError('This key already exists for this provider')
      }
    }
  }

  const handleRemoveProviderKey = (providerId: string, keyIndex: number) => {
    if (!localConfig) return

    const newConfig = { ...localConfig }
    const provider = newConfig.providers[providerId]

    if (provider && provider.keys.length > keyIndex) {
      provider.keys.splice(keyIndex, 1)
      setLocalConfig(newConfig)
      setSuccess('Key removed successfully')
    }
  }

  const handleAddCrawlerKey = () => {
    if (!localConfig || !selectedCrawler || !newCrawlerKey) return

    const newConfig = { ...localConfig }
    const crawler = newConfig.crawlers[selectedCrawler]

    if (crawler) {
      // Check if key already exists
      const keyExists = crawler.keys.some(k => k.key === newCrawlerKey)
      if (!keyExists) {
        crawler.keys.push({ key: newCrawlerKey, owner: 'user' })
        setLocalConfig(newConfig)
        setNewCrawlerKey('')
        setSuccess('Crawler key added successfully')
      } else {
        setError('This key already exists for this crawler')
      }
    }
  }

  const handleAddWeatherKey = () => {
    if (!localConfig || !newWeatherKey) return

    const newConfig = { ...localConfig }

    // Initialize weatherApi if it doesn't exist
    if (!newConfig.weatherApi) {
      newConfig.weatherApi = {
        protocol: { protocol: 'meteoblue' },
        endpoint: 'https://my.meteoblue.com/packages',
        keys: []
      }
    }

    // Check if key already exists
    const keyExists = newConfig.weatherApi.keys.some(k => k.key === newWeatherKey)
    if (!keyExists) {
      const newKey: any = { key: newWeatherKey, owner: 'user' }

      // Add shared secret if provided
      if (weatherSharedSecret) {
        newKey.sharedSecret = weatherSharedSecret
      }

      // Add signature type if provided
      if (weatherSignatureType) {
        newKey.signatureType = weatherSignatureType
      }

      newConfig.weatherApi.keys.push(newKey)
      setLocalConfig(newConfig)
      setNewWeatherKey('')
      setWeatherSharedSecret('')
      setWeatherSignatureType('')
      setSuccess('Weather API key added successfully')
    } else {
      setError('This weather API key already exists')
    }
  }

  const handleRemoveWeatherKey = (keyIndex: number) => {
    if (!localConfig || !localConfig.weatherApi) return

    const newConfig = { ...localConfig }
    if (newConfig.weatherApi && newConfig.weatherApi.keys.length > keyIndex) {
      newConfig.weatherApi.keys.splice(keyIndex, 1)
      setLocalConfig(newConfig)
      setSuccess('Weather API key removed successfully')
    }
  }

  const handleRemoveCrawlerKey = (crawlerId: string, keyIndex: number) => {
    if (!localConfig) return

    const newConfig = { ...localConfig }
    const crawler = newConfig.crawlers[crawlerId]

    if (crawler && crawler.keys.length > keyIndex) {
      crawler.keys.splice(keyIndex, 1)
      setLocalConfig(newConfig)
      setSuccess('Key removed successfully')
    }
  }

  const handleSave = () => {
    if (!localConfig) return

    try {
      // Validate that we have at least one provider key
      const hasProviderKeys = Object.values(localConfig.providers).some(
        provider => provider.keys.length > 0
      )

      if (!hasProviderKeys) {
        setError('You must have at least one provider key')
        return
      }

      // Save the configuration
      switchToBYOK(localConfig)
      setSuccess('Configuration saved and activated!')
    } catch (err) {
      setError('Failed to save configuration')
      console.error('Failed to save BYOK config:', err)
    }
  }

  const getKeyDisplay = (key: string) => {
    if (key.length <= 8) return key
    return `***${key.slice(-8)}`
  }

  if (!localConfig) {
    return (
      <div className="p-4 space-y-4">
        <p>Loading configuration...</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-semibold">BYOK Configuration Editor</h3>

      {error && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>Error</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {success && (
        <Alert status="success">
          <Alert.Content>
            <Alert.Title>Success</Alert.Title>
            <Alert.Description>{success}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/* Provider Keys Section */}
      <div className="space-y-4">
        <h4 className="font-medium">AI Provider Keys</h4>

        {/* Add Provider Key Form */}
        <div className="space-y-2 border border-default-200 rounded-lg p-3">
          <Label>Add New Provider Key</Label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="">Select a provider</option>
            {Object.keys(localConfig.providers).map((providerId) => (
              <option key={providerId} value={providerId}>
                {providerId}
              </option>
            ))}
          </select>

          <Input
            type="password"
            placeholder="Enter API key"
            value={newProviderKey}
            onChange={(e) => setNewProviderKey(e.target.value)}
            variant="secondary"
            className="w-full"
          />

          <Button
            onPress={handleAddProviderKey}
            fullWidth
            isDisabled={!selectedProvider || !newProviderKey}
            className="mt-1"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Key
          </Button>
        </div>

        {/* Provider Keys List */}
        {Object.entries(localConfig.providers).map(([providerId, provider]) => (
          <div key={providerId} className="border border-default-200 rounded-lg p-3">
            <h5 className="font-medium mb-2">{providerId}</h5>

            {provider.keys.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {provider.keys.map((key, idx) => (
                  <li key={idx} className="flex justify-between items-center p-1 border-b border-default-100">
                    <span className="font-mono">{getKeyDisplay(key.key)}</span>
                    <Button
                      isIconOnly
                      variant="ghost"
                      size="sm"
                      onPress={() => handleRemoveProviderKey(providerId, idx)}
                      className="text-danger-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-default-500">No keys configured</p>
            )}
          </div>
        ))}
      </div>

      {/* Crawler Keys Section */}
      <div className="space-y-4">
        <h4 className="font-medium">Crawler Keys</h4>

        {/* Add Crawler Key Form */}
        <div className="space-y-2 border border-default-200 rounded-lg p-3">
          <Label>Add New Crawler Key</Label>
          <select
            value={selectedCrawler}
            onChange={(e) => setSelectedCrawler(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="">Select a crawler</option>
            {Object.keys(localConfig.crawlers).map((crawlerId) => (
              <option key={crawlerId} value={crawlerId}>
                {crawlerId}
              </option>
            ))}
          </select>

          <Input
            type="password"
            placeholder="Enter crawler API key"
            value={newCrawlerKey}
            onChange={(e) => setNewCrawlerKey(e.target.value)}
            variant="secondary"
            className="w-full"
          />

          <Button
            onPress={handleAddCrawlerKey}
            fullWidth
            isDisabled={!selectedCrawler || !newCrawlerKey}
            className="mt-1"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Crawler Key
          </Button>
        </div>

        {/* Crawler Keys List */}
        {Object.entries(localConfig.crawlers).map(([crawlerId, crawler]) => (
          <div key={crawlerId} className="border border-default-200 rounded-lg p-3">
            <h5 className="font-medium mb-2">{crawlerId}</h5>

            {crawler.keys.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {crawler.keys.map((key, idx) => (
                  <li key={idx} className="flex justify-between items-center p-1 border-b border-default-100">
                    <span className="font-mono">{getKeyDisplay(key.key)}</span>
                    <Button
                      isIconOnly
                      variant="ghost"
                      size="sm"
                      onPress={() => handleRemoveCrawlerKey(crawlerId, idx)}
                      className="text-danger-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-default-500">No keys configured</p>
            )}
          </div>
        ))}
      </div>

      {/* Weather API Keys Section */}
      <div className="space-y-4">
        <h4 className="font-medium">Weather API Keys</h4>

        {/* Add Weather Key Form */}
        <div className="space-y-2 border border-default-200 rounded-lg p-3">
          <Label>Add New Weather API Key</Label>

          <Input
            type="password"
            placeholder="Enter Weather API key"
            value={newWeatherKey}
            onChange={(e) => setNewWeatherKey(e.target.value)}
            variant="secondary"
            className="w-full"
          />

          {/* Advanced options - collapsible */}
          <div className="space-y-2">
            <details className="border border-default-200 rounded-lg p-2">
              <summary className="font-medium cursor-pointer">Advanced Options</summary>
              <div className="mt-2 space-y-2">
                <Input
                  type="password"
                  placeholder="Shared Secret (optional)"
                  value={weatherSharedSecret}
                  onChange={(e) => setWeatherSharedSecret(e.target.value)}
                  variant="secondary"
                  className="w-full"
                />

                <select
                  value={weatherSignatureType}
                  onChange={(e) => setWeatherSignatureType(e.target.value)}
                  className="w-full p-2 border rounded"
                >
                  <option value="">Select Signature Type (optional)</option>
                  <option value="hmac-md5">HMAC-MD5</option>
                  <option value="hmac-sha256">HMAC-SHA256</option>
                  <option value="hmac-sha512">HMAC-SHA512</option>
                </select>
              </div>
            </details>
          </div>

          <Button
            onPress={handleAddWeatherKey}
            fullWidth
            isDisabled={!newWeatherKey}
            className="mt-1"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Weather API Key
          </Button>
        </div>

        {/* Weather Keys List */}
        {localConfig.weatherApi && (
          <div className="border border-default-200 rounded-lg p-3">
            <h5 className="font-medium mb-2">Weather API</h5>

            {localConfig.weatherApi.keys.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {localConfig.weatherApi.keys.map((key, idx) => (
                  <li key={idx} className="flex justify-between items-center p-1 border-b border-default-100">
                    <div className="flex flex-col">
                      <span className="font-mono">{getKeyDisplay(key.key)}</span>
                      {key.sharedSecret && <span className="text-xs text-default-500">Shared secret: ***{key.sharedSecret.slice(-4)}</span>}
                      {key.signatureType && <span className="text-xs text-default-500">Signature: {key.signatureType}</span>}
                    </div>
                    <Button
                      isIconOnly
                      variant="ghost"
                      size="sm"
                      onPress={() => handleRemoveWeatherKey(idx)}
                      className="text-danger-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-default-500">No weather API keys configured</p>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-4 border-t border-default-200">
        <Button onPress={handleSave} fullWidth variant="primary">
          <Save className="mr-2 h-4 w-4" />
          Save Configuration
        </Button>
        <Button onPress={onClose} fullWidth variant="ghost">
          Close
        </Button>
      </div>
    </div>
  )
}
