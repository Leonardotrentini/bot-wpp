# Checkpoint Vesto — 12/07/2026

Documento de retomada. Tudo commitado na `main`; último commit: `970d96a`.

---

## URLs e infra

| Item | Valor |
|------|--------|
| Backend (Railway) | `https://backend-production-7a466.up.railway.app` |
| Frontend (produção) | `https://vestogroup.up.railway.app` |
| LP referência | `https://baseset.vercel.app` |
| Pixel Meta | `1566611764859334` |
| Chave pública LP (exemplo BaseSet) | `vpk_17899139c659991466e48d5eb97d9443` |

Deploy: push na `main` → Railway faz build automático (ver `RAILWAY.md`).

---

## O que está pronto e validado

### Produto / integrações
- [x] Script LP `vesto-attribution.js` — Contact no clique, POST atribuição silenciosa
- [x] CORS `/api/public/meta/attribution` para domínios da LP
- [x] Funil CAPI: `ConversationStarted` → `LeadQualified` → `Quote` → `Purchase`
- [x] Conversões personalizadas Meta alinhadas com `content_category` (ver abaixo)
- [x] Lead Qualificado aparecendo na campanha (custo validado)
- [x] **Purchase CAPI testado** — `sent: true`, `lastEventName: Purchase`, `lastError: null`
- [x] Histórico do lead — fix loop infinito (`38de9ad`)

### Robustez (commit `970d96a`)
- [x] Socket WhatsApp por tenant (`user:${userId}`)
- [x] Webhook Evolution retorna 500 em falha
- [x] Scheduler: catch-up antes de marcar automação `once` como concluída
- [x] Idempotência Meta atômica (ConversationStarted, LeadQualified, Quote)
- [x] Race P2002 em contato/conversa CRM
- [x] Purchase usa contato atualizado no CAPI
- [x] Frontend: API real em PROD, banner demo, interceptor 401, erros visíveis
- [x] GroupDetails: rollback otimista; Members: aviso tags localStorage

---

## Conversões personalizadas Meta (configuradas)

| Nome na Meta | Evento | Regra `content_category` |
|--------------|--------|---------------------------|
| Mensagem Iniciada | `ConversationStarted` | contém `conversation_started` |
| Lead Qualificado | `LeadQualified` | contém `qualified_lead` |
| Orçamento ENVIADO | `Quote` | contém `quote` |
| **Compra** | `Purchase` | contém `purchase` — **criar/confirmar se ainda não existir** |

Fonte da ação na UI Meta: **Site** (normal para eventos CAPI do Vesto).

**Opcional LP:** `Contact` + URL contém domínio da LP (ex. `baseset.vercel.app`).

---

## Regras do funil (não esquecer)

| Ação no Vesto | Evento Meta | Limite |
|---------------|-------------|--------|
| 1ª mensagem inbound (contato novo) | ConversationStarted | 1x/contato |
| Tag **QUALIFICADO** (exata) | LeadQualified | 1x/contato |
| Botão **ORÇAMENTO** no chat | Quote | 1x/contato |
| Botão **COMPRA** confirmada | Purchase | cada confirmação |
| Clicar só na tag visual | **não** envia Quote/Purchase | — |

Toggles em **Integrações → Meta**: `sendQuotes`, `sendPurchases`.

---

## Testes feitos hoje (console)

### Script funil CRM
- Rodar no painel logado; em **localhost** usar API relativa: `${window.location.origin}/api` (proxy Vite).
- Em produção: `https://vestogroup.up.railway.app` ou API relativa.

### Resultado do último teste (contato `cmrhbz1jp0004rx0pb4moapfv`)
- QUALIFICADO: já existia → LeadQualified `already_sent` (esperado)
- Quote: `skipped: true, reason: already_sent` (esperado)
- **Purchase: `sent: true`, value 1500, trackingMode crm** ✅
- Meta status: `connected: true`, `lastEventName: Purchase`, `lastError: null`

### Checar status Meta (console)
```javascript
(async () => {
  const API = (window.__VESTO_ENV__?.apiBase || `${window.location.origin}/api`).replace(/\/+$/, '');
  const TOKEN = localStorage.getItem('vg_auth_token');
  const { integration: m } = await (await fetch(`${API}/integrations/meta`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })).json();
  console.log('📡 Meta:', m);
})();
```

### Teste rápido todos os eventos (Eventos de teste Meta)
`POST /integrations/meta/test` — requer código TEST em Integrações.

---

## Pendências / próximos passos (amanhã)

### Go-live clientes
1. Piloto com 1–2 clientes: só CRM + funil + Meta (sem IA/fluxos/automações de grupo no início)
2. Checklist por cliente: WhatsApp conectado, pixel/token, domínios LP, toggles Quote/Purchase
3. Conversão personalizada **Purchase** na Meta se coluna Compra ficar vazia

### Produto (P1 opcional)
- [ ] Wizard/hints em Integrações
- [ ] Toast feedback em LeadQualified (hoje só Quote/Purchase retornam `tracking` na API)
- [ ] Teste funil completo com **contato novo** (validar Quote + LeadQualified `sent: true`)
- [ ] Validar `ConversationStarted` com mensagem WhatsApp real (não simula pelo console)

### Volume / medo operacional
- 100–200 msgs/dia por cliente = carga baixa; risco maior é Evolution/sessão WhatsApp, não o backend
- Idempotência faz colunas Orçamento/Compra mostrarem "-" após 1º evento por contato (comportamento esperado)

---

## Commits recentes (referência)

```
970d96a Endurece operacao: socket por tenant, Meta atomico, erros visiveis e UX demo.
38de9ad Corrige loop infinito no historico do lead no chat CRM.
90ac7ca Corrige CORS da LP e otimiza painel de integracoes Meta.
ba53981 Atribuicao silenciosa: mensagem WhatsApp limpa e prompt atualizado.
```

---

## Arquivos-chave

| Área | Caminho |
|------|---------|
| Backend principal | `whatsapp-saas/backend/src/server.js` |
| CAPI Meta | `whatsapp-saas/backend/src/lib/metaConversions.js` |
| CRM ingestão | `whatsapp-saas/backend/src/lib/crmCore.js` |
| Orçamento/compra | `whatsapp-saas/backend/src/lib/crmContactActivity.js` |
| Script LP | `whatsapp-saas/backend/public/vesto-attribution.js` |
| Integrações UI | `whatsapp-saas/src/pages/dashboard/Integrations.jsx` |
| Guia Meta UI | `whatsapp-saas/src/components/integrations/MetaIntegrationGuide.jsx` |
| Funil lead chat | `whatsapp-saas/src/components/crm/ContactLeadActions.jsx` |
| Deploy | `RAILWAY.md` |

---

*Checkpoint gerado em 12/07/2026 — retomar a partir da seção "Pendências / próximos passos".*
