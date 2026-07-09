/**
 * Testes de integração CRM (fluxos + configurações) contra API real.
 * Uso: CRM_API_URL=... CRM_EMAIL=... CRM_PASSWORD=... node scripts/test-crm-api.js
 */
const assert = require("assert")

const BASE = process.env.CRM_API_URL || "https://backend-production-7a466.up.railway.app/api"
const EMAIL = process.env.CRM_EMAIL || "admin@vesto.group"
const PASSWORD = process.env.CRM_PASSWORD || "Admin@ChangeMe!2026"

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
  return { status: res.status, data }
}

async function login() {
  const { status, data } = await req("/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  })
  assert.strictEqual(status, 200, `login falhou: ${JSON.stringify(data)}`)
  return data.token
}

function test(name, fn) {
  return fn().then(
    () => console.log(`  ✓ ${name}`),
    (err) => {
      console.error(`  ✗ ${name}`)
      throw err
    },
  )
}

async function main() {
  console.log("\ncrm-api — testes de integração\n")
  const token = await login()
  const created = { tags: [], stages: [], flows: [], quickReplies: [] }

  try {
    await test("GET /crm/tags", async () => {
      const { status, data } = await req("/crm/tags", { token })
      assert.strictEqual(status, 200)
      assert.ok(Array.isArray(data.tags))
    })

    await test("POST/PATCH/DELETE tag", async () => {
      let r = await req("/crm/tags", { method: "POST", token, body: { name: "Teste API", color: "#f97316" } })
      assert.strictEqual(r.status, 201)
      const tagId = r.data.tag.id
      created.tags.push(tagId)
      r = await req(`/crm/tags/${tagId}`, { method: "PATCH", token, body: { name: "Teste API 2" } })
      assert.strictEqual(r.status, 200)
      assert.strictEqual(r.data.tag.name, "Teste API 2")
    })

    await test("GET /crm/stages", async () => {
      const { status, data } = await req("/crm/stages", { token })
      assert.strictEqual(status, 200)
      assert.ok(data.stages.length >= 4)
    })

    await test("POST/PATCH/DELETE stage", async () => {
      let r = await req("/crm/stages", { method: "POST", token, body: { name: "Estágio Teste", color: "#a855f7" } })
      assert.strictEqual(r.status, 201)
      const stageId = r.data.stage.id
      created.stages.push(stageId)
      r = await req(`/crm/stages/${stageId}`, { method: "PATCH", token, body: { name: "Estágio Teste 2" } })
      assert.strictEqual(r.status, 200)
    })

    await test("POST/PUT/DELETE quick-reply", async () => {
      let r = await req("/crm/quick-replies", {
        method: "POST",
        token,
        body: { shortcut: "teste_api", title: "Teste", body: "Olá do teste API" },
      })
      assert.strictEqual(r.status, 201)
      const id = r.data.quickReply.id
      created.quickReplies.push(id)
      r = await req(`/crm/quick-replies/${id}`, {
        method: "PUT",
        token,
        body: { shortcut: "teste_api", title: "Teste 2", body: "Atualizado" },
      })
      assert.strictEqual(r.status, 200)
      r = await req(`/crm/quick-replies/${id}/content`, { token })
      assert.strictEqual(r.status, 200)
    })

    const triggers = [
      {
        name: "Teste new_conversation",
        trigger: { type: "new_conversation" },
        actions: [{ type: "send_message", body: "Bem-vindo!", mediaType: "none" }],
      },
      {
        name: "Teste keyword",
        trigger: { type: "keyword", keywords: ["preco", "valor"] },
        actions: [{ type: "send_message", body: "Tabela de preços em breve.", mediaType: "none" }],
      },
      {
        name: "Teste no_reply",
        trigger: { type: "no_reply", hours: 24 },
        actions: [{ type: "set_status", value: "pending" }],
      },
      {
        name: "Teste stage_change",
        trigger: { type: "stage_change", stageId: null },
        actions: [{ type: "send_message", body: "Card movido!", mediaType: "none" }],
      },
    ]

    for (const flow of triggers) {
      await test(`POST fluxo ${flow.trigger.type}`, async () => {
        const r = await req("/crm/flows", {
          method: "POST",
          token,
          body: { ...flow, enabled: false, cooldownPerContactHours: 24 },
        })
        assert.strictEqual(r.status, 201, JSON.stringify(r.data))
        created.flows.push(r.data.flow.id)
      })
    }

    await test("PUT fluxo keyword sem keywords rejeita", async () => {
      const r = await req(`/crm/flows/${created.flows[1]}`, {
        method: "PUT",
        token,
        body: {
          name: "Teste keyword",
          enabled: false,
          trigger: { type: "keyword", keywords: [] },
          actions: [{ type: "send_message", body: "x", mediaType: "none" }],
          cooldownPerContactHours: 24,
        },
      })
      assert.strictEqual(r.status, 400)
    })

    await test("PATCH toggle fluxo", async () => {
      const r = await req(`/crm/flows/${created.flows[0]}`, {
        method: "PATCH",
        token,
        body: { enabled: true },
      })
      assert.strictEqual(r.status, 200)
      assert.strictEqual(r.data.flow.enabled, true)
    })

    await test("GET /crm/flows/:id/runs", async () => {
      const r = await req(`/crm/flows/${created.flows[0]}/runs`, { token })
      assert.strictEqual(r.status, 200)
      assert.ok(Array.isArray(r.data.runs))
    })

    console.log("\n  Todos os testes passaram.\n")
  } finally {
    for (const id of created.flows) {
      await req(`/crm/flows/${id}`, { method: "DELETE", token }).catch(() => {})
    }
    for (const id of created.quickReplies) {
      await req(`/crm/quick-replies/${id}`, { method: "DELETE", token }).catch(() => {})
    }
    for (const id of created.stages) {
      await req(`/crm/stages/${id}`, { method: "DELETE", token }).catch(() => {})
    }
    for (const id of created.tags) {
      await req(`/crm/tags/${id}`, { method: "DELETE", token }).catch(() => {})
    }
  }
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
