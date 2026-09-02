import * as React from "react"
import { cn } from "@/lib/utils"
const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref}
      className={cn("flex min-h-[60px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] transition-all duration-200 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 focus:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed", className)}
      {...props} />
  )
)
Textarea.displayName = "Textarea"
export { Textarea }
