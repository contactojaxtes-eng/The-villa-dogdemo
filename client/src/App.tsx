import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { AppLayout } from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ProfilePage from './pages/ProfilePage'
import DashboardPage from './pages/DashboardPage'
import OrdersPage from './pages/OrdersPage'
import ActiveDeliveriesPage from './pages/ActiveDeliveriesPage'
import OrderDetailPage from './pages/OrderDetailPage'
import NewOrderPage from './pages/NewOrderPage'
import ProductsPage from './pages/ProductsPage'
import PaymentsPage from './pages/PaymentsPage'
import ExpensesPage from './pages/ExpensesPage'
import ReportsPage from './pages/ReportsPage'
import UsersPage from './pages/UsersPage'
import ZonesPage from './pages/ZonesPage'
import SettingsPage from './pages/SettingsPage'
import InventoryPage from './pages/InventoryPage'
import CashRegistersPage from './pages/CashRegistersPage'
import CashControlPage from './pages/CashControlPage'
import ChatPage from './pages/ChatPage'
import CustomersPage from './pages/CustomersPage'
import DriversPage from './pages/DriversPage'
import SuperAdminOverviewPage from './pages/superadmin/SuperAdminOverviewPage'
import SuperAdminConfigPage from './pages/superadmin/SuperAdminConfigPage'
import AuditLogsPage from './pages/superadmin/AuditLogsPage'
import MaintenancePage from './pages/superadmin/MaintenancePage'

import PublicMenuPage from './pages/PublicMenuPage'

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

  // Admin tiene acceso a todas las rutas operativas
  if (user?.role === 'ADMIN') return <>{children}</>

  // Validar si tiene el permiso granular requerido o el rol permitido
  const hasPerm = requiredPermission ? hasPermission(requiredPermission) : false
  const hasRoleAccess = allowedRoles ? hasRole(...allowedRoles) : false

  if (hasPerm || hasRoleAccess) {
    return <>{children}</>
  }

  // Si no tiene acceso a esta ruta, redirigir a su vista principal por defecto
  if (user?.role === 'DELIVERY_MANAGER') return <Navigate to="/dispatch" replace />
  if (user?.role === 'ACCOUNTANT' || user?.role === 'ACCOUNTING_ASSISTANT') return <Navigate to="/orders" replace />
  return <Navigate to="/dashboard" replace />
}

function HomeRedirect() {
  const { user } = useAuth()
  if (user?.role === 'DELIVERY_MANAGER') return <Navigate to="/dispatch" replace />
  if (user?.role === 'ACCOUNTANT' || user?.role === 'ACCOUNTING_ASSISTANT') return <Navigate to="/orders" replace />
  return <Navigate to="/dashboard" replace />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/menu" element={<PublicMenuPage />} />
      <Route path="/menudigital" element={<PublicMenuPage />} />
      <Route path="/menu" element={<PublicMenuPage />} />

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
          <ProtectedRoute requiredPermission="orders.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT']}><OrdersPage /></ProtectedRoute>
        } />
        <Route path="orders/new" element={
          <ProtectedRoute requiredPermission="orders.create" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><NewOrderPage /></ProtectedRoute>
        } />
        <Route path="orders/active" element={
          <ProtectedRoute requiredPermission="dispatch.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><ActiveDeliveriesPage /></ProtectedRoute>
        } />
        <Route path="orders/:id" element={
          <ProtectedRoute requiredPermission="orders.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT']}><OrderDetailPage /></ProtectedRoute>
        } />
        <Route path="products" element={
          <ProtectedRoute requiredPermission="products.view" allowedRoles={['SUPERADMIN', 'ADMIN']}><ProductsPage /></ProtectedRoute>
        } />
        <Route path="customers" element={
          <ProtectedRoute requiredPermission="customers.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><CustomersPage /></ProtectedRoute>
        } />
        <Route path="drivers" element={
          <ProtectedRoute requiredPermission="drivers.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT']}><DriversPage /></ProtectedRoute>
        } />
        <Route path="payments" element={
          <ProtectedRoute requiredPermission="cash.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER']}><PaymentsPage /></ProtectedRoute>
        } />
        <Route path="expenses" element={
          <ProtectedRoute requiredPermission="expenses.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT']}><ExpensesPage /></ProtectedRoute>
        } />
        <Route path="reports" element={
          <ProtectedRoute requiredPermission="reports.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT']}><ReportsPage /></ProtectedRoute>
        } />
        <Route path="users" element={
          <ProtectedRoute requiredPermission="users.view" allowedRoles={['SUPERADMIN', 'ADMIN']}><UsersPage /></ProtectedRoute>
        } />
        <Route path="zones" element={
          <ProtectedRoute requiredPermission="zones.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER']}><ZonesPage /></ProtectedRoute>
        } />
        <Route path="inventory" element={
          <ProtectedRoute requiredPermission="inventory.view" allowedRoles={['SUPERADMIN', 'ADMIN']}><InventoryPage /></ProtectedRoute>
        } />
        <Route path="cash-registers" element={
          <ProtectedRoute requiredPermission="cash.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER']}><CashRegistersPage /></ProtectedRoute>
        } />
        <Route path="cash-control" element={
          <ProtectedRoute requiredPermission="cash.control" allowedRoles={['SUPERADMIN', 'ADMIN', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT']}><CashControlPage /></ProtectedRoute>
        } />
        <Route path="settings" element={
          <ProtectedRoute requiredPermission="settings.view" allowedRoles={['SUPERADMIN', 'ADMIN']}><SettingsPage /></ProtectedRoute>
        } />
        <Route path="chat" element={
          <ProtectedRoute requiredPermission="whatsapp.view" allowedRoles={['SUPERADMIN', 'ADMIN', 'DELIVERY_MANAGER', 'CASHIER']}><ChatPage /></ProtectedRoute>
        } />
        <Route path="profile" element={
          <ProtectedRoute allowedRoles={['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT']}><ProfilePage /></ProtectedRoute>
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
  )
}

export default App
