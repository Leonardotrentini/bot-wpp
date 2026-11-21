/**
 * Configura evolution-api-canary = Canário A (mesmo código Evo1 + SAVE_DATA on).
 * Não altera evolution-api de produção.
 *
 * Uso (quando o serviço já existir no Railway):
 *   node scripts/_configure-evo-canary-persist.js
 */
const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const PROJECT_ID = "711341c4-2da7-47b7-a60e-22abe6eabfd4"
const ENV_ID = "1e3e9f30-0974-4631-8554-ee028bb7ef64"
const SOURCE_SERVICE = "evolution-api"
const CANARY_NAME = "evolution-api-canary"
const PIN_COMMIT = "fa09d37892cdbb1d65a250155d293d92230c5b30"

function loadToken() {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(process.env.USERPROFILE || process.env.HOME, ".railway", "config.json"), "utf8"),
  )
  return cfg.user.accessToken || process.env.RAILWAY_TOKEN
}

async function gql(token, query, variables) {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors?.length) {
    const err = new Error(json.errors.map((e) => e.message).join("; "))
    err.details = json.errors
    throw err
  }
  return json.data
}

async function main() {
  const token = loadToken()
  const project = await gql(
    token,
    `query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }`,
    { id: PROJECT_ID },
  )
  const services = project.project.services.edges.map((e) => e.node)
  const canary = services.find((s) => s.name === CANARY_NAME)
  const source = services.find((s) => s.name === SOURCE_SERVICE)
  if (!canary) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          waiting: true,
          message: `Serviço ${CANARY_NAME} ainda não existe. Crie no Railway com repo Leonardotrentini/evolution-api @ ${PIN_COMMIT} (main/fa09d37), depois rode este script de novo.`,
        },
        null,
        2,
      ),
    )
    return
  }
  if (!source) throw new Error("evolution-api source missing")

  const sourceVars = (
    await gql(
      token,
      `query($serviceId: String!, $environmentId: String!) {
        variables(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      { serviceId: source.id, environmentId: ENV_ID },
    )
  ).variables || {}

  const skip = new Set([
    "RAILWAY_PRIVATE_DOMAIN",
    "RAILWAY_PUBLIC_DOMAIN",
    "RAILWAY_STATIC_URL",
    "RAILWAY_SERVICE_ID",
    "RAILWAY_ENVIRONMENT_ID",
    "RAILWAY_PROJECT_ID",
    "RAILWAY_DEPLOYMENT_ID",
  ])
  const variables = {}
  for (const [k, v] of Object.entries(sourceVars)) {
    if (skip.has(k) || k.startsWith("RAILWAY_")) continue
    variables[k] = String(v)
  }

  Object.assign(variables, {
    DATABASE_SAVE_DATA_CHATS: "true",
    DATABASE_SAVE_DATA_CONTACTS: "true",
    DATABASE_SAVE_DATA_NEW_MESSAGE: "true",
    DATABASE_SAVE_DATA_HISTORIC: "true",
    DATABASE_SAVE_DATA_LABELS: "true",
    DATABASE_SAVE_MESSAGE_UPDATE: "true",
    SYNC_FULL_HISTORY: "false",
    CONFIG_SESSION_SYNC_FULL_HISTORY: "false",
    AUTHENTICATION_API_KEY: `canary_${require("crypto").randomBytes(16).toString("hex")}`,
  })

  // Domínio / SERVER_URL
  let domain = null
  try {
    const dom = await gql(
      token,
      `mutation($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { domain }
      }`,
      { input: { environmentId: ENV_ID, serviceId: canary.id } },
    )
    domain = dom.serviceDomainCreate?.domain || null
  } catch (err) {
    // pode já existir
    domain = null
  }

  if (domain) variables.SERVER_URL = `https://${domain}`

  await gql(
    token,
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId: PROJECT_ID,
        environmentId: ENV_ID,
        serviceId: canary.id,
        variables,
        replace: false,
      },
    },
  )

  // CRM: marcar canário como persistente
  execSync(
    'railway variables set --service backend --environment production "WHATSAPP_HOST_PERSIST_CHATS=primary:false,secondary:true,canary:true"',
    { stdio: "inherit" },
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        canaryServiceId: canary.id,
        pinCommit: PIN_COMMIT,
        domain,
        persistEnvs: true,
        next: [
          "Confirmar no dashboard que o deploy do canário usa commit fa09d37 (não a branch do patch)",
          "Gerar domínio se SERVER_URL ainda não apontar",
          "Conectar 1 conta de teste via QR no canário",
          "Dry-run retenção: railway variables -s <Postgres-do-canary> --json | node scripts/evo-message-retention-cleanup.js --days=30",
          "Sucesso 72h: lastWebhookAt fresco + msgs pós-ociosidade + findChats > 0",
          "GET /api/admin/canary-sync-health?instanceName=...",
        ],
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
