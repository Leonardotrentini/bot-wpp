import {
  DEFAULT_REPORT_FILTERS,
  DEFAULT_REPORT_WIDGETS,
  createWidgetId,
  getMetricDef,
} from './reportMetricCatalog.js'

const STORAGE_VERSION = 2

function migrateLayout(parsed) {
  if (!parsed?.widgets) return parsed
  const widgets = parsed.widgets.map((w) =>
    w.id === 'w2' && w.metricId === 'groups.new_leads'
      ? { ...w, metricId: 'crm.conversations_started' }
      : w,
  )
  return { ...parsed, widgets, version: STORAGE_VERSION }
}

function storageKey(userId) {
  return `vesto_report_layout_${String(userId || 'default')}`
}

export function loadReportLayout(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) {
      return {
        version: STORAGE_VERSION,
        filters: { ...DEFAULT_REPORT_FILTERS },
        widgets: DEFAULT_REPORT_WIDGETS.map((w) => ({ ...w })),
      }
    }
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== STORAGE_VERSION) {
      const migrated = parsed?.version === 1 ? migrateLayout(parsed) : null
      if (migrated) {
        saveReportLayout(userId, migrated)
        return migrated
      }
      return {
        version: STORAGE_VERSION,
        filters: { ...DEFAULT_REPORT_FILTERS },
        widgets: DEFAULT_REPORT_WIDGETS.map((w) => ({ ...w })),
      }
    }
    return {
      version: STORAGE_VERSION,
      filters: { ...DEFAULT_REPORT_FILTERS, ...(parsed.filters || {}) },
      widgets: Array.isArray(parsed.widgets) && parsed.widgets.length
        ? parsed.widgets
        : DEFAULT_REPORT_WIDGETS.map((w) => ({ ...w })),
    }
  } catch {
    return {
      version: STORAGE_VERSION,
      filters: { ...DEFAULT_REPORT_FILTERS },
      widgets: DEFAULT_REPORT_WIDGETS.map((w) => ({ ...w })),
    }
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
  return {
    version: STORAGE_VERSION,
    filters: { ...DEFAULT_REPORT_FILTERS },
    widgets: DEFAULT_REPORT_WIDGETS.map((w) => ({ ...w })),
  }
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
