export interface PermissionAction {
  key: string;
  label: string;
  description?: string;
}

export interface PermissionModule {
  id: string;
  name: string;
  icon?: string;
  actions: PermissionAction[];
}

export const SYSTEM_MODULES_PERMISSIONS: PermissionModule[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp Chat',
    actions: [
      { key: 'whatsapp.view', label: 'Ver chats y mensajes' },
      { key: 'whatsapp.reply', label: 'Responder mensajes de texto' },
      { key: 'whatsapp.media', label: 'Enviar notas de voz y fotos' },
      { key: 'whatsapp.assign', label: 'Asignar chats a otros operadores' },
      { key: 'whatsapp.close', label: 'Cerrar / archivar conversaciones' },
      { key: 'whatsapp.bot_toggle', label: 'Activar / pausar Bot de IA' },
      { key: 'whatsapp.order_create', label: 'Crear pedido directo desde el chat' },
    ],
  },
  {
    id: 'orders',
    name: 'Pedidos & Facturas (POS)',
    actions: [
      { key: 'orders.view', label: 'Ver historial de pedidos' },
      { key: 'orders.create', label: 'Crear nuevos pedidos en POS' },
      { key: 'orders.edit', label: 'Editar productos y cantidades' },
      { key: 'orders.cancel', label: 'Anular / cancelar pedidos' },
      { key: 'orders.reprint', label: 'Reimprimir comandas y facturas' },
      { key: 'orders.discount', label: 'Aplicar descuentos o cortesías' },
      { key: 'orders.change_driver', label: 'Asignar o cambiar domiciliario' },
    ],
  },
  {
    id: 'tables',
    name: 'Mesas & Salon',
    actions: [
      { key: 'tables.view', label: 'Ver mesas abiertas' },
      { key: 'tables.create', label: 'Crear pedidos de mesa' },
      { key: 'tables.edit', label: 'Editar pedidos de mesa' },
      { key: 'tables.close', label: 'Cerrar mesas pagadas' },
      { key: 'tables.cancel', label: 'Cancelar mesas o productos' },
    ],
  },
  {
    id: 'kitchen',
    name: 'Cocina por Estaciones',
    actions: [
      { key: 'kitchen.view', label: 'Ver tablet de cocina' },
      { key: 'kitchen.prepare', label: 'Marcar pedidos en preparacion' },
      { key: 'kitchen.ready', label: 'Marcar pedidos listos' },
      { key: 'kitchen.history', label: 'Ver historial de cocina' },
      { key: 'kitchen_stations.manage', label: 'Configurar estaciones y cocineros' },
    ],
  },
  {
    id: 'payment_validation',
    name: 'Validacion de Pagos',
    actions: [
      { key: 'payment_validation.view', label: 'Ver pagos pendientes' },
      { key: 'payment_validation.cash', label: 'Validar pagos en efectivo' },
      { key: 'payment_validation.transfer', label: 'Validar transferencias' },
      { key: 'payment_validation.reject', label: 'Rechazar pagos con motivo' },
    ],
  },
  {
    id: 'dispatch',
    name: 'Despachos & Domiciliarios',
    actions: [
      { key: 'dispatch.view', label: 'Ver tablero de despachos activos' },
      { key: 'dispatch.change_status', label: 'Cambiar estado (En Ruta / Entregado)' },
      { key: 'drivers.view', label: 'Ver directorio de domiciliarios' },
      { key: 'drivers.manage', label: 'Crear / editar domiciliarios' },
      { key: 'drivers.export', label: 'Liquidar y exportar (Excel / PDF)' },
    ],
  },
  {
    id: 'customers',
    name: 'Directorio de Clientes',
    actions: [
      { key: 'customers.view', label: 'Ver lista de clientes' },
      { key: 'customers.manage', label: 'Crear y editar clientes' },
      { key: 'customers.delete', label: 'Eliminar clientes' },
      { key: 'customers.credit', label: 'Registrar abonos y créditos' },
    ],
  },
  {
    id: 'cash',
    name: 'Cajas & Turnos',
    actions: [
      { key: 'cash.view', label: 'Ver caja y arqueos' },
      { key: 'cash.open_close', label: 'Abrir y cerrar turnos de caja' },
      { key: 'cash.control', label: 'Ver control de caja y comprobantes' },
      { key: 'cash.reopen', label: 'Reabrir cajas cerradas' },
    ],
  },
  {
    id: 'products',
    name: 'Productos & Menú Digital',
    actions: [
      { key: 'products.view', label: 'Ver catálogo de productos y precios' },
      { key: 'products.manage', label: 'Crear y editar productos / precios' },
      { key: 'products.delete', label: 'Eliminar productos' },
    ],
  },
  {
    id: 'zones',
    name: 'Barrios & Tarifas',
    actions: [
      { key: 'zones.view', label: 'Ver barrios y tarifas de Montería' },
      { key: 'zones.manage', label: 'Crear y editar zonas y tarifas' },
    ],
  },
  {
    id: 'users_management',
    name: 'Usuarios & Gestión',
    actions: [
      { key: 'users.view', label: 'Ver directorio de usuarios' },
      { key: 'users.manage', label: 'Crear, editar y gestionar permisos' },
      { key: 'users.delete', label: 'Eliminar / desactivar usuarios' },
      { key: 'settings.modules', label: 'Activar y ocultar modulos del menu' },
    ],
  },
];

