import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { Sparkles, TrendingUp, MapPin, Clock, Flame, Send, Bot, HelpCircle, RefreshCw } from 'lucide-react'

interface AiInsightsData {
  prediction: string
  recommendation: string
  topBarrio: string
  topBarrioOrders: number
  peakHour: string
  topItem: string
  topItemQuantity: number
  topBarrios: { name: string; count: number; total: number }[]
  topItems: { name: string; count: number; total: number }[]
}

export function VillaDogAiAnalyticsCard() {
  const [insights, setInsights] = useState<AiInsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [aiAnswer, setAiAnswer] = useState<string | null>(null)

  const fetchInsights = async () => {
    setLoading(true)
    try {
      const data = await api.get<AiInsightsData>('/reports/ai-insights')
      setInsights(data)
    } catch (err) {
      console.error('Error cargando analítica IA:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInsights()
  }, [])

  const handleAskQuestion = async (qToAsk?: string) => {
    const text = qToAsk || question
    if (!text.trim() || asking) return

    setAsking(true)
    setAiAnswer(null)
    try {
      const res = await api.post<{ answer: string }>('/reports/ask-ai', { question: text })
      setAiAnswer(res.answer)
      if (!qToAsk) setQuestion('')
    } catch (err: any) {
      setAiAnswer(err.message || 'Error al conectar con la IA de The Villa Dog.')
    } finally {
      setAsking(false)
    }
  }

  const sampleQuestions = [
    '¿Cuál es el barrio que más compra?',
    '¿Qué plato rota más esta semana?',
    '¿A qué hora suben los domicilios?',
    '¿Qué combo me recomiendas ofrecer hoy?'
  ]

  return (
    <Card className="border border-[var(--accent)]/30 bg-gradient-to-br from-[var(--bg-panel)] via-[var(--bg-panel)] to-[var(--accent-muted)]/10 shadow-xl rounded-2xl overflow-hidden">
      <CardHeader className="border-b border-[var(--border-subtle)] pb-4 pt-5 px-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-fg)] shadow-md shadow-[var(--accent)]/20">
                <Sparkles className="h-4 w-4 animate-pulse" />
              </span>
              <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide">
                The Villa Dog AI — Analítica Predictiva y Copilot
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-[var(--text-secondary)] mt-1">
              Inteligencia artificial que analiza tu demanda, horas pico, rotación de menú y responde tus preguntas de negocio.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={fetchInsights}
            disabled={loading}
            className="h-8 px-3 text-xs font-bold rounded-xl border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar IA
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-10 gap-3 text-xs text-[var(--text-muted)] animate-pulse">
            <Sparkles className="h-5 w-5 text-[var(--accent)] animate-spin" />
            <span>Analizando historial de ventas y patrones de demanda con Gemini AI...</span>
          </div>
        ) : insights ? (
          <>
            {/* KPI METRICS ROW */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                  <MapPin className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider">Barrio Top Domicilios</p>
                  <p className="text-sm font-extrabold text-[var(--text-primary)] truncate">{insights.topBarrio}</p>
                  <p className="text-[10px] text-[var(--text-secondary)]">{insights.topBarrioOrders} pedidos registrados</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider">Hora Pico de Domicilios</p>
                  <p className="text-sm font-extrabold text-[var(--text-primary)] truncate">{insights.peakHour}</p>
                  <p className="text-[10px] text-[var(--text-secondary)]">Máximo flujo proyectado</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                  <Flame className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider">Plato Estrella (Top Rotación)</p>
                  <p className="text-sm font-extrabold text-[var(--text-primary)] truncate">{insights.topItem}</p>
                  <p className="text-[10px] text-[var(--text-secondary)]">{insights.topItemQuantity} unidades vendidas</p>
                </div>
              </div>
            </div>

            {/* AI PREDICTION & RECOMMENDATION BOX */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-[var(--bg-elevated)]/80 border border-[var(--border-subtle)] relative overflow-hidden">
                <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--accent)] uppercase mb-2">
                  <TrendingUp className="h-4 w-4" />
                  <span>Predicción de Demanda (IA)</span>
                </div>
                <p className="text-xs text-[var(--text-primary)] leading-relaxed font-medium">
                  {insights.prediction}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[var(--bg-elevated)]/80 border border-[var(--border-subtle)] relative overflow-hidden">
                <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--accent)] uppercase mb-2">
                  <Sparkles className="h-4 w-4" />
                  <span>Sugerencia Estratégica</span>
                </div>
                <p className="text-xs text-[var(--text-primary)] leading-relaxed font-medium">
                  {insights.recommendation}
                </p>
              </div>
            </div>

            {/* ASK AI INTERACTIVE SECTION */}
            <div className="pt-2 border-t border-[var(--border-subtle)] space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Bot className="h-4 w-4 text-[var(--accent)]" /> Preguntar a The Villa Dog AI Copilot
                </label>
                <span className="text-[10px] text-[var(--text-muted)]">Responde con datos reales de tu restaurante</span>
              </div>

              {/* Sample Quick Questions */}
              <div className="flex flex-wrap gap-1.5">
                {sampleQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setQuestion(q)
                      handleAskQuestion(q)
                    }}
                    disabled={asking}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 transition-all cursor-pointer"
                  >
                    <HelpCircle className="h-3 w-3 text-[var(--accent)] shrink-0" />
                    <span>{q}</span>
                  </button>
                ))}
              </div>

              {/* Input Form */}
              <form onSubmit={(e) => { e.preventDefault(); handleAskQuestion(); }} className="flex items-center gap-2">
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ej: ¿Qué barrio compra más salchipapas? o ¿Qué puedo promocionar hoy?"
                  className="flex-1 h-10 text-xs rounded-xl bg-[var(--bg-input)] border-[var(--border-default)] focus:border-[var(--accent)]"
                  disabled={asking}
                />
                <Button
                  type="submit"
                  disabled={asking || !question.trim()}
                  className="h-10 px-4 text-xs font-bold rounded-xl bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] cursor-pointer flex items-center gap-1.5 shrink-0 shadow-md shadow-[var(--accent)]/15"
                >
                  {asking ? (
                    <Sparkles className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      <span>Preguntar</span>
                    </>
                  )}
                </Button>
              </form>

              {/* AI Answer Display */}
              <AnimatePresence>
                {aiAnswer && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="p-4 rounded-xl bg-[var(--accent-muted)]/20 border border-[var(--accent)]/30 text-xs text-[var(--text-primary)] leading-relaxed space-y-1 relative"
                  >
                    <div className="flex items-center justify-between text-[10px] font-bold text-[var(--accent)] uppercase mb-1">
                      <span className="flex items-center gap-1">
                        <Bot className="h-3.5 w-3.5" /> Respuesta de The Villa Dog AI:
                      </span>
                      <button type="button" onClick={() => setAiAnswer(null)} className="text-[var(--text-muted)] hover:text-white cursor-pointer">
                        Cerrar
                      </button>
                    </div>
                    <p className="font-medium whitespace-pre-line">{aiAnswer}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
