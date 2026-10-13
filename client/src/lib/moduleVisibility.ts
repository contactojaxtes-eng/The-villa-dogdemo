import { api } from './api'
import { accessTokenMatchesSite, DEFAULT_SITE_ID } from './multisite'
import { getHiddenModules, saveHiddenModules } from './navigation'

export interface ModuleVisibilityResponse {
  hiddenModules: string[]
  configured: boolean
}

/**
 * Sincroniza una sola vez al crear/cambiar la sesión. Si la sede principal
 * todavía no tiene configuración en servidor, conserva la preferencia local
 * histórica hasta que un administrador la guarde desde Configuración.
 */
export async function syncModuleVisibility(siteId?: string | null) {
  const resolvedSiteId = siteId || DEFAULT_SITE_ID
  if (!accessTokenMatchesSite(api.getToken(), resolvedSiteId)) {
    return getHiddenModules(resolvedSiteId)
  }
  try {
    const setting = await api.get<ModuleVisibilityResponse>(
      '/site-settings/module-visibility',
      { force: true, ttlMs: 0 },
    )
    return setting.configured
      ? saveHiddenModules(setting.hiddenModules, resolvedSiteId)
      : getHiddenModules(resolvedSiteId)
  } catch {
    return getHiddenModules(resolvedSiteId)
  }
}
