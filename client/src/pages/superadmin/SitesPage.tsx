import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Building2, CheckCircle2, Loader2, MapPin, MessageCircle, Pencil, Plus, Power, PowerOff, Settings, ShieldCheck, Users } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { alerts } from '@/lib/alerts'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'

type SiteRecord = {
  id: string
  code: string
  name: string
  timezone: string
  address?: string | null
  phone?: string | null
  active: boolean
  isDefault: boolean
  memberCount: number
  status: 'PRINCIPAL' | 'ACTIVE' | 'DRAFT'
  canActivate: boolean
  activationBlockedReason?: string | null
  readiness?: {
    completed: number
    total: number
    configurationReady: boolean
    checks: Array<{ key: string; label: string; ready: boolean }>
  }
  whatsapp?: {
    configured: boolean
    active: boolean
    phoneNumberId: string
    businessAccountId?: string | null
    displayPhoneNumber?: string | null
    accessTokenEnvKey: string
    verifyTokenEnvKey: string
  } | null
}

type SiteMember = {
  id: string
  name: string
  email: string
  role: string
  siteRole: string
  member: boolean
}

const emptyForm = {
  name: '',
  code: '',
  address: '',
  phone: '',
  timezone: 'America/Bogota',
}

const emptyWhatsAppForm = {
  phoneNumberId: '',
  businessAccountId: '',
  displayPhoneNumber: '',
  accessTokenEnvKey: '',
  verifyTokenEnvKey: '',
}

const errorMessage = (error: unknown) => error instanceof Error
  ? error.message
  : 'No se pudo completar la operación.'

