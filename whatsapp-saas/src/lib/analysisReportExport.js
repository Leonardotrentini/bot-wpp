/** Gera e baixa relatórios da Análise IA (Markdown). */

function slugify(text) {
  return String(text || 'relatorio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function formatScore(score) {
  if (score == null || Number.isNaN(Number(score))) return 'N/A'
  return `${Number(score).toFixed(1)}/5`
}

function formatPeriod(run) {
  const from = run?.periodFrom ? new Date(run.periodFrom).toLocaleDateString('pt-BR') : '—'
  const to = run?.periodTo ? new Date(run.periodTo).toLocaleDateString('pt-BR') : '—'
  return `${from} a ${to}`
}

function criterionLabel(profile, criterionId) {
  return profile?.criteria?.find((c) => c.id === criterionId)?.label || criterionId
}

function downloadText(filename, content) {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatConversationBlock(r, profile) {
  const lines = []
  lines.push(`### ${r.contactName || 'Contato'} — ${formatScore(r.overallScore)}`)
  lines.push(`- Mensagens: ${r.messageCount ?? '—'}`)
  if (r.analyzedAt) lines.push(`- Analisado em: ${new Date(r.analyzedAt).toLocaleString('pt-BR')}`)

  if (r.resumoGeral?.momentoCritico) {
    lines.push(`\n**Momento crítico:** ${r.resumoGeral.momentoCritico}`)
  }
  if (r.resumoGeral?.acaoPrioritaria) {
    lines.push(`\n**Ação prioritária:** ${r.resumoGeral.acaoPrioritaria}`)
  }
  if (r.summary && !r.resumoGeral?.momentoCritico) {
    lines.push(`\n${r.summary}`)
  }

  if (r.strengths?.length) {
    lines.push('\n**Pontos fortes:**')
    for (const s of r.strengths) lines.push(`- ${s}`)
  }
  if (r.weaknesses?.length) {
    lines.push('\n**Pontos fracos:**')
    for (const w of r.weaknesses) lines.push(`- ${w}`)
  }

  const criteria = profile?.criteria || []
  const scored = criteria.filter((c) => r.scores?.[c.id] != null)
  if (scored.length) {
    lines.push('\n**Notas por critério:**')
    for (const c of scored) {
      lines.push(`- ${c.label}: ${formatScore(r.scores[c.id])}`)
    }
  }

  if (r.failures?.length) {
    lines.push('\n**Análise por critério:**')
    for (const f of r.failures) {
      lines.push(`\n#### ${f.criterionName || criterionLabel(profile, f.criterionId)}${f.nota != null ? ` (${formatScore(f.nota)})` : ''}`)
      if (f.issue) lines.push(f.issue)
      if (f.positiveQuote) lines.push(`\n> ✓ "${f.positiveQuote}"`)
      if (f.quote) lines.push(`\n> ✗ "${f.quote}"`)
      if (f.suggestion) lines.push(`\n→ ${f.suggestion}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

export function buildGeneralReportMarkdown({ run, profile, results, accountName }) {
  const summaries = run?.sellerSummaries || {}
  const narrative = summaries.narrative || ''
  const orgIssues = summaries.orgTopIssues || []
  const sellers = summaries.sellers || []
  const date = new Date().toISOString().slice(0, 10)

  const lines = []
  lines.push('# Relatório Geral — Análise IA\n')
  if (accountName) lines.push(`**Conta:** ${accountName}`)
  lines.push(`**Perfil:** ${profile?.name || 'Análise de vendas'}`)
  lines.push(`**Período:** ${formatPeriod(run)}`)
  lines.push(`**Gerado em:** ${new Date().toLocaleString('pt-BR')}`)
  lines.push(`**Conversas analisadas:** ${run?.doneConversations ?? results.length}`)
  lines.push(`**Vendedores:** ${sellers.length}`)

  if (narrative) {
    lines.push('\n## Panorama da equipe\n')
    lines.push(narrative)
  }

  if (orgIssues.length) {
    lines.push('\n## Falhas mais frequentes\n')
    for (const issue of orgIssues) {
      lines.push(`- **${issue.label}:** ${issue.count} ocorrência(s)`)
    }
  }

  if (sellers.length) {
    lines.push('\n## Resumo por vendedor\n')
    lines.push('| Vendedor | Nota média | Conversas | Principais falhas |')
    lines.push('| --- | --- | --- | --- |')
    for (const s of sellers) {
      const fails = (s.topFailureAreas || [])
        .slice(0, 3)
        .map((f) => `${f.label} (${f.count}x)`)
        .join('; ') || '—'
      lines.push(`| ${s.sellerName} | ${formatScore(s.overallAvg)} | ${s.conversationCount} | ${fails} |`)
    }

    for (const s of sellers) {
      lines.push(`\n### ${s.sellerName}`)
      lines.push(`- Nota média: ${formatScore(s.overallAvg)}`)
      lines.push(`- Conversas: ${s.conversationCount}`)
      if (s.topFailureAreas?.length) {
        lines.push('- Áreas com mais falhas:')
        for (const f of s.topFailureAreas) {
          lines.push(`  - ${f.label}: ${f.count}x`)
        }
      }
      if (s.recurringWeaknesses?.length) {
        lines.push('- Padrões recorrentes:')
        for (const w of s.recurringWeaknesses.slice(0, 5)) {
          lines.push(`  - ${w.text} (${w.count}x)`)
        }
      }
      const avgScores = s.avgScores || {}
      const criteria = profile?.criteria || []
      const withAvg = criteria.filter((c) => avgScores[c.id] != null)
      if (withAvg.length) {
        lines.push('- Média por critério:')
        for (const c of withAvg) {
          lines.push(`  - ${c.label}: ${formatScore(avgScores[c.id])}`)
        }
      }
    }
  }

  if (results?.length) {
    lines.push('\n## Detalhamento por conversa\n')
    const bySeller = new Map()
    for (const r of results) {
      const key = r.userId || 'unknown'
      if (!bySeller.has(key)) bySeller.set(key, [])
      bySeller.get(key).push(r)
    }
    for (const s of sellers) {
      const convs = bySeller.get(s.userId) || []
      if (!convs.length) continue
      lines.push(`\n---\n\n## Conversas — ${s.sellerName}\n`)
      for (const r of convs) {
        lines.push(formatConversationBlock(r, profile))
      }
    }
    const orphan = results.filter((r) => !sellers.some((s) => s.userId === r.userId))
    if (orphan.length) {
      lines.push('\n---\n\n## Outras conversas\n')
      for (const r of orphan) lines.push(formatConversationBlock(r, profile))
    }
  }

  lines.push('\n---\n_Relatório gerado automaticamente pela Análise IA._\n')
  return { content: lines.join('\n'), filename: `analise-ia-geral-${date}.md` }
}

export function buildSellerReportMarkdown({ run, profile, seller, results, accountName }) {
  const date = new Date().toISOString().slice(0, 10)
  const name = seller?.sellerName || 'vendedor'

  const lines = []
  lines.push(`# Relatório Individual — ${name}\n`)
  if (accountName) lines.push(`**Conta:** ${accountName}`)
  lines.push(`**Perfil:** ${profile?.name || 'Análise de vendas'}`)
  lines.push(`**Período:** ${formatPeriod(run)}`)
  lines.push(`**Gerado em:** ${new Date().toLocaleString('pt-BR')}`)
  lines.push(`**Nota média:** ${formatScore(seller?.overallAvg)}`)
  lines.push(`**Conversas analisadas:** ${seller?.conversationCount ?? results.length}`)

  if (seller?.topFailureAreas?.length) {
    lines.push('\n## Principais falhas\n')
    for (const f of seller.topFailureAreas) {
      lines.push(`- **${f.label}:** ${f.count} ocorrência(s)`)
    }
  }

  if (seller?.recurringWeaknesses?.length) {
    lines.push('\n## Padrões recorrentes\n')
    for (const w of seller.recurringWeaknesses) {
      lines.push(`- ${w.text} (${w.count}x)`)
    }
  }

  const avgScores = seller?.avgScores || {}
  const criteria = profile?.criteria || []
  const withAvg = criteria.filter((c) => avgScores[c.id] != null)
  if (withAvg.length) {
    lines.push('\n## Média por critério\n')
    for (const c of withAvg) {
      lines.push(`- **${c.label}:** ${formatScore(avgScores[c.id])}`)
    }
  }

  if (results?.length) {
    lines.push('\n## Conversas analisadas\n')
    for (const r of results) {
      lines.push(formatConversationBlock(r, profile))
      lines.push('---\n')
    }
  } else {
    lines.push('\n_Nenhuma conversa encontrada neste lote para este vendedor._\n')
  }

  lines.push('\n_Relatório gerado automaticamente pela Análise IA._\n')
  return { content: lines.join('\n'), filename: `analise-ia-${slugify(name)}-${date}.md` }
}

export function downloadGeneralReport(payload) {
  const { content, filename } = buildGeneralReportMarkdown(payload)
  downloadText(filename, content)
}

export function downloadSellerReport(payload) {
  const { content, filename } = buildSellerReportMarkdown(payload)
  downloadText(filename, content)
}
