import { useCallback, useState } from 'react'
import { getReportDashboard, refreshOverview } from '../services/api.js'

export function useReportDashboard({ filters, groupIds, onRefreshDone }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getReportDashboard({
        period: filters.period,
        startDate: filters.startDate,
        endDate: filters.endDate,
        groupIds,
        metaPeriod: filters.metaPeriod,
      })
      setData(res.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [filters.period, filters.startDate, filters.endDate, filters.metaPeriod, groupIds])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshOverview({
        groupIds,
        period: filters.period === 'custom' ? '2d' : filters.period,
      })
      const res = await getReportDashboard({
        period: filters.period,
        startDate: filters.startDate,
        endDate: filters.endDate,
        groupIds,
        metaPeriod: filters.metaPeriod,
      })
      setData(res.data)
      onRefreshDone?.(res.data)
      return res.data
    } finally {
      setRefreshing(false)
    }
  }, [filters, groupIds, onRefreshDone])

  return { data, loading, refreshing, load, refresh, setData }
}
