/**
 * Prompt completo para o cliente colar no Codex/Cursor/ChatGPT e implementar a LP.
 */

import { formatPhoneExample } from './lpSellers.js'
import { DEFAULT_BACKEND_ORIGIN } from './runtimeEnv.js'

function formatSellerLine(seller, index) {
  const name = seller.label?.trim() || `Vendedor ${index + 1}`
  return `- ${name}: ${seller.phone} (${formatPhoneExample(seller.phone)})`
}

function formatSellerJson(sellers) {
  return JSON.stringify(
    sellers.map((s, i) => ({
      label: s.label?.trim() || `Vendedor ${i + 1}`,
      phone: s.phone,
    })),
    null,
    2,
  )
}

export function buildMetaLpPrompt({
  publicKey,
  backendOrigin,
  pixelId,
  domains = [],
  sellers = [],
  message = '',
  rotatorMode = 'sequential',
}) {
  const key = publicKey || 'vpk_SALVE_NO_VESTO'
  const origin = (backendOrigin || DEFAULT_BACKEND_ORIGIN).replace(/\/+$/, '')
  const apiBase = `${origin}/api`
  const pixel = pixelId || 'SEU_PIXEL_ID'
  const msg = message || 'Olá! Vim pelo site e quero mais informações.'
  const scriptLine = `<script src="${origin}/vesto-attribution.js?key=${key}" defer></script>`

  const domainLines = domains.length
    ? domains.map((d) => `- ${d}`).join('\n')
    : '- (salve os domínios no Vesto)'

  const sellerLines = sellers.length
    ? sellers.map((s, i) => formatSellerLine(s, i)).join('\n')
    : '- (salve os vendedores no Vesto)'

  const rotatorExplain =
    rotatorMode === 'sequential'
      ? `Rotacionador SEQUENCIAL (${sellers.length} vendedor(es)): cada clique alterna o próximo vendedor (distribuição igual).`
      : `Rotacionador: ${rotatorMode}`

  return `OBJETIVO
Integrar esta landing page com atribuição Meta Ads → WhatsApp → CRM Vesto.
Maximizar match quality (fbclid, fbc, fbp, UTMs) para CAPI: ConversationStarted, LeadQualified, Quote, Purchase.
A mensagem do WhatsApp deve ficar LIMPA para o cliente final — sem códigos técnicos visíveis.

DOMÍNIOS AUTORIZADOS (CORS ativo no Vesto — só hostname, não slug)
${domainLines}

CHAVE VESTO
${key}

SCRIPT OBRIGATÓRIO — layout raiz (index.html, layout.tsx, _app), antes de </body>
${scriptLine}

URL correta do script: ${origin}/vesto-attribution.js (raiz do backend, NÃO ${apiBase}/vesto-attribution.js).

PIXEL META — ID ${pixel}
1. Pixel base oficial no <head>.
2. PageView: fbq('init', '${pixel}'); fbq('track', 'PageView');
3. NÃO usar fbq('track','Lead') no WhatsApp — o script Vesto dispara Contact no clique.

BOTÕES WHATSAPP — TODOS os CTAs (header, hero, footer, mobile, todas as páginas)
<a href="#" data-vesto-whatsapp class="SEU_ESTILO">Texto do botão</a>

Se já existir onclick ou rotador na LP, NÃO montar wa.me manualmente:
e.preventDefault();
window.vestoOpenWhatsApp(e);

VENDEDORES — ${rotatorExplain}
${sellerLines}

Referência (servidor Vesto — NÃO hardcodar na LP):
${sellers.length ? formatSellerJson(sellers) : '[]'}

MENSAGEM WHATSAPP (texto limpo — exatamente assim no wa.me)
"${msg}"

REGRA DE UX — MENSAGEM LIMPA
- O wa.me deve abrir SOMENTE com o texto acima — sem códigos, sem (vst_...), sem IDs técnicos.
- A atribuição Meta é SILENCIOSA: no clique o script envia POST para o Vesto com ref interno + fbc/fbp/UTMs.
- O CRM Vesto associa automaticamente o clique ao contato na 1ª mensagem recebida (sem código na mensagem).
- NÃO criar vesto-whatsapp-open.js, NÃO usar data-selector="[data-vesto-skip]", NÃO adicionar nada à mensagem.

O QUE O SCRIPT VESTO FAZ (não reimplementar)
- Load: captura fbclid, cookies _fbc/_fbp, UTMs, pageUrl.
- Clique: fbq('track','Contact'), POST ${apiBase}/public/meta/attribution?key=${key}, rotacionador sequencial, abre wa.me só com a mensagem limpa.

NÃO FAZER
- Não criar API própria de atribuição na LP.
- Não adicionar códigos (vst_...) ou qualquer sufixo na mensagem do WhatsApp.
- Não criar JS custom que substitua o clique do script Vesto.
- Não usar fbq('track','Lead') no botão.
- Não hardcodar wa.me com número fixo — rotacionador vem do Vesto.
- Não bloquear ${origin} nem ${apiBase} no CSP.

CHECKLIST
[ ] Script: ${origin}/vesto-attribution.js?key=${key}
[ ] Pixel ${pixel} + PageView
[ ] Botões com data-vesto-whatsapp (sem handler custom competindo)
[ ] wa.me abre só: "${msg}"
[ ] Network: POST ${apiBase}/public/meta/attribution → 200
[ ] Rotacionador alterna entre ${sellers.length || 'N'} vendedor(es) se houver mais de um`
}
