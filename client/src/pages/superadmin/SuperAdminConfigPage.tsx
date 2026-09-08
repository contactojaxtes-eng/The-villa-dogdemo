import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  Gauge,
  Info,
  KeyRound,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  Printer,
  Save,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { cn } from '@/lib/utils'

interface SmtpConfig {
  host: string
  port: number
  user: string
  from: string
  passConfigured: boolean
}

interface WhatsappCoreConfig {
  phoneId: string
  businessPhone: string
  configured: boolean
  verifyTokenConfigured: boolean
  chatbotEnabled: boolean
  geminiApiKey: string
  geminiKeyCount: number
  geminiModel: string
  aiInstructions: string
  geminiRequestsToday: number
}

interface GeminiKeyResult {
  key: string
  ok: boolean
  model?: string
  latencyMs: number
  reply?: string
  error?: string
}

interface GeminiTestResult {
  success: boolean
  message: string
  testedKeys: number
  validKeys: number
  model?: string
  latencyMs?: number
  reply?: string
  requestsToday?: number
  results: GeminiKeyResult[]
}

interface GeminiModel {
  name: string
  displayName: string
  description: string
  inputTokenLimit: number | null
  outputTokenLimit: number | null
  supportedGenerationMethods: string[]
}

interface GeminiModelInfo {
  provider: string
  keySuffix: string | null
  configuredModel: string | null
  selectedModel: GeminiModel | null
  availableModels: GeminiModel[]
  usage: {
    requestsToday: number
    quotaRemaining: number | null
    quotaSource: string
    note: string
  }
  checkedAt: string
}

type ConfigTab = 'AI' | 'META' | 'EMAIL'

const fieldClass = 'h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10'
const textAreaClass = 'w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10'

const getErrorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

const formatTokenLimit = (value: number | null) => value ? `${value.toLocaleString('es-CO')} tokens` : 'No informado'

type GeminiModelUse = {
  label: string
  description: string
  tone: 'recommended' | 'balanced' | 'reasoning' | 'specialized'
}

const getGeminiModelUse = (model: GeminiModel): GeminiModelUse => {
  const name = model.name.toLowerCase()
  if (/(embedding|image|imagen|tts|audio|live|robotics|computer|deep-research|veo|lyria)/i.test(name)) {
    return {
      label: 'Especializado',
      description: 'Está pensado para una función específica. No es la primera opción para atender chats o tomar pedidos.',
      tone: 'specialized',
    }
  }
  if (name.includes('pro')) {
    return {
      label: 'Razonamiento complejo',
      description: 'Mejor para casos difíciles y respuestas elaboradas; consume más recursos y puede responder más lento.',
      tone: 'reasoning',
    }
  }
  if (name === 'gemini-2.5-flash-lite') {
    return {
      label: 'Recomendado principal',
      description: 'La opción más rápida y económica para alto volumen, extracción de datos y toma de pedidos.',
      tone: 'recommended',
    }
  }
  if (name === 'gemini-3.8-flash') {
    return {
      label: 'Más comprensión',
      description: 'Mejor para conversaciones complejas; usa más recursos y puede responder más lento.',
      tone: 'reasoning',
    }
  }
  if (name.includes('flash-lite') || name.endsWith('-lite') || name.includes('lite-')) {
    return {
      label: 'Más rápido y económico',
      description: 'Útil para tareas sencillas y alto volumen; puede entender peor conversaciones ambiguas o con muchos cambios.',
      tone: 'balanced',
    }
  }
  if (name.includes('flash')) {
    return {
      label: 'Chat y pedidos equilibrados',
      description: 'Buena opción general para responder clientes y entender pedidos con baja latencia.',
      tone: 'balanced',
    }
  }
  return {
    label: 'Uso general',
    description: 'Modelo compatible con respuestas de texto. Revisa su descripción antes de usarlo en producción.',
    tone: 'balanced',
  }
}

const getRecommendedGeminiModel = (models: GeminiModel[]) => {
  const preferred = [
    'gemini-2.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.6-flash',
    'gemini-2.5-flash',
  ]
  const stableChatModels = models.filter(model => {
    const name = model.name.toLowerCase()
    return !/(embedding|image|imagen|tts|audio|live|robotics|computer|deep-research|veo|lyria)/i.test(name)
      && !/(preview|experimental|exp|latest)/i.test(name)
  })
  return preferred.map(name => stableChatModels.find(model => model.name === name)).find(Boolean)
    || stableChatModels.find(model => /flash/i.test(model.name))
    || models[0]
    || null
}

