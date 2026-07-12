/**
 * Prompt simples + código pronto para LP com rotacionador Vesto.
 */

import { formatPhoneExample } from './lpSellers.js'

function formatSellerLine(seller, index) {
  const label = seller.label ? `${seller.label} — ` : `Vendedor ${index + 1} — `
  return `  • ${label}${seller.phone} (${formatPhoneExample(seller.phone)})`
}

export function buildVestoRotatorSnippet({ backendOrigin, publicKey, sellers, message }) {
  const key = publicKey || 'vpk_SUA_CHAVE'
  const origin = backendOrigin || 'https://SEU_BACKEND.up.railway.app'
  const msg = message || 'Olá! Vim pelo site e quero mais informações.'

  return `<!-- Vesto: script oficial (rotacionador vem do servidor após salvar no painel) -->
<script src="${origin}/vesto-attribution.js?key=${key}" defer></script>

<!-- Botão WhatsApp — use em TODOS os CTAs da LP (todas as páginas/slugs) -->
<a href="#" data-vesto-whatsapp class="btn-whatsapp">
  Falar no WhatsApp
</a>

<!--
  Rotacionador sequencial já configurado no Vesto:
${sellers.map((s, i) => `  - ${s.label || `Vendedor ${i + 1}`}: ${s.phone}`).join('\n')}
  Mensagem: ${msg}

  Cada clique alterna o vendedor (distribuição igual).
  Atribuição Meta + código (vst_...) automáticos.
-->

<!-- Opcional: se o botão já tem JS próprio, use: -->
<script>
  document.querySelector('.btn-whatsapp').addEventListener('click', function (e) {
    e.preventDefault();
    window.vestoOpenWhatsApp(e); // rotacionador + atribuição
  });
</script>`
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
  const key = publicKey || 'vpk_SALVE_E_CONFIRME_NO_VESTO'
  const origin = backendOrigin || 'https://SEU_BACKEND.up.railway.app'
  const pixel = pixelId || 'SEU_PIXEL_ID'
  const domainList = domains.length ? domains.join(', ') : '(cadastre domínios no Vesto e salve)'
  const msg = message || 'Olá! Vim pelo site e quero mais informações.'
  const scriptLine = `<script src="${origin}/vesto-attribution.js?key=${key}" defer></script>`
  const sellerBlock =
    sellers.length > 0
      ? sellers.map((s, i) => formatSellerLine(s, i)).join('\n')
      : '  • (cadastre vendedores no Vesto e salve)'

  const embedCode = buildVestoRotatorSnippet({
    backendOrigin: origin,
    publicKey: key,
    sellers: sellers.length ? sellers : [{ label: 'Vendedor 1', phone: '5547996747378' }],
    message: msg,
  })

  const rotatorLabel =
    rotatorMode === 'sequential'
      ? 'Sequencial (cada clique vai para o próximo vendedor — distribuição igual)'
      : rotatorMode

  return `Integre WhatsApp com atribuição Meta na minha landing page.

## 1. Cole no layout principal (vale para todas as páginas e slugs)
${scriptLine}

## 2. Marque os botões WhatsApp
<a href="#" data-vesto-whatsapp>Seu texto do botão</a>

## 3. Pixel Meta ${pixel}
fbq('init', '${pixel}'); fbq('track', 'PageView');

## Já configurado no Vesto (não alterar)
- Domínios ativos: ${domainList}
- Mensagem WhatsApp: "${msg}"
- Rotacionador: ${rotatorLabel}
${sellerBlock}

## Código completo de referência
${embedCode}

## Regras
- Não criar API própria de atribuição.
- Não remover o código (vst_...) da mensagem do WhatsApp.
- Slugs não precisam ser cadastrados — só o domínio.`
}
