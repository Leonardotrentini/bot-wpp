/**
 * Cria serviço Railway evolution-api-canary a partir do repo/branch do patch.
 * Não toca no evolution-api de produção.
 *
 * Uso: node scripts/_provision-evo-canary.js
 */
const fs = require("fs")
const path = require("path")

const PROJECT_ID = "711341c4-2da7-47b7-a60e-22abe6eabfd4"
const ENV_ID = "1e3e9f30-0974-4631-8554-ee028bb7ef64"
const SOURCE_SERVICE_ID = "77d831c6-52b3-48cb-95b8-82db22efec77" // evolution-api
const REPO = "Leonardotrentini/evolution-api"
const BRANCH = "canary/sync-history-patch"
const NAME = "evolution-api-canary"

function loadToken() {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(process.env.USERPROFILE || process.env.HOME, ".railway", "config.json"), "utf8"),
  )
  return cfg.user.accessToken || cfg.token || process.env.RAILWAY_TOKEN
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
  if (!token) throw new Error("Railway token missing")

  // Já existe?
  const project = await gql(
    token,
    `query($id: String!) {
      project(id: $id) {
        services { edges { node { id name } } }
      }
    }`,
    { id: PROJECT_ID },
  )
  const existing = project.project.services.edges
    .map((e) => e.node)
    .find((s) => s.name === NAME)
  if (existing) {
    console.log(JSON.stringify({ ok: true, alreadyExists: true, service: existing }, null, 2))
    return
  }

  const created = await gql(
    token,
    `mutation($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }`,
    {
      input: {
        projectId: PROJECT_ID,
        name: NAME,
        source: {
          repo: REPO,
        },
      },
    },
  )
  const service = created.serviceCreate
  console.log("created", service)

  // Tenta setar branch via serviceInstanceUpdate / source
  try {
    await gql(
      token,
      `mutation($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) {
        serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
      }`,
      {
        environmentId: ENV_ID,
        serviceId: service.id,
        input: {
          branch: BRANCH,
          rootDirectory: null,
        },
      },
    )
    console.log("branch set to", BRANCH)
  } catch (err) {
    console.warn("branch update failed (set manually):", err.message)
  }

  // Copia variáveis da Evo1 + overrides de persistência (canário)
  const varsData = await gql(
    token,
    `query($serviceId: String!, $environmentId: String!) {
      variables(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId: SOURCE_SERVICE_ID, environmentId: ENV_ID },
  )
  const sourceVars = varsData.variables || {}
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
  // Persistência alinhada à Evo2 (só no canário)
  Object.assign(variables, {
    DATABASE_SAVE_DATA_CHATS: "true",
    DATABASE_SAVE_DATA_CONTACTS: "true",
    DATABASE_SAVE_DATA_NEW_MESSAGE: "true",
    DATABASE_SAVE_DATA_HISTORIC: "true",
    DATABASE_SAVE_DATA_LABELS: "true",
    DATABASE_SAVE_MESSAGE_UPDATE: "true",
    SYNC_FULL_HISTORY: "false",
    CONFIG_SESSION_SYNC_FULL_HISTORY: "false",
    // API key própria do canário (não reutilizar a da Evo1 em requests misturados)
    AUTHENTICATION_API_KEY: `canary_${require("crypto").randomBytes(16).toString("hex")}`,
  })
  // SERVER_URL será ajustado depois do domínio

  await gql(
    token,
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId: PROJECT_ID,
        environmentId: ENV_ID,
        serviceId: service.id,
        variables,
        replace: false,
      },
    },
  )
  console.log("variables upserted (persistence ON for canary)")

  // Domínio público
  let domain = null
  try {
    const dom = await gql(
      token,
      `mutation($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { id domain }
      }`,
      {
        input: {
          environmentId: ENV_ID,
          serviceId: service.id,
        },
      },
    )
    domain = dom.serviceDomainCreate?.domain || null
  } catch (err) {
    console.warn("domain create:", err.message)
  }

  if (domain) {
    const serverUrl = `https://${domain}`
    await gql(
      token,
      `mutation($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }`,
      {
        input: {
          projectId: PROJECT_ID,
          environmentId: ENV_ID,
          serviceId: service.id,
          variables: { SERVER_URL: serverUrl },
          replace: false,
        },
      },
    )
  }

  // Volume (sessões) — best-effort
  try {
    await gql(
      token,
      `mutation($input: VolumeCreateInput!) {
        volumeCreate(input: $input) { id name }
      }`,
      {
        input: {
          projectId: PROJECT_ID,
          environmentId: ENV_ID,
          serviceId: service.id,
          mountPath: "/evolution/instances",
        },
      },
    )
    console.log("volume created")
  } catch (err) {
    console.warn("volume create (may need manual):", err.message)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        service,
        branch: BRANCH,
        domain,
        next: [
          "Confirmar branch canary/sync-history-patch no dashboard Railway",
          "Deploy do serviço canário",
          "Conectar 1 conta de teste via QR no canário",
          "NÃO migrar clientes ainda",
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
