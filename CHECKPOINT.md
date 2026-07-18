# Checkpoint Vesto — 17/07/2026

Documento de retomada. Tudo crítico commitado na `main`.

**Últimos commits deste checkpoint:**
- `9ea9cb9` — docs(meta): reforçar contrato universal das landing pages
- `482c7f5` — fix(meta): vincular clique da LP por proximidade temporal
- `19c7d16` — feat(crm): filtro por vendedor no Kanban e foto do atendente
- `a3e76a8` — fix(meta): atribuir clique LP do dono ao WhatsApp do vendedor
- `e3de4f4` — fix(meta): Purchase ao vivo por venda e trava reenvio histórico

**Status:** Meta Ads coluna **Compras** atribuindo corretamente (validado em produção: subiu para 15).  
**NÃO QUEBRAR** o fluxo LP → atribuição → CAPI descrito abaixo.

---

## URLs e infra

| Item | Valor |
|------|--------|
| Backend (Railway) | `https://backend-production-7a466.up.railway.app` |
| Frontend (produção) | `https://vestogroup.up.railway.app` |
| Health backend | `GET /health` → `{ ok: true }` |
| Script LP | `{backend}/vesto-attribution.js?key=vpk_…` |
| Deploy | push `main` → Railway automático |

Deploy validado neste checkpoint: frontend + backend online após os commits acima.

---

## O que está pronto e validado (17/07/2026)

### Meta / atribuição / CAPI
- [x] LP captura `fbclid` / `_fbc` / `_fbp` / UTMs e POST silencioso em `/api/public/meta/attribution`
- [x] Mensagem WhatsApp **limpa** (sem `vst_` visível)
- [x] Clique da LP fica no **OWNER** (Pixel); WhatsApp pode ser dono ou vendedor
- [x] Match temporal na 1ª msg (±10 min; bloqueia ambiguidade <20s) — commit `482c7f5`
- [x] Antes de Quote/Purchase/LeadQualified: `ensureAttributionBeforeMetaEvent` recupera atribuição
- [x] Com `fbc`/`fbp`: CAPI usa `action_source: website` + `event_source_url` da LP
- [x] Pixel do dono para vendas de vendedor (`resolveMetaIntegrationForTracking`)
- [x] Purchase por **venda** (`activityId` + `event_time` da activity)
- [x] Backfill histórico **travado** (não reenviar histórico antigo)
- [x] Prompt universal da ferramenta atualizado (`buildMetaLpPrompt.js`) — commit `9ea9cb9`
- [x] Prova real: toast Quote/Purchase **sem** “sem clique de anúncio” + Ads **Compras = 15**

### CRM UI
- [x] Kanban: filtro por vendedor (dono)
- [x] Bolinha do atendente no card (avatar/iniciais)
- [x] Dono pode definir fotos da equipe em Configurações

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
  → Meta Ads coluna
```

### Eventos CAPI do funil

| Ação no Vesto | Evento Meta | content_category | Limite |
|---------------|-------------|------------------|--------|
| Tag QUALIFICADO | LeadQualified | qualified_lead | 1x/contato |
| Botão Orçamento (com valor) | Quote | quote | 1x/contato |
| Botão Compra (com valor) | Purchase | purchase | por venda |
| Só tag visual Orçamento/Comprou | — | — | **não** envia |

Toast bom: `Quote/Purchase enviado à Meta.` **sem** aviso “sem clique de anúncio”.

---

## NÃO FAZER (quebra atribuição / Ads)

- Colocar `vst_` / códigos na mensagem do WhatsApp
- Backfill / reenviar Purchases históricos
- Exigir “só 1 clique pendente” (bug antigo)
- Usar `localStorage` / `vesto_seq_*` / `vestoPickWhatsApp` para escolher número
- Remover `data-selector="[data-vesto-skip]"` com rotator servidor
- Disparar Quote/Purchase/LeadQualified no Pixel/GTM da LP
- Mudar `action_source` / payload CAPI sem teste
- Abrir `wa.me` sem esperar o POST de atribuição

---

## Arquivos-chave

| Área | Caminho |
|------|---------|
| Prompt LP (painel) | `whatsapp-saas/src/lib/buildMetaLpPrompt.js` |
| Script LP | `whatsapp-saas/backend/public/vesto-attribution.js` |
| Atribuição / match temporal | `whatsapp-saas/backend/src/lib/metaAttributionLead.js` |
| CAPI Meta | `whatsapp-saas/backend/src/lib/metaConversions.js` |
| Ingestão CRM / 1ª msg | `whatsapp-saas/backend/src/lib/crmCore.js` |
| Orçamento / compra | `whatsapp-saas/backend/src/lib/crmContactActivity.js` |
| Rota pública atribuição | `whatsapp-saas/backend/src/routes/publicMeta.js` |
| Painel LP UI | `whatsapp-saas/src/components/integrations/MetaLpAttributionPanel.jsx` |
| Feedback toast Meta | `whatsapp-saas/src/lib/metaTrackingFeedback.js` |
| Kanban filtro/avatar | `whatsapp-saas/src/pages/dashboard/Crm.jsx` |
| Rule Cursor Meta | `.cursor/rules/meta-lp-tracking-checkpoint.mdc` |

---

## Checkpoint anterior (resumo)

Checkpoint de **12/07/2026** validou funil CAPI básico, idempotência e Purchase live.  
Este de **17/07/2026** consolida: atribuição LP↔vendedor, match temporal, trava de backfill, prompt universal e prova na coluna Compras do Ads.

---

*Checkpoint gerado em **17/07/2026** — tracking Meta/LP estável; não alterar sem necessidade e teste.*
