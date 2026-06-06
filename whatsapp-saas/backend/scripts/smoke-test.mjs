#!/usr/bin/env node
/**
 * Smoke test pós-deploy — valida health, DB e auth básico.
 * Uso: node scripts/smoke-test.mjs
 * Env: SMOKE_BASE_URL (default http://localhost:4000)
 *      SMOKE_EMAIL / SMOKE_PASSWORD (opcional — testa login)
 */
const base = (process.env.SMOKE_BASE_URL || "http://localhost:4000").replace(/\/+$/, "")

async function request(path, options = {}) {
  const url = `${base}${path}`
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data }
}

function ok(label) {
  console.log(`  ✓ ${label}`)
}

function fail(label, detail) {
  console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`)
}

async function main() {
  console.log(`\n[smoke] ${base}\n`)
  let passed = 0
  let failed = 0

  // Health + DB
  try {
    const health = await request("/health")
    if (health.status === 200 && health.data?.ok && health.data?.db === "ok") {
      ok("GET /health (db ok)")
      passed += 1
    } else {
      fail("GET /health", JSON.stringify(health.data))
      failed += 1
    }
  } catch (err) {
    fail("GET /health", err.message)
    failed += 1
  }

  // Register probe (409 = email exists = API ok)
  const probeEmail = process.env.SMOKE_PROBE_EMAIL || `smoke-${Date.now()}@vesto.group.invalid`
  try {
    const reg = await request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "Smoke Test", email: probeEmail, password: "SmokeTest123!" }),
    })
    if (reg.status === 201 && reg.data?.token) {
      ok("POST /api/auth/register")
      passed += 1
    } else if (reg.status === 409) {
      ok("POST /api/auth/register (API responde)")
      passed += 1
    } else {
      fail("POST /api/auth/register", `${reg.status} ${JSON.stringify(reg.data)}`)
      failed += 1
    }
  } catch (err) {
    fail("POST /api/auth/register", err.message)
    failed += 1
  }

  const email = process.env.SMOKE_EMAIL
  const password = process.env.SMOKE_PASSWORD
  if (email && password) {
    try {
      const login = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
      if (login.status !== 200 || !login.data?.token) {
        fail("POST /api/auth/login", `${login.status}`)
        failed += 1
      } else {
        ok("POST /api/auth/login")
        passed += 1
        const me = await request("/api/auth/me", {
          headers: { Authorization: `Bearer ${login.data.token}` },
        })
        if (me.status === 200 && me.data?.user?.plan?.maxGroups === 50) {
          ok("GET /api/auth/me (maxGroups=50)")
          passed += 1
        } else {
          fail("GET /api/auth/me", `${me.status} plan=${me.data?.user?.plan?.maxGroups}`)
          failed += 1
        }
        const groups = await request("/api/groups", {
          headers: { Authorization: `Bearer ${login.data.token}` },
        })
        if (groups.status === 200 && groups.data?.limits?.maxGroups != null) {
          ok("GET /api/groups (limits)")
          passed += 1
        } else if (groups.status === 409) {
          ok("GET /api/groups (sem WhatsApp — esperado)")
          passed += 1
        } else {
          fail("GET /api/groups", `${groups.status}`)
          failed += 1
        }
      }
    } catch (err) {
      fail("login flow", err.message)
      failed += 1
    }
  } else {
    console.log("  · SMOKE_EMAIL/SMOKE_PASSWORD não definidos — pulando login/me/groups")
  }

  console.log(`\n[smoke] ${passed} ok, ${failed} falha(s)\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
