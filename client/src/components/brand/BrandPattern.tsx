import { motion } from 'framer-motion'
import { brand } from '@/lib/brand'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type BrandPatternProps = {
  className?: string
  children: ReactNode
}

export function BrandPattern({ className, children }: BrandPatternProps) {
  return (
    <div className={cn('niche-checker relative overflow-hidden', className)}>
      <motion.div
        className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full opacity-10 blur-3xl"
        style={{ backgroundColor: brand.colors.limaMoss }}
        animate={{ scale: [1, 1.15, 1], opacity: [0.08, 0.14, 0.08] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full opacity-10 blur-3xl"
        style={{ backgroundColor: brand.colors.limaMoss }}
        animate={{ scale: [1.1, 1, 1.1], opacity: [0.06, 0.12, 0.06] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}
