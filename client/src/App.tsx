import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { AppLayout } from './components/layout/AppLayout'
import { getFirstAllowedPath } from './lib/navigation'
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
const TableHistoryPage = lazy(() => import('./pages/TableHistoryPage'))
const KitchenPage = lazy(() => import('./pages/KitchenPage'))
const PaymentValidationPage = lazy(() => import('./pages/PaymentValidationPage'))
const KitchenStationsPage = lazy(() => import('./pages/KitchenStationsPage'))
const ModuleSettingsPage = lazy(() => import('./pages/ModuleSettingsPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const CustomersPage = lazy(() => import('./pages/CustomersPage'))
const DriversPage = lazy(() => import('./pages/DriversPage'))
const SuperAdminOverviewPage = lazy(() => import('./pages/superadmin/SuperAdminOverviewPage'))
const SuperAdminConfigPage = lazy(() => import('./pages/superadmin/SuperAdminConfigPage'))
const AuditLogsPage = lazy(() => import('./pages/superadmin/AuditLogsPage'))
const MaintenancePage = lazy(() => import('./pages/superadmin/MaintenancePage'))

const PublicMenuPage = lazy(() => import('./pages/PublicMenuPage'))

function ProtectedRoute({ 
  children, 
  allowedRoles,
  requiredPermission,
}: { 
  children: React.ReactNode; 
  allowedRoles?: string[];
  requiredPermission?: string;
}) {
  const { isAuthenticated, loading, hasRole, hasPermission, user } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen bg-[#0D0D0D] text-white">Cargando...</div>
  if (!isAuthenticated) return <Navigate to="/login" replace />

  // Rutas generales no restringidas (ej. AppLayout principal)
  if (!allowedRoles && !requiredPermission) return <>{children}</>

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

  return <Navigate to={getFirstAllowedPath(user) || '/profile'} replace />
}

function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={getFirstAllowedPath(user) || '/profile'} replace />
}

function App() {
  return (
    <Suspense fallback={<div role="status" className="flex min-h-[50vh] items-center justify-center text-sm text-[var(--text-secondary)]">Cargando vista…</div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/menu" element={<PublicMenuPage />} />
      <Route path="/menudigital" element={<PublicMenuPage />} />

      <Route path="/" element={
        <ProtectedRoute><AppLayout /></ProtectedRoute>
      }>
        <Route index element={<HomeRedirect />} />
        <Route path="dashboard" element={
          <ProtectedRoute allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><DashboardPage /></ProtectedRoute>
        } />
        <Route path="dispatch" element={
          <ProtectedRoute requiredPermission="dispatch.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><ActiveDeliveriesPage /></ProtectedRoute>
        } />
        <Route path="orders" element={
          <ProtectedRoute requiredPermission="orders.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><OrdersPage /></ProtectedRoute>
        } />
        <Route path="orders/new" element={
          <ProtectedRoute requiredPermission="orders.create" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><NewOrderPage /></ProtectedRoute>
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
          <ProtectedRoute requiredPermission="dispatch.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><ActiveDeliveriesPage /></ProtectedRoute>
        } />
        <Route path="orders/:id" element={
          <ProtectedRoute requiredPermission="orders.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><OrderDetailPage /></ProtectedRoute>
        } />
        <Route path="products" element={
          <ProtectedRoute requiredPermission="products.view" allowedRoles={['SUPERADMIN', 'ADMIN']}><ProductsPage /></ProtectedRoute>
        } />
        <Route path="customers" element={
          <ProtectedRoute requiredPermission="customers.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><CustomersPage /></ProtectedRoute>
        } />
        <Route path="drivers" element={
          <ProtectedRoute requiredPermission="drivers.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER']}><DriversPage /></ProtectedRoute>
        } />
        <Route path="payments" element={
          <ProtectedRoute requiredPermission="cash.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER']}><PaymentsPage /></ProtectedRoute>
        } />
        <Route path="users" element={
          <ProtectedRoute requiredPermission="users.view" allowedRoles={['SUPERADMIN', 'ADMIN']}><UsersPage /></ProtectedRoute>
        } />
        <Route path="zones" element={
          <ProtectedRoute requiredPermission="zones.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><ZonesPage /></ProtectedRoute>
        } />
        <Route path="cash-registers" element={
          <ProtectedRoute requiredPermission="cash.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER']}><CashRegistersPage /></ProtectedRoute>
        } />
        <Route path="cash-control" element={
          <ProtectedRoute requiredPermission="cash.control" allowedRoles={['SUPERADMIN', 'ADMIN']}><CashControlPage /></ProtectedRoute>
        } />
        <Route path="settings/kitchen-stations" element={
          <ProtectedRoute requiredPermission="kitchen_stations.manage" allowedRoles={['SUPERADMIN', 'ADMIN']}><KitchenStationsPage /></ProtectedRoute>
        } />
        <Route path="settings/modules" element={
          <ProtectedRoute requiredPermission="settings.modules" allowedRoles={['SUPERADMIN', 'ADMIN']}><ModuleSettingsPage /></ProtectedRoute>
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
          <ProtectedRoute allowedRoles={['SUPERADMIN']}><SuperAdminConfigPage /></ProtectedRoute>
        } />
        <Route path="superadmin/audit-logs" element={
          <ProtectedRoute allowedRoles={['SUPERADMIN']}><AuditLogsPage /></ProtectedRoute>
        } />
        <Route path="superadmin/maintenance" element={
          <ProtectedRoute allowedRoles={['SUPERADMIN']}><MaintenancePage /></ProtectedRoute>
        } />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  )
}

export default App
