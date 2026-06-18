import React from 'react'
import { Button, Card } from '@heroui/react'
import { ShieldCheck, ShieldX } from 'lucide-react'

interface Props {
  toolName: string
  input: unknown
  onApprove: () => void
  onDeny: () => void
}

export const ToolApprovalDialog: React.FC<Props> = ({ toolName, input, onApprove, onDeny }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <Card className="w-full max-w-lg p-6">
      <Card.Header>
        <Card.Title className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="h-5 w-5 text-warning-500" />
          Tool approval required
        </Card.Title>
        <Card.Description>
          The agent wants to run <strong className="font-mono text-sm">{toolName}</strong>
        </Card.Description>
      </Card.Header>
      <Card.Content className="mt-3">
        <pre className="max-h-48 overflow-auto rounded-md bg-default-100 p-3 text-xs">
          {JSON.stringify(input, null, 2)}
        </pre>
      </Card.Content>
      <Card.Footer className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onPress={onDeny}>
          <ShieldX className="mr-1 h-4 w-4" />
          Deny
        </Button>
        <Button onPress={onApprove}>
          <ShieldCheck className="mr-1 h-4 w-4" />
          Approve
        </Button>
      </Card.Footer>
    </Card>
  </div>
)
