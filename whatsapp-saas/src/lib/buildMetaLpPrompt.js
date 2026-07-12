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

export function buildVestoRotatorSnippet({ backendOrigin, publicKey }) {
  const key = publicKey || 'vpk_SUA_CHAVE'
  const origin = (backendOrigin || DEFAULT_BACKEND_ORIGIN).replace(/\/+$/, '')

  return `<!-- Cole no layout raiz da LP (vale para todas as páginas e slugs) -->
<script src="${origin}/vesto-attribution.js?key=${key}" defer></script>

<!-- Marque TODOS os botões/links de WhatsApp -->
<a href="#" data-vesto-whatsapp class="btn-whatsapp">Falar no WhatsApp</a>`
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
      ? `Rotacionador SEQUENCIAL (${sellers.length} vendedor(es)): cada clique no WhatsApp vai para o próximo número da lista, em ordem, com distribuição igual (round-robin via script Vesto + localStorage).`
      : `Rotacionador: ${rotatorMode}`

  return `OBJETIVO
Integrar esta landing page com atribuição Meta Ads → WhatsApp → CRM Vesto.
Maximizar qualidade de match (fbclid, fbc, fbp, UTMs) para o funil CAPI: ConversationStarted, LeadQualified, Quote, Purchase.

DOMÍNIOS AUTORIZADOS (CORS já ativo no Vesto — não cadastrar slugs, só hostname)
${domainLines}

CHAVE VESTO
${key}

SCRIPT OBRIGATÓRIO — colar no layout raiz (index.html, layout.tsx, _app, etc.), antes de </body>
${scriptLine}

IMPORTANTE: a URL do script é ${origin}/vesto-attribution.js (raiz do backend, NÃO é ${apiBase}/vesto-attribution.js).

PIXEL META — ID ${pixel}
1. Instalar o Pixel base oficial da Meta no <head>.
2. PageView no carregamento: fbq('init', '${pixel}'); fbq('track', 'PageView');
3. NÃO disparar fbq('track','Lead') no botão WhatsApp — o script Vesto dispara Contact automaticamente no clique.

BOTÕES WHATSAPP — em TODOS os CTAs (header, hero, footer, mobile, todas as páginas/slugs)
<a href="#" data-vesto-whatsapp class="SEU_ESTILO">Texto do botão</a>

Se já existir botão com JavaScript ou rotador próprio, NÃO abrir wa.me manualmente. Use:
e.preventDefault();
window.vestoOpenWhatsApp(e);

VENDEDORES — ${rotatorExplain}
${sellerLines}

Lista para referência (configurada no servidor Vesto — o script busca automaticamente, NÃO hardcodar wa.me na LP):
${sellers.length ? formatSellerJson(sellers) : '[]'}

MENSAGEM PADRÃO DO WHATSAPP
"${msg}"
O script adiciona automaticamente (vst_XXXXXXXX) ao final da mensagem. NUNCA remover esse código.

O QUE O SCRIPT VESTO FAZ AUTOMATICAMENTE (não reimplementar na LP)
- Ao carregar: lê fbclid da URL, cria cookie _fbc se necessário, lê cookies _fbp/_fbc do Pixel.
- Lê utm_source, utm_medium, utm_campaign, utm_content, utm_term da URL.
- No clique: dispara fbq('track','Contact') se o Pixel existir.
- Gera código vst_ e envia POST para ${apiBase}/public/meta/attribution?key=${key}
- Rotaciona o vendedor (sequencial) e abre wa.me com mensagem + (vst_...).
- O cliente manda a mensagem no WhatsApp; o Vesto liga o clique ao CRM e melhora o CAPI.

NÃO FAZER
- Não criar API própria de atribuição.
- Não remover (vst_...) da mensagem do WhatsApp.
- Não usar fbq('track','Lead') no clique do WhatsApp.
- Não hardcodar números em wa.me — o rotacionador vem do script Vesto.
- Não bloquear ${origin} nem ${apiBase} no Content-Security-Policy.

CHECKLIST AO TERMINAR
[ ] Script com URL HTTPS completa: ${origin}/vesto-attribution.js?key=${key}
[ ] Pixel ${pixel} com PageView no carregamento
[ ] Todos os botões WhatsApp com data-vesto-whatsapp
[ ] Clique abre wa.me com a mensagem + (vst_...)
[ ] DevTools → Network: POST ${apiBase}/public/meta/attribution retorna 200
[ ] Rotacionador sequencial alternando entre os ${sellers.length || 'N'} vendedor(es) listados acima`
}
