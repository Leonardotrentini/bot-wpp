import { useCallback, useState } from 'react'
import { getReportDashboard, refreshOverview } from '../services/api.js'

export function useReportDashboard({ filters, groupIds, sellerUserId, onRefreshDone }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)

  const fetchDashboard = useCallback(async () => {
    const res = await getReportDashboard({
      period: filters.period,
      startDate: filters.startDate,
      endDate: filters.endDate,
      groupIds,
      metaPeriod: filters.metaPeriod,
      sellerUserId: sellerUserId || undefined,
    })
    setData(res.data)
    setLastUpdatedAt(new Date())
    return res.data
  }, [filters.period, filters.startDate, filters.endDate, filters.metaPeriod, groupIds, sellerUserId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await fetchDashboard()
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [fetchDashboard])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    let syncNote = 'ok'

    try {
      try {
        await refreshOverview({
          groupIds,
          period: filters.period === 'custom' ? '2d' : filters.period,
        })
      } catch (err) {
        const code = err?.response?.data?.error
        if (code === 'WHATSAPP_NOT_CONNECTED') syncNote = 'whatsapp_offline'
        else syncNote = 'sync_failed'
      }

      const dashboardData = await fetchDashboard()
      onRefreshDone?.(dashboardData, syncNote)
      return { data: dashboardData, syncNote }
    } catch (err) {
      throw err
    } finally {
      setRefreshing(false)
    }
  }, [filters.period, groupIds, fetchDashboard, onRefreshDone])

  return { data, loading, refreshing, load, refresh, setData, lastUpdatedAt }
}