const modelToneClass: Record<GeminiModelUse['tone'], string> = {
  recommended: 'border-emerald-500/30 bg-emerald-500/5',
  balanced: 'border-blue-500/30 bg-blue-500/5',
  reasoning: 'border-violet-500/30 bg-violet-500/5',
  specialized: 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
}

function SectionTitle({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-base font-black text-[var(--text-primary)]">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>
      </div>
    </div>
  )
}

export default function SuperAdminConfigPage() {
  const [activeTab, setActiveTab] = useState<ConfigTab>('AI')
  const [loading, setLoading] = useState(true)
  const [smtp, setSmtp] = useState<SmtpConfig>({ host: '', port: 587, user: '', from: '', passConfigured: false })
  const [smtpPass, setSmtpPass] = useState('')
  const [savingSmtp, setSavingSmtp] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testingEmail, setTestingEmail] = useState(false)
  const [wa, setWa] = useState<WhatsappCoreConfig>({
    phoneId: '',
    businessPhone: '',
    configured: false,
    verifyTokenConfigured: false,
    chatbotEnabled: false,
    geminiApiKey: '',
    geminiKeyCount: 0,
    geminiModel: 'gemini-2.5-flash-lite',
    aiInstructions: '',
    geminiRequestsToday: 0,
  })
  const [waToken, setWaToken] = useState('')
  const [waVerifyToken, setWaVerifyToken] = useState('')
  const [geminiKeys, setGeminiKeys] = useState<string[]>([''])
  const [savingMeta, setSavingMeta] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const [savingChatbot, setSavingChatbot] = useState(false)
  const [testingGemini, setTestingGemini] = useState(false)
  const [testPrompt, setTestPrompt] = useState('Saluda brevemente como asesor de The Villa Dog.')
  const [testResult, setTestResult] = useState<GeminiTestResult | null>(null)
  const [modelInfo, setModelInfo] = useState<GeminiModelInfo | null>(null)
  const [loadingModelInfo, setLoadingModelInfo] = useState(false)
  const [modelInfoError, setModelInfoError] = useState('')

  const setWhatsappResponse = (settings: WhatsappCoreConfig) => {
    setWa(settings)
    const keys = settings.geminiApiKey
      ? settings.geminiApiKey.split(',').map(key => key.trim()).filter(Boolean)
      : []
    setGeminiKeys(keys.length ? keys : [''])
  }

  useEffect(() => {
    let active = true
    Promise.all([
      api.get<SmtpConfig>('/superadmin/config/smtp'),
      api.get<WhatsappCoreConfig>('/whatsapp/settings'),
    ])
      .then(([smtpData, whatsappData]) => {
        if (!active) return
        setSmtp(smtpData)
        setWhatsappResponse(whatsappData)
      })
      .catch(error => alerts.error('No se pudo cargar la configuración', getErrorMessage(error, 'Inténtalo nuevamente.')))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  const localKeyCount = useMemo(
    () => geminiKeys.filter(key => key.trim().length >= 10 || key.includes('•')).length,
    [geminiKeys],
  )

  const recommendedModel = useMemo(
    () => getRecommendedGeminiModel(modelInfo?.availableModels || []),
    [modelInfo],
  )

  const updateKey = (index: number, value: string) => {
    setGeminiKeys(current => current.map((key, keyIndex) => keyIndex === index ? value : key))
    setTestResult(null)
  }

  const removeKey = (index: number) => {
    setGeminiKeys(current => {
      const next = current.filter((_, keyIndex) => keyIndex !== index)
      return next.length ? next : ['']
    })
    setTestResult(null)
  }

  const toggleChatbot = async () => {
    if (savingChatbot) return
    const next = !wa.chatbotEnabled
    setSavingChatbot(true)
    try {
      const updated = await api.put<WhatsappCoreConfig>('/whatsapp/settings', { chatbotEnabled: next })
      setWa(current => ({ ...current, chatbotEnabled: updated.chatbotEnabled === true }))
      alerts.success(next ? 'IA activada' : 'IA pausada', next
        ? 'Responderá en conversaciones nuevas o que estén sin asignar.'
        : 'Las respuestas automáticas quedaron pausadas.')
    } catch (error) {
      alerts.error('No se pudo cambiar la IA', getErrorMessage(error, 'Inténtalo nuevamente.'))
    } finally {
      setSavingChatbot(false)
    }
  }

  const saveAi = async () => {
    const combinedKeys = geminiKeys.map(key => key.trim()).filter(Boolean).join(', ')
    if (combinedKeys && geminiKeys.some(key => key.trim() && !key.includes('•') && key.trim().length < 10)) {
      alerts.warning('Revisa las llaves de Gemini: hay una llave demasiado corta.')
      return
    }
    setSavingAi(true)
    try {
      const updated = await api.put<WhatsappCoreConfig>('/whatsapp/settings', {
        chatbotEnabled: wa.chatbotEnabled,
        geminiApiKey: combinedKeys,
        geminiModel: wa.geminiModel,
        aiInstructions: wa.aiInstructions,
      })
      setWhatsappResponse(updated)
      setTestResult(null)
      alerts.success('Configuración de IA guardada')
      void loadGeminiModelInfo(combinedKeys, wa.geminiModel)
    } catch (error) {
      alerts.error('No se pudo guardar la IA', getErrorMessage(error, 'Revisa los datos e inténtalo nuevamente.'))
    } finally {
      setSavingAi(false)
    }
  }

  const testGemini = async () => {
    const combinedKeys = geminiKeys.map(key => key.trim()).filter(Boolean).join(', ')
    if (!combinedKeys) {
      alerts.warning('Agrega al menos una llave de Gemini para ejecutar la prueba.')
      return
    }
    setTestingGemini(true)
    setTestResult(null)
    try {
      const result = await api.post<GeminiTestResult>('/whatsapp/test-gemini', {
        key: combinedKeys,
        prompt: testPrompt,
        model: wa.geminiModel,
      })
      setTestResult(result)
      if (typeof result.requestsToday === 'number') {
        setWa(current => ({ ...current, geminiRequestsToday: result.requestsToday || 0 }))
      }
      if (result.success) alerts.success('La IA respondió correctamente')
    } catch (error) {
      const message = getErrorMessage(error, 'No se pudo completar la prueba.')
      setTestResult({ success: false, message, testedKeys: 0, validKeys: 0, results: [] })
    } finally {
      setTestingGemini(false)
    }
  }

  const loadGeminiModelInfo = async (keysOverride?: string, modelOverride?: string) => {
    const combinedKeys = keysOverride ?? geminiKeys.map(key => key.trim()).filter(Boolean).join(', ')
    if (!combinedKeys) {
      alerts.warning('Agrega al menos una llave de Gemini para consultar los modelos.')
      return
    }
    setLoadingModelInfo(true)
    setModelInfoError('')
    try {
      const result = await api.post<GeminiModelInfo>('/whatsapp/gemini-models', { key: combinedKeys, model: modelOverride ?? wa.geminiModel })
      setModelInfo(result)
      if (result.selectedModel?.name) setWa(current => ({ ...current, geminiModel: result.selectedModel?.name || current.geminiModel }))
      alerts.toast(`${result.availableModels.length} modelos compatibles encontrados`)
    } catch (error) {
      const message = getErrorMessage(error, 'No se pudieron consultar los modelos de Gemini.')
      setModelInfoError(message)
      alerts.error('No se pudo consultar Gemini', message)
    } finally {
      setLoadingModelInfo(false)
    }
  }

  const saveMeta = async () => {
    setSavingMeta(true)
    try {
      const payload: Record<string, unknown> = {
        phoneId: wa.phoneId,
        businessPhone: wa.businessPhone,
      }
      if (waToken.trim()) payload.token = waToken.trim()
      if (waVerifyToken.trim()) payload.verifyToken = waVerifyToken.trim()
      const updated = await api.put<WhatsappCoreConfig>('/whatsapp/settings', payload)
      setWa(current => ({ ...current, ...updated }))
      setWaToken('')
      setWaVerifyToken('')
      alerts.success('Conexión de WhatsApp guardada')
    } catch (error) {
      alerts.error('No se pudo guardar WhatsApp', getErrorMessage(error, 'Revisa las credenciales.'))
    } finally {
      setSavingMeta(false)
    }
  }

  const saveSmtp = async () => {
    setSavingSmtp(true)
    try {
      const payload: Record<string, unknown> = { host: smtp.host, port: smtp.port, user: smtp.user, from: smtp.from }
      if (smtpPass) payload.pass = smtpPass
      const updated = await api.put<SmtpConfig>('/superadmin/config/smtp', payload)
      setSmtp(updated)
      setSmtpPass('')
      alerts.success('Configuración de correo guardada')
    } catch (error) {
      alerts.error('No se pudo guardar el correo', getErrorMessage(error, 'Revisa los datos.'))
    } finally {
      setSavingSmtp(false)
    }
  }

  const sendEmailTest = async () => {
    if (!testEmail.trim()) return
    setTestingEmail(true)
    try {
      const result = await api.post<{ message: string }>('/superadmin/config/smtp/test', { to: testEmail.trim() })
      alerts.success('Correo enviado', result.message)
    } catch (error) {
      alerts.error('No se pudo enviar el correo', getErrorMessage(error, 'Revisa la configuración SMTP.'))
    } finally {
      setTestingEmail(false)
    }
  }

  const tabs: Array<{ id: ConfigTab; label: string; description: string; icon: LucideIcon }> = [
    { id: 'AI', label: 'Inteligencia artificial', description: 'Bot, modelo y prueba', icon: Sparkles },
    { id: 'META', label: 'WhatsApp Meta', description: 'Número, token y webhook', icon: MessageCircle },
    { id: 'EMAIL', label: 'Correo', description: 'Servidor y prueba SMTP', icon: Mail },
  ]

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-muted)]">
        <Loader2 className="h-7 w-7 animate-spin text-[var(--accent)]" />
        <p className="text-sm font-bold">Cargando configuración…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1450px] space-y-4 pb-8">
      <Card className="flex flex-col gap-4 rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link to="/superadmin" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]" aria-label="Volver al panel">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-fg)]">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-black text-[var(--text-primary)] sm:text-2xl">Configuración técnica</h1>
            <p className="text-xs text-[var(--text-muted)]">Conexiones externas y comportamiento de la atención automática.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={cn('inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-bold', wa.configured ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
            <MessageCircle className="h-4 w-4" /> {wa.configured ? 'WhatsApp conectado' : 'WhatsApp pendiente'}
          </span>
          <span className={cn('inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-bold', wa.chatbotEnabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-[var(--text-secondary)]')}>
            <Bot className="h-4 w-4" /> Bot {wa.chatbotEnabled ? 'activo' : 'pausado'}
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {tabs.map(tab => {
          const Icon = tab.icon
          const selected = tab.id === activeTab
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={cn('flex items-center gap-3 rounded-2xl border p-3 text-left transition', selected ? 'border-[var(--accent)] bg-[var(--accent)]/5 shadow-sm' : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:border-[var(--border-default)]')}>
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', selected ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]')}><Icon className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block truncate text-sm font-black text-[var(--text-primary)]">{tab.label}</span><span className="block truncate text-[10px] text-[var(--text-muted)]">{tab.description}</span></span>
            </button>
          )
        })}
      </div>

      {activeTab === 'AI' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <SectionTitle icon={Bot} title="Asistente de WhatsApp" description="Controla cuándo responde y con qué instrucciones atiende." />
              <button type="button" role="switch" aria-checked={wa.chatbotEnabled} onClick={() => void toggleChatbot()} disabled={savingChatbot} className={cn('inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-black transition disabled:cursor-wait disabled:opacity-70', wa.chatbotEnabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]')}>
                {savingChatbot ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className={cn('h-2.5 w-2.5 rounded-full', wa.chatbotEnabled ? 'bg-emerald-500' : 'bg-slate-400')} />}
                {savingChatbot ? 'Guardando…' : wa.chatbotEnabled ? 'Respuestas activas' : 'Bot pausado'}
              </button>
            </div>

            <div className="mt-5 space-y-5">
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] leading-5 text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Cómo se prueba:</strong> el interruptor se guarda al instante. La IA solo responde mensajes entrantes de chats sin asignar; si una asesora tomó el chat, usa <strong className="text-[var(--text-primary)]">Soltar chat</strong> o prueba con una conversación nueva.
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Modelo principal</span>
                <div className="flex flex-col gap-2 sm:flex-row"><input list="gemini-models" value={wa.geminiModel} onChange={event => { setWa(current => ({ ...current, geminiModel: event.target.value })); setTestResult(null) }} className={cn(fieldClass, 'min-w-0 flex-1')} placeholder="gemini-2.5-flash-lite" /><Button type="button" variant="outline" onClick={() => void loadGeminiModelInfo()} disabled={loadingModelInfo} className="h-11 shrink-0 rounded-xl text-xs font-black">{loadingModelInfo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />} Consultar modelos</Button></div>
                <datalist id="gemini-models"><option value="gemini-2.5-flash-lite" /><option value="gemini-2.5-flash" /><option value="gemini-3.8-flash" /><option value="gemini-3.5-flash" /><option value="gemini-3.5-flash-lite" />{modelInfo?.availableModels.map(model => <option key={model.name} value={model.name} />)}</datalist>
                <span className="mt-1.5 block text-[11px] text-[var(--text-muted)]">Para respuestas rápidas y alto volumen usa <strong>gemini-2.5-flash-lite</strong>. La llave muestra los modelos reales y sus límites; “Nuevo pedido” reconoce el chat localmente y usa Gemini solo para completar datos.</span>
              </label>

              <label className="block">
                <span className="mb-1.5 flex items-center justify-between gap-3 text-xs font-bold text-[var(--text-secondary)]"><span>Instrucciones del negocio</span><span className="font-normal text-[var(--text-muted)]">{wa.aiInstructions.length}/4000</span></span>
                <textarea value={wa.aiInstructions} maxLength={4000} onChange={event => setWa(current => ({ ...current, aiInstructions: event.target.value }))} className={cn(textAreaClass, 'min-h-32')} placeholder="Ejemplo: usa un tono cercano, informa la promoción vigente y deriva a un asesor cuando el cliente pida una excepción." />
                <span className="mt-1.5 block text-[11px] text-[var(--text-muted)]">El menú, los horarios y los datos de cobro se toman automáticamente de la configuración actual.</span>
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div><p className="text-xs font-bold text-[var(--text-secondary)]">Llaves de Gemini</p><p className="text-[11px] text-[var(--text-muted)]">Puedes dejar una principal y otras de respaldo.</p></div>
                  <Button type="button" variant="outline" onClick={() => setGeminiKeys(current => [...current, ''])} className="h-9 rounded-xl text-xs font-bold"><Plus className="mr-1.5 h-4 w-4" /> Agregar</Button>
                </div>
                <div className="space-y-2">
                  {geminiKeys.map((keyValue, index) => {
                    const masked = keyValue.includes('•')
                    const invalid = Boolean(keyValue.trim() && !masked && keyValue.trim().length < 10)
                    return (
                      <div key={`${index}-${masked ? keyValue.slice(-4) : 'new'}`}>
                        <div className="flex gap-2">
                          <span className="flex h-11 min-w-20 items-center justify-center rounded-xl bg-[var(--bg-elevated)] px-2 text-[11px] font-bold text-[var(--text-muted)]">Llave {index + 1}</span>
                          <input type="text" autoComplete="off" value={keyValue} onChange={event => updateKey(index, event.target.value)} className={cn(fieldClass, 'min-w-0 flex-1 font-mono text-xs', masked && 'border-emerald-500/30 text-emerald-600', invalid && 'border-red-500 text-red-600')} placeholder="Pega aquí la llave API" />
                          <button type="button" onClick={() => removeKey(index)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/20 text-red-500 transition hover:bg-red-500/10" aria-label={`Eliminar llave ${index + 1}`}><Trash2 className="h-4 w-4" /></button>
                        </div>
                        {masked && <p className="mt-1 pl-[5.5rem] text-[10px] font-bold text-emerald-600">Guardada · termina en {keyValue.slice(-4)}</p>}
                        {invalid && <p className="mt-1 pl-[5.5rem] text-[10px] font-bold text-red-500">La llave parece incompleta.</p>}
                      </div>
                    )
                  })}
                </div>
              </div>

              {modelInfoError && <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs font-bold text-red-600">{modelInfoError}</div>}
              {modelInfo && <div className="space-y-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4">
                <div className="flex items-start gap-2"><Gauge className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" /><div><p className="text-sm font-black text-[var(--text-primary)]">Modelos reales de esta llave</p><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Google devolvió {modelInfo.availableModels.length} modelos que aceptan respuestas de texto. Consulta realizada con la llave {modelInfo.keySuffix || 'configurada'} · {new Date(modelInfo.checkedAt).toLocaleTimeString('es-CO')}</p></div></div>

                <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-[var(--bg-panel)] p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Modelo seleccionado</p><p className="mt-1 truncate text-xs font-black text-[var(--text-primary)]">{modelInfo.selectedModel?.name || modelInfo.configuredModel || 'No encontrado'}</p></div><div className="rounded-xl bg-[var(--bg-panel)] p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Entrada máxima</p><p className="mt-1 text-sm font-black text-[var(--text-primary)]">{formatTokenLimit(modelInfo.selectedModel?.inputTokenLimit ?? null)}</p></div><div className="rounded-xl bg-[var(--bg-panel)] p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Salida máxima</p><p className="mt-1 text-sm font-black text-[var(--text-primary)]">{formatTokenLimit(modelInfo.selectedModel?.outputTokenLimit ?? null)}</p></div></div>

                {recommendedModel && <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-xs font-black text-emerald-700 dark:text-emerald-300">Recomendado para respuestas y toma de pedidos</p><p className="mt-0.5 truncate font-mono text-[11px] font-bold text-[var(--text-primary)]">{recommendedModel.name}</p><p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{getGeminiModelUse(recommendedModel).description}</p></div><Button type="button" variant="outline" onClick={() => { setWa(current => ({ ...current, geminiModel: recommendedModel.name })); setTestResult(null) }} className="h-9 shrink-0 rounded-lg border-emerald-500/30 text-[11px] font-black text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300">Usar este modelo</Button></div>}

                <div className="flex items-start gap-2 rounded-xl bg-[var(--bg-panel)] p-3"><Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><p className="text-[11px] leading-5 text-[var(--text-secondary)]">Solicitudes registradas por esta aplicación hoy: <strong>{modelInfo.usage.requestsToday.toLocaleString('es-CO')}</strong>. La cuota restante exacta no la publica esta API; Google la administra por proyecto y plan en AI Studio o Cloud Console.</p></div>

                <div><div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-black text-[var(--text-primary)]">Todos los modelos disponibles</p><span className="rounded-lg bg-[var(--bg-panel)] px-2 py-1 text-[10px] font-bold text-[var(--text-muted)]">Haz clic para seleccionar</span></div><div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">{modelInfo.availableModels.map(model => { const use = getGeminiModelUse(model); const selected = wa.geminiModel === model.name; return <button key={model.name} type="button" onClick={() => { setWa(current => ({ ...current, geminiModel: model.name })); setTestResult(null) }} className={cn('w-full rounded-xl border p-3 text-left transition hover:border-[var(--accent)] hover:shadow-sm', modelToneClass[use.tone], selected && 'border-[var(--accent)] ring-2 ring-[var(--accent)]/15')}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-xs font-black text-[var(--text-primary)]">{model.displayName || model.name}</span><span className="rounded-md bg-[var(--bg-panel)] px-1.5 py-0.5 text-[9px] font-black text-[var(--text-secondary)]">{use.label}</span>{selected && <span className="rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-black text-[var(--accent-fg)]">Seleccionado</span>}</div><p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">{model.name}</p><p className="mt-1 text-[11px] leading-4 text-[var(--text-secondary)]">{model.description || use.description}</p></div><span className="shrink-0 text-[10px] font-bold text-[var(--text-muted)]">{formatTokenLimit(model.outputTokenLimit)} salida</span></div></button> })}</div></div>
                <p className="text-[10px] text-[var(--text-muted)]">El modelo elegido queda guardado al pulsar “Guardar configuración de IA”. “Nuevo pedido” usa automáticamente ese modelo para interpretar el chat; si falla, mantiene la contingencia local.</p>
              </div>}

              <div className="grid gap-2 rounded-2xl bg-[var(--bg-elevated)] p-3 sm:grid-cols-3">
                <div className="rounded-xl bg-[var(--bg-panel)] p-3"><KeyRound className="mb-2 h-4 w-4 text-[var(--accent)]" /><p className="text-xl font-black text-[var(--text-primary)]">{localKeyCount}</p><p className="text-[10px] text-[var(--text-muted)]">Llaves en el formulario</p></div>
                <div className="rounded-xl bg-[var(--bg-panel)] p-3"><Activity className="mb-2 h-4 w-4 text-blue-500" /><p className="text-xl font-black text-[var(--text-primary)]">{wa.geminiRequestsToday.toLocaleString('es-CO')}</p><p className="text-[10px] text-[var(--text-muted)]">Solicitudes exitosas hoy</p></div>
                <div className="rounded-xl bg-[var(--bg-panel)] p-3"><Clock3 className="mb-2 h-4 w-4 text-amber-500" /><p className="truncate text-sm font-black text-[var(--text-primary)]">Según proveedor</p><p className="text-[10px] text-[var(--text-muted)]">La cuota no es fija</p></div>
              </div>

              <Button type="button" onClick={saveAi} disabled={savingAi} className="h-11 w-full rounded-xl bg-[var(--accent)] font-black text-[var(--accent-fg)]">
                {savingAi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Guardar configuración de IA
              </Button>
            </div>
          </Card>

          <Card className="h-fit rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:p-5">
            <SectionTitle icon={Sparkles} title="Prueba real" description="Envía un mensaje corto al modelo y comprueba cada llave sin activar el bot." />
            <div className="mt-5 space-y-3">
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Mensaje de prueba</span><textarea value={testPrompt} maxLength={500} onChange={event => { setTestPrompt(event.target.value); setTestResult(null) }} className={cn(textAreaClass, 'min-h-24')} /></label>
              <Button type="button" onClick={testGemini} disabled={testingGemini || !testPrompt.trim()} className="h-11 w-full rounded-xl bg-[var(--accent)] font-black text-[var(--accent-fg)]">
                {testingGemini ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} {testingGemini ? 'Probando conexión…' : 'Probar IA ahora'}
              </Button>

              {!testResult && <div className="rounded-2xl border border-dashed border-[var(--border-default)] p-5 text-center"><Server className="mx-auto mb-2 h-6 w-6 text-[var(--text-muted)]" /><p className="text-xs font-bold text-[var(--text-secondary)]">Aún no se ha ejecutado una prueba</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">Verás aquí la respuesta, el modelo usado y el tiempo de conexión.</p></div>}

              {testResult && (
                <div className={cn('space-y-3 rounded-2xl border p-4', testResult.success ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
                  <div className="flex items-start gap-2">{testResult.success ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />}<div><p className="text-sm font-black text-[var(--text-primary)]">{testResult.success ? 'Conexión correcta' : 'La prueba falló'}</p><p className="text-[11px] text-[var(--text-muted)]">{testResult.message}</p></div></div>
                  {testResult.reply && <div className="rounded-xl bg-[var(--bg-panel)] p-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Respuesta</p><p className="text-sm text-[var(--text-primary)]">{testResult.reply}</p></div>}
                  <div className="flex flex-wrap gap-2 text-[10px] font-bold text-[var(--text-secondary)]">{testResult.model && <span className="rounded-lg bg-[var(--bg-panel)] px-2 py-1">Modelo: {testResult.model}</span>}{typeof testResult.latencyMs === 'number' && <span className="rounded-lg bg-[var(--bg-panel)] px-2 py-1">Latencia: {testResult.latencyMs} ms</span>}<span className="rounded-lg bg-[var(--bg-panel)] px-2 py-1">Llaves: {testResult.validKeys}/{testResult.testedKeys}</span></div>
                  {testResult.results.length > 0 && <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3">{testResult.results.map(result => <div key={result.key} className="flex items-start justify-between gap-3 text-[11px]"><span className="font-mono font-bold text-[var(--text-secondary)]">{result.key}</span><span className={cn('text-right font-bold', result.ok ? 'text-emerald-600' : 'text-red-500')}>{result.ok ? `${result.model} · ${result.latencyMs} ms` : result.error}</span></div>)}</div>}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'META' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <SectionTitle icon={MessageCircle} title="Conexión con WhatsApp Cloud API" description="Datos técnicos entregados por Meta para enviar y recibir mensajes." />
              <span className={cn('inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black', wa.configured ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>{wa.configured ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}{wa.configured ? 'Conectado' : 'Pendiente'}</span>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Phone Number ID</span><input value={wa.phoneId} onChange={event => setWa(current => ({ ...current, phoneId: event.target.value }))} className={fieldClass} /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Teléfono comercial</span><input value={wa.businessPhone} onChange={event => setWa(current => ({ ...current, businessPhone: event.target.value }))} className={fieldClass} placeholder="+57…" /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Token de acceso de Meta</span><input type="password" value={waToken} onChange={event => setWaToken(event.target.value)} className={fieldClass} placeholder={wa.configured ? 'Guardado · escribe solo para cambiarlo' : 'Pega el token permanente'} /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Token de verificación del webhook</span><input type="password" value={waVerifyToken} onChange={event => setWaVerifyToken(event.target.value)} className={fieldClass} placeholder={wa.verifyTokenConfigured ? 'Guardado · escribe solo para cambiarlo' : 'Define el token del webhook'} /></label>
            </div>
            <Button type="button" onClick={saveMeta} disabled={savingMeta} className="mt-5 h-11 w-full rounded-xl bg-[var(--accent)] font-black text-[var(--accent-fg)]">{savingMeta ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Guardar conexión</Button>
          </Card>

          <Card className="h-fit rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:p-5">
            <SectionTitle icon={Printer} title="Impresión local" description="Railway administra la cola; el computador del negocio hace la impresión dentro de la red." />
            <div className="mt-4 space-y-3 text-xs leading-relaxed text-[var(--text-secondary)]">
              <p className="rounded-xl bg-[var(--bg-elevated)] p-3">El puente se ejecuta en segundo plano en el computador del negocio y se conecta por HTTPS hacia Railway. La impresora no necesita quedar expuesta a Internet.</p>
              <p className="rounded-xl bg-[var(--bg-elevated)] p-3">Si cambia la IP de una impresora, se actualiza desde Configuración → Cocina domicilios; no hay que editar el programa local.</p>
              <Link to="/settings/modules" className="flex h-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] font-black text-[var(--accent)] transition hover:border-[var(--accent)]">Abrir configuración operativa</Link>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'EMAIL' && (
        <Card className="mx-auto max-w-4xl rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-center sm:justify-between">
            <SectionTitle icon={Mail} title="Servidor de correo" description="Notificaciones y recuperación de contraseñas." />
            {smtp.passConfigured && <span className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-500/10 px-3 text-xs font-black text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Contraseña guardada</span>}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Servidor SMTP</span><input value={smtp.host} onChange={event => setSmtp(current => ({ ...current, host: event.target.value }))} className={fieldClass} placeholder="smtp.gmail.com" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Puerto</span><input type="number" value={smtp.port} onChange={event => setSmtp(current => ({ ...current, port: Number(event.target.value) }))} className={fieldClass} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Usuario</span><input value={smtp.user} onChange={event => setSmtp(current => ({ ...current, user: event.target.value }))} className={fieldClass} placeholder="correo@dominio.com" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Correo remitente</span><input value={smtp.from} onChange={event => setSmtp(current => ({ ...current, from: event.target.value }))} className={fieldClass} placeholder="notificaciones@dominio.com" /></label>
            <label className="block md:col-span-2"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Contraseña o App Password</span><input type="password" value={smtpPass} onChange={event => setSmtpPass(event.target.value)} className={fieldClass} placeholder={smtp.passConfigured ? 'Guardada · escribe solo para cambiarla' : 'Escribe la contraseña'} /></label>
          </div>
          <Button type="button" onClick={saveSmtp} disabled={savingSmtp} className="mt-5 h-11 w-full rounded-xl bg-[var(--accent)] font-black text-[var(--accent-fg)]">{savingSmtp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Guardar correo</Button>
          <div className="mt-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 sm:flex sm:items-end sm:gap-3">
            <label className="block flex-1"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Enviar correo de prueba a</span><input type="email" value={testEmail} onChange={event => setTestEmail(event.target.value)} className={fieldClass} placeholder="destino@correo.com" /></label>
            <Button type="button" variant="outline" onClick={sendEmailTest} disabled={testingEmail || !testEmail.trim()} className="mt-3 h-11 w-full rounded-xl font-black sm:mt-0 sm:w-auto">{testingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Enviar prueba</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
