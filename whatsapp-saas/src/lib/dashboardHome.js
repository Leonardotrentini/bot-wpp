export function getDashboardHomePath(user) {
  if (user?.orgRole === 'SELLER') return '/dashboard/chat'
  return '/dashboard'
}
