import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw, Home } from 'lucide-react'
import { Button } from './ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo)

    // Auto-reload on ChunkLoadError (stale assets after deploy)
    const msg = (error?.message || '').toLowerCase()
    const name = (error?.name || '').toLowerCase()
    const isChunkError = msg.includes('loading chunk') || msg.includes('loading css chunk') ||
      msg.includes('dynamically imported module') || name.includes('chunkloaderror') ||
      msg.includes('failed to fetch')

    if (isChunkError) {
      const reloadKey = 'niche_error_auto_reload'
      const lastReload = parseInt(sessionStorage.getItem(reloadKey) || '0', 10)
      const now = Date.now()
      if (now - lastReload > 10000) {
        sessionStorage.setItem(reloadKey, String(now))
        window.location.reload()
        return
      }
    }
  }

  public handleReload = () => {
    window.location.reload()
  }

  public handleCleanRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  public handleGoHome = () => {
    window.location.href = '/'
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
          <div className="mx-auto max-w-md space-y-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-8 shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--destructive)]/10 text-[var(--destructive)]">
              <AlertTriangle className="h-8 w-8" />
            </div>
            
            <div className="space-y-2">
              <h2 className="antifont text-xl font-black tracking-wide text-[var(--text-primary)]">
                Hubo un detalle al cargar esta vista
              </h2>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                No pudimos mostrar esta página. Reintenta o recarga. Tu borrador de pedido se conserva.
              </p>
            </div>

            {import.meta.env.DEV && this.state.error && (
              <div className="text-left bg-black/40 rounded-xl p-3 border border-red-500/20 text-[11px] text-red-400 font-mono overflow-auto max-h-28">
                <p className="font-bold">{this.state.error.name}: {this.state.error.message}</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Button
                onClick={this.handleReload}
                className="w-full sm:w-auto bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold text-xs rounded-xl h-10 px-5 flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <RefreshCw className="h-4 w-4" /> Recargar Sistema
              </Button>
              <Button
                variant="outline"
                onClick={this.handleCleanRetry}
                className="w-full sm:w-auto border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-bold text-xs rounded-xl h-10 px-5 flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" /> Reintentar
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
