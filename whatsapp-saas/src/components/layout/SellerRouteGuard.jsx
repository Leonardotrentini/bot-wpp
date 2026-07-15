import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext.jsx'

const SELLER_PATHS = ['/dashboard/chat', '/dashboard/connect', '/dashboard/settings']

function isSellerAllowedPath(pathname) {
  return SELLER_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export function SellerRouteGuard({ children }) {
  const { isOrgSeller } = useAuth()
  const { pathname } = useLocation()

  if (isOrgSeller && !isSellerAllowedPath(pathname)) {
    return <Navigate to="/dashboard/chat" replace />
  }

  return children
}
