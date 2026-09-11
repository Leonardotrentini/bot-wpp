/**
 * Semáforo simples para limitar operações pesadas em paralelo (ex.: download de mídia).
 */

function createSemaphore(maxConcurrent) {
  const max = Math.max(1, Number(maxConcurrent) || 1)
  let active = 0
  const waiters = []

  async function acquire() {
    if (active < max) {
      active += 1
      return
    }
    await new Promise((resolve) => waiters.push(resolve))
    active += 1
  }

  function release() {
    active = Math.max(0, active - 1)
    const next = waiters.shift()
    if (next) next()
  }

  async function run(fn) {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }

  return {
    run,
    stats: () => ({ active, waiting: waiters.length, max }),
  }
}

module.exports = { createSemaphore }
