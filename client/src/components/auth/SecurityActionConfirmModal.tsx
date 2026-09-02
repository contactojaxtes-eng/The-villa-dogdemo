import { useEffect, useRef } from 'react'

interface SecurityActionConfirmModalProps {
  open: boolean
  title?: string
  description?: string
  actionName: string
  onClose: () => void
  onSuccess: () => void | Promise<void>
}

export function SecurityActionConfirmModal({
  open,
  onClose,
  onSuccess,
}: SecurityActionConfirmModalProps) {
  const running = useRef(false)
  const lastOpen = useRef(false)

  useEffect(() => {
    // Solo ejecutar cuando cambia de cerrado a abierto
    if (open && !lastOpen.current && !running.current) {
      lastOpen.current = true
      running.current = true
      Promise.resolve(onSuccess()).finally(() => {
        running.current = false
        onClose()
      })
    }
    if (!open) {
      lastOpen.current = false
    }
  }, [open])

  return null
}
