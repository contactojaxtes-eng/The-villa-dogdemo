import React from 'react'
import { Input } from '@/components/ui/input'
import { formatThousandsInput } from '@/lib/utils'
import { cn } from '@/lib/utils'

export interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  className?: string;
  prefixSymbol?: boolean;
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, className, prefixSymbol = false, placeholder = '0', ...props }, ref) => {
    const displayValue = formatThousandsInput(value);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawDigits = e.target.value.replace(/\D/g, '');
      onChange(rawDigits);
    };

    return (
      <div className="relative flex items-center w-full">
        {prefixSymbol && (
          <span className="absolute left-3 text-xs font-bold text-[var(--text-secondary)] pointer-events-none select-none">
            $
          </span>
        )}
        <Input
          {...props}
          ref={ref}
          type="text"
          inputMode="numeric"
          value={displayValue}
          onChange={handleChange}
          placeholder={placeholder}
          className={cn(
            prefixSymbol && 'pl-7',
            className
          )}
        />
      </div>
    );
  }
);
CurrencyInput.displayName = 'CurrencyInput';
