/**
 * Google Tag Manager — container por tenant (LP).
 */

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/i

function normalizeGtmContainerId(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
  if (!raw) return null
  if (!raw.startsWith("GTM-")) return null
  return raw
}

function isValidGtmContainerId(value) {
  const id = normalizeGtmContainerId(value)
  return Boolean(id && GTM_ID_PATTERN.test(id) && id.length >= 8)
}

function formatGtmIntegrationRow(row) {
  if (!row) return null
  const containerId = normalizeGtmContainerId(row.containerId) || ""
  return {
    containerId,
    enabled: row.enabled !== false,
    connected: Boolean(containerId && row.enabled !== false),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  }
}

function buildGtmHeadSnippet(containerId) {
  const id = normalizeGtmContainerId(containerId)
  if (!id) return ""
  return `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${id}');</script>
<!-- End Google Tag Manager -->`
}

function buildGtmBodySnippet(containerId) {
  const id = normalizeGtmContainerId(containerId)
  if (!id) return ""
  return `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`
}

async function getGtmIntegration(prisma, userId) {
  const row = await prisma.gtmIntegration.findUnique({ where: { userId } })
  return formatGtmIntegrationRow(row)
}

async function upsertGtmIntegration(prisma, userId, data) {
  const containerId = normalizeGtmContainerId(data.containerId)
  if (!containerId || !isValidGtmContainerId(containerId)) {
    return {
      error: "VALIDATION",
      message: "Informe um ID de container válido (ex.: GTM-XXXXXXX).",
    }
  }

  const enabled = data.enabled !== false

  const row = await prisma.gtmIntegration.upsert({
    where: { userId },
    create: { userId, containerId, enabled },
    update: { containerId, enabled },
  })

  return { integration: formatGtmIntegrationRow(row) }
}

async function getGtmForPublicConfig(prisma, userId) {
  const row = await prisma.gtmIntegration.findUnique({ where: { userId } })
  if (!row || row.enabled === false) return null
  const containerId = normalizeGtmContainerId(row.containerId)
  if (!containerId) return null
  return { containerId, enabled: true }
}

module.exports = {
  normalizeGtmContainerId,
  isValidGtmContainerId,
  formatGtmIntegrationRow,
  buildGtmHeadSnippet,
  buildGtmBodySnippet,
  getGtmIntegration,
  upsertGtmIntegration,
  getGtmForPublicConfig,
}
