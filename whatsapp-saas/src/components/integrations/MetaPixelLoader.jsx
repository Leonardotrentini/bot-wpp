import { useEffect } from 'react'
import { getMetaIntegration } from '../../services/api.js'
import { initMetaPixel } from '../../lib/metaPixel.js'
import { resolveUseRealApi } from '../../lib/runtimeEnv.js'

export function MetaPixelLoader() {
  useEffect(() => {
    if (!resolveUseRealApi()) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await getMetaIntegration()
        const integration = data.integration
        if (!cancelled && integration?.enabled && integration?.pixelId) {
          initMetaPixel(integration.pixelId)
        }
      } catch {
        // pixel opcional — falha silenciosa
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
