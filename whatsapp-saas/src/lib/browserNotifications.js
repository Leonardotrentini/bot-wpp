export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  return Notification.permission
}

export async function ensureNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

export function showBrowserReminderNotification({ title, body, tag, onClick }) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return null
  try {
    const notification = new Notification(title, {
      body,
      tag: tag || undefined,
      icon: '/favicon.ico',
    })
    notification.onclick = () => {
      window.focus()
      onClick?.()
      notification.close()
    }
    return notification
  } catch {
    return null
  }
}
