/**
 * Testes — agregação de análise de conversas.
 * Uso: node scripts/test-crm-analysis.js
 */
const assert = require("assert")
const { buildSellerSummaries, buildGeneralNarrative } = require("../src/lib/crmAnalysisAggregate")
const { DEFAULT_ANALYSIS_CRITERIA } = require("../src/lib/crmAnalysisDefaults")

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed += 1
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
  }
}

console.log("\ncrm-analysis — testes\n")

test("buildSellerSummaries agrupa por vendedor", () => {
  const analyses = [
    {
      userId: "u1",
      conversationId: "c1",
      scores: { rapport: 2, closing: 3 },
      failures: [{ criterionId: "rapport", issue: "Sem empatia" }],
      weaknesses: ["Resposta seca"],
      summary: "Lead frio",
      overallScore: 2.5,
    },
    {
      userId: "u1",
      conversationId: "c2",
      scores: { rapport: 4, closing: 2 },
      failures: [{ criterionId: "closing", issue: "Não fechou" }],
      weaknesses: ["Não enviou link"],
      summary: "Quase fechou",
      overallScore: 3,
    },
  ]
  const agg = buildSellerSummaries(analyses, DEFAULT_ANALYSIS_CRITERIA, { u1: "Maria" })
  assert.strictEqual(agg.sellers.length, 1)
  assert.strictEqual(agg.sellers[0].sellerName, "Maria")
  assert.strictEqual(agg.sellers[0].conversationCount, 2)
  assert.ok(agg.orgTopIssues.length > 0)
})

test("buildGeneralNarrative menciona vendedores", () => {
  const agg = {
    totalAnalyzed: 2,
    orgTopIssues: [{ criterionId: "rapport", label: "Rapport", count: 1 }],
    sellers: [{ sellerName: "Maria", conversationCount: 2, overallAvg: 2.75, recurringWeaknesses: [] }],
  }
  const text = buildGeneralNarrative(agg, DEFAULT_ANALYSIS_CRITERIA)
  assert.ok(text.includes("Maria"))
  assert.ok(text.includes("2 conversa"))
})

console.log(`\n${passed} passou, ${failed} falhou\n`)
process.exit(failed ? 1 : 0)
