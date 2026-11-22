/**
 * Janela pós-boot do processo CRM: mutações automáticas em instâncias ficam bloqueadas.
 */
const PROCESS_BOOT_AT_MS = Date.now()
const BOOT_GRACE_MS = Math.max(0, Number(process.env.WHATSAPP_BOOT_GRACE_MS || 5 * 60 * 1000))

function inBootGrace(now = Date.now()) {
  return BOOT_GRACE_MS > 0 && now - PROCESS_BOOT_AT_MS < BOOT_GRACE_MS
}

function bootGraceRemainingMs(now = Date.now()) {
  if (!inBootGrace(now)) return 0
  return Math.max(0, BOOT_GRACE_MS - (now - PROCESS_BOOT_AT_MS))
}

module.exports = {
  PROCESS_BOOT_AT_MS,
  BOOT_GRACE_MS,
  inBootGrace,
  bootGraceRemainingMs,
}
