# Checkpoint Vesto — 20/07/2026 (`-checkpoint20-07`)

Documento de retomada. Tudo crítico commitado na `main`.

**Últimos commits deste checkpoint:**
- `8282472` — fix(meta): só marcar enviado se Meta aceitar o evento
- `3e7b50f` — fix(reports): impedir datas custom de contaminar filtro Hoje
- `519f8a3` — docs: checkpoint Meta/LP 17-07-2026
- `9ea9cb9` — docs(meta): reforçar contrato universal das landing pages
- `482c7f5` — fix(meta): vincular clique da LP por proximidade temporal
- `a3e76a8` — fix(meta): atribuir clique LP do dono ao WhatsApp do vendedor
- `e3de4f4` — fix(meta): Purchase ao vivo por venda e trava reenvio histórico

**Status:** Funil CAPI com entrega auditável + prova no Ads (Compras / Qualificado / Orçamento no **dia da marcação**).  
**NÃO QUEBRAR** o fluxo LP → atribuição → CAPI descrito abaixo.

---

## URLs e infra

| Item | Valor |
|------|--------|
| Backend (Railway) | `https://backend-production-7a466.up.railway.app` |
| Frontend (produção) | `https://vestogroup.up.railway.app` |
| Health backend | `GET /health` → `{ ok: true }` |
| Script LP | `{backend}/vesto-attribution.js?key=vpk_…` |
| Conta referência | Baseset — Pixel `1566611764859334` — LP `baseset.vercel.app` |
| Deploy | push `main` → Railway automático |

Deploy validado neste checkpoint: schema `MetaEventDelivery` no Postgres + backend `8282472` online.

---

## O que está pronto e validado (20/07/2026)

### Meta / atribuição / CAPI
- [x] Tudo do checkpoint **17/07** (LP, match temporal, Purchase por venda, trava de backfill, prompt universal)
- [x] Log durável `MetaEventDelivery` a cada tentativa CAPI
- [x] Sucesso (`sent: true` + flags `*EventSentAt` / `metaPurchaseSentAt`) **só** se `events_received >= 1`
- [x] Purchase `event_time` = horário da **confirmação no CRM** (não do clique / entrada do lead)
- [x] Prova real (20/07): lead LP do dia 18 → Qualificado / Quote / Purchase hoje → toasts OK
- [x] Prova Ads (20/07, após F5): **Compras = 1**, valor **R$ 777** (venda registrada mais cedo no mesmo dia); teste R$ 200 em espera de propagação
- [x] Delay esperado: Events Manager ~5–30 min; Ads até horas

### Dashboard / reports
- [x] Filtro “Hoje” não contaminado por datas de período personalizado (`3e7b50f`)

### CRM UI
- [x] Kanban: filtro por vendedor + avatar do atendente (checkpoint 17/07)

---

## Contrato da Landing Page (TODOS os usuários)

Fonte de verdade do texto copiável: painel **Integrações → Meta → Prompt para IA**  
Código: `whatsapp-saas/src/lib/buildMetaLpPrompt.js`

### A página DEVE
1. Pixel Meta **uma vez** (não duplicar com GTM/plugin)
2. `PageView` uma vez; no CTA: `fbq('track','Contact', {}, { eventID: contactEventId })` — **não** `Lead`
3. Script Vesto com `data-selector="[data-vesto-skip]"` + chave pública
4. Domínio da LP em `allowedOrigins` no Vesto
5. Rodízio de número no **servidor da LP** (`/api/next-seller`) — **não** `localStorage` / `vestoPickWhatsApp`
6. No clique: POST atribuição com `ref`, `contactEventId`, `fbclid`, `fbc`, `fbp`, `clickAt`, `pageUrl`, `userAgent`, UTMs
7. Esperar POST (máx. ~2,5s) **antes** de abrir `wa.me`
8. Mensagem WA **limpa**
9. **Não** disparar LeadQualified / Quote / Purchase no browser — só CAPI do CRM

### REGRA DE OURO
- Quem decide o **número**: servidor da LP (`/api/next-seller`)
- Quem grava a **atribuição Meta**: Vesto (`POST /api/public/meta/attribution`)

---

## Fluxo ponta a ponta (como está funcionando)

