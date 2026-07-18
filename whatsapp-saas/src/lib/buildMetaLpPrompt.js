/**
 * Prompt completo para o cliente colar no Codex/Cursor/ChatGPT e implementar a LP.
 * Contrato genérico: rodízio no SERVIDOR da LP + atribuição Meta no Vesto
 * + Pixel Contact deduplicável (não localStorage e sem código na mensagem).
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

function formatSellerRotationExample(sellers) {
  if (!sellers.length) return '- Clique 1 → Vendedor 1 → …'
  const cycle = [...sellers, sellers[0]]
  return cycle
    .map((s, i) => {
      const name = s.label?.trim() || `Vendedor ${(i % sellers.length) + 1}`
      return `- Clique ${i + 1} → ${name}`
    })
    .join('\n')
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
  const sellerCount = sellers.length || 0
  const scriptLine = `<script src="${origin}/vesto-attribution.js?key=${key}" defer data-selector="[data-vesto-skip]"></script>`

  const domainLines = domains.length
    ? domains.map((d) => `- ${d}`).join('\n')
    : '- (salve os domínios no Vesto)'

  const sellerLines = sellers.length
    ? sellers.map((s, i) => formatSellerLine(s, i)).join('\n')
    : '- (salve os vendedores no Vesto)'

  const rotatorExplain =
    rotatorMode === 'sequential'
      ? `SEQUENCIAL no SERVIDOR (${sellerCount || 'N'} vendedor(es)): contador global compartilhado — NÃO localStorage.`
      : `Modo ${rotatorMode} no SERVIDOR — NÃO localStorage.`

  const sellersJson = sellers.length ? formatSellerJson(sellers) : '[]'
  const rotationExample = formatSellerRotationExample(sellers)

  return `OBJETIVO
Integrar esta landing page: Meta Ads → WhatsApp → CRM Vesto (fluxo LP → WPP).
1) Rotacionar vendedores no SERVIDOR (contador global).
2) Atribuir fbc/fbp/fbclid/UTMs no Vesto no clique (para CAPI Purchase).
3) Mensagem do WhatsApp LIMPA — sem códigos técnicos visíveis.
4) Pixel browser e CAPI sem eventos duplicados.

REGRA DE OURO
- Quem decide o NÚMERO: servidor da LP (/api/next-seller) — compartilhado por todo o tráfego.
- Quem grava a ATRIBUIÇÃO Meta: Vesto (POST /api/public/meta/attribution).
- NÃO usar localStorage / vesto_seq_* / window.vestoPickWhatsApp para escolher o número.
  (O picker padrão do script Vesto começa no índice 0 em cada navegador novo → em anúncios quase 100% cai no 1º vendedor.)

DOMÍNIOS AUTORIZADOS (CORS ativo no Vesto — só hostname, sem path)
${domainLines}

CHAVE VESTO
${key}

PIXEL META — ID ${pixel}
1. Pixel base oficial no <head>, exatamente uma vez.
   Se a página já instala esse Pixel via GTM/plugin, NÃO instalar/inicializar de novo.
2. PageView exatamente uma vez: fbq('init', '${pixel}'); fbq('track', 'PageView');
3. No clique WhatsApp: fbq('track', 'Contact', {}, { eventID: contactEventId }).
4. O MESMO contactEventId deve ir no POST Vesto para deduplicação browser/CAPI.
5. NÃO disparar Lead, LeadQualified, Quote ou Purchase pelo navegador:
   Qualificado/Orçamento/Compra são enviados exclusivamente pelo CRM Vesto via CAPI.

SCRIPTS — layout raiz (antes de </body>), nesta ordem
1) Script Vesto (só captura fbclid/_fbc/_fbp/UTMs em sessionStorage "vesto_meta" — NÃO trata o clique):
${scriptLine}

data-selector="[data-vesto-skip]" é OBRIGATÓRIO: evita o handler local do Vesto (localStorage) competir com o rotacionador servidor.

2) Seu JS do rotacionador global (ex.: /src/js/vesto-global-rotator.js) — veja implementação abaixo.

URL do script Vesto: ${origin}/vesto-attribution.js (raiz do backend, NÃO ${apiBase}/vesto-attribution.js).

BOTÕES WHATSAPP — TODOS os CTAs
<a href="#" data-vesto-whatsapp class="SEU_ESTILO">Texto do botão</a>
Sem outros onclick / rotadores competindo no mesmo botão.

VENDEDORES — ${rotatorExplain}
Lista oficial (painel Vesto → Integrações → Meta). O /api/next-seller DEVE usar a MESMA lista:
${sellerLines}

JSON (fonte da verdade — sincronizar no servidor da LP):
${sellersJson}

Exemplo de ordem com ${sellerCount || 'N'} vendedor(es):
${rotationExample}

MENSAGEM WHATSAPP (texto limpo — exatamente assim no wa.me)
"${msg}"

FLUXO DO CLIQUE (obrigatório, nesta ordem)
1. Clique em [data-vesto-whatsapp] → preventDefault + stopPropagation (+ stopImmediatePropagation).
2. Ler sessionStorage "vesto_meta" (preenchido pelo script Vesto no load).
3. No momento do clique, atualizar clickAt=Date.now(), pageUrl=location.href e userAgent.
4. Gerar ref interno "vst_" + 8 chars e contactEventId="vst_contact_"+ref
   (NÃO colocar nenhum deles na mensagem do WhatsApp).
5. Disparar fbq('track', 'Contact', {}, { eventID: contactEventId }).
6. Em paralelo:
   a) GET /api/next-seller (host da LP) → { phone, message }
   b) POST ${apiBase}/public/meta/attribution?key=${key}
      headers: Content-Type: application/json, X-Vesto-Key: ${key}
      body: { vestoPublicKey, ref, contactEventId, fbclid, fbc, fbp, clickAt,
              pageUrl, userAgent, utm_source, utm_medium, utm_campaign,
              utm_content, utm_term }
7. Esperar o POST de atribuição concluir OU no máximo 2,5 segundos; só então abrir
   https://wa.me/{phone}?text={encodeURIComponent(message limpa)}.
   O POST usa keepalive e timeout próprio para não perder dados na troca de página.

API /api/next-seller (na hospedagem da LP — Vercel/Node)
- Contador GLOBAL atômico no servidor (KV / DB / Redis). NÃO cookie, NÃO localStorage.
- sellers = lista JSON acima (mesma do painel Vesto).
- index = (seq - 1) % sellers.length → devolver phone + message limpa.
- Resposta exemplo: { "ok": true, "phone": "55…", "label": "…", "index": 0, "total": ${sellerCount || 'N'}, "seq": 16, "message": "${msg}" }
- Opcional: ler lista ao vivo de GET ${apiBase}/public/meta/config?key=${key} (CORS: domínio da LP autorizado).

HANDLER DE REFERÊNCIA (cole como /src/js/vesto-global-rotator.js)
(function () {
  var VESTO_KEY = '${key}';
  var ATTRIBUTION_URL = '${apiBase}/public/meta/attribution?key=' + encodeURIComponent(VESTO_KEY);
  var NEXT_SELLER_URL = '/api/next-seller';
  var FALLBACK_MSG = ${JSON.stringify(msg)};
  var busy = false;

  function buildRef() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var suffix = '';
    for (var i = 0; i < 8; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    return 'vst_' + suffix;
  }

  function readMeta() {
    try { return JSON.parse(sessionStorage.getItem('vesto_meta') || '{}'); } catch (_) { return {}; }
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function sendAttribution(meta, ref, contactEventId) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 4000) : null;
    return fetch(ATTRIBUTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vesto-Key': VESTO_KEY },
      body: JSON.stringify({
        vestoPublicKey: VESTO_KEY,
        ref: ref,
        contactEventId: contactEventId,
        fbclid: meta.fbclid || null,
        fbc: meta.fbc || null,
        fbp: meta.fbp || null,
        clickAt: meta.clickAt,
        pageUrl: meta.pageUrl,
        userAgent: meta.userAgent,
        utm_source: meta.utm_source || '',
        utm_medium: meta.utm_medium || '',
        utm_campaign: meta.utm_campaign || '',
        utm_content: meta.utm_content || '',
        utm_term: meta.utm_term || '',
      }),
      credentials: 'omit',
      keepalive: true,
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error('vesto_attribution_' + res.status);
        return res.json();
      })
      .catch(function () { return null; })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function nextSeller() {
    return fetch(NEXT_SELLER_URL, { method: 'GET', cache: 'no-store', credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('next_seller_' + res.status);
        return res.json();
      });
  }

  function openWhatsApp(phone, message) {
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(message || FALLBACK_MSG), '_blank', 'noopener,noreferrer');
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-vesto-whatsapp]');
    if (!btn || busy) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    busy = true;
    var meta = readMeta();
    meta.clickAt = Date.now();
    meta.pageUrl = location.href;
    meta.userAgent = navigator.userAgent || '';
    var ref = buildRef();
    var contactEventId = 'vst_contact_' + ref.toLowerCase();
    try { sessionStorage.setItem('vesto_ref', ref); } catch (_) {}
    try { sessionStorage.setItem('vesto_contact_event_id', contactEventId); } catch (_) {}
    if (typeof fbq === 'function') {
      fbq('track', 'Contact', {}, { eventID: contactEventId });
    }
    var attributionWait = Promise.race([
      sendAttribution(meta, ref, contactEventId),
      wait(2500),
    ]);
    Promise.all([nextSeller(), attributionWait])
      .then(function (results) {
        var seller = results[0] || {};
        var phone = seller.phone ? String(seller.phone) : '';
        if (!phone) return;
        openWhatsApp(phone, seller.message || FALLBACK_MSG);
      })
      .catch(function (err) {
        console.error('[Vesto] Não foi possível obter o próximo vendedor.', err);
      })
      .finally(function () { busy = false; });
  }, true);
})();

COMO O VESTO FAZ A ATRIBUIÇÃO (NÃO REIMPLEMENTAR NA LP)
- O POST salva silenciosamente o clique com fbclid/fbc/fbp/UTMs na conta dona do Pixel.
- A mensagem permanece limpa. Na primeira mensagem recebida, o Vesto vincula o contato
  ao clique temporalmente mais próximo, inclusive quando um vendedor da mesma organização atende.
- Antes de cada evento CAPI, o Vesto tenta recuperar a atribuição novamente.
- Com fbc/fbp, os eventos do CRM usam action_source=website + event_source_url da LP.
- O CRM envia event_id idempotente e dados normalizados/hasheados; a LP não deve enviar
  Qualificado, Quote nem Purchase em paralelo.

PARA A VENDA VIRAR COMPRA NO ADS MANAGER
- Clique grava fbc/fbp no Vesto (lead pendente).
- 1ª mensagem do lead precisa chegar num WhatsApp CONECTADO à conta Vesto (mesmo org/pixel).
- No CRM: QUALIFICADO → Orçamento → Compra no MESMO contato → CAPI Purchase + content_category=purchase.
- Vendedores só no wa.me, sem conexão no Vesto → rodízio ok, atribuição de compra no Ads falha.

NÃO FAZER
- Usar localStorage / vesto_seq_* / window.vestoPickWhatsApp / window.vestoOpenWhatsApp para o número.
- Remover data-selector="[data-vesto-skip]" do script Vesto (senão o picker local volta).
- Abrir wa.me sem o POST de atribuição Vesto.
- Hardcodar um único wa.me no href do botão (com 2+ vendedores).
- Colocar (vst_...) ou IDs na mensagem do WhatsApp.
- fbq('track','Lead') no CTA.
- Disparar LeadQualified, Quote ou Purchase no Pixel/GTM da LP (o CRM envia por CAPI).
- Usar eventID diferente no Pixel Contact e no POST Vesto.
- Reutilizar ref/contactEventId em cliques diferentes.
- Dois handlers competindo no mesmo clique.
- Bloquear ${origin} nem ${apiBase} no CSP.

CHECKLIST
[ ] Script Vesto com data-selector="[data-vesto-skip]" + chave ${key}
[ ] Domínio da LP autorizado no Vesto
[ ] Pixel ${pixel} + PageView
[ ] Pixel/PageView sem instalação duplicada por código + GTM/plugin
[ ] Botões com data-vesto-whatsapp
[ ] /api/next-seller no host da LP com contador global + mesma lista de vendedores
[ ] Network no clique: GET /api/next-seller → 200 (phones diferentes a cada clique / aba anônima)
[ ] Pixel Helper: Contact com eventID único
[ ] Network no clique: POST ${apiBase}/public/meta/attribution → 200
    (mesmo contactEventId do Pixel + clickAt atual + fbc ou fbclid + UTMs)
[ ] wa.me abre só: "${msg}"
[ ] WhatsApps de destino conectados (ou ingestão) no Vesto para CAPI Purchase`
}
