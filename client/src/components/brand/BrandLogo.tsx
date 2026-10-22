import logoLockup from '@/assets/brand/jaxtes-logo.png'
import { brand } from '@/lib/brand'
import { cn } from '@/lib/utils'

type BrandLogoProps = {
  className?: string
  imageClassName?: string
  compact?: boolean
}

export function BrandLogo({ className, imageClassName, compact = false }: BrandLogoProps) {
  return (
    <div className={cn('inline-flex items-center gap-2.5', className)} aria-label={`${brand.name} ${brand.slogan}`}>
      <span className={cn(
        'inline-flex items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-950/5',
        compact ? 'px-2 py-1.5' : 'px-3 py-2',
      )}>
        <img
          src={logoLockup}
          alt="JAXTES"
          className={cn('h-auto w-40 object-contain select-none', compact && 'max-h-10 w-28', imageClassName)}
          draggable={false}
        />
      </span>
      {!compact && (
        <span className="rounded-full border border-[#145AEC]/20 bg-[#145AEC]/10 px-2.5 py-1 text-[10px] font-black tracking-[0.18em] text-[#145AEC]">
          DEMO
        </span>
      )}
    </div>
  )
}
