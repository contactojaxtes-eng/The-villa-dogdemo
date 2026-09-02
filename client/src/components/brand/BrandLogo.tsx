import logoLockup from '@/assets/brand/the-villa-dog-logo.png'
import { brand } from '@/lib/brand'
import { cn } from '@/lib/utils'

type BrandLogoProps = {
  className?: string
  imageClassName?: string
  compact?: boolean
}

export function BrandLogo({ className, imageClassName, compact = false }: BrandLogoProps) {
  return (
    <div className={cn('inline-flex items-center gap-3', className)} aria-label={`${brand.name} ${brand.slogan}`}>
      <img
        src={logoLockup}
        alt={`${brand.name} - ${brand.slogan}`}
        className={cn('h-auto w-36 object-contain select-none', compact && 'max-h-12 w-24', imageClassName)}
        draggable={false}
      />
    </div>
  )
}
