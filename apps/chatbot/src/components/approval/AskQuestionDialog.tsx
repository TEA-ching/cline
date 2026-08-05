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
