/** Fila por usuário: evita disparos simultâneos no mesmo WhatsApp (50 grupos = minutos de envio). */
const chains = new Map()

function enqueueUserSend(userId, task) {
  const prev = chains.get(userId) || Promise.resolve()
  const next = prev
    .then(() => task())
    .catch((err) => {
      console.error("[send-queue]", userId, err?.message || err)
      throw err
    })
  chains.set(userId, next.finally(() => {
    if (chains.get(userId) === next) chains.delete(userId)
  }))
  return next
}

module.exports = { enqueueUserSend }
