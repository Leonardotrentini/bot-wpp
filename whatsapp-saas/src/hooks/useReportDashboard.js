import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getReportDashboard, refreshOverview } from '../services/api.js'
import {
  encodeFunnelTagGroups,
  funnelStepsToTagGroups,
} from '../lib/reportFunnelConfig.js'

/** Referência estável — `[]` inline no Dashboard remontava o fetch a cada render. */
export const EMPTY_GROUP_IDS = Object.freeze([])

export function useReportDashboard({ filters, groupIds = EMPTY_GROUP_IDS, sellerUserId, funnelSteps, onRefreshDone }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [error, setError] = useState(null)
  const requestIdRef = useRef(0)

  const stableGroupIds = Array.isArray(groupIds) ? groupIds : EMPTY_GROUP_IDS
  const groupIdsKey = useMemo(
    () => (stableGroupIds.length ? stableGroupIds.slice().sort().join(',') : ''),
    [stableGroupIds],
  )

  const funnelTagGroupsParam = useMemo(
    () => encodeFunnelTagGroups(funnelStepsToTagGroups(funnelSteps)),
    [funnelSteps],
  )

  const fetchDashboard = useCallback(async () => {
    const res = await getReportDashboard({
      period: filters.period,
      startDate: filters.startDate,
      endDate: filters.endDate,
      groupIds: groupIdsKey ? groupIdsKey.split(',') : [],
      metaPeriod: filters.metaPeriod,
      sellerUserId: sellerUserId || undefined,
      funnelTagGroups: funnelTagGroupsParam || undefined,
    })
    return res.data
  }, [
    filters.period,
    filters.startDate,
    filters.endDate,
    filters.metaPeriod,
    groupIdsKey,
    sellerUserId,
    funnelTagGroupsParam,
  ])

  const load = useCallback(async () => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const next = await fetchDashboard()
      if (reqId !== requestIdRef.current) return null
      setData(next)
      setLastUpdatedAt(new Date())
      return next
    } catch (err) {
      if (reqId !== requestIdRef.current) return null
      // Mantém dados anteriores para não piscar tela vazia / erro intermitente.
      setError(err?.response?.data?.message || 'Falha ao carregar o painel.')
      return null
    } finally {
      if (reqId === requestIdRef.current) setLoading(false)
    }
  }, [fetchDashboard])

  const refresh = useCallback(async () => {
    const reqId = ++requestIdRef.current
    setRefreshing(true)
    setError(null)
    let syncNote = 'ok'

    try {
      try {
        await refreshOverview({
          groupIds: groupIdsKey ? groupIdsKey.split(',') : [],
          period: filters.period === 'custom' ? '2d' : filters.period,
        })
      } catch (err) {
        const code = err?.response?.data?.error
        if (code === 'WHATSAPP_NOT_CONNECTED') syncNote = 'whatsapp_offline'
        else syncNote = 'sync_failed'
      }

      if (reqId !== requestIdRef.current) return { data: null, syncNote }

      const dashboardData = await fetchDashboard()
      if (reqId !== requestIdRef.current) return { data: null, syncNote }

      setData(dashboardData)
      setLastUpdatedAt(new Date())
      onRefreshDone?.(dashboardData, syncNote)
      return { data: dashboardData, syncNote }
    } catch (err) {
      if (reqId === requestIdRef.current) {
        setError(err?.response?.data?.message || 'Falha ao carregar o painel.')
      }
      throw err
    } finally {
      if (reqId === requestIdRef.current) setRefreshing(false)
    }
  }, [filters.period, groupIdsKey, fetchDashboard, onRefreshDone])

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
    }
  }, [])

  return { data, loading, refreshing, load, refresh, setData, lastUpdatedAt, error }
}
