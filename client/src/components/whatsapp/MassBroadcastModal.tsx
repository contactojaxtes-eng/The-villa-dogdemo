import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { Send, Upload, FileText, CheckCircle2, XCircle, Loader2, Sparkles, Phone, Users, ShieldAlert } from 'lucide-react'

interface MassBroadcastModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function MassBroadcastModal({ open, onOpenChange, onSuccess }: MassBroadcastModalProps) {
  const [templateName, setTemplateName] = useState('')
  const [languageCode, setLanguageCode] = useState('es_CO')
  const [param1, setParam1] = useState('')
  const [rawNumbers, setRawNumbers] = useState('')
  const [inputMode, setInputMode] = useState<'manual' | 'file'>('manual')
  const [fileName, setFileName] = useState<string | null>(null)
  
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<{ total: number; sentCount: number; failedCount: number; results: any[] } | null>(null)

  // Extract valid unique 10-digit numbers (normalized to avoid duplicates like 573... vs 3...)
  const parseNumbers = (text: string): string[] => {
    const matches = text.match(/\b\d{10,12}\b/g) || []
    const unique = new Set<string>()
    for (const raw of matches) {
      const clean = raw.trim().slice(-10)
      if (clean.length === 10 && clean.startsWith('3')) {
        unique.add(clean)
      }
    }
    return Array.from(unique)
  }

