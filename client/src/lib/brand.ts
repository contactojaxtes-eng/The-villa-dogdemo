export const brand = {
  name: 'DEMO JAXTES',
  slogan: 'Operacion inteligente para restaurantes',
  product: 'Plataforma de gestion para restaurantes',
  colors: {
    primary: '#145AEC',
    flameOrange: '#145AEC',
    cheddar: '#FBBF24',
    ketchup: '#145AEC',
    burgundy: '#0B2D7A',
    crust: '#10C9E7',
    cream: '#F5F8FC',
    limaMoss: '#10C9E7',
    white: '#FFFFFF',
    black: '#070D1B',
    ink: '#070D1B',
    panel: '#FFFFFF',
    panelSoft: '#EFF4FA',
    border: '#D7E1ED',
    muted: '#64748B',
    danger: '#EF4444',
  },
  typography: {
    logo: 'Logotipo JAXTES',
    slogan: 'Interfaz',
    display: 'Interfaz',
    texture: 'Producto SaaS',
  },
  protection: {
    grid: '3:1',
    rule: 'Mantener area libre alrededor del logo y no deformarlo ni cambiar sus colores.',
  },
  contact: {
    instagram: '',
    phones: [''],
  },
} as const

export const statusOrder = ['PENDING', 'READY', 'IN_ROUTE', 'DELIVERED', 'CANCELLED'] as const

export const statusAccent: Record<string, string> = {
  PENDING: brand.colors.cheddar,
  PREPARING: '#3B82F6',
  READY: '#10B981',
  IN_ROUTE: '#8B5CF6',
  DELIVERED: brand.colors.flameOrange,
  CANCELLED: brand.colors.danger,
}
