// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
import React, { useState } from 'react'
import { Alert, Button, Card, Form, Input, Label, TextField } from '@heroui/react'
import { LogIn } from 'lucide-react'
import { useVault } from '@/hooks/useVault'

export const LoginScreen: React.FC = () => {
  const [token, setToken] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const { login, loading } = useVault()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLocalError(null)
    try {
      await login(token)
    } catch {
      setLocalError('Login failed. Please check your token.')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-default-50 p-4">
      <Card className="w-full max-w-md p-6">
        <Card.Header className="flex flex-col gap-1 text-center">
          <Card.Title className="text-2xl font-bold">SCTG Chatbot</Card.Title>
          <Card.Description>
            Enter your vault token to connect to the AI proxy.
          </Card.Description>
        </Card.Header>

        <Card.Content className="mt-4">
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
        </Card.Content>

        <Card.Footer className="mt-4 text-center">
          <p className="text-xs text-default-400">
            Token stored in sessionStorage only — cleared on tab close.
          </p>
        </Card.Footer>
      </Card>
    </div>
  )
}
