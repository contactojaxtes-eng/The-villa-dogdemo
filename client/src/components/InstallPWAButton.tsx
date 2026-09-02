import { useState, useEffect } from 'react'
import { Download, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'

export function InstallPWAButton({ className }: { className?: string }) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)

  useEffect(() => {
    // Check if running as installed standalone app
    const checkStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone
    setIsStandalone(!!checkStandalone)

    // Check iOS
    const userAgent = window.navigator.userAgent.toLowerCase()
    const ios = /iphone|ipad|ipod/.test(userAgent)
    setIsIOS(ios)

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
  }, [])

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setDeferredPrompt(null)
      }
    } else if (isIOS) {
      setShowIosGuide(!showIosGuide)
    } else {
      alert('Para instalar la App: Toca el menú de tu navegador (3 puntos) y selecciona "Instalar aplicación" o "Agregar a la pantalla principal".')
    }
  }

  if (isStandalone) return null

  return (
    <div className="relative inline-block">
      <button
        onClick={handleInstallClick}
        title="Instalar The Villa Dog App en tu pantalla principal"
        className={cn(
          "px-3.5 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-md cursor-pointer border bg-amber-500 hover:bg-amber-600 text-slate-950 border-amber-400 shadow-amber-900/20 active:scale-95",
          className
        )}
      >
        <Download className="w-4 h-4 animate-bounce" />
        <span className="hidden sm:inline">INSTALAR APP EN CELULAR / PC</span>
        <span className="sm:hidden">INSTALAR APP</span>
      </button>

      {showIosGuide && (
        <div className="absolute top-12 right-0 z-50 w-72 p-4 bg-slate-900 text-white rounded-2xl shadow-2xl border border-amber-500/40 text-xs space-y-2">
          <div className="flex items-center gap-2 text-amber-400 font-bold">
            <Smartphone className="w-4 h-4" />
            <span>Instalar en iPhone / iPad:</span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            1. Toca el botón <strong>Compartir</strong> en la barra inferior de Safari.
            <br />
            2. Selecciona <strong>"Agregar a inicio"</strong> ➕.
          </p>
        </div>
      )}
    </div>
  )
}
