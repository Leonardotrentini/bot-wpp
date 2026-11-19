/**
 * Lembra que o usuário já liberou mic/câmera neste dispositivo (mesma origem).
 * Nota: Safari em aba Privada NÃO persiste — aí o iOS pede de novo sempre.
 */

const MIC_KEY = 'vg_perm_mic'
const CAM_KEY = 'vg_perm_cam'

function storage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function hasMicPermissionMemory() {
  return storage()?.getItem(MIC_KEY) === '1'
}

export function hasCamPermissionMemory() {
  return storage()?.getItem(CAM_KEY) === '1'
}

export function rememberMicPermission() {
  try {
    storage()?.setItem(MIC_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function rememberCamPermission() {
  try {
    storage()?.setItem(CAM_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function isSafariPrivateLikely() {
  // Heurística leve — Privado no iOS costuma falhar em localStorage quota/outras APIs
  try {
    const ls = window.localStorage
    const k = '__vg_priv_probe__'
    ls.setItem(k, '1')
    ls.removeItem(k)
    return false
  } catch {
    return true
  }
}
