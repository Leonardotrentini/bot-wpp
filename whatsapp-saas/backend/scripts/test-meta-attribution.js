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

testDomains()
testRef()
console.log("✓ Meta attribution unit tests OK")