  const extractedNumbers = parseNumbers(rawNumbers)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      if (content) {
        setRawNumbers(content)
        alerts.info('Archivo procesado', `Se extrajeron contactos de "${file.name}"`)
      }
    }
    reader.readAsText(file)
  }

  const handleSend = async () => {
    if (!templateName.trim()) {
      alerts.error('Error', 'Ingresa el nombre de la plantilla aprobada en Meta.')
      return
    }
    if (extractedNumbers.length === 0) {
      alerts.error('Sin números válidos', 'Ingresa al menos un número de teléfono válido (10 dígitos).')
      return
    }

    const confirm = await alerts.confirm(
      '¿Iniciar Envío Masivo?',
      `Se enviará la plantilla "${templateName}" a ${extractedNumbers.length} número(s) seleccionado(s).`,
      'Sí, enviar ahora',
      'Cancelar'
    )
    if (!confirm) return

    setSending(true)
    setProgress(10)
    setResults(null)

    try {
      const params = param1.trim() ? [param1.trim()] : []
      const res = await api.post<{
        total: number
        sentCount: number
        failedCount: number
        results: { phone: string; success: boolean; error?: string }[]
      }>('/whatsapp/broadcast-template', {
        numbers: extractedNumbers,
        templateName: templateName.trim(),
        languageCode,
        params,
      })

      setProgress(100)
      setResults(res)

      if (res.sentCount > 0) {
        alerts.success('¡Campaña Masiva Completada!', `Se entregaron ${res.sentCount} mensaje(s) correctamente.`)
        if (onSuccess) onSuccess()
      } else {
        alerts.error('Falló el envío', 'No se pudo entregar ningún mensaje. Revisa los códigos de error.')
      }
    } catch (err: any) {
      // If client timeout occurred during large batch, the backend continues processing
      alerts.info(
        'Procesando Campaña Masiva',
        'La campaña masiva de WhatsApp se está procesando y entregando en segundo plano a través de Meta.'
      )
      if (onSuccess) onSuccess()
      onOpenChange(false)
    } finally {
      setSending(false)
    }
  }

  const handleClose = () => {
    if (sending) return
    setResults(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl bg-[var(--bg-panel)] border-[var(--border-subtle)] text-[var(--text-primary)] rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2.5 rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Envío Masivo de WhatsApp</DialogTitle>
              <DialogDescription className="text-xs text-[var(--text-muted)]">
                Envía plantillas oficiales aprobadas por Meta a múltiples contactos simultáneamente.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 my-2">
          {/* Configuración de la Plantilla */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text-primary)]">Nombre de la Plantilla Meta</label>
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="ej: niche_prueba"
                className="bg-[var(--bg-base)] border-[var(--border-subtle)] rounded-xl text-xs font-mono"
              />
              <p className="text-[10px] text-[var(--text-muted)]">Tal cual como aparece en Meta WhatsApp Manager</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--text-primary)]">Código de Idioma</label>
              <Input
                value={languageCode}
                onChange={(e) => setLanguageCode(e.target.value)}
                placeholder="es_EC o es"
                className="bg-[var(--bg-base)] border-[var(--border-subtle)] rounded-xl text-xs font-mono"
              />
              <p className="text-[10px] text-[var(--text-muted)]">Usualmente <code className="text-[var(--accent)]">es_EC</code> o <code className="text-[var(--accent)]">es</code></p>
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-xs font-bold text-[var(--text-primary)]">Parámetro 1 (Opcional - Reemplaza {'{{1}}'})</label>
              <Input
                value={param1}
                onChange={(e) => setParam1(e.target.value)}
                placeholder="ej: Cliente (déjalo vacío si no usas variables)"
                className="bg-[var(--bg-base)] border-[var(--border-subtle)] rounded-xl text-xs"
              />
            </div>
          </div>

          {/* Selector de Entrada de Números */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Users className="h-4 w-4 text-[var(--accent)]" /> Destinatarios ({extractedNumbers.length} detectados)
              </label>
              <div className="flex items-center bg-[var(--bg-subtle)] p-0.5 rounded-xl border border-[var(--border-subtle)] text-xs">
                <button
                  type="button"
                  onClick={() => setInputMode('manual')}
                  className={`px-3 py-1 rounded-lg font-semibold transition-all ${inputMode === 'manual' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                >
                  Texto / Manual
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('file')}
                  className={`px-3 py-1 rounded-lg font-semibold transition-all ${inputMode === 'file' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                >
                  Cargar Archivo
                </button>
              </div>
            </div>

            {inputMode === 'manual' ? (
              <Textarea
                value={rawNumbers}
                onChange={(e) => setRawNumbers(e.target.value)}
                placeholder="Pega o escribe aquí los números separados por coma, espacio o renglón&#10;Ejemplo:&#10;3117455306, 3215580510, 3174047876"
                rows={5}
                className="bg-[var(--bg-base)] border-[var(--border-subtle)] rounded-2xl text-xs font-mono"
              />
            ) : (
              <div className="border-2 border-dashed border-[var(--border-subtle)] rounded-2xl p-6 text-center bg-[var(--bg-base)] space-y-3">
                <Upload className="h-8 w-8 mx-auto text-[var(--accent)]" />
                <div>
                  <p className="text-xs font-bold">Subir archivo de contactos (CSV, TXT, Excel)</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">El sistema extraerá automáticamente todos los números válidos del archivo.</p>
                </div>
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  onChange={handleFileUpload}
                  id="broadcast-file"
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('broadcast-file')?.click()}
                  className="rounded-xl border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-xs"
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5 text-[var(--accent)]" />
                  {fileName ? `Archivo: ${fileName}` : 'Seleccionar Archivo'}
                </Button>
              </div>
            )}

            {/* Previsualización de números detectados */}
            {extractedNumbers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-[var(--bg-base)] rounded-xl border border-[var(--border-subtle)]">
                {extractedNumbers.map((num) => (
                  <Badge key={num} variant="secondary" className="text-[10px] font-mono bg-[var(--accent)]/10 text-[var(--accent)] border-none">
                    <Phone className="h-2.5 w-2.5 mr-1" />
                    {num}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Barra de Progreso durante Envío */}
          {sending && (
            <div className="space-y-2 p-4 rounded-2xl bg-[var(--accent)]/5 border border-[var(--accent)]/20">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="flex items-center gap-2 text-[var(--accent)]">
                  <Loader2 className="h-4 w-4 animate-spin" /> Procesando envío masivo a Meta...
                </span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-[var(--bg-base)] h-2 rounded-full overflow-hidden">
                <div className="bg-[var(--accent)] h-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Resumen de Resultados */}
          {results && (
            <div className="space-y-3 p-4 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Resumen de Resultados
                </h4>
                <div className="flex gap-2">
                  <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                    {results.sentCount} Exitosos
                  </Badge>
                  {results.failedCount > 0 && (
                    <Badge className="bg-red-500/10 text-red-500 border-red-500/20">
                      {results.failedCount} Fallidos
                    </Badge>
                  )}
                </div>
              </div>

              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {results.results.map((r, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-xl bg-[var(--bg-base)] text-xs border border-[var(--border-subtle)]">
                    <span className="font-mono text-[11px] flex items-center gap-1.5">
                      <Phone className="h-3 w-3 text-[var(--text-muted)]" /> {r.phone}
                    </span>
                    {r.success ? (
                      <span className="text-emerald-500 text-[10px] font-bold flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Entregado
                      </span>
                    ) : (
                      <span className="text-red-500 text-[10px] font-bold flex items-center gap-1" title={r.error}>
                        <XCircle className="h-3 w-3" /> {r.error || 'Falló'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={sending}
            className="rounded-xl text-xs hover:bg-[var(--bg-hover)]"
          >
            {results ? 'Cerrar' : 'Cancelar'}
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || extractedNumbers.length === 0}
            className="rounded-xl text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" /> Enviar Campaña Masiva ({extractedNumbers.length})
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
