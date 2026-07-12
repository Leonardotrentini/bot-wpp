#!/usr/bin/env node
/**
 * Testa painéis Admin, Dono (OWNER) e Vendedor (SELLER) via API de produção.
 * Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/test-panels.mjs
 */
const API_BASE = (process.env.API_BASE || "https://backend-production-7a466.up.railway.app/api").replace(/\/+$/, "")
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.SMOKE_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.SMOKE_PASSWORD

const results = []
let failed = 0

function pass(label, detail) {
  results.push({ ok: true, label, detail })
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`)
}

function fail(label, detail) {
  results.push({ ok: false, label, detail })
  failed += 1
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`)
}

async function request(method, path, { token, body, expect } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text?.slice(0, 300) }
  }
  if (expect !== undefined && res.status !== expect) {
    throw new Error(`expected ${expect}, got ${res.status}: ${JSON.stringify(data)}`)
  }
  return { status: res.status, data }
}

async function login(email, password) {
  const res = await request("POST", "/auth/login", { body: { email, password } })
  if (res.status !== 200 || !res.data?.token) {
    throw new Error(`login failed ${res.status}: ${JSON.stringify(res.data)}`)
  }
  return { token: res.data.token, user: res.data.user }
}

async function impersonate(adminToken, userId) {
  const res = await request("POST", `/admin/users/${userId}/impersonate`, { token: adminToken })
  if (res.status !== 200 || !res.data?.token) {
    throw new Error(`impersonate failed ${res.status}: ${JSON.stringify(res.data)}`)
  }
  return { token: res.data.token, user: res.data.user }
}

async function testMe(token, expected) {
  const res = await request("GET", "/auth/me", { token })
  if (res.status !== 200) return fail("GET /auth/me", `status ${res.status}`)
  const u = res.data?.user
  if (!u) return fail("GET /auth/me", "sem user")

  let ok = true
  if (expected.role && u.role !== expected.role) {
    fail("auth/me role", `esperado ${expected.role}, veio ${u.role}`)
    ok = false
  }
  if (expected.orgRole !== undefined && u.orgRole !== expected.orgRole) {
    fail("auth/me orgRole", `esperado ${expected.orgRole}, veio ${u.orgRole}`)
    ok = false
  }
  if (ok) pass("GET /auth/me", `${u.email} role=${u.role} orgRole=${u.orgRole || "—"}`)
  return u
}

async function testDashboardRoutes(token, roleLabel, { expectIntegrations, expectSellers }) {
  const routes = [
    ["GET", "/groups"],
    ["GET", "/whatsapp/status"],
    ["GET", "/org"],
    ["GET", "/integrations"],
    ["GET", "/org/sellers"],
    ["GET", "/crm/tags"],
    ["GET", "/reports/dashboard"],
  ]

  for (const [method, path] of routes) {
    try {
      const res = await request(method, path, { token })
      if (path === "/integrations") {
        if (expectIntegrations === false && res.status === 403) {
          pass(`${roleLabel} ${path}`, "bloqueado para vendedor (403)")
        } else if (expectIntegrations !== false && res.status === 200) {
          pass(`${roleLabel} ${path}`, `ok (${(res.data?.integrations || []).length} integrações)`)
        } else {
          fail(`${roleLabel} ${path}`, `status ${res.status}`)
        }
      } else if (path === "/org/sellers") {
        if (expectSellers === false && res.status === 403) {
          pass(`${roleLabel} ${path}`, "bloqueado para vendedor (403)")
        } else if (expectSellers !== false && res.status === 200) {
          pass(`${roleLabel} ${path}`, `${(res.data?.sellers || []).length} vendedor(es)`)
        } else {
          fail(`${roleLabel} ${path}`, `status ${res.status}`)
        }
      } else if (res.status === 200 || res.status === 409) {
        pass(`${roleLabel} ${path}`, `status ${res.status}`)
      } else {
        fail(`${roleLabel} ${path}`, `status ${res.status} ${JSON.stringify(res.data?.error || res.data?.message || "")}`)
      }
    } catch (e) {
      fail(`${roleLabel} ${path}`, e.message)
    }
  }
}

async function testAdminForbidden(token, roleLabel) {
  const res = await request("GET", "/admin/users", { token })
  if (res.status === 403 || res.status === 401) {
    pass(`${roleLabel} /admin/users`, "sem acesso admin")
  } else {
    fail(`${roleLabel} /admin/users`, `deveria ser 403, veio ${res.status}`)
  }
}

