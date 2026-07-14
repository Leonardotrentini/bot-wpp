import {
  DEFAULT_REPORT_FILTERS,
  DEFAULT_REPORT_WIDGETS,
  createWidgetId,
  getMetricDef,
} from './reportMetricCatalog.js'
import { DEFAULT_FUNNEL_STEPS, normalizeFunnelSteps } from './reportFunnelConfig.js'

const STORAGE_VERSION = 4

const LEGACY_DEFAULT_METRIC_IDS = [
  'groups.active',
  'crm.conversations_started',
  'crm.sales_revenue',
  'meta.spend',
  'groups.messages_series',
  'crm.funnel_stages',
  'groups.top_groups',
  'crm.sales_series',
  'groups.comparison_table',
  'meta.campaigns_table',
  'meta.conversions',
]

function isLegacyDefaultLayout(widgets) {
  if (!Array.isArray(widgets) || widgets.length !== LEGACY_DEFAULT_METRIC_IDS.length) return false
  const ids = widgets.map((w) => w.metricId).sort()
  const legacy = [...LEGACY_DEFAULT_METRIC_IDS].sort()
  return ids.every((id, i) => id === legacy[i])
}

function defaultLayout() {
  return {
    version: STORAGE_VERSION,
    filters: { ...DEFAULT_REPORT_FILTERS },
    widgets: DEFAULT_REPORT_WIDGETS.map((w) => ({ ...w })),
    funnelSteps: DEFAULT_FUNNEL_STEPS.map((s) => ({ ...s, tagIds: [] })),
  }
}

function migrateLayout(parsed) {
  if (!parsed?.widgets) return { ...defaultLayout(), ...parsed, funnelSteps: normalizeFunnelSteps(parsed.funnelSteps) }

  let widgets = parsed.widgets.map((w) =>
    w.id === 'w2' && w.metricId === 'groups.new_leads'
      ? { ...w, metricId: 'crm.conversations_started' }
      : w,
  )

  if ((parsed.version === 2 || parsed.version === 3) && isLegacyDefaultLayout(widgets)) {
    widgets = DEFAULT_REPORT_WIDGETS.map((w) => ({ ...w }))
  }

  return {
    ...parsed,
    widgets,
    funnelSteps: normalizeFunnelSteps(parsed.funnelSteps),
    version: STORAGE_VERSION,
  }
}

function storageKey(userId) {
  return `vesto_report_layout_${String(userId || 'default')}`
}

export function loadReportLayout(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return defaultLayout()
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== STORAGE_VERSION) {
      const migrated =
        parsed?.version === 1 || parsed?.version === 2 || parsed?.version === 3
          ? migrateLayout(parsed)
          : null
      if (migrated) {
        saveReportLayout(userId, migrated)
        return migrated
      }
      return defaultLayout()
    }
    return {
      version: STORAGE_VERSION,
      filters: { ...DEFAULT_REPORT_FILTERS, ...(parsed.filters || {}) },
      widgets: Array.isArray(parsed.widgets) && parsed.widgets.length
        ? parsed.widgets
        : DEFAULT_REPORT_WIDGETS.map((w) => ({ ...w })),
      funnelSteps: normalizeFunnelSteps(parsed.funnelSteps),
    }
  } catch {
    return defaultLayout()
  }
}

export function saveReportLayout(userId, layout) {
  try {
    localStorage.setItem(
      storageKey(userId),
      JSON.stringify({
        version: STORAGE_VERSION,
        filters: layout.filters,
        widgets: layout.widgets,
        funnelSteps: normalizeFunnelSteps(layout.funnelSteps),
      }),
    )
  } catch {
    /* quota exceeded — ignora */
  }
}

export function resetReportLayout(userId) {
  try {
    localStorage.removeItem(storageKey(userId))
  } catch {
    /* ignore */
  }
  return defaultLayout()
}

export function addWidgetToLayout(layout, metricId) {
  if (layout.widgets.find((w) => w.metricId === metricId)) return layout
  const def = getMetricDef(metricId)
  return {
    ...layout,
    widgets: [
      ...layout.widgets,
      {
        id: createWidgetId(),
        metricId,
        colSpan: def?.defaultColSpan || 1,
      },
    ],
  }
}

export function removeWidgetFromLayout(layout, widgetId) {
  return {
    ...layout,
    widgets: layout.widgets.filter((w) => w.id !== widgetId),
  }
}

export function moveWidgetInLayout(layout, widgetId, direction) {
  const idx = layout.widgets.findIndex((w) => w.id === widgetId)
  if (idx < 0) return layout
  const next = direction === 'up' ? idx - 1 : idx + 1
  if (next < 0 || next >= layout.widgets.length) return layout
  const widgets = [...layout.widgets]
  const [item] = widgets.splice(idx, 1)
  widgets.splice(next, 0, item)
  return { ...layout, widgets }
}

export function updateLayoutFilters(layout, filters) {
  return {
    ...layout,
    filters: { ...layout.filters, ...filters },
  }
}

export function updateLayoutFunnelSteps(layout, funnelSteps) {
  return {
    ...layout,
    funnelSteps: normalizeFunnelSteps(funnelSteps),
  }
}
