/** Mapeia período do painel para período da API Meta Ads. */
export function mapPeriodToMetaPeriod(period) {
  if (period === 'hoje') return 'today'
  if (period === '30d' || period === 'custom') return '30d'
  return '7d'
}