```
Anúncio Meta (fbclid)
  → LP (Pixel + script Vesto / rotator)
  → POST /api/public/meta/attribution  [lead pendente no OWNER]
  → wa.me (mensagem limpa)
  → 1ª msg WhatsApp (dono OU vendedor conectado à org)
  → resolveAttributionOwnerUserId → busca lead no OWNER
  → match TEMPORAL → customFields.meta (fbclid, fbc, fbp, pageUrl, utm, attributionRef)
  → CRM: Qualificado → Orçamento → Compra
  → CAPI (action_source website se há cookies LP)
  → MetaEventDelivery (events_received >= 1) → flags / toast
  → Meta Ads coluna (no dia do event_time = marcação)
```

### Eventos CAPI do funil

| Ação no Vesto | Evento Meta | content_category | Limite |
|---------------|-------------|------------------|--------|
| Tag QUALIFICADO | LeadQualified | qualified_lead | 1x/contato |
| Botão Orçamento (com valor) | Quote | quote | 1x/contato |
| Botão Compra (com valor) | Purchase | purchase | por venda |
| Só tag visual Orçamento/Comprou | — | — | **não** envia |

Toast bom: `… enviado à Meta` (com `(N aceito)` quando o front expõe `eventsReceived`) **sem** aviso “sem clique de anúncio”.

---

## NÃO FAZER (quebra atribuição / Ads)

- Colocar `vst_` / códigos na mensagem do WhatsApp
- Backfill / reenviar Purchases históricos
- Aceitar HTTP 200 CAPI **sem** `events_received >= 1` como sucesso
- Exigir “só 1 clique pendente” (bug antigo)
- Usar `localStorage` / `vesto_seq_*` / `vestoPickWhatsApp` para escolher número
- Remover `data-selector="[data-vesto-skip]"` com rotator servidor
- Disparar Quote/Purchase/LeadQualified no Pixel/GTM da LP
- Mudar `action_source` / payload CAPI sem teste
- Abrir `wa.me` sem esperar o POST de atribuição
- Usar `event_time` do clique/entrada do lead na Compra (deve ser o da confirmação)

---

## Arquivos-chave

| Área | Caminho |
|------|---------|
| Prompt LP (painel) | `whatsapp-saas/src/lib/buildMetaLpPrompt.js` |
| Script LP | `whatsapp-saas/backend/public/vesto-attribution.js` |
| Atribuição / match temporal | `whatsapp-saas/backend/src/lib/metaAttributionLead.js` |
| CAPI Meta | `whatsapp-saas/backend/src/lib/metaConversions.js` |
| Log entrega CAPI | `whatsapp-saas/backend/src/lib/metaEventDelivery.js` |
| Schema delivery | `MetaEventDelivery` em `whatsapp-saas/backend/prisma/schema.prisma` |
| Ingestão CRM / 1ª msg | `whatsapp-saas/backend/src/lib/crmCore.js` |
| Orçamento / compra | `whatsapp-saas/backend/src/lib/crmContactActivity.js` |
| Rota pública atribuição | `whatsapp-saas/backend/src/routes/publicMeta.js` |
| Painel LP UI | `whatsapp-saas/src/components/integrations/MetaLpAttributionPanel.jsx` |
| Feedback toast Meta | `whatsapp-saas/src/lib/metaTrackingFeedback.js` |
| Reports “Hoje” | `whatsapp-saas/backend/src/lib/reportDashboard.js` |
| Rule Cursor Meta | `.cursor/rules/meta-lp-tracking-checkpoint.mdc` |

---

## Checkpoint anterior (resumo)

- **12/07/2026** — funil CAPI básico, idempotência, Purchase live  
- **17/07/2026** — atribuição LP↔vendedor, match temporal, trava de backfill, prompt universal, Ads Compras  
- **20/07/2026 (`-checkpoint20-07`)** — `MetaEventDelivery` + sucesso estrito; Purchase no dia da marcação; prova Ads R$ 777 no dia 20; fix filtro Hoje do dashboard  

---

*Checkpoint gerado em **20/07/2026** (`-checkpoint20-07`) — tracking Meta/LP auditável; não alterar sem necessidade e teste.*
