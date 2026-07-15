/**
 * Auditoria de isolamento OWNER/SELLER + regressões de Conversas.
 *
 * Uso local / produção:
 *   node scripts/audit-seller-isolation.js
 *
 * Env:
 *   CRM_API_URL   (default Railway)
 *   OWNER_EMAIL / OWNER_PASSWORD
 *   SELLER_EMAIL / SELLER_PASSWORD   (opcional — se omitido, só testa OWNER + regras unitárias)
 */

const assert = require("assert")
const { normalizeWaPhoneDigits } = require("../src/lib/whatsappConnection")

const BASE = process.env.CRM_API_URL || process.env.API_URL || "http://localhost:3001/api"
const OWNER_EMAIL = process.env.OWNER_EMAIL || process.env.CRM_EMAIL || ""
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || process.env.CRM_PASSWORD || ""
const SELLER_EMAIL = process.env.SELLER_EMAIL || ""
const SELLER_PASSWORD = process.env.SELLER_PASSWORD || ""

let passed = 0
let failed = 0

async function req(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
  return { status: res.status, data, ms: 0 }
}

async function timedReq(path, opts) {
  const t0 = Date.now()
  const result = await req(path, opts)
  result.ms = Date.now() - t0
  return result
}

async function login(email, password) {
  const { status, data } = await req("/auth/login", {
    method: "POST",
    body: { email, password },
  })
  if (status !== 200 || !data.token) {
    throw new Error(`login ${email} falhou: ${status} ${JSON.stringify(data)}`)
  }
  return { token: data.token, user: data.user }
}

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1
      console.log(`  ✓ ${name}`)
    })
    .catch((err) => {
      failed += 1
      console.error(`  ✗ ${name}`)
      console.error(`    ${err.message || err}`)
    })
}

/** Espelho da regra de CRM UI (seller isolado). */
function isConversationInScope(conversation, { userId, isOrgOwner, filterSellerUserId } = {}) {
  if (!conversation?.id) return false
  if (!userId) return true
  const ownerId = conversation.userId || conversation.contact?.userId || null
  if (!ownerId) {
    if (filterSellerUserId) return false
    return Boolean(isOrgOwner)
  }
  if (filterSellerUserId) return ownerId === filterSellerUserId
  if (ownerId === userId) return true
  if (isOrgOwner) return true
  return false
}

async function runUnitTests() {
  console.log("\n— unitários (offline) —\n")

  await test("normalizeWaPhoneDigits alinha BR com/sem 55", () => {
    assert.strictEqual(normalizeWaPhoneDigits("+55 11 98765-4321"), "11987654321")
    assert.strictEqual(normalizeWaPhoneDigits("11987654321"), "11987654321")
    assert.strictEqual(normalizeWaPhoneDigits("5511987654321"), "11987654321")
  })

  await test("SELLER rejeita conversa sem userId", () => {
    assert.strictEqual(
      isConversationInScope({ id: "c1" }, { userId: "seller", isOrgOwner: false }),
      false,
    )
  })

  await test("SELLER rejeita conversa de outro userId", () => {
    assert.strictEqual(
      isConversationInScope(
        { id: "c1", userId: "owner" },
        { userId: "seller", isOrgOwner: false },
      ),
      false,
    )
  })

  await test("SELLER aceita só a própria conversa", () => {
    assert.strictEqual(
      isConversationInScope(
        { id: "c1", userId: "seller" },
        { userId: "seller", isOrgOwner: false },
      ),
      true,
    )
  })

  await test("OWNER aceita conversa da equipe", () => {
    assert.strictEqual(
      isConversationInScope(
        { id: "c1", userId: "seller" },
        { userId: "owner", isOrgOwner: true },
      ),
      true,
    )
  })

  await test("OWNER filtrado só vê o membro escolhido", () => {
    assert.strictEqual(
      isConversationInScope(
        { id: "c1", userId: "seller-a" },
        { userId: "owner", isOrgOwner: true, filterSellerUserId: "seller-b" },
      ),
      false,
    )
    assert.strictEqual(
      isConversationInScope(
        { id: "c1", userId: "seller-b" },
        { userId: "owner", isOrgOwner: true, filterSellerUserId: "seller-b" },
      ),
      true,
    )
  })
}

