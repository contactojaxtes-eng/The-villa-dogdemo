import React, { useState, useRef, useEffect } from 'react'
import { Search, ChevronDown, Check, X } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

export interface Option {
  id?: string
  name?: string
  value?: string
  label?: string
  price?: number
  code?: string | null
}

export interface SearchableSelectProps {
  options: Option[]
  value: string
  onValueChange?: (value: string) => void
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  onChange,
  placeholder = 'Buscar por nombre o código...',
  className = ''
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const getItemId = (o: Option): string => o.id || o.value || ''
  const getItemName = (o: Option): string => o.name || o.label || ''

  const selectedOption = options.find(o => getItemId(o) === value)

  // Synchronize query with selectedOption when not actively typing/focused
  useEffect(() => {
    if (selectedOption) {
      setQuery(getItemName(selectedOption))
    } else {
      setQuery('')
    }
  }, [value, selectedOption])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        if (selectedOption) {
          setQuery(getItemName(selectedOption))
        } else {
          setQuery('')
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [selectedOption])

  const handleSelect = (option: Option) => {
    const optId = getItemId(option)
    if (onValueChange) onValueChange(optId)
    if (onChange) onChange(optId)
    setQuery(getItemName(option))
    setIsOpen(false)
  }

  const filteredOptions = options.filter(o => {
    const q = query.toLowerCase().trim()
    if (!q || (selectedOption && getItemName(selectedOption).toLowerCase().trim() === q)) return true
    const nameStr = getItemName(o)
    return (
      nameStr.toLowerCase().includes(q) ||
      (o.code && o.code.toLowerCase().includes(q))
    )
  })

  return (
    <div className={`relative w-full ${isOpen ? 'z-[90]' : 'z-10'} ${className}`} ref={containerRef}>
      <div className="relative flex items-center">
        <Search className="absolute left-3 h-3.5 w-3.5 text-[var(--text-muted)] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => {
            setIsOpen(true)
            if (selectedOption && query === getItemName(selectedOption)) {
              // Select text on focus so user can immediately type to replace
              inputRef.current?.select()
            }
          }}
          onChange={e => {
            setQuery(e.target.value)
            setIsOpen(true)
            if (!e.target.value && value) {
              if (onValueChange) onValueChange('')
              if (onChange) onChange('')
            }
          }}
          placeholder={placeholder}
          className="w-full h-9 pl-8 pr-8 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:border-[var(--accent)]/50 focus:border-[var(--accent)] rounded-xl text-xs font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-all outline-none shadow-sm focus:ring-2 focus:ring-[var(--accent)]/20"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              if (onValueChange) onValueChange('')
              if (onChange) onChange('')
              setIsOpen(true)
              inputRef.current?.focus()
            }}
            className="absolute right-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className={`absolute right-2.5 h-4 w-4 text-[var(--text-muted)] pointer-events-none transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-[var(--bg-panel)] border border-[var(--border-default)] rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
          <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <div className="py-3 text-center text-xs text-[var(--text-muted)] font-medium">
                No se encontraron productos coincidentes
              </div>
            ) : (
              filteredOptions.map(option => {
                const optId = getItemId(option)
                const optName = getItemName(option)
                const isSelected = optId === value
                return (
                  <button
                    key={optId}
                    type="button"
                    onClick={() => handleSelect(option)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--accent)] text-[var(--accent-fg)] font-bold shadow-sm'
                        : 'text-[var(--text-primary)] hover:bg-[var(--accent-muted)]/60 font-medium'
                    }`}
                  >
                    <div className="truncate pr-2 flex items-center gap-1.5">
                      <span>{optName}</span>
                      {option.code && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${isSelected ? 'bg-white/20 text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'}`}>
                          {option.code}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {option.price !== undefined && (
                        <span className={`font-black ${isSelected ? 'text-white' : 'text-[var(--accent)]'}`}>
                          {formatCurrency(option.price)}
                        </span>
                      )}
                      {isSelected && <Check className="h-4 w-4 ml-1" />}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
