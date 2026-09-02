export const brand = {
  name: 'THE VILLA DOG',
  slogan: 'Sabor Auténtico',
  product: 'Sistema de Gestión de Domicilios',
  colors: {
    limaMoss: '#90BF50',
    white: '#FFFFFF',
    black: '#000000',
    ink: '#0D0D0D',
    panel: '#1A1A1A',
    panelSoft: '#2A2A2A',
    border: '#333333',
    muted: '#999999',
    danger: '#EF4444',
  },
  typography: {
    logo: 'Logotipo exclusivo del manual',
    slogan: 'Comfortaa',
    display: 'Anton',
    texture: 'Panton Rust Heavy Grunge Shadow',
  },
  protection: {
    grid: '18x23',
    rule: 'Mantener área libre alrededor del logo y no deformarlo, rotarlo, sombrearlo, degradarlo ni cambiar sus colores.',
  },
  contact: {
    instagram: '@thevilladog',
    phones: [''],
  },
} as const

export const statusOrder = ['PENDING', 'READY', 'IN_ROUTE', 'DELIVERED', 'CANCELLED'] as const

export const statusAccent: Record<string, string> = {
  PENDING: '#F59E0B',
  PREPARING: '#3B82F6',
  READY: '#10B981',
  IN_ROUTE: '#8B5CF6',
  DELIVERED: brand.colors.limaMoss,
  CANCELLED: brand.colors.danger,
}
