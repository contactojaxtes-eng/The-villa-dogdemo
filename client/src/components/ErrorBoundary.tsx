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

function checkIsChunkError(error: Error | null): boolean {
  if (!error) return false
  const msg = (error.message || '').toLowerCase()
  const name = (error.name || '').toLowerCase()
  return (
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('dynamically imported module') ||
    msg.includes('failed to fetch') ||
    msg.includes('unexpected token') ||
    name.includes('chunkloaderror')
  )
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
    if (checkIsChunkError(error)) {
      const reloadKey = 'the_villa_dog_auto_reload'
      const lastReload = parseInt(sessionStorage.getItem(reloadKey) || '0', 10)
      const now = Date.now()
      if (now - lastReload > 4000) {
        sessionStorage.setItem(reloadKey, String(now))
        setTimeout(() => {
          window.location.reload()
        }, 100)
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
      if (checkIsChunkError(this.state.error)) {
        return (
          <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center animate-in fade-in">
            <div className="mx-auto max-w-sm space-y-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-8 shadow-2xl">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <RefreshCw className="h-7 w-7 animate-spin" />
              </div>
              <div className="space-y-1.5">
                <h2 className="antifont text-lg font-black text-[var(--text-primary)]">
                  Actualizando el sistema...
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Hay una actualización reciente disponible. Sincronizando en un momento...
                </p>
              </div>
            </div>
          </div>
        )
      }

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

            {this.state.error && (
              <details className="text-left bg-black/5 dark:bg-black/40 rounded-xl p-2.5 border border-red-500/20 text-[11px] text-red-500 font-mono overflow-auto max-h-32">
                <summary className="cursor-pointer font-bold select-none">Ver detalle técnico del error</summary>
                <p className="mt-1 font-semibold">{this.state.error.name}: {this.state.error.message}</p>
              </details>
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
