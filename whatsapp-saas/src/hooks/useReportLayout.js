import { useCallback, useEffect, useState } from 'react'
import {
  addWidgetToLayout,
  loadReportLayout,
  moveWidgetInLayout,
  removeWidgetFromLayout,
  resetReportLayout,
  saveReportLayout,
  updateLayoutFilters,
  updateLayoutFunnelSteps,
} from '../lib/reportLayoutStorage.js'

export function useReportLayout(userId) {
  const [layout, setLayout] = useState(() => loadReportLayout(userId))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setLayout(loadReportLayout(userId))
    setEditing(false)
  }, [userId])

  const persist = useCallback(
    (updater) => {
      setLayout((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        saveReportLayout(userId, next)
        return next
      })
    },
    [userId],
  )

  const setFilters = useCallback(
    (filters) => {
      persist((prev) => updateLayoutFilters(prev, filters))
    },
    [persist],
  )

  const setFunnelSteps = useCallback(
    (funnelSteps) => {
      persist((prev) => updateLayoutFunnelSteps(prev, funnelSteps))
    },
    [persist],
  )

  const addWidget = useCallback(
    (metricId) => {
      persist((prev) => addWidgetToLayout(prev, metricId))
    },
    [persist],
  )

  const removeWidget = useCallback(
    (widgetId) => {
      persist((prev) => removeWidgetFromLayout(prev, widgetId))
    },
    [persist],
  )

  const moveWidget = useCallback(
    (widgetId, direction) => {
      persist((prev) => moveWidgetInLayout(prev, widgetId, direction))
    },
    [persist],
  )

  const restoreDefault = useCallback(() => {
    const next = resetReportLayout(userId)
    setLayout(next)
    saveReportLayout(userId, next)
  }, [userId])

  return {
    layout,
    editing,
    setEditing,
    setFilters,
    setFunnelSteps,
    addWidget,
    removeWidget,
    moveWidget,
    restoreDefault,
  }
}
