import Swal from 'sweetalert2'
import { toast } from 'sonner'

const isDark = () => document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')

const getSwalOptions = () => {
  return {
    target: document.body,
    heightAuto: false,
    returnFocus: false,
    background: isDark() ? '#1C1C1E' : '#FFFFFF',
    color: isDark() ? '#FFFFFF' : '#1C1C1E',
    customClass: {
      container: '!z-[999999] pointer-events-auto',
      popup: 'rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl p-6 font-sans',
      title: 'antifont text-xl font-bold tracking-wider text-[var(--text-primary)]',
      htmlContainer: 'text-sm text-[var(--text-secondary)]',
      confirmButton: 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold px-6 py-2.5 rounded-xl shadow-md transition-all cursor-pointer mx-2 border-0 outline-none',
      cancelButton: 'bg-neutral-600 hover:bg-neutral-700 text-white rounded-xl font-bold px-6 py-2.5 text-sm cursor-pointer mx-2 border-0 outline-none',
    },
    buttonsStyling: false,
  }
}

export const alerts = {
  toast(title: string) {
    if (localStorage.getItem('the_villa_dog_mute_notifications') === 'true') return
    return toast(title)
  },
  async warning(title: string, text?: string) {
    return Swal.fire({ ...getSwalOptions(), icon: 'warning', title, text, confirmButtonText: 'Aceptar' })
  },
  async success(title: string, text?: string) {
    return Swal.fire({
      ...getSwalOptions(),
      icon: 'success',
      title,
      text,
      confirmButtonText: 'Aceptar',
    })
  },
  async error(title: string, text?: string) {
    return Swal.fire({
      ...getSwalOptions(),
      icon: 'error',
      title,
      text,
      confirmButtonText: 'Aceptar',
    })
  },
  async info(title: string, text?: string) {
    return Swal.fire({
      ...getSwalOptions(),
      icon: 'info',
      title,
      text,
      confirmButtonText: 'Aceptar',
    })
  },
  async confirm(title: string, text?: string, confirmText = 'Confirmar', cancelText = 'Cancelar', icon: 'question' | 'warning' | 'info' = 'question') {
    const result = await Swal.fire({
      ...getSwalOptions(),
      icon,
      title,
      text,
      showCancelButton: true,
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      reverseButtons: true,
    })
    return result.isConfirmed
  },
  async prompt(title: string, text?: string, inputValue = '', placeholder = '') {
    const result = await Swal.fire({
      ...getSwalOptions(),
      title,
      text,
      input: 'text',
      inputValue,
      inputPlaceholder: placeholder,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      inputValidator: (val) => {
        if (!val || !val.trim()) {
          return 'Debes ingresar un texto válido'
        }
        return null
      },
    })
    return result.isConfirmed ? (result.value as string)?.trim() : null
  },
  async rejectedPaymentAlert(data: {
    title?: string
    tableLabel: string
    orderNumber: number | string
    reason: string
    waiterName?: string
    amount?: string | number
    onAction?: () => void
  }) {
    const isDarkTheme = isDark()
    const result = await Swal.fire({
      ...getSwalOptions(),
      icon: 'warning',
      title: data.title || '⚠️ Pedido / Cobro Rechazado',
      html: `
        <div style="text-align: left; font-size: 14px; line-height: 1.6; margin-top: 8px;">
          <div style="font-size: 16px; margin-bottom: 8px;">
            <strong>Mesa:</strong> <span style="color: #ef4444; font-weight: 800;">${data.tableLabel}</span> &nbsp;•&nbsp; 
            <strong>Pedido:</strong> <span style="font-weight: 800;">#${data.orderNumber}</span>
          </div>
          ${data.waiterName ? `
            <div style="margin-bottom: 8px; color: ${isDarkTheme ? '#cbd5e1' : '#475569'};">
              <strong>Mesera / Responsable:</strong> <span style="font-weight: 700;">${data.waiterName}</span>
            </div>
          ` : ''}
          <div style="background: rgba(239, 68, 68, 0.12); border-left: 4px solid #ef4444; padding: 12px 14px; border-radius: 8px; margin: 12px 0;">
            <div style="color: #ef4444; font-size: 11px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px; margin-bottom: 4px;">
              Motivo:
            </div>
            <div style="font-size: 14px; font-weight: 700; color: ${isDarkTheme ? '#fca5a5' : '#b91c1c'}; font-style: italic;">
              "${data.reason || 'Sin motivo especificado'}"
            </div>
          </div>
          <p style="font-size: 12px; opacity: 0.8; margin-top: 6px;">
            Este pedido se encuentra en el filtro de <strong>Rechazados</strong> de Validación de Pagos con opción de Validar / Aceptar.
          </p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Ir a Validar / Aceptar',
      cancelButtonText: 'Cerrar',
      customClass: {
        ...getSwalOptions().customClass,
        confirmButton: 'bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-2.5 rounded-xl shadow-md transition-all cursor-pointer mx-2 border-0 outline-none',
      },
    })

    if (result.isConfirmed) {
      if (data.onAction) {
        data.onAction()
      } else {
        window.location.href = '/payment-validation'
      }
    }
    return result.isConfirmed
  }
}

