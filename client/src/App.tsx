import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { AppLayout } from './components/layout/AppLayout'
import { getFirstAllowedPath } from './lib/navigation'
import { hasUserPermission } from './lib/permissions'
import { api } from './lib/api'
import { setCachedSessions, type CachedSession } from './lib/chatCache'
import LoginPage from './pages/LoginPage'
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const OrdersPage = lazy(() => import('./pages/OrdersPage'))
const ActiveDeliveriesPage = lazy(() => import('./pages/ActiveDeliveriesPage'))
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage'))
const NewOrderPage = lazy(() => import('./pages/NewOrderPage'))
const ProductsPage = lazy(() => import('./pages/ProductsPage'))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const ZonesPage = lazy(() => import('./pages/ZonesPage'))
const CashRegistersPage = lazy(() => import('./pages/CashRegistersPage'))
const CashControlPage = lazy(() => import('./pages/CashControlPage'))
const TablesPage = lazy(() => import('./pages/TablesPage'))
const TableOrderPage = lazy(() => import('./pages/TableOrderPage'))
const TableDetailPage = lazy(() => import('./pages/TableDetailPage'))
import TableHistoryPage from './pages/TableHistoryPage'
const KitchenPage = lazy(() => import('./pages/KitchenPage'))
import PaymentValidationPage from './pages/PaymentValidationPage'
const KitchenStationsPage = lazy(() => import('./pages/KitchenStationsPage'))
const ModuleSettingsPage = lazy(() => import('./pages/ModuleSettingsPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const CustomersPage = lazy(() => import('./pages/CustomersPage'))
const DriversPage = lazy(() => import('./pages/DriversPage'))
const DriverPortalPage = lazy(() => import('./pages/DriverPortalPage'))
const SuperAdminOverviewPage = lazy(() => import('./pages/superadmin/SuperAdminOverviewPage'))
const SuperAdminConfigPage = lazy(() => import('./pages/superadmin/SuperAdminConfigPage'))
const AuditLogsPage = lazy(() => import('./pages/superadmin/AuditLogsPage'))
const MaintenancePage = lazy(() => import('./pages/superadmin/MaintenancePage'))
const SitesPage = lazy(() => import('./pages/superadmin/SitesPage'))

const PublicMenuPage = lazy(() => import('./pages/PublicMenuPage'))

function ProtectedRoute({ 
  children, 
  allowedRoles,
  requiredPermission,
  allowPreparation = false,
  globalSiteManagerOnly = false,
}: { 
  children: React.ReactNode; 
  allowedRoles?: string[];
  requiredPermission?: string;
  allowPreparation?: boolean;
  globalSiteManagerOnly?: boolean;
}) {
  const { isAuthenticated, loading, hasRole, hasPermission, user } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen bg-[#0D0D0D] text-white">Cargando...</div>
  if (!isAuthenticated) return <Navigate to="/login" replace />

  if (user?.activeSite?.preparationMode && !allowPreparation) {
    return <Navigate to="/superadmin/sites" replace />
  }

  // Rutas generales no restringidas (ej. AppLayout principal)
  if (!allowedRoles && !requiredPermission) return <>{children}</>

  // La administración de sedes es global: la puede abrir el SuperAdmin o el
  // ADMIN histórico promovido a administrador general, pero no un ADMIN
  // creado para una sola sede.
  if (globalSiteManagerOnly) {
    if (user?.globalRole !== 'SUPERADMIN' && user?.globalRole !== 'ADMIN_GENERAL') {
      return <Navigate to={getFirstAllowedPath(user, user?.activeSite?.id) || '/profile'} replace />
    }
    return <>{children}</>
  }

  // El portal operativo solo funciona con la identidad de un domiciliario.
  // Si el administrador conservó el enlace, llévalo a su historial de repartidores.
  if (allowedRoles?.length === 1 && allowedRoles[0] === 'DELIVERY_DRIVER') {
    if (user?.role !== 'DELIVERY_DRIVER') {
      return <Navigate to={user?.role === 'SUPERADMIN' ? '/drivers' : (getFirstAllowedPath(user, user?.activeSite?.id) || '/profile')} replace />
    }
    return <>{children}</>
  }

  // SuperAdmin tiene acceso a todo el sistema
  if (user?.role === 'SUPERADMIN') return <>{children}</>

  // Rutas exclusivas de SuperAdmin (Panel, Mantenimiento, etc.)
  if (allowedRoles?.length === 1 && allowedRoles[0] === 'SUPERADMIN') {
    if (user?.role !== 'SUPERADMIN') return <Navigate to="/dashboard" replace />
    return <>{children}</>
  }

  // Si la ruta declara permiso granular, ese permiso manda.
  const hasPerm = requiredPermission ? hasPermission(requiredPermission) : false
  const hasRoleAccess = !requiredPermission && allowedRoles ? hasRole(...allowedRoles) : false

  if (hasPerm || hasRoleAccess) {
    return <>{children}</>
  }

  return <Navigate to={getFirstAllowedPath(user, user?.activeSite?.id) || '/profile'} replace />
}

function HomeRedirect() {
  const { user } = useAuth()
  if (user?.activeSite?.preparationMode) return <Navigate to="/superadmin/sites" replace />
  return <Navigate to={getFirstAllowedPath(user, user?.activeSite?.id) || '/profile'} replace />
}

function App() {
  const { isAuthenticated, user } = useAuth()

  useEffect(() => {
    if (!isAuthenticated || user?.activeSite?.preparationMode) return

    // Descarga en segundo plano los módulos operativos más usados. Así el primer
    // cambio de pestaña reutiliza el chunk local y no muestra una vista vacía.
    const preloadTimer = window.setTimeout(() => {
      const modules: Promise<unknown>[] = []
      if (hasUserPermission(user, 'whatsapp.view')) {
        modules.push(import('./pages/ChatPage'), import('./pages/NewOrderPage'))
        void api.get<{ items?: CachedSession[] } | CachedSession[]>('/whatsapp/sessions?filter=TODAY&pagination=cursor&limit=60')
          .then(result => setCachedSessions('', 'TODAY', Array.isArray(result) ? result : (result.items || [])))
          .catch(() => {})
      }
      if (hasUserPermission(user, 'orders.view')) modules.push(import('./pages/OrdersPage'), import('./pages/ActiveDeliveriesPage'))
      if (hasUserPermission(user, 'tables.view')) modules.push(import('./pages/TablesPage'), import('./pages/TableOrderPage'))
      if (hasUserPermission(user, 'kitchen.view')) modules.push(import('./pages/KitchenPage'))
      if (hasUserPermission(user, 'users.view')) modules.push(import('./pages/UsersPage'))
      if (hasUserPermission(user, 'products.view')) modules.push(import('./pages/ProductsPage'))
      void Promise.allSettled(modules)
    }, 700)

    return () => window.clearTimeout(preloadTimer)
  }, [isAuthenticated, user])

  return (
    <Suspense fallback={<div role="status" className="flex min-h-[50vh] items-center justify-center text-sm text-[var(--text-secondary)]">Cargando vista…</div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/menu" element={<PublicMenuPage />} />
      <Route path="/menu/:siteCode" element={<PublicMenuPage />} />
      <Route path="/menudigital" element={<PublicMenuPage />} />
      <Route path="/menudigital/:siteCode" element={<PublicMenuPage />} />

      <Route path="/" element={
        <ProtectedRoute allowPreparation><AppLayout key={user?.activeSite?.id || 'principal'} /></ProtectedRoute>
      }>
        <Route index element={<HomeRedirect />} />
        <Route path="dashboard" element={
          <ProtectedRoute allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER']}><DashboardPage /></ProtectedRoute>
        } />
        <Route path="dispatch" element={
          <ProtectedRoute requiredPermission="dispatch.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER']}><ActiveDeliveriesPage /></ProtectedRoute>
        } />
        <Route path="orders" element={
          <ProtectedRoute requiredPermission="orders.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER']}><OrdersPage /></ProtectedRoute>
        } />
        <Route path="orders/new" element={
          <ProtectedRoute requiredPermission="orders.create" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER', 'WAITER']}><NewOrderPage /></ProtectedRoute>
        } />
        <Route path="tables" element={
          <ProtectedRoute requiredPermission="tables.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'WAITER']}><TablesPage /></ProtectedRoute>
        } />
        <Route path="tables/new" element={
          <ProtectedRoute requiredPermission="tables.create" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'WAITER']}><TableOrderPage /></ProtectedRoute>
        } />
        <Route path="tables/history" element={
          <ProtectedRoute requiredPermission="tables.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'WAITER']}><TableHistoryPage /></ProtectedRoute>
        } />
        <Route path="tables/:id" element={
          <ProtectedRoute requiredPermission="tables.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'WAITER']}><TableDetailPage /></ProtectedRoute>
        } />
        <Route path="kitchen" element={
          <ProtectedRoute requiredPermission="kitchen.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'KITCHEN']}><KitchenPage /></ProtectedRoute>
        } />
        <Route path="payment-validation" element={
          <ProtectedRoute requiredPermission="payment_validation.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER']}><PaymentValidationPage /></ProtectedRoute>
        } />
        <Route path="orders/active" element={
          <ProtectedRoute requiredPermission="dispatch.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER']}><ActiveDeliveriesPage /></ProtectedRoute>
        } />
        <Route path="orders/:id" element={
          <ProtectedRoute requiredPermission="orders.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER']}><OrderDetailPage /></ProtectedRoute>
        } />
        <Route path="products" element={
          <ProtectedRoute allowPreparation requiredPermission="products.view" allowedRoles={['SUPERADMIN', 'ADMIN']}><ProductsPage /></ProtectedRoute>
        } />
        <Route path="customers" element={
          <ProtectedRoute requiredPermission="customers.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><CustomersPage /></ProtectedRoute>
        } />
        <Route path="drivers" element={
          <ProtectedRoute requiredPermission="drivers.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DISPATCHER']}><DriversPage /></ProtectedRoute>
        } />
        <Route path="my-deliveries" element={
          <ProtectedRoute allowedRoles={['DELIVERY_DRIVER']}><DriverPortalPage /></ProtectedRoute>
        } />
        <Route path="payments" element={
          <ProtectedRoute requiredPermission="cash.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER']}><PaymentsPage /></ProtectedRoute>
        } />
        <Route path="users" element={
          <ProtectedRoute allowPreparation requiredPermission="users.view" allowedRoles={['SUPERADMIN', 'ADMIN']}><UsersPage /></ProtectedRoute>
        } />
        <Route path="zones" element={
          <ProtectedRoute allowPreparation requiredPermission="zones.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><ZonesPage /></ProtectedRoute>
        } />
        <Route path="cash-registers" element={
          <ProtectedRoute allowPreparation requiredPermission="cash.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER']}><CashRegistersPage /></ProtectedRoute>
        } />
        <Route path="cash-control" element={
          <ProtectedRoute requiredPermission="cash.control" allowedRoles={['SUPERADMIN', 'ADMIN']}><CashControlPage /></ProtectedRoute>
        } />
        <Route path="settings/kitchen-stations" element={
          <ProtectedRoute allowPreparation requiredPermission="kitchen_stations.manage" allowedRoles={['SUPERADMIN', 'ADMIN']}><KitchenStationsPage /></ProtectedRoute>
        } />
        <Route path="settings/modules" element={
          <ProtectedRoute allowPreparation requiredPermission="settings.modules" allowedRoles={['SUPERADMIN', 'ADMIN']}><ModuleSettingsPage /></ProtectedRoute>
        } />
        <Route path="chat" element={
          <ProtectedRoute requiredPermission="whatsapp.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'DELIVERY_MANAGER', 'CASHIER']}><ChatPage /></ProtectedRoute>
        } />
        <Route path="profile" element={
          <ProtectedRoute><ProfilePage /></ProtectedRoute>
        } />
        <Route path="superadmin" element={
          <ProtectedRoute allowedRoles={['SUPERADMIN']}><SuperAdminOverviewPage /></ProtectedRoute>
        } />
        <Route path="superadmin/config" element={
          <ProtectedRoute allowPreparation allowedRoles={['SUPERADMIN']}><SuperAdminConfigPage /></ProtectedRoute>
        } />
        <Route path="superadmin/audit-logs" element={
          <ProtectedRoute allowedRoles={['SUPERADMIN']}><AuditLogsPage /></ProtectedRoute>
        } />
        <Route path="superadmin/maintenance" element={
          <ProtectedRoute allowedRoles={['SUPERADMIN']}><MaintenancePage /></ProtectedRoute>
        } />
        <Route path="superadmin/sites" element={
          <ProtectedRoute allowPreparation globalSiteManagerOnly allowedRoles={['SUPERADMIN', 'ADMIN']}><SitesPage /></ProtectedRoute>
        } />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  )
}

export default App
