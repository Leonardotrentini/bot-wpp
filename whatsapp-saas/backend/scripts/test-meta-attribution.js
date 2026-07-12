/**
 * Testes unitários — atribuição LP (ref vst_, domínios).
 * Uso: node scripts/test-meta-attribution.js
 */

const {
  parseAllowedOriginsInput,
  isOriginAllowed,
  extractVstRefFromText,
  validateRef,
  normalizeHostname,
} = require("../src/lib/metaAttributionLead")
const { isValidCtwaClid, extractCtwaClidFromRecord } = require("../src/lib/metaMessaging")

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function testDomains() {
  const list = parseAllowedOriginsInput("baseset.vercel.app\nhttps://www.Site.com/\n*.vercel.app")
  assert(list.includes("baseset.vercel.app"), "baseset")
  assert(list.includes("site.com"), "normalized site")
  assert(list.includes("*.vercel.app"), "wildcard kept")

  assert(isOriginAllowed(list, "https://baseset.vercel.app"), "exact origin")
  assert(isOriginAllowed(list, "https://foo.vercel.app"), "wildcard match")
  assert(!isOriginAllowed(list, "https://evil.com"), "reject evil")
  assert(!isOriginAllowed([], "https://baseset.vercel.app"), "empty list")
}

function testRef() {
  assert(validateRef("vst_abc12345"), "valid ref")
  assert(!validateRef("ref_bad"), "invalid ref")
  assert(extractVstRefFromText("Oi! (vst_t6xjrm54)") === "vst_t6xjrm54", "extract parens")
  assert(extractVstRefFromText("vst_abcdef12 no meio") === "vst_abcdef12", "extract inline")
  assert(normalizeHostname("https://WWW.Example.com/path") === "example.com", "normalize")
}

function testCtwaClid() {
  const valid =
    "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a"
  assert(isValidCtwaClid(valid), "valid ctwa_clid")
  assert(!isValidCtwaClid("short"), "reject short")
  assert(!isValidCtwaClid("notARAvalid123456789012345678901234567890"), "reject non-ARA")

  const record = {
    message: {
      extendedTextMessage: {
        text: "Oi",
        contextInfo: {
          externalAdReply: { ctwaClid: valid },
        },
      },
    },
  }
  assert(extractCtwaClidFromRecord(record) === valid, "baileys externalAdReply")
}

testDomains()
testRef()
testCtwaClid()
console.log("✓ Meta attribution unit tests OK")
