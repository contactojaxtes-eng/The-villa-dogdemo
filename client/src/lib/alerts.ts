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
  }
}

