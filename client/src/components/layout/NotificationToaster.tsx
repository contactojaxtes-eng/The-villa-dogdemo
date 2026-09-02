import { Toaster } from 'sonner'
import { useNotifications } from '@/hooks/useNotifications'
import { useTheme } from '@/hooks/useTheme'

export function NotificationToaster() {
  useNotifications()
  const { theme } = useTheme()
  return (
    <Toaster
      position="top-right"
      theme={theme}
      toastOptions={{
        style: {
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-default)',
          color: 'var(--text-primary)',
        },
        classNames: {
          title: 'text-[var(--text-primary)] font-semibold',
          description: 'text-[var(--text-secondary)]',
        },
      }}
      richColors
      closeButton
    />
  )
}
