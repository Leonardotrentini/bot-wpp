/**
 * Catálogo de métricas editáveis para a Visão geral.
 */

export const REPORT_CATEGORIES = {
  groups: 'Grupos',
  crm: 'CRM',
  meta: 'Meta Ads',
  attr: 'Atribuição',
}

/** @typedef {'kpi'|'area'|'bar'|'bar_horizontal'|'table'|'funnel'|'list'|'conversions'} ChartType */

/**
 * @typedef {Object} MetricDef
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {keyof typeof REPORT_CATEGORIES} category
 * @property {ChartType} chartType
 * @property {'number'|'percent'|'currency'} [format]
 * @property {number} [defaultColSpan]
 */

/** @type {MetricDef[]} */
export const REPORT_METRIC_CATALOG = [
  // Grupos — KPIs
  {
    id: 'groups.active',
    label: 'Grupos ativos',
    description: 'Grupos conectados e monitorados',
    category: 'groups',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  {
    id: 'groups.new_leads',
    label: 'Novos leads',
    description: 'Novos membros desde a ativação do grupo',
    category: 'groups',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  {
    id: 'groups.exits',
    label: 'Saídas',
    description: 'Membros que saíram no período',
    category: 'groups',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  {
    id: 'groups.active_pct',
    label: '% membros ativos',
    description: 'Participantes com status ativo nos grupos',
    category: 'groups',
    chartType: 'kpi',
    format: 'percent',
    defaultColSpan: 1,
  },
  {
    id: 'groups.messages_today',
    label: 'Mensagens hoje',
    description: 'Total de mensagens enviadas hoje',
    category: 'groups',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  // Grupos — gráficos
  {
    id: 'groups.messages_series',
    label: 'Mensagens por dia',
    description: 'Volume de mensagens ao longo do período',
    category: 'groups',
    chartType: 'area',
    defaultColSpan: 2,
  },
  {
    id: 'groups.messages_by_hour',
    label: 'Mensagens por hora',
    description: 'Distribuição horária de mensagens',
    category: 'groups',
    chartType: 'bar',
    defaultColSpan: 1,
  },
  {
    id: 'groups.top_groups',
    label: 'Grupos mais ativos (24h)',
    description: 'Ranking de grupos por mensagens nas últimas 24h',
    category: 'groups',
    chartType: 'list',
    defaultColSpan: 1,
  },
  {
    id: 'groups.top_members',
    label: 'Quem mais falou',
    description: 'Membros com mais mensagens no período',
    category: 'groups',
    chartType: 'bar_horizontal',
    defaultColSpan: 1,
  },
  {
    id: 'groups.top_messages',
    label: 'Mensagens com engajamento',
    description: 'Mensagens com mais respostas e reações',
    category: 'groups',
    chartType: 'list',
    defaultColSpan: 1,
  },
  {
    id: 'groups.comparison_table',
    label: 'Resumo por grupo',
    description: 'Comparativo de mensagens e membros por grupo',
    category: 'groups',
    chartType: 'table',
    defaultColSpan: 2,
  },
  {
    id: 'groups.recent_activities',
    label: 'Atividades recentes',
    description: 'Últimas ações nos grupos',
    category: 'groups',
    chartType: 'list',
    defaultColSpan: 2,
  },
  // CRM — KPIs
  {
    id: 'crm.open',
    label: 'Conversas abertas',
    description: 'Conversas com status aberto',
    category: 'crm',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  {
    id: 'crm.pending',
    label: 'Conversas pendentes',
    description: 'Aguardando atendimento',
    category: 'crm',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  {
    id: 'crm.contacts',
    label: 'Total contatos',
    description: 'Contatos no CRM',
    category: 'crm',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  {
    id: 'crm.unread',
    label: 'Não lidas',
    description: 'Conversas com mensagens não lidas',
    category: 'crm',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  {
    id: 'crm.sales_count',
    label: 'Vendas',
    description: 'Compras confirmadas no período',
    category: 'crm',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  {
    id: 'crm.sales_revenue',
    label: 'Receita CRM',
    description: 'Soma dos valores de vendas confirmadas',
    category: 'crm',
    chartType: 'kpi',
    format: 'currency',
    defaultColSpan: 1,
  },
  {
    id: 'crm.avg_ticket',
    label: 'Ticket médio',
    description: 'Valor médio por venda',
    category: 'crm',
    chartType: 'kpi',
    format: 'currency',
    defaultColSpan: 1,
  },
  {
    id: 'crm.roas',
    label: 'ROAS estimado',
    description: 'Receita CRM ÷ investimento Meta Ads',
    category: 'crm',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  // CRM — gráficos
  {
    id: 'crm.funnel_stages',
    label: 'Funil por estágio',
    description: 'Distribuição de conversas no kanban',
    category: 'crm',
    chartType: 'funnel',
    defaultColSpan: 1,
  },
  {
    id: 'crm.funnel_events_series',
    label: 'Eventos do funil',
    description: 'Leads, orçamentos e vendas por dia',
    category: 'crm',
    chartType: 'area',
    defaultColSpan: 2,
  },
  {
    id: 'crm.sales_series',
    label: 'Vendas no período',
    description: 'Quantidade e valor de vendas por dia',
    category: 'crm',
    chartType: 'area',
    defaultColSpan: 1,
  },
  // Meta Ads
  {
    id: 'meta.spend',
    label: 'Investimento',
    description: 'Gasto total em anúncios Meta',
    category: 'meta',
    chartType: 'kpi',
    format: 'currency',
    defaultColSpan: 1,
  },
  {
    id: 'meta.clicks',
    label: 'Cliques',
    description: 'Cliques nos anúncios',
    category: 'meta',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  {
    id: 'meta.cpc',
    label: 'CPC',
    description: 'Custo por clique',
    category: 'meta',
    chartType: 'kpi',
    format: 'currency',
    defaultColSpan: 1,
  },
  {
    id: 'meta.cpm',
    label: 'CPM',
    description: 'Custo por mil impressões',
    category: 'meta',
    chartType: 'kpi',
    format: 'currency',
    defaultColSpan: 1,
  },
  {
    id: 'meta.ctr',
    label: 'CTR',
    description: 'Taxa de cliques',
    category: 'meta',
    chartType: 'kpi',
    format: 'percent',
    defaultColSpan: 1,
  },
  {
    id: 'meta.campaigns_table',
    label: 'Campanhas Meta',
    description: 'Performance por campanha',
    category: 'meta',
    chartType: 'table',
    defaultColSpan: 2,
  },
  {
    id: 'meta.conversions',
    label: 'Conversões Meta',
    description: 'Eventos enviados ao Meta CAPI no período',
    category: 'meta',
    chartType: 'conversions',
    defaultColSpan: 2,
  },
  // Atribuição
  {
    id: 'attr.leads_count',
    label: 'Leads da LP',
    description: 'Cliques rastreados na landing page',
    category: 'attr',
    chartType: 'kpi',
    format: 'number',
    defaultColSpan: 1,
  },
  {
    id: 'attr.by_source',
    label: 'Leads por origem',
    description: 'Distribuição por utm_source',
    category: 'attr',
    chartType: 'bar_horizontal',
    defaultColSpan: 1,
  },
  {
    id: 'attr.by_campaign',
    label: 'Leads por campanha',
    description: 'Distribuição por utm_campaign',
    category: 'attr',
    chartType: 'bar_horizontal',
    defaultColSpan: 1,
  },
]

const catalogById = new Map(REPORT_METRIC_CATALOG.map((m) => [m.id, m]))

export function getMetricDef(metricId) {
  return catalogById.get(metricId) || null
}

export function getMetricsByCategory() {
  const grouped = {}
  for (const m of REPORT_METRIC_CATALOG) {
    if (!grouped[m.category]) grouped[m.category] = []
    grouped[m.category].push(m)
  }
  return grouped
}

export const DEFAULT_REPORT_WIDGETS = [
  { id: 'w1', metricId: 'groups.active', colSpan: 1 },
  { id: 'w2', metricId: 'groups.new_leads', colSpan: 1 },
  { id: 'w3', metricId: 'crm.sales_revenue', colSpan: 1 },
  { id: 'w4', metricId: 'meta.spend', colSpan: 1 },
  { id: 'w5', metricId: 'groups.messages_series', colSpan: 2 },
  { id: 'w6', metricId: 'crm.funnel_stages', colSpan: 1 },
  { id: 'w7', metricId: 'groups.top_groups', colSpan: 1 },
  { id: 'w8', metricId: 'crm.sales_series', colSpan: 1 },
  { id: 'w9', metricId: 'groups.comparison_table', colSpan: 2 },
  { id: 'w10', metricId: 'meta.campaigns_table', colSpan: 2 },
  { id: 'w11', metricId: 'meta.conversions', colSpan: 2 },
]

export const DEFAULT_REPORT_FILTERS = {
  period: '7d',
  groupIds: [],
  metaPeriod: '7d',
}

export function createWidgetId() {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function formatCurrency(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}

function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toFixed(1)}%`
}

export function formatMetricValue(value, format) {
  if (value == null || value === '') return '—'
  if (format === 'currency') return formatCurrency(value)
  if (format === 'percent') return formatPercent(value)
  if (typeof value === 'number') return String(value)
  return String(value)
}

/** Resolve dados de um widget a partir da resposta da API. */
export function resolveMetricData(metricId, data) {
  if (!data) return { empty: true }

  const g = data.groups
  const c = data.crm
  const m = data.meta
  const a = data.attribution

  switch (metricId) {
    case 'groups.active':
      return { value: g?.connectedGroupsCount ?? 0, hint: g?.connectedGroupsLabel }
    case 'groups.new_leads':
      return { value: g?.newLeads ?? 0, hint: 'Novos membros no período' }
    case 'groups.exits':
      return { value: g?.exits ?? 0, hint: 'Saídas detectadas' }
    case 'groups.active_pct':
      return {
        value: g?.activeLeadsPct ?? 0,
        hint: `${g?.activeLeads ?? 0} ativos · ${g?.inactiveLeads ?? 0} inativos`,
      }
    case 'groups.messages_today':
      return { value: g?.messagesToday ?? 0 }
    case 'groups.messages_series':
      return { series: g?.messagesByDay || [], dataKey: 'msgs', xKey: 'day' }
    case 'groups.messages_by_hour':
      return { series: g?.messagesByHour || [], dataKey: 'count', xKey: 'hour' }
    case 'groups.top_groups':
      return { items: (g?.topGroups || []).map((x) => ({ label: x.name, value: `${x.messages24h} msg`, id: x.id })) }
    case 'groups.top_members':
      return { series: [...(g?.topMembers || [])].reverse(), dataKey: 'msgs', xKey: 'name' }
    case 'groups.top_messages':
      return {
        items: (g?.topMessages || []).slice(0, 8).map((msg) => ({
          id: msg.id,
          label: msg.title,
          sub: `${msg.group}${msg.senderName ? ` · ${msg.senderName}` : ''}`,
          value: msg.interactions > 0 ? `${msg.interactions} interação(ões)` : 'Sem interações',
        })),
      }
    case 'groups.comparison_table':
      return {
        columns: [
          { key: 'name', label: 'Grupo' },
          { key: 'messages', label: 'Mensagens' },
          { key: 'members', label: 'Membros' },
          { key: 'engagement', label: '% ativos' },
        ],
        rows: (g?.groupComparison || []).map((row) => ({
          ...row,
          engagement: `${row.engagement}%`,
          link: `/dashboard/groups/${encodeURIComponent(row.id)}`,
        })),
      }
    case 'groups.recent_activities':
      return {
        items: (g?.recentActivities || []).map((x) => ({
          id: x.id,
          label: x.text,
          value: x.time,
        })),
      }
    case 'crm.open':
      return { value: c?.overview?.open ?? 0 }
    case 'crm.pending':
      return { value: c?.overview?.pending ?? 0 }
    case 'crm.contacts':
      return { value: c?.overview?.contacts ?? 0 }
    case 'crm.unread':
      return { value: c?.overview?.unread ?? 0 }
    case 'crm.sales_count':
      return { value: c?.sales?.summary?.count ?? 0 }
    case 'crm.sales_revenue':
      return { value: c?.sales?.summary?.totalAmount ?? 0 }
    case 'crm.avg_ticket':
      return { value: c?.sales?.summary?.averageAmount ?? 0 }
    case 'crm.roas': {
      const revenue = c?.sales?.summary?.totalAmount ?? 0
      const spend = m?.summary?.spend ?? 0
      return {
        value: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null,
        hint: spend > 0 ? `R$ ${revenue} / R$ ${spend}` : 'Requer investimento Meta',
      }
    }
    case 'crm.funnel_stages':
      return { stages: c?.funnel || [] }
    case 'crm.funnel_events_series':
      return {
        series: c?.funnelEvents || [],
        multiSeries: [
          { key: 'lead_created', label: 'Leads', color: '#22c55e' },
          { key: 'quote_saved', label: 'Orçamentos', color: '#eab308' },
          { key: 'purchase_confirmed', label: 'Vendas', color: '#3b82f6' },
        ],
        xKey: 'date',
      }
    case 'crm.sales_series':
      return {
        series: (c?.sales?.byDay || []).map((d) => ({ ...d, count: d.count, amount: d.amount })),
        dataKey: 'count',
        xKey: 'date',
      }
    case 'meta.spend':
      return { value: m?.summary?.spend ?? null, unavailable: !m?.summary }
    case 'meta.clicks':
      return { value: m?.summary?.clicks ?? null, unavailable: !m?.summary }
    case 'meta.cpc':
      return { value: m?.summary?.cpc ?? null, unavailable: !m?.summary }
    case 'meta.cpm':
      return { value: m?.summary?.cpm ?? null, unavailable: !m?.summary }
    case 'meta.ctr':
      return { value: m?.summary?.ctr ?? null, unavailable: !m?.summary }
    case 'meta.campaigns_table':
      return {
        columns: [
          { key: 'name', label: 'Campanha' },
          { key: 'spend', label: 'Gasto' },
          { key: 'clicks', label: 'Cliques' },
          { key: 'ctr', label: 'CTR' },
        ],
        rows: (m?.campaigns || []).map((row) => ({
          ...row,
          spend: formatCurrency(row.spend),
          ctr: row.ctr != null ? formatPercent(row.ctr) : '—',
        })),
        unavailable: !m?.summary,
      }
    case 'meta.conversions': {
      const conv = m?.conversions || c?.conversions || {}
      return {
        steps: [
          { label: 'Conversa iniciada', value: conv.conversationStarted ?? 0 },
          { label: 'Lead qualificado', value: conv.leadQualified ?? 0 },
          { label: 'Orçamento', value: conv.quote ?? 0 },
          { label: 'Compra', value: conv.purchase ?? 0 },
        ],
      }
    }
    case 'attr.leads_count':
      return { value: a?.total ?? 0, hint: 'Cliques rastreados na LP (TTL 14 dias)' }
    case 'attr.by_source':
      return {
        series: (a?.bySource || []).map((x) => ({ name: x.source, msgs: x.count })),
        dataKey: 'msgs',
        xKey: 'name',
      }
    case 'attr.by_campaign':
      return {
        series: (a?.byCampaign || []).map((x) => ({ name: x.campaign, msgs: x.count })),
        dataKey: 'msgs',
        xKey: 'name',
      }
    default:
      return { empty: true }
  }
}

export function getMetricSourceNote(metricId, data) {
  const retention = data?.meta_info?.groupsRetentionDays ?? 2
  if (metricId.startsWith('groups.')) {
    return `Mensagens de grupo: janela de ${retention} dias.`
  }
  if (metricId.startsWith('crm.')) {
    return 'CRM: histórico completo no período selecionado.'
  }
  if (metricId.startsWith('meta.')) {
    if (!data?.meta?.summary) return data?.meta?.message || 'Meta Ads não conectado.'
    return 'Meta Ads: dados da Marketing API.'
  }
  if (metricId.startsWith('attr.')) {
    return 'Atribuição LP: leads com TTL de 14 dias.'
  }
  return null
}
