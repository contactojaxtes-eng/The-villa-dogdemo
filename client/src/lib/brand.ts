export const brand = {
  name: 'THE VILLA DOG',
  slogan: 'Comidas Rapidas',
  product: 'Sistema de Gestion de Domicilios',
  colors: {
    flameOrange: '#F97316',
    cheddar: '#FBBF24',
    ketchup: '#DC2626',
    burgundy: '#7A1F2B',
    crust: '#FDBA74',
    cream: '#FFF7ED',
    limaMoss: '#F97316',
    white: '#FFFFFF',
    black: '#000000',
    ink: '#17100D',
    panel: '#FFFFFF',
    panelSoft: '#FFF7ED',
    border: '#FED7AA',
    muted: '#7C5A45',
    danger: '#EF4444',
  },
  typography: {
    logo: 'Logotipo Villa Dog',
    slogan: 'Sistema',
    display: 'Sistema',
    texture: 'Estilo rotulo urbano',
  },
  protection: {
    grid: '18x23',
    rule: 'Mantener area libre alrededor del logo y no deformarlo, rotarlo, sombrearlo, degradarlo ni cambiar sus colores.',
  },
  contact: {
    instagram: '@thevilladog',
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
