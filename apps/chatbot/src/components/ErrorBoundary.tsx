// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
import React from 'react'

interface Props {
  children: React.ReactNode
  /** Custom fallback rendered on error. Defaults to a generic error card. */
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] uncaught render error:', error, info.componentStack)
  }

  override render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback) return this.props.fallback

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4 p-8 text-center"
      >
        <p className="text-danger text-base font-semibold">Une erreur inattendue s&apos;est produite.</p>
        {this.state.error?.message && (
          <pre className="text-default-500 text-xs font-mono max-w-lg overflow-auto whitespace-pre-wrap break-all bg-default-50 rounded-medium p-3">
            {this.state.error.message}
          </pre>
        )}
        <button
          type="button"
          className="px-4 py-2 rounded-medium bg-default-100 hover:bg-default-200 text-sm transition-colors"
          onClick={() => this.setState({ hasError: false, error: null })}
        >
          Réessayer
        </button>
      </div>
    )
  }
}
