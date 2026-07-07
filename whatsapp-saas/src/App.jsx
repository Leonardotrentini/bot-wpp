import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext.jsx'
import { SidebarProvider } from './contexts/SidebarContext.jsx'
import { Landing } from './pages/Landing.jsx'
import { Login } from './pages/Login.jsx'
import { Register } from './pages/Register.jsx'
import { DashboardLayout } from './components/layout/DashboardLayout.jsx'
import { Dashboard } from './pages/dashboard/Dashboard.jsx'
import { Connect } from './pages/dashboard/Connect.jsx'
import { Groups } from './pages/dashboard/Groups.jsx'
import { GroupDetails } from './pages/dashboard/GroupDetails.jsx'
import { Messages } from './pages/dashboard/Messages.jsx'
import { Chat } from './pages/dashboard/Chat.jsx'
import { Crm } from './pages/dashboard/Crm.jsx'
import { Members } from './pages/dashboard/Members.jsx'
import { Integrations } from './pages/dashboard/Integrations.jsx'
import { Settings } from './pages/dashboard/Settings.jsx'
import { Admin } from './pages/dashboard/Admin.jsx'

function ProtectedRoute({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AdminRoute({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'ADMIN') return <Navigate to="/dashboard" replace />
  return children
}

function DashboardShell() {
  return (
    <SidebarProvider>
      <DashboardLayout />
    </SidebarProvider>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="connect" element={<Connect />} />
        <Route path="groups" element={<Groups />} />
        <Route path="groups/:id" element={<GroupDetails />} />
        <Route path="chat" element={<Chat />} />
        <Route path="crm" element={<Crm />} />
        <Route path="automations" element={<Messages defaultTab="automacoes" />} />
        <Route path="automations/library" element={<Messages defaultTab="criar" />} />
        <Route path="automations/cadences" element={<Messages defaultTab="cadencia" />} />
        <Route path="messages" element={<Navigate to="/dashboard/automations/library" replace />} />
        <Route path="members" element={<Members />} />
        <Route path="analytics" element={<Navigate to="/dashboard" replace />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<Settings />} />
        <Route
          path="admin"
          element={
            <AdminRoute>
              <Admin />
            </AdminRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
