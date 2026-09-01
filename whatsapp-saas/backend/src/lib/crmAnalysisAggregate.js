/**
 * Agregação de análises por vendedor e resumo geral de falhas.
 */

function weightedAverage(scores, criteria) {
  const list = Array.isArray(criteria) ? criteria : []
  let sum = 0
  let weight = 0
  for (const c of list) {
    const id = String(c.id || "")
    const w = Number(c.weight) > 0 ? Number(c.weight) : 1
    const v = Number(scores?.[id])
    if (!Number.isFinite(v)) continue
    sum += v * w
    weight += w
  }
  return weight > 0 ? Math.round((sum / weight) * 100) / 100 : null
}

function buildSellerSummaries(analyses, criteria, sellerNames = {}) {
  const bySeller = new Map()

  for (const row of analyses) {
    const uid = row.userId
    if (!bySeller.has(uid)) {
      bySeller.set(uid, {
        userId: uid,
        sellerName: sellerNames[uid] || uid,
        conversationCount: 0,
        scoresSum: {},
        scoresCount: {},
        failures: [],
        weaknesses: [],
        summaries: [],
      })
    }
    const bucket = bySeller.get(uid)
    bucket.conversationCount += 1
    if (row.summary) bucket.summaries.push(String(row.summary).slice(0, 400))

    const scores = row.scores && typeof row.scores === "object" ? row.scores : {}
    for (const [k, v] of Object.entries(scores)) {
      const n = Number(v)
      if (!Number.isFinite(n)) continue
      bucket.scoresSum[k] = (bucket.scoresSum[k] || 0) + n
      bucket.scoresCount[k] = (bucket.scoresCount[k] || 0) + 1
    }

    const failures = Array.isArray(row.failures) ? row.failures : []
    for (const f of failures) {
      bucket.failures.push({ ...f, conversationId: row.conversationId })
    }

    const weaknesses = Array.isArray(row.weaknesses) ? row.weaknesses : []
    for (const w of weaknesses) {
      if (w) bucket.weaknesses.push(String(w))
    }
  }

  const sellers = []
  for (const bucket of bySeller.values()) {
    const avgScores = {}
    for (const c of criteria || []) {
      const id = String(c.id || "")
      const count = bucket.scoresCount[id] || 0
      if (count > 0) avgScores[id] = Math.round((bucket.scoresSum[id] / count) * 100) / 100
    }

    const failureByCriterion = {}
    for (const f of bucket.failures) {
      const cid = String(f.criterionId || f.criterion || "geral")
      failureByCriterion[cid] = (failureByCriterion[cid] || 0) + 1
    }
    const topFailureAreas = Object.entries(failureByCriterion)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([criterionId, count]) => {
        const label = (criteria || []).find((c) => c.id === criterionId)?.label || criterionId
        return { criterionId, label, count }
      })

    const weaknessFreq = {}
    for (const w of bucket.weaknesses) {
      const key = w.toLowerCase().trim()
      if (!key) continue
      weaknessFreq[key] = (weaknessFreq[key] || 0) + 1
    }
    const recurringWeaknesses = Object.entries(weaknessFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([text, count]) => ({ text, count }))

    const overallAvg =
      analyses
        .filter((a) => a.userId === bucket.userId)
        .map((a) => a.overallScore)
        .filter((n) => Number.isFinite(n))
        .reduce((s, n, _, arr) => s + n / arr.length, 0) || weightedAverage(avgScores, criteria)

    sellers.push({
      userId: bucket.userId,
      sellerName: bucket.sellerName,
      conversationCount: bucket.conversationCount,
      avgScores,
      overallAvg: overallAvg ? Math.round(overallAvg * 100) / 100 : null,
      topFailureAreas,
      recurringWeaknesses,
      sampleSummaries: bucket.summaries.slice(0, 3),
    })
  }

  sellers.sort((a, b) => (a.overallAvg ?? 0) - (b.overallAvg ?? 0))

  const globalFailures = {}
  for (const s of sellers) {
    for (const t of s.topFailureAreas) {
      globalFailures[t.criterionId] = (globalFailures[t.criterionId] || 0) + t.count
    }
  }
  const orgTopIssues = Object.entries(globalFailures)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([criterionId, count]) => {
      const label = (criteria || []).find((c) => c.id === criterionId)?.label || criterionId
      return { criterionId, label, count }
    })

  return {
    sellers,
    orgTopIssues,
    totalAnalyzed: analyses.length,
  }
}

function buildGeneralNarrative(aggregate, criteria) {
  if (!aggregate?.sellers?.length) {
    return "Nenhuma conversa analisada neste lote."
  }
  const lines = []
  lines.push(`Foram analisadas ${aggregate.totalAnalyzed} conversa(s) de ${aggregate.sellers.length} vendedor(es).`)

  if (aggregate.orgTopIssues.length) {
    const issues = aggregate.orgTopIssues.map((i) => `${i.label} (${i.count}x)`).join(", ")
    lines.push(`Principais áreas com falhas na equipe: ${issues}.`)
  }

  for (const s of aggregate.sellers) {
    const score = s.overallAvg != null ? `nota média ${s.overallAvg}/5` : "sem nota média"
    const weak =
      s.recurringWeaknesses.length > 0
        ? ` — padrões: ${s.recurringWeaknesses
            .slice(0, 3)
            .map((w) => w.text)
            .join("; ")}`
        : ""
    lines.push(`${s.sellerName}: ${s.conversationCount} conversa(s), ${score}${weak}.`)
  }

  return lines.join("\n")
}

module.exports = { buildSellerSummaries, buildGeneralNarrative, weightedAverage }