async function runApiTests() {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    console.log("\n— API —\n")
    console.log("  (pulado) defina OWNER_EMAIL e OWNER_PASSWORD para testes contra API")
    return
  }

  console.log(`\n— API ${BASE} —\n`)

  let owner
  await test("login OWNER", async () => {
    owner = await login(OWNER_EMAIL, OWNER_PASSWORD)
    assert.ok(owner.token)
  })
  if (!owner?.token) return

  await test("OWNER GET /crm/conversations responde rápido e 200", async () => {
    const r = await timedReq("/crm/conversations?includeTotal=0", { token: owner.token })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.ok(r.ms < 15000, `timeout lento: ${r.ms}ms`)
    assert.ok(Array.isArray(r.data.conversations))
  })

  await test("OWNER GET /org/members (lista equipe)", async () => {
    const r = await req("/org/members", { token: owner.token })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.ok(Array.isArray(r.data.members))
  })

  if (!SELLER_EMAIL || !SELLER_PASSWORD) {
    console.log("  (SELLER_* não definido — pulando asserts cross-user)")
    return
  }

  let seller
  await test("login SELLER", async () => {
    seller = await login(SELLER_EMAIL, SELLER_PASSWORD)
    assert.ok(seller.token)
    assert.notStrictEqual(seller.user?.id, owner.user?.id)
  })
  if (!seller?.token) return

  await test("SELLER conversations não hang e só traz userId próprio", async () => {
    const r = await timedReq("/crm/conversations?includeTotal=0", { token: seller.token })
    assert.strictEqual(r.status, 200, JSON.stringify(r.data))
    assert.ok(r.ms < 15000, `spinner/timeout: ${r.ms}ms`)
    for (const c of r.data.conversations || []) {
      assert.strictEqual(
        c.userId,
        seller.user.id,
        `vazamento: conversa ${c.id} userId=${c.userId} (seller=${seller.user.id})`,
      )
    }
  })

  await test("SELLER não lista /org/members", async () => {
    const r = await req("/org/members", { token: seller.token })
    assert.strictEqual(r.status, 403)
  })

  await test("SELLER não filtra por sellerUserId do dono", async () => {
    const r = await req(`/crm/conversations?sellerUserId=${encodeURIComponent(owner.user.id)}`, {
      token: seller.token,
    })
    assert.strictEqual(r.status, 403)
  })

  const ownerList = await timedReq("/crm/conversations?includeTotal=0", { token: owner.token })
  const ownerOnly = (ownerList.data.conversations || []).find((c) => c.userId === owner.user.id)
  if (ownerOnly) {
    await test("SELLER não abre mensagens de conversa do OWNER", async () => {
      const r = await req(`/crm/conversations/${encodeURIComponent(ownerOnly.id)}/messages`, {
        token: seller.token,
      })
      assert.ok(r.status === 404 || r.status === 403, `status inesperado ${r.status}`)
    })
  } else {
    console.log("  · (sem conversa só do OWNER para teste B2)")
  }

  await test("phones WA da org não duplicam entre membros conectados", async () => {
    const membersRes = await req("/org/members", { token: owner.token })
    assert.strictEqual(membersRes.status, 200)
    const phones = new Map()
    for (const m of membersRes.data.members || []) {
      const phone = m.whatsapp?.phone
      if (!phone || !m.whatsapp?.connected) continue
      const key = normalizeWaPhoneDigits(phone)
      if (!key) continue
      if (phones.has(key)) {
        throw new Error(
          `telefone ${phone} em ${m.name} e ${phones.get(key)} — risco Jorge/Luis`,
        )
      }
      phones.set(key, m.name)
    }
  })
}

async function main() {
  console.log("\naudit-seller-isolation\n")
  await runUnitTests()
  try {
    await runApiTests()
  } catch (err) {
    failed += 1
    console.error("\n  ✗ falha geral na API:", err.message || err)
  }

  console.log(`\n${passed} passou, ${failed} falhou\n`)
  if (failed) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
