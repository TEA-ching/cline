import React from 'react'
import { Button, Card } from '@heroui/react'
import { HelpCircle } from 'lucide-react'

interface Props {
  question: string
  options: string[]
  onAnswer: (answer: string) => void
}

export const AskQuestionDialog: React.FC<Props> = ({ question, options, onAnswer }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <Card className="w-full max-w-lg p-6">
      <Card.Header>
        <Card.Title className="flex items-center gap-2 text-lg font-semibold">
          <HelpCircle className="h-5 w-5 text-primary-500" />
          Agent question
        </Card.Title>
        <Card.Description className="mt-1 text-sm">{question}</Card.Description>
      </Card.Header>
      <Card.Content className="mt-3 flex flex-col gap-2">
        {options.map(opt => (
          <Button key={opt} variant="outline" fullWidth onPress={() => onAnswer(opt)} className="justify-start text-left">
            {opt}
          </Button>
        ))}
      </Card.Content>
    </Card>
  </div>
)
