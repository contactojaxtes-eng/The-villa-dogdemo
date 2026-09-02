import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { ChevronDown, ChevronUp, Check } from "lucide-react"
import { cn } from "@/lib/utils"
const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value
const SelectTrigger = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger ref={ref}
      className={cn("flex h-10 w-full items-center justify-between whitespace-nowrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)] shadow-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 focus:shadow-sm disabled:opacity-50 cursor-pointer transition-all duration-200", className)}
      {...props}>{children}<SelectPrimitive.Icon asChild><ChevronDown className="h-4 w-4 opacity-50" /></SelectPrimitive.Icon></SelectPrimitive.Trigger>
  )
)
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName
const SelectContent = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Content>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(
  ({ className, children, position = "popper", ...props }, ref) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content ref={ref} className={cn("relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)] shadow-xl p-1", className)} position={position} {...props}>
        <SelectPrimitive.ScrollUpButton className="flex items-center justify-center h-6 bg-[var(--bg-panel)] text-[var(--text-primary)] cursor-default"><ChevronUp className="h-4 w-4" /></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex items-center justify-center h-6 bg-[var(--bg-panel)] text-[var(--text-primary)] cursor-default"><ChevronDown className="h-4 w-4" /></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
)
SelectContent.displayName = SelectPrimitive.Content.displayName
const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item ref={ref}
      className={cn("relative flex w-full cursor-pointer select-none items-center rounded-lg py-2 pl-3 pr-8 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] data-[disabled]:opacity-50 transition-colors duration-150", className)} {...props}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center"><SelectPrimitive.ItemIndicator><Check className="h-4 w-4 text-[var(--accent)]" /></SelectPrimitive.ItemIndicator></span>
    </SelectPrimitive.Item>
  )
)
SelectItem.displayName = SelectPrimitive.Item.displayName
export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem }
