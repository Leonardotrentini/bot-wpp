/**
 * Não carrega o Pixel no dashboard admin — evita PageView poluindo o dataset de ads.
 * O Pixel deve rodar só na landing page (script vesto-attribution / pixel da LP).
 */
export function MetaPixelLoader() {
  return null
}
