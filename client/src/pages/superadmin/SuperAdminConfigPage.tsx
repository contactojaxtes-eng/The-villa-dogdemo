import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { cn } from '@/lib/utils'
import { Mail, MessageCircle, Loader2, CheckCircle2, Send, ShieldCheck, Terminal, Save, Lock, ArrowLeft, Trash2, Key, Headphones, AlertTriangle, Activity, PlusCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

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
  chatbotEnabled?: boolean
  geminiApiKey?: string
  geminiRequestsToday?: number
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
}

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
}

export default function SuperAdminConfigPage() {
  const [loading, setLoading] = useState(true)
  const [smtp, setSmtp] = useState<SmtpConfig>({ host: '', port: 587, user: '', from: '', passConfigured: false })
  const [smtpPass, setSmtpPass] = useState('')
  const [savingSmtp, setSavingSmtp] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testingEmail, setTestingEmail] = useState(false)

  const [wa, setWa] = useState<WhatsappCoreConfig>({ phoneId: '', businessPhone: '', configured: false, verifyTokenConfigured: false, chatbotEnabled: true, geminiApiKey: '', geminiRequestsToday: 0 })
  const [waToken, setWaToken] = useState('')
  const [waVerifyToken, setWaVerifyToken] = useState('')
  const [savingWa, setSavingWa] = useState(false)

  const [testingGemini, setTestingGemini] = useState(false)

  const handleTestGemini = async () => {
    const keysJoined = geminiKeys.map(k => k.trim()).filter(Boolean).join(',');
    if (!keysJoined) {
      alerts.warning('Ingresa al menos una clave API de Gemini antes de probar.')
      return
    }
    setTestingGemini(true)
    try {
      const res = await api.post<{ success: boolean; message: string }>('/whatsapp/test-gemini', {
        key: keysJoined
      })
      if (res.success) {
        alerts.success(res.message)
      } else {
        alerts.error(res.message)
      }
    } catch (err: any) {
      alerts.error('Error al probar conexión: ' + (err.message || err))
    } finally {
      setTestingGemini(false)
    }
  }

  const [geminiKeys, setGeminiKeys] = useState<string[]>([''])

  useEffect(() => {
    Promise.all([
      api.get<SmtpConfig>('/superadmin/config/smtp'),
      api.get<WhatsappCoreConfig>('/whatsapp/settings'),
    ])
      .then(([smtpData, waData]) => { 
        setSmtp(smtpData); 
        setWa(waData);
        const keysArr = waData.geminiApiKey ? waData.geminiApiKey.split(',').map(k => k.trim()).filter(Boolean) : [''];
        setGeminiKeys(keysArr.length > 0 ? keysArr : ['']);
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleKeyChange = (index: number, val: string) => {
    setGeminiKeys(prev => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  }

  const handleAddKey = () => {
    setGeminiKeys(prev => [...prev, '']);
  }

  const handleRemoveKey = (index: number) => {
    setGeminiKeys(prev => {
      const next = prev.filter((_, i) => i !== index);
      const finalKeys = next.length > 0 ? next : [''];
      return finalKeys;
    });
  }

  const saveSmtp = async () => {
    setSavingSmtp(true)
    try {
      const payload: any = { host: smtp.host, port: smtp.port, user: smtp.user, from: smtp.from }
      if (smtpPass) payload.pass = smtpPass
      const updated = await api.put<SmtpConfig>('/superadmin/config/smtp', payload)
      setSmtp(updated)
      setSmtpPass('')
      alerts.success('Configuración SMTP guardada')
    } catch (err: any) {
      alerts.error('Error al guardar SMTP', err.message)
    } finally {
      setSavingSmtp(false)
    }
  }

  const sendTest = async () => {
    if (!testEmail) return
    setTestingEmail(true)
    try {
      const res = await api.post<{ message: string }>('/superadmin/config/smtp/test', { to: testEmail })
      alerts.success('Correo enviado', res.message)
    } catch (err: any) {
      alerts.error('No se pudo enviar el correo de prueba', err.message)
    } finally {
      setTestingEmail(false)
    }
  }

  const saveWhatsapp = async () => {
    setSavingWa(true)
    try {
      const combinedKeys = geminiKeys.map(k => k.trim()).filter(Boolean).join(', ');
      const payload: any = { 
        phoneId: wa.phoneId, 
        businessPhone: wa.businessPhone, 
        chatbotEnabled: wa.chatbotEnabled, 
        geminiApiKey: combinedKeys 
      }
      if (waToken) payload.token = waToken
      if (waVerifyToken) payload.verifyToken = waVerifyToken
      const updated = await api.put<WhatsappCoreConfig>('/whatsapp/settings', payload)
      setWa(updated)
      setWaToken('')
      setWaVerifyToken('')
      const keysArr = updated.geminiApiKey ? updated.geminiApiKey.split(',').map(k => k.trim()).filter(Boolean) : [''];
      setGeminiKeys(keysArr.length > 0 ? keysArr : ['']);
      alerts.success('Configuración de WhatsApp y llaves de Gemini guardadas correctamente')
    } catch (err: any) {
      alerts.error('Error al guardar WhatsApp', err.message)
    } finally {
      setSavingWa(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-[#64748B] min-h-[80vh] bg-[#F6F7F9] rounded-[2rem] border border-[#E5E7EB]">
        <Loader2 className="h-8 w-8 animate-spin text-[#7A1F2B]" />
        <p className="mt-4 text-xs font-mono uppercase tracking-widest text-[#7A1F2B]/50 animate-pulse">Loading Configurations...</p>
      </div>
    )
  }

  return (
    <div className="min-h-[85vh] bg-[#F6F7F9] rounded-[2rem] border border-[#E5E7EB] p-4 md:p-8 text-[#334155] relative overflow-hidden shadow-2xl">
      <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-[#7A1F2B]/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.05),transparent_50%)] pointer-events-none" />
      
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="relative z-10 space-y-8">
        
        {/* Header */}
        <motion.div variants={itemVariants} className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E2E8F0] pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link to="/superadmin">
                <button className="flex items-center justify-center h-6 w-6 rounded-md bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] transition-colors cursor-pointer mr-2">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
              </Link>
              <ShieldCheck className="h-5 w-5 text-[#B45309]" />
              <span className="text-[10px] font-mono tracking-[0.2em] text-[#B45309] uppercase font-bold">CORE CONFIG</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-[#0F172A] tracking-tight uppercase flex items-center gap-3">
              Configuración Técnica
            </h1>
            <p className="text-xs text-[#64748B] font-mono mt-1">Variables de entorno sensibles // The Villa Dog NO tiene acceso</p>
          </div>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-6">
          
          {/* SMTP Config */}
          <motion.div variants={itemVariants} className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-[#E5E7EB] bg-[#F6F7F9]/50 flex items-center gap-3">
              <div className="p-2 bg-[#7A1F2B]/10 rounded-lg text-[#7A1F2B]">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[#0F172A] uppercase tracking-widest">Servidor SMTP</h2>
                <p className="text-[10px] font-mono text-[#64748B]">Notificaciones de stock y recuperación de contraseñas</p>
              </div>
            </div>
            
            <div className="p-6 space-y-4 flex-1">
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider">Host SMTP</label>
                <input type="text" className="w-full h-10 px-3 bg-[#F6F7F9] border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#0F172A] focus:outline-none focus:border-[#7A1F2B]/50 transition-colors" value={smtp.host} onChange={e => setSmtp(p => ({ ...p, host: e.target.value }))} placeholder="smtp.gmail.com" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider">Port</label>
                  <input type="number" className="w-full h-10 px-3 bg-[#F6F7F9] border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#0F172A] focus:outline-none focus:border-[#7A1F2B]/50 transition-colors" value={smtp.port} onChange={e => setSmtp(p => ({ ...p, port: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider">Usuario (Email)</label>
                  <input type="text" className="w-full h-10 px-3 bg-[#F6F7F9] border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#0F172A] focus:outline-none focus:border-[#7A1F2B]/50 transition-colors" value={smtp.user} onChange={e => setSmtp(p => ({ ...p, user: e.target.value }))} placeholder="correo@gmail.com" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider flex justify-between">
                  <span>Contraseña / App Password</span>
                  {smtp.passConfigured && <span className="text-[#7A1F2B] flex items-center gap-1"><Lock className="h-3 w-3" /> SECURE</span>}
                </label>
                <input type="password" className="w-full h-10 px-3 bg-[#F6F7F9] border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#0F172A] focus:outline-none focus:border-[#7A1F2B]/50 transition-colors" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} placeholder={smtp.passConfigured ? '[REDACTED] - Escribir para cambiar' : '••••••••'} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider">Correo Remitente (FROM)</label>
                <input type="text" className="w-full h-10 px-3 bg-[#F6F7F9] border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#0F172A] focus:outline-none focus:border-[#7A1F2B]/50 transition-colors" value={smtp.from} onChange={e => setSmtp(p => ({ ...p, from: e.target.value }))} placeholder="notificaciones@thevilladog.local" />
              </div>
            </div>
            
            <div className="p-4 bg-[#F6F7F9]/30 border-t border-[#E5E7EB] space-y-4">
              <button onClick={saveSmtp} disabled={savingSmtp} className="w-full h-10 flex items-center justify-center gap-2 bg-[#7A1F2B]/10 hover:bg-[#7A1F2B]/20 text-[#7A1F2B] border border-[#7A1F2B]/30 font-mono font-bold rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer">
                {savingSmtp ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" /> COMMIT SMTP CHANGES</>}
              </button>
              
              <div className="flex gap-2">
                <input type="text" className="flex-1 h-9 px-3 bg-[#F6F7F9] border border-[#E2E8F0] rounded-lg text-xs font-mono text-[#0F172A] focus:outline-none" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="test@email.com" />
                <button onClick={sendTest} disabled={testingEmail || !testEmail} className="h-9 px-4 flex items-center gap-2 bg-[#F1F5F9] hover:bg-[#E2E8F0] border border-[#E2E8F0] text-[#0F172A] font-mono rounded-lg text-[10px] uppercase transition-colors cursor-pointer disabled:opacity-50">
                  {testingEmail ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Send className="h-3 w-3" /> PING</>}
                </button>
              </div>
            </div>
          </motion.div>

          {/* WhatsApp Config */}
          <motion.div variants={itemVariants} className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-[#E5E7EB] bg-[#F6F7F9]/50 flex items-center gap-3">
              <div className="p-2 bg-[#7A1F2B]/10 rounded-lg text-[#7A1F2B]">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-bold text-[#0F172A] uppercase tracking-widest">WhatsApp Cloud API</h2>
                <p className="text-[10px] font-mono text-[#64748B]">Conexión con Meta / Graph API</p>
              </div>
              {wa.configured && (
                <div className="flex items-center gap-1.5 text-[9px] font-mono font-bold text-[#7A1F2B] border border-[#7A1F2B]/30 bg-[#7A1F2B]/10 px-2 py-1 rounded">
                  <CheckCircle2 className="h-3 w-3" /> CONNECTED
                </div>
              )}
            </div>
            
            <div className="p-6 space-y-4 flex-1">
              {/* Chatbot Toggle Switch */}
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F6F7F9] px-4 py-3 hover:bg-[#F1F5F9] transition-colors">
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-[#0F172A] uppercase tracking-wide">Habilitar Chatbot IA</p>
                  <p className="text-[10px] text-[#64748B] font-medium">Responder automáticamente vía WhatsApp.</p>
                </div>
                <input
                  type="checkbox"
                  checked={wa.chatbotEnabled !== false}
                  onChange={e => setWa(p => ({ ...p, chatbotEnabled: e.target.checked }))}
                  className="h-5 w-5 accent-[#7A1F2B] rounded cursor-pointer shrink-0 ml-4"
                />
              </label>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider flex items-center gap-1">
                  <Key className="h-3 w-3 text-[#7A1F2B]" /> Phone Number ID
                </label>
                <div className="relative">
                  <Terminal className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" />
                  <input type="text" className="w-full h-10 pl-9 pr-3 bg-[#F6F7F9] border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#0F172A] focus:outline-none focus:border-[#7A1F2B]/50 transition-colors" value={wa.phoneId} onChange={e => setWa(p => ({ ...p, phoneId: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider flex items-center gap-1">
                  <Headphones className="h-3 w-3 text-[#7A1F2B]" /> Teléfono Comercial
                </label>
                <input type="text" className="w-full h-10 px-3 bg-[#F6F7F9] border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#0F172A] focus:outline-none focus:border-[#7A1F2B]/50 transition-colors" value={wa.businessPhone} onChange={e => setWa(p => ({ ...p, businessPhone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider flex justify-between">
                  <span>Graph API Access Token</span>
                  <span className="text-[#94A3B8]">BEARER</span>
                </label>
                <input type="password" className="w-full h-10 px-3 bg-[#F6F7F9] border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#7A1F2B] focus:outline-none focus:border-[#7A1F2B]/50 transition-colors" value={waToken} onChange={e => setWaToken(e.target.value)} placeholder="[REDACTED] - Escribir nuevo token" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider flex justify-between">
                  <span>Webhook Verify Token</span>
                  {wa.verifyTokenConfigured && <span className="text-[#7A1F2B] flex items-center gap-1"><Lock className="h-3 w-3" /> SECURE</span>}
                </label>
                <input type="password" className="w-full h-10 px-3 bg-[#F6F7F9] border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#7A1F2B] focus:outline-none focus:border-[#7A1F2B]/50 transition-colors" value={waVerifyToken} onChange={e => setWaVerifyToken(e.target.value)} placeholder="[REDACTED] - Escribir para cambiar" />
              </div>

              <div className="space-y-3 pt-3 border-t border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-mono text-[#64748B] uppercase tracking-wider flex items-center gap-1.5 text-[#7A1F2B] font-bold">
                    <Key className="h-3.5 w-3.5" /> GEMINI API KEYS (Soporte Multi-Cuenta)
                  </label>
                  <button
                    type="button"
                    onClick={handleTestGemini}
                    disabled={testingGemini}
                    className="h-8 px-3 rounded-lg border border-[#7A1F2B]/30 hover:bg-[#7A1F2B]/20 text-[#7A1F2B] text-[10px] uppercase font-bold transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                  >
                    {testingGemini ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Probar Llaves'}
                  </button>
                </div>

                <div className="space-y-2">
                  {geminiKeys.map((keyVal, idx) => {
                    const isMasked = keyVal.includes('•') || keyVal.startsWith('••••');
                    const isNewValid = !isMasked && keyVal.trim().length >= 15;
                    const isInvalidFormat = !isMasked && keyVal.trim().length > 0 && keyVal.trim().length < 15;

                    return (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="h-10 px-2.5 flex items-center justify-center rounded-xl bg-[#F1F5F9] text-[10px] font-mono text-[#64748B] border border-[#E2E8F0] shrink-0 font-bold">
                            Key #{idx + 1}
                          </div>
                          <input 
                            className={cn(
                              "flex-1 h-10 px-3 rounded-xl bg-[#F6F7F9] border text-xs font-mono transition-colors focus:outline-none",
                              isInvalidFormat 
                                ? "border-red-500 text-red-600 focus:border-red-500" 
                                : isMasked 
                                ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 font-bold focus:border-emerald-500"
                                : isNewValid
                                ? "border-blue-500/40 text-blue-700 dark:text-blue-400 focus:border-blue-500"
                                : "border-[#E2E8F0] text-[#0F172A] focus:border-[#7A1F2B]/50"
                            )} 
                            type="text" 
                            value={keyVal} 
                            onChange={e => handleKeyChange(idx, e.target.value)} 
                            placeholder={idx === 0 ? "Clave API Gemini (Correo 1)" : `Clave API Gemini Reserva ${idx} (Otro Correo)`} 
                          />
                          {geminiKeys.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveKey(idx)}
                              className="h-10 w-10 flex items-center justify-center rounded-xl border border-red-200 text-red-600 hover:bg-red-500/20 transition-colors shrink-0 cursor-pointer"
                              title="Eliminar esta llave"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {isMasked && (
                          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono pl-14 flex items-center gap-1 font-bold">
                            ✓ Llave activa en el servidor (termina en ...{keyVal.slice(-4)})
                          </p>
                        )}
                        {isNewValid && (
                          <p className="text-[10px] text-blue-600 dark:text-blue-400 font-mono pl-14 flex items-center gap-1 font-bold">
                            ✓ Nueva clave ingresada. Haz clic en "COMMIT META CONFIG" para guardar.
                          </p>
                        )}
                        {isInvalidFormat && (
                          <p className="text-[10px] text-red-600 font-mono pl-14 flex items-center gap-1">
                            ⚠️ La clave ingresada es muy corta (menos de 15 caracteres). Copia la clave completa desde Google AI Studio.
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleAddKey}
                  className="w-full h-9 rounded-xl border border-dashed border-[#7A1F2B]/40 hover:bg-[#7A1F2B]/10 text-[#7A1F2B] text-xs font-bold font-mono flex items-center justify-center gap-1.5 transition-colors cursor-pointer mt-1"
                >
                  <PlusCircle className="h-4 w-4 text-[#7A1F2B]" /> + AGREGAR OTRA API KEY (OTRO CORREO)
                </button>

                <p className="text-[10px] text-[#64748B] leading-tight pt-1">
                  💡 <strong>Cada Llave API te da 1.500 msgs/día.</strong> Agrega las llaves que quieras de otros correos de Google para tener 3.000, 4.500 o más mensajes diarios gratis.
                </p>

                {/* MONITOR DE USO EN TIEMPO REAL */}
                {(() => {
                  const validKeys = geminiKeys.filter(k => k.trim().length > 0);
                  const keysCount = validKeys.length;
                  const totalCapacity = keysCount * 1500;
                  const usedToday = wa.geminiRequestsToday || 0;
                  const remainingToday = Math.max(0, totalCapacity - usedToday);
                  const percentageUsed = totalCapacity > 0 ? Math.min(100, Math.round((usedToday / totalCapacity) * 100)) : 0;

                  return (
                    <div className="p-3 rounded-xl bg-[#F6F7F9]/80 border border-[#E2E8F0] space-y-2 mt-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-[#334155] font-bold flex items-center gap-1.5">
                          <Activity className="h-3.5 w-3.5 text-[#7A1F2B] animate-pulse" />
                          Uso de IA Hoy:
                        </span>
                        <span className="text-[#7A1F2B] font-extrabold">
                          {keysCount > 0 ? `${usedToday.toLocaleString('de-DE')} / ${totalCapacity.toLocaleString('de-DE')} sol.` : '0 / 0 sol.'}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-2 rounded-full bg-[#E2E8F0] overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-500 ${
                            percentageUsed > 85 ? 'bg-red-500' : percentageUsed > 60 ? 'bg-amber-500' : 'bg-[#7A1F2B]'
                          }`}
                          style={{ width: `${keysCount > 0 ? Math.max(3, percentageUsed) : 0}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-[#64748B] font-mono">
                        <span>{keysCount} Llave(s) activa(s)</span>
                        <span className="text-[#7A1F2B] font-bold">
                          {keysCount > 0 ? `${remainingToday.toLocaleString('de-DE')} disponibles hoy` : 'Sin llaves de Gemini'}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>


            </div>
            
            <div className="p-4 bg-[#F6F7F9]/30 border-t border-[#E5E7EB]">
              <button onClick={saveWhatsapp} disabled={savingWa} className="w-full h-10 flex items-center justify-center gap-2 bg-[#7A1F2B]/10 hover:bg-[#7A1F2B]/20 text-[#7A1F2B] border border-[#7A1F2B]/30 font-mono font-bold rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer">
                {savingWa ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" /> COMMIT META CONFIG</>}
              </button>
            </div>
          </motion.div>


          {/* Deploy Config */}
          <motion.div variants={itemVariants} className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden flex flex-col md:col-span-2 lg:col-span-1">
            <div className="p-4 border-b border-[#E5E7EB] bg-[#F6F7F9]/50 flex items-center gap-3">
              <div className="p-2 bg-[#F1F5F9] rounded-lg text-[#64748B]">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[#0F172A] uppercase tracking-widest">Deploy & Impresoras</h2>
                <p className="text-[10px] font-mono text-[#64748B]">Producción e integraciones locales</p>
              </div>
            </div>
            
            <div className="p-6 space-y-4 flex-1 text-xs text-[#64748B] leading-relaxed">
              <p>
                <strong className="text-[#0F172A] font-bold uppercase tracking-wider text-[10px] block mb-0.5">Frontend (Vite + React)</strong>
                Desplegado en la nube. Compatible con WebUSB.
              </p>
              <p>
                <strong className="text-[#0F172A] font-bold uppercase tracking-wider text-[10px] block mb-0.5">Servidor e Impresora Local</strong>
                Para imprimir de forma directa por IP local, el servidor API debe correr dentro de la misma red WiFi local.
              </p>
              <p>
                <strong className="text-[#0F172A] font-bold uppercase tracking-wider text-[10px] block mb-0.5">Alternativa Híbrida (WebUSB)</strong>
                Puedes usar la impresora directamente conectada a cualquier computador sin importar si el backend está en la nube.
              </p>
            </div>
          </motion.div>
        </div>

      </motion.div>
    </div>
  )
}