async function main() {
  console.log(`\n=== Teste painéis (API) ===\n${API_BASE}\n`)

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD.")
    process.exit(1)
  }

  // Health
  const healthUrl = API_BASE.replace(/\/api$/, "") + "/health"
  const health = await fetch(healthUrl, { signal: AbortSignal.timeout(15000) }).then(async (r) => ({
    status: r.status,
    data: await r.json().catch(() => ({})),
  }))
  if (health.status === 200 && health.data?.ok) pass("GET /health", `db=${health.data.db}`)
  else fail("GET /health", JSON.stringify(health.data))

  // Admin login
  let admin
  try {
    admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
    pass("Login admin", admin.user.email)
  } catch (e) {
    fail("Login admin", e.message)
    console.log(`\n${failed} falha(s)\n`)
    process.exit(1)
  }

  const adminToken = admin.token
  await testMe(adminToken, { role: "ADMIN" })

  // Admin routes
  for (const path of ["/admin/users", "/admin/organizations", "/admin/plans"]) {
    const res = await request("GET", path, { token: adminToken })
    if (res.status === 200) pass(`Admin ${path}`, "ok")
    else fail(`Admin ${path}`, `status ${res.status}`)
  }

  // Find owner + seller from organizations
  const orgsRes = await request("GET", "/admin/organizations?pageSize=50", { token: adminToken })
  const orgs = orgsRes.data?.organizations || []
  if (!orgs.length) {
    fail("Organizações", "nenhuma empresa encontrada")
    console.log(`\n${failed} falha(s)\n`)
    process.exit(1)
  }

  let ownerUser = null
  let sellerUser = null
  let testOrg = null

  for (const org of orgs) {
    const owner = org.members?.find((m) => m.role === "OWNER")
    const seller = org.members?.find((m) => m.role === "SELLER")
    if (owner && seller) {
      testOrg = org
      ownerUser = owner
      sellerUser = seller
      break
    }
  }

  if (!ownerUser || !sellerUser) {
    // fallback: any org with owner, create seller check from users list
    const usersRes = await request("GET", "/admin/users?pageSize=100", { token: adminToken })
    const users = usersRes.data?.users || []
    const sellers = users.filter((u) => u.organization?.role === "SELLER")
    const owners = users.filter((u) => u.organization?.role === "OWNER" && u.role === "USER")
    if (owners.length && sellers.length) {
      ownerUser = { userId: owners[0].id, name: owners[0].name, email: owners[0].email, role: "OWNER" }
      sellerUser = { userId: sellers[0].id, name: sellers[0].name, email: sellers[0].email, role: "SELLER" }
      testOrg = { name: owners[0].organization?.name || "?" }
    }
  }

  if (!ownerUser) {
    fail("Cenário dono", "nenhum OWNER encontrado")
  } else {
    pass("Cenário dono", `${ownerUser.name} (${ownerUser.email})`)
  }
  if (!sellerUser) {
    fail("Cenário vendedor", "nenhum SELLER encontrado")
  } else {
    pass("Cenário vendedor", `${sellerUser.name} (${sellerUser.email})`)
  }

  if (testOrg) pass("Empresa teste", testOrg.name)

  // Owner panel (impersonate)
  if (ownerUser?.userId) {
    console.log("\n--- Painel DONO ---")
    try {
      const imp = await impersonate(adminToken, ownerUser.userId)
      await testMe(imp.token, { role: "USER", orgRole: "OWNER" })
      await testDashboardRoutes(imp.token, "OWNER", { expectIntegrations: true, expectSellers: true })
      await testAdminForbidden(imp.token, "OWNER")
    } catch (e) {
      fail("Painel dono", e.message)
    }
  }

  // Seller panel (impersonate)
  if (sellerUser?.userId) {
    console.log("\n--- Painel VENDEDOR ---")
    try {
      const imp = await impersonate(adminToken, sellerUser.userId)
      await testMe(imp.token, { role: "USER", orgRole: "SELLER" })
      await testDashboardRoutes(imp.token, "SELLER", { expectIntegrations: false, expectSellers: false })
      await testAdminForbidden(imp.token, "SELLER")
    } catch (e) {
      fail("Painel vendedor", e.message)
    }
  }

  console.log(`\n=== Resultado: ${results.filter((r) => r.ok).length} ok, ${failed} falha(s) ===\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