export default function SitesPage() {
  const navigate = useNavigate()
  const { activeSite, switchSite, user } = useAuth()
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingSite, setEditingSite] = useState<SiteRecord | null>(null)
  const [memberSite, setMemberSite] = useState<SiteRecord | null>(null)
  const [members, setMembers] = useState<SiteMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null)
  const [switchingToSiteId, setSwitchingToSiteId] = useState<string | null>(null)
  const [whatsappSite, setWhatsappSite] = useState<SiteRecord | null>(null)
  const [whatsappForm, setWhatsappForm] = useState(emptyWhatsAppForm)
  const [savingWhatsapp, setSavingWhatsapp] = useState(false)
  const [activatingSiteId, setActivatingSiteId] = useState<string | null>(null)
  const [deactivatingSiteId, setDeactivatingSiteId] = useState<string | null>(null)

  const loadSites = useCallback(async () => {
    setLoading(true)
    try {
      setSites(await api.get<SiteRecord[]>('/superadmin/sites', { force: true }))
    } catch (error) {
      alerts.error('No se pudieron cargar las sedes', errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSites()
  }, [loadSites])

  const saveSite = async () => {
    if (form.name.trim().length < 2) {
      alerts.warning('Nombre requerido', 'Escribe un nombre claro para la nueva sede.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        ...(form.code.trim() ? { code: form.code.trim().toLowerCase() } : {}),
        ...(form.address.trim() ? { address: form.address.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        timezone: form.timezone.trim() || 'America/Bogota',
      }
      if (editingSite) await api.put<SiteRecord>(`/superadmin/sites/${editingSite.id}`, payload)
      else await api.post<SiteRecord>('/superadmin/sites', payload)
      setDialogOpen(false)
      setForm(emptyForm)
      setEditingSite(null)
      await loadSites()
      alerts.success(editingSite ? 'Sede actualizada' : 'Sede preparada', editingSite ? 'Los datos generales quedaron guardados.' : 'Se creó inactiva. Todavía no recibe pedidos, chats ni operaciones.')
    } catch (error) {
      alerts.error('No se pudo crear la sede', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const openCreateSite = () => {
    setEditingSite(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  const openEditSite = (site: SiteRecord) => {
    setEditingSite(site)
    setForm({
      name: site.name,
      code: site.code,
      address: site.address || '',
      phone: site.phone || '',
      timezone: site.timezone || 'America/Bogota',
    })
    setDialogOpen(true)
  }

  const openMembers = async (site: SiteRecord) => {
    setMemberSite(site)
    setMembers([])
    setLoadingMembers(true)
    try {
      setMembers(await api.get<SiteMember[]>(`/superadmin/sites/${site.id}/members`, { force: true }))
    } catch (error) {
      alerts.error('No se pudieron cargar los usuarios', errorMessage(error))
      setMemberSite(null)
    } finally {
      setLoadingMembers(false)
    }
  }

  const toggleMember = async (member: SiteMember) => {
    if (!memberSite) return
    setUpdatingMemberId(member.id)
    try {
      const nextMember = !member.member
      await api.put(`/superadmin/sites/${memberSite.id}/members/${member.id}`, {
        active: nextMember,
        role: member.siteRole || member.role,
      })
      setMembers(current => current.map(item => item.id === member.id
        ? { ...item, member: nextMember }
        : item))
      await loadSites()
    } catch (error) {
      alerts.error('No se pudo actualizar el acceso', errorMessage(error))
    } finally {
      setUpdatingMemberId(null)
    }
  }

  const enterSiteSetup = async (site: SiteRecord) => {
    setSwitchingToSiteId(site.id)
    try {
      if (activeSite?.id !== site.id) await switchSite(site.id)
      navigate('/settings/modules')
    } catch (error) {
      alerts.error('No se pudo abrir la sede', errorMessage(error))
    } finally {
      setSwitchingToSiteId(null)
    }
  }

  const enterSiteUsers = async (site: SiteRecord) => {
    setSwitchingToSiteId(site.id)
    try {
      if (activeSite?.id !== site.id) await switchSite(site.id)
      setMemberSite(null)
      navigate('/users')
    } catch (error) {
      alerts.error('No se pudo abrir los usuarios de la sede', errorMessage(error))
    } finally {
      setSwitchingToSiteId(null)
    }
  }

  const enterTechnicalSetup = async (site: SiteRecord) => {
    setSwitchingToSiteId(site.id)
    try {
      if (activeSite?.id !== site.id) await switchSite(site.id)
      navigate('/superadmin/config')
    } catch (error) {
      alerts.error('No se pudo abrir la configuración técnica', errorMessage(error))
    } finally {
      setSwitchingToSiteId(null)
    }
  }

  const openWhatsApp = (site: SiteRecord) => {
    const prefix = site.code.replace(/[^a-z0-9]/gi, '_').toUpperCase()
    setWhatsappSite(site)
    setWhatsappForm({
      phoneNumberId: site.whatsapp?.phoneNumberId || '',
      businessAccountId: site.whatsapp?.businessAccountId || '',
      displayPhoneNumber: site.whatsapp?.displayPhoneNumber || '',
      accessTokenEnvKey: site.whatsapp?.accessTokenEnvKey || `WHATSAPP_ACCESS_TOKEN_${prefix}`,
      verifyTokenEnvKey: site.whatsapp?.verifyTokenEnvKey || `WHATSAPP_VERIFY_TOKEN_${prefix}`,
    })
  }

  const saveWhatsApp = async () => {
    if (!whatsappSite) return
    if (!whatsappForm.phoneNumberId.trim() || !whatsappForm.accessTokenEnvKey.trim() || !whatsappForm.verifyTokenEnvKey.trim()) {
      alerts.warning('Datos incompletos', 'Escribe el Phone Number ID y los nombres de las dos variables de Railway.')
      return
    }
    setSavingWhatsapp(true)
    try {
      await api.put(`/superadmin/sites/${whatsappSite.id}/whatsapp-account`, {
        phoneNumberId: whatsappForm.phoneNumberId.trim(),
        ...(whatsappForm.businessAccountId.trim() ? { businessAccountId: whatsappForm.businessAccountId.trim() } : {}),
        ...(whatsappForm.displayPhoneNumber.trim() ? { displayPhoneNumber: whatsappForm.displayPhoneNumber.trim() } : {}),
        accessTokenEnvKey: whatsappForm.accessTokenEnvKey.trim().toUpperCase(),
        verifyTokenEnvKey: whatsappForm.verifyTokenEnvKey.trim().toUpperCase(),
      })
      setWhatsappSite(null)
      await loadSites()
      alerts.success('WhatsApp vinculado', 'Solo se guardaron identificadores y nombres de variables. La cuenta permanece apagada mientras la sede esté en preparación.')
    } catch (error) {
      alerts.error('No se pudo vincular WhatsApp', errorMessage(error))
    } finally {
      setSavingWhatsapp(false)
    }
  }

  const activateSite = async (site: SiteRecord) => {
    const acknowledged = await alerts.confirm(
      `Activar ${site.name}`,
      'La sede empezará a aceptar operaciones y su WhatsApp propio quedará encendido. Verifica antes el aislamiento de pedidos, chats, impresión y usuarios.',
      'Continuar',
      'Cancelar',
      'warning',
    )
    if (!acknowledged) return

    const confirmationCode = await alerts.prompt(
      'Confirmación final',
      `Escribe exactamente el código ${site.code} para activar únicamente esta sede.`,
      '',
      site.code,
    )
    if (!confirmationCode) return
    if (confirmationCode.trim().toLowerCase() !== site.code.toLowerCase()) {
      await alerts.warning('Código incorrecto', 'No se activó ninguna sede.')
      return
    }

    setActivatingSiteId(site.id)
    let activationCompleted = false
    try {
      await api.post<SiteRecord>(`/superadmin/sites/${site.id}/activate`, {
        confirmationCode,
        acknowledgeIsolation: true,
      })
      activationCompleted = true

      // Un JWT emitido durante la preparación conserva ese modo hasta renovar
      // la sesión. Volvemos a la principal para evitar operar con un token viejo.
      if (activeSite?.id === site.id) {
        const principal = sites.find(candidate => candidate.isDefault)
        if (principal) await switchSite(principal.id)
        navigate('/superadmin/sites')
      }

      await loadSites()
      await alerts.success('Sede activada', `${site.name} ya puede operar con sus datos y su WhatsApp propios.`)
    } catch (error) {
      await alerts.error(
        activationCompleted ? 'La sede se activó, pero debes renovar la sesión' : 'No se activó la sede',
        activationCompleted
          ? 'Vuelve a iniciar sesión antes de entrar a la sede.'
          : errorMessage(error),
      )
    } finally {
      setActivatingSiteId(null)
    }
  }

  const deactivateSite = async (site: SiteRecord) => {
    const acknowledged = await alerts.confirm(
      `Pausar ${site.name}`,
      'La sede dejará de recibir operaciones, su WhatsApp se apagará y sus usuarios conectados saldrán del tiempo real. Los pedidos, configuraciones y usuarios se conservan. La sede principal seguirá funcionando.',
      'Continuar',
      'Cancelar',
      'warning',
    )
    if (!acknowledged) return

    const confirmationCode = await alerts.prompt(
      'Confirmación final',
      `Escribe exactamente el código ${site.code} para pausar únicamente esta sede.`,
      '',
      site.code,
    )
    if (!confirmationCode) return
    if (confirmationCode.trim().toLowerCase() !== site.code.toLowerCase()) {
      await alerts.warning('Código incorrecto', 'No se pausó ninguna sede.')
      return
    }

    setDeactivatingSiteId(site.id)
    try {
      await api.post<SiteRecord>(`/superadmin/sites/${site.id}/deactivate`, {
        confirmationCode,
        acknowledgePause: true,
      })

      if (activeSite?.id === site.id) {
        const principal = sites.find(candidate => candidate.isDefault)
        if (principal) await switchSite(principal.id)
        navigate('/superadmin/sites')
      }

      await loadSites()
      await alerts.success('Sede pausada', `${site.name} volvió a preparación. Sus datos se conservaron y la sede principal no fue modificada.`)
    } catch (error) {
      await alerts.error('No se pudo pausar la sede', errorMessage(error))
    } finally {
      setDeactivatingSiteId(null)
    }
  }

  return (
    <div className="mx-auto max-w-[1450px] space-y-5">
      <header className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <Link to={activeSite?.preparationMode ? '/superadmin/sites' : '/superadmin'} className="mb-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--accent)]">
                <ArrowLeft className="h-3 w-3" /> {activeSite?.preparationMode ? 'Administración de sedes' : 'Panel'}
              </Link>
              <h1 className="text-2xl font-black text-[var(--text-primary)]">Sedes</h1>
              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                Prepara cada local de forma aislada antes de permitirle operar.
              </p>
            </div>
          </div>
          <Button onClick={openCreateSite}>
            <Plus className="mr-2 h-4 w-4" /> Preparar nueva sede
          </Button>
        </div>
      </header>

      <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-xs leading-5 text-[var(--text-secondary)]">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div>
            <p className="font-black text-[var(--text-primary)]">Protección de la sede principal</p>
            <p className="mt-1">Una nueva sede queda en preparación. El administrador general y el SuperAdmin pueden abrirla para configurarla; no recibe pedidos, chats, impresión ni tiempo real. La activación se habilitará después de las pruebas de aislamiento.</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-52 items-center justify-center rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-muted)]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando sedes…
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sites.map(site => (
            <article key={site.id} className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-black text-[var(--text-primary)]">{site.name}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${site.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-700'}`}>
                      {site.isDefault ? 'PRINCIPAL ACTIVA' : site.active ? 'SEDE ACTIVA' : 'EN PREPARACIÓN'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-[var(--text-muted)]">Código: {site.code}</p>
                </div>
                {site.isDefault
                  ? <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
                  : <Building2 className="h-6 w-6 shrink-0 text-amber-600" />}
              </div>
              <div className="mt-5 grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                  <p className="font-bold text-[var(--text-muted)]">Dirección</p>
                  <p className="mt-1 font-black text-[var(--text-primary)]">{site.address || 'Pendiente de configurar'}</p>
                </div>
                <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
                  <p className="font-bold text-[var(--text-muted)]">Usuarios vinculados</p>
                  <p className="mt-1 font-black text-[var(--text-primary)]">{site.memberCount}</p>
                </div>
                <div className="rounded-xl bg-[var(--bg-elevated)] p-3 sm:col-span-2">
                  <p className="flex items-center gap-1 font-bold text-[var(--text-muted)]"><MapPin className="h-3.5 w-3.5" /> Zona horaria</p>
                  <p className="mt-1 font-black text-[var(--text-primary)]">{site.timezone}</p>
                </div>
              </div>
              {!site.isDefault && site.readiness && (
                <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black text-[var(--text-primary)]">Preparación operativa</p>
                    <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-black text-amber-700">
                      {site.readiness.completed}/{site.readiness.total}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {site.readiness.checks.map(check => (
                      <div key={check.key} className="flex items-center gap-2 text-[11px] font-bold text-[var(--text-secondary)]">
                        <CheckCircle2 className={`h-4 w-4 shrink-0 ${check.ready ? 'text-emerald-600' : 'text-[var(--text-muted)] opacity-35'}`} />
                        <span>{check.label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[10px] leading-4 text-[var(--text-muted)]">
                    Completar esta lista todavía no activa la sede. La prueba A/B con la principal sigue siendo obligatoria.
                  </p>
                  {site.activationBlockedReason && (
                    <p className="mt-2 rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[10px] font-semibold leading-4 text-blue-700 dark:text-blue-300">
                      {site.activationBlockedReason}
                    </p>
                  )}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <Button className="h-9 text-xs font-black" onClick={() => void enterSiteSetup(site)} disabled={Boolean(switchingToSiteId)}>
                      {switchingToSiteId === site.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings className="mr-2 h-4 w-4" />}
                      Configurar
                    </Button>
                    {user?.globalRole === 'SUPERADMIN' && <Button variant="outline" className="h-9 text-xs font-black" onClick={() => openWhatsApp(site)}>
                      <MessageCircle className="mr-2 h-4 w-4" /> Vincular WhatsApp
                    </Button>}
                    {user?.globalRole === 'SUPERADMIN' && <Button variant="outline" className="h-9 text-xs font-black" onClick={() => void enterTechnicalSetup(site)} disabled={Boolean(switchingToSiteId)}>
                      <ShieldCheck className="mr-2 h-4 w-4" /> IA y técnica
                    </Button>}
                    <Button variant="outline" className="h-9 text-xs font-black" onClick={() => void openMembers(site)}>
                      <Users className="mr-2 h-4 w-4" /> Usuarios
                    </Button>
                    {site.canActivate && (
                      <Button className="h-9 bg-emerald-600 text-xs font-black text-white hover:bg-emerald-700" onClick={() => void activateSite(site)} disabled={Boolean(activatingSiteId || deactivatingSiteId)}>
                        {activatingSiteId === site.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
                        Activar
                      </Button>
                    )}
                    {site.active && (
                      <Button variant="outline" className="h-9 border-amber-500/40 text-xs font-black text-amber-700 hover:bg-amber-500/10 dark:text-amber-300" onClick={() => void deactivateSite(site)} disabled={Boolean(activatingSiteId || deactivatingSiteId)}>
                        {deactivatingSiteId === site.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4" />}
                        Pausar
                      </Button>
                    )}
                  </div>
                  <Button variant="ghost" className="mt-2 h-8 w-full text-[11px] font-bold text-[var(--text-muted)]" onClick={() => openEditSite(site)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> Editar dirección, teléfono y nombre
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={open => {
        if (saving) return
        setDialogOpen(open)
        if (!open) {
          setEditingSite(null)
          setForm(emptyForm)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSite ? `Editar ${editingSite.name}` : 'Preparar nueva sede'}</DialogTitle>
            <DialogDescription>
              {editingSite ? 'Estos datos pertenecen únicamente a esta sede.' : 'Se guardará como borrador inactivo. Esto no cambia el funcionamiento de la sede principal.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="site-name">Nombre de la sede</Label>
              <Input id="site-name" className="mt-1.5" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Ejemplo: Villa Luz" />
            </div>
            <div>
              <Label htmlFor="site-code">Código opcional</Label>
              <Input id="site-code" className="mt-1.5" value={form.code} onChange={event => setForm(current => ({ ...current, code: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} placeholder="villa-luz" />
            </div>
            <div>
              <Label htmlFor="site-phone">Teléfono</Label>
              <Input id="site-phone" className="mt-1.5" value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} placeholder="Opcional" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="site-address">Dirección</Label>
              <Input id="site-address" className="mt-1.5" value={form.address} onChange={event => setForm(current => ({ ...current, address: event.target.value }))} placeholder="Dirección del nuevo local" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void saveSite()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              {editingSite ? 'Guardar datos' : 'Crear borrador seguro'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(memberSite)} onOpenChange={open => !open && !updatingMemberId && setMemberSite(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Usuarios · {memberSite?.name}</DialogTitle>
            <DialogDescription>
              Vincula cuentas existentes aquí. Para crear su administrador propio, abre Usuarios dentro de esta sede y crea una cuenta con rol ADMIN.
            </DialogDescription>
          </DialogHeader>
          {loadingMembers ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-[var(--text-muted)]">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando usuarios…
            </div>
          ) : (
            <div className="space-y-2 py-2">
              {members.map(member => (
                <div key={member.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-[var(--text-primary)]">{member.name}</p>
                    <p className="truncate text-[10px] text-[var(--text-muted)]">{member.email} · {member.siteRole}</p>
                  </div>
                  <Button
                    variant={member.member ? 'outline' : 'default'}
                    className="h-8 shrink-0 px-3 text-[10px] font-black"
                    disabled={updatingMemberId === member.id}
                    onClick={() => void toggleMember(member)}
                  >
                    {updatingMemberId === member.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : member.member ? 'Retirar' : 'Agregar'}
                  </Button>
                </div>
              ))}
              {!members.length && (
                <p className="py-8 text-center text-xs text-[var(--text-muted)]">No hay usuarios activos disponibles.</p>
              )}
            </div>
          )}
          <DialogFooter>
            {memberSite && (
              <Button onClick={() => void enterSiteUsers(memberSite)} disabled={Boolean(updatingMemberId || switchingToSiteId)}>
                {switchingToSiteId === memberSite.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Crear usuario en esta sede
              </Button>
            )}
            <Button variant="outline" onClick={() => setMemberSite(null)} disabled={Boolean(updatingMemberId)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(whatsappSite)} onOpenChange={open => !open && !savingWhatsapp && setWhatsappSite(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>WhatsApp · {whatsappSite?.name}</DialogTitle>
            <DialogDescription>
              Primero crea las dos variables en Railway. Aquí se guardan solamente sus nombres y los identificadores de Meta; nunca se guarda el token real en la base de datos.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="wa-phone-id">Phone Number ID de Meta</Label>
              <Input id="wa-phone-id" className="mt-1.5" value={whatsappForm.phoneNumberId} onChange={event => setWhatsappForm(current => ({ ...current, phoneNumberId: event.target.value.replace(/\s/g, '') }))} placeholder="Ejemplo: 123456789012345" />
            </div>
            <div>
              <Label htmlFor="wa-business-id">WhatsApp Business Account ID</Label>
              <Input id="wa-business-id" className="mt-1.5" value={whatsappForm.businessAccountId} onChange={event => setWhatsappForm(current => ({ ...current, businessAccountId: event.target.value.replace(/\s/g, '') }))} placeholder="Opcional" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="wa-display-phone">Número visible</Label>
              <Input id="wa-display-phone" className="mt-1.5" value={whatsappForm.displayPhoneNumber} onChange={event => setWhatsappForm(current => ({ ...current, displayPhoneNumber: event.target.value }))} placeholder="Ejemplo: +57 300 000 0000" />
            </div>
            <div>
              <Label htmlFor="wa-access-env">Variable del token de acceso</Label>
              <Input id="wa-access-env" className="mt-1.5 font-mono text-xs" value={whatsappForm.accessTokenEnvKey} onChange={event => setWhatsappForm(current => ({ ...current, accessTokenEnvKey: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))} />
            </div>
            <div>
              <Label htmlFor="wa-verify-env">Variable del token de verificación</Label>
              <Input id="wa-verify-env" className="mt-1.5 font-mono text-xs" value={whatsappForm.verifyTokenEnvKey} onChange={event => setWhatsappForm(current => ({ ...current, verifyTokenEnvKey: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))} />
            </div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-5 text-[var(--text-secondary)]">
            La vinculación no enciende la cuenta ni cambia el webhook. La sede seguirá aislada hasta la activación controlada.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWhatsappSite(null)} disabled={savingWhatsapp}>Cancelar</Button>
            <Button onClick={() => void saveWhatsApp()} disabled={savingWhatsapp}>
              {savingWhatsapp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Guardar vinculación segura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
