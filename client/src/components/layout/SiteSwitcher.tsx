import { Building2, ChevronDown, LoaderCircle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type SiteSwitcherProps = {
  compact?: boolean
  className?: string
}

export function SiteSwitcher({ compact = false, className }: SiteSwitcherProps) {
  const { activeSite, sites, switchSite, switchingSite } = useAuth()
  if (!activeSite) return null
  const handleChange = (siteId: string) => {
    void switchSite(siteId).catch((error: any) => {
      toast.error('No se pudo cambiar de sede', {
        description: error?.message || 'Verifica tu acceso e inténtalo nuevamente.',
      })
    })
  }
  const siteLabel = (site: NonNullable<typeof activeSite>) => `${site.name}${site.preparationMode ? ' · Preparación' : ''}`

  if (compact) {
    if (sites.length <= 1) {
      return (
        <div
          className={cn('flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--accent)]', className)}
          title={siteLabel(activeSite)}
        >
          <Building2 className="h-4 w-4" />
        </div>
      )
    }
    return (
      <label className={cn('relative flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--accent)]', className)} title={`Sede: ${siteLabel(activeSite)}`}>
        {switchingSite ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
        <select
          aria-label="Cambiar sede"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={activeSite.id}
          disabled={switchingSite}
          onChange={event => handleChange(event.target.value)}
        >
          {sites.map(site => <option key={site.id} value={site.id}>{siteLabel(site)}</option>)}
        </select>
      </label>
    )
  }

  return (
    <div className={cn('relative', className)}>
      <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--accent)]" />
      <select
        aria-label="Sede activa"
        value={activeSite.id}
        disabled={switchingSite || sites.length <= 1}
        onChange={event => handleChange(event.target.value)}
        className="h-11 w-full appearance-none rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 pl-9 pr-8 text-left text-xs font-bold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-default"
      >
        {sites.map(site => <option key={site.id} value={site.id}>{siteLabel(site)}</option>)}
      </select>
      {switchingSite
        ? <LoaderCircle className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--accent)]" />
        : sites.length > 1 && <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />}
      <p className="mt-1 truncate px-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {activeSite.organizationName}
      </p>
    </div>
  )
}
