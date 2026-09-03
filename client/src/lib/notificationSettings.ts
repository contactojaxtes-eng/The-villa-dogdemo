import { toast } from 'sonner'

export const NOTIFICATIONS_MUTE_KEY = 'the_villa_dog_mute_notifications'
export const WA_TOASTS_MUTE_KEY = 'niche_mute_wa_toasts'
export const SOUNDS_MUTE_KEY = 'niche_mute_sounds'

export function isNotificationsMuted(): boolean {
  return localStorage.getItem(NOTIFICATIONS_MUTE_KEY) === 'true'
}

export function toggleNotificationsMuted(): boolean {
  const next = !isNotificationsMuted()
  localStorage.setItem(NOTIFICATIONS_MUTE_KEY, String(next))
  localStorage.setItem(WA_TOASTS_MUTE_KEY, String(next))
  localStorage.setItem(SOUNDS_MUTE_KEY, String(next))

  if (next) {
    toast.dismiss()
    toast.info('🔕 Notificaciones silenciadas', {
      description: 'No se mostrarán avisos flotantes ni sonidos.',
      duration: 2500,
    })
  } else {
    toast.success('🔔 Notificaciones activadas', {
      description: 'Recibirás avisos emergentes del sistema.',
      duration: 2500,
    })
  }

  window.dispatchEvent(new Event('the-villa-dog-mute-changed'))
  window.dispatchEvent(new Event('storage'))
  return next
}
