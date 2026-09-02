import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} ref={ref}
      className={cn('flex h-10 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] transition-all duration-200 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 focus:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed', className)}
      {...props} />
  )
)
Input.displayName = 'Input'
export { Input }
