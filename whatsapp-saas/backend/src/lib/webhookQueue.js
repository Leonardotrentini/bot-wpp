/**
 * Fila leve em memória para webhooks Evolution.
 * ACK HTTP imediato + processamento com concorrência limitada (evita OOM / retries).
 */

const WEBHOOK_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.WEBHOOK_CONCURRENCY || 3)))
const WEBHOOK_QUEUE_MAX = Math.max(50, Math.min(2000, Number(process.env.WEBHOOK_QUEUE_MAX || 400)))

const queue = []
let active = 0
let dropped = 0
let processed = 0

function stats() {
  return { queued: queue.length, active, processed, dropped, concurrency: WEBHOOK_CONCURRENCY }
}

async function pump() {
  while (active < WEBHOOK_CONCURRENCY && queue.length) {
    const job = queue.shift()
    if (!job) break
    active += 1
    Promise.resolve()
      .then(() => job.fn())
      .catch((err) => {
        console.error(`[webhook-queue] job failed (${job.label}):`, err?.message || err)
      })
      .finally(() => {
        active -= 1
        processed += 1
        pump()
      })
  }
}

/**
 * Enfileira trabalho. Se a fila estiver cheia, descarta o mais antigo
 * (evita crescimento ilimitado de memória sob flood).
 */
function enqueueWebhookJob(label, fn) {
  if (queue.length >= WEBHOOK_QUEUE_MAX) {
    const discarded = queue.shift()
    dropped += 1
    console.warn(
      `[webhook-queue] fila cheia (${WEBHOOK_QUEUE_MAX}) — descartando job antigo (${discarded?.label || "?"}). stats=${JSON.stringify(stats())}`,
    )
  }
  queue.push({ label: String(label || "job"), fn })
  pump()
  return stats()
}

module.exports = {
  enqueueWebhookJob,
  webhookQueueStats: stats,
  WEBHOOK_CONCURRENCY,
  WEBHOOK_QUEUE_MAX,
}
