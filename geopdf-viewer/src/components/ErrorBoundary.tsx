import React from 'react'

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-slate-900 p-6">
          <div className="max-w-lg bg-red-950 border border-red-700 rounded-xl p-6 text-center">
            <h1 className="text-red-300 text-lg font-bold mb-2">Something went wrong</h1>
            <pre className="text-red-400 text-xs text-left whitespace-pre-wrap break-words mb-4">
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm"
            >
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