export const ALL_PERMISSION_KEYS: string[] = SYSTEM_MODULES_PERMISSIONS.flatMap(m =>
  m.actions.map(a => a.key)
);

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPERADMIN: ALL_PERMISSION_KEYS,
  ADMIN: ALL_PERMISSION_KEYS,
  CASHIER: [
    'orders.view',
    'orders.create',
    'orders.edit',
    'orders.reprint',
    'dispatch.view',
    'dispatch.change_status',
    'customers.view',
    'customers.manage',
    'cash.view',
    'cash.open_close',
    'tables.view',
    'tables.create',
    'tables.edit',
    'tables.close',
    'kitchen.view',
    'kitchen.prepare',
    'kitchen.ready',
    'payment_validation.view',
    'payment_validation.cash',
    'payment_validation.transfer',
    'payment_validation.reject',
    'whatsapp.view',
    'whatsapp.reply',
    'whatsapp.media',
    'whatsapp.order_create',
    'zones.view',
    'drivers.view',
  ],
  DELIVERY_MANAGER: [
    'orders.view',
    'orders.create',
    'orders.edit',
    'orders.reprint',
    'whatsapp.view',
    'whatsapp.reply',
    'whatsapp.media',
    'whatsapp.assign',
    'whatsapp.order_create',
    'zones.view',
    'customers.view',
    'customers.manage',
  ],
  DISPATCHER: [
    'orders.view',
    'orders.change_driver',
    'dispatch.view',
    'dispatch.change_status',
    'drivers.view',
    'drivers.manage',
    'drivers.export',
  ],
  WAITER: [
    'tables.view',
    'tables.create',
    'tables.edit',
    'orders.view',
    'orders.create',
    'products.view',
  ],
  KITCHEN: [
    'kitchen.view',
    'kitchen.prepare',
    'kitchen.ready',
    'kitchen.history',
  ],
};

export function getDefaultPermissionsForRole(role: string): string[] {
  return DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.CASHIER;
}

export function hasUserPermission(user: { role?: string; permissions?: any } | null | undefined, permKey: string): boolean {
  if (!user) return false;
  if (user.role === 'SUPERADMIN') return true;

  let perms = user.permissions;
  if (typeof perms === 'string') {
    try {
      perms = JSON.parse(perms);
    } catch {
      perms = null;
    }
  }

  // Si tiene permisos explícitos configurados como arreglo
  if (perms && Array.isArray(perms)) {
    if (perms.includes('*')) return true;
    return perms.includes(permKey);
  }

  // Fallback a los permisos por defecto del rol
  const defaults = getDefaultPermissionsForRole(user.role || 'CASHIER');
  return defaults.includes(permKey);
}

export const SYSTEM_ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: 'Super Administrador',
  ADMIN: 'Administrador',
  CASHIER: 'Cajero / Facturación',
  DELIVERY_MANAGER: 'Gestora de Domicilios',
  DISPATCHER: 'Despachador de Domicilios',
  WAITER: 'Mesero',
  KITCHEN: 'Cocinero',
  ACCOUNTANT: 'Contador',
  ACCOUNTING_ASSISTANT: 'Auxiliar Contable',
};

export function getRoleLabel(role?: string | null): string {
  if (!role) return '';
  return SYSTEM_ROLE_LABELS[role] || role;
}
