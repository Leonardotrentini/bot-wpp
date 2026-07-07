const STORAGE_PREFIX = 'vg_crm_chat_onboarding_v1'

export function chatOnboardingStorageKey(user) {
  const id = user?.id || user?.email || 'guest'
  return `${STORAGE_PREFIX}:${id}`
}

export function hasSeenChatOnboarding(user) {
  try {
    return localStorage.getItem(chatOnboardingStorageKey(user)) === '1'
  } catch {
    return false
  }
}

export function markChatOnboardingSeen(user) {
  try {
    localStorage.setItem(chatOnboardingStorageKey(user), '1')
  } catch {
    /* ignore quota / private mode */
  }
}
