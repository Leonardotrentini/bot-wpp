/** Mapeia período do painel para período da API Meta Ads. */
export function mapPeriodToMetaPeriod(period) {
  if (period === 'hoje') return 'today'
  if (period === '2d') return '2d'
  if (period === '30d') return '30d'
  if (period === 'custom') return 'custom'
  return '7d'
}
