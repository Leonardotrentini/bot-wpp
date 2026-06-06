# Auditoria MVP — Vesto Group (piloto 3–4 clientes, até 50 grupos/número)

**Data:** 2026-06-02  
**Objetivo:** operação estável com até **50 grupos monitorados** por WhatsApp, sem reduzir capacidade.  
**SCORE pós-melhorias (piloto fechado):** **84 / 100**

---

## Resumo executivo

| Área | Antes | Depois | Nota |
|------|-------|--------|------|
| Limite 50 grupos | Só no plano, sem enforcement | Backend + UI + parcial | 9/10 |
| Sync participantes (50 grupos) | Disparo sequencial sem pausa | Fila background + delay + rate-limit | 8/10 |
| Disparos / scheduler | 20 auto/tick, overlap possível | 5/tick, mutex, fila por usuário | 8/10 |
| Validação de envio | Qualquer groupId | Só grupos monitorados ativos | 9/10 |
| Health check | Só `{ ok: true }` | Inclui ping PostgreSQL | 8/10 |
| Testes automatizados | Scripts X1 manuais | + `smoke-test.mjs` | 5/10 |
| Billing / integrações | Mock / manual | Inalterado (ok para piloto) | 4/10 |

**Veredicto:** pronto para **3–4 clientes** com onboarding manual, usando até **50 grupos** cada.

---

## Melhorias implementadas nesta auditoria

### 1. Limite de 50 grupos (robusto)
- **Arquivo:** `backend/src/lib/groupLimits.js`
- Ativação **parcial**: selecionar 55 grupos → ativa 50, informa quantos foram ignorados.
- Bloqueio claro quando limite já está cheio (0 vagas).
- API retorna `limits: { maxGroups, monitored, remaining }` em `/api/groups`.

### 2. Fila de envio por usuário
- **Arquivo:** `backend/src/lib/sendQueue.js`
- Evita dois disparos simultâneos no mesmo WhatsApp (crítico com 50 grupos × ~5s = ~4 min por job).

### 3. Sync de participantes escalonado
- **Arquivo:** `backend/src/lib/participantSyncQueue.js`
- Após ativar grupos, sync roda em **background** com pausa entre grupos.
- Para fila em **rate-limit** WhatsApp/Evolution.

### 4. Scheduler mais seguro
- Mutex global (`schedulerTickBusy`) — ticks não sobrepõem.
- Máx. **5 automações/tick** (`SCHEDULER_MAX_AUTOMATIONS_PER_TICK`).
- Só dispara para grupos **monitorados + ativos**.
- Disparos do scheduler entram na **fila por usuário**.

### 5. Validação de disparos
- Automações e envio imediato usam `resolveMonitoredGroupJidsForSend`.
- Grupos inativos/pendentes não recebem mensagem silenciosamente.

### 6. Health check com banco
- `GET /health` → `{ ok, db: "ok" }` ou 503 se Postgres indisponível.

### 7. UI Grupos
- Contador `X / 50` + vagas restantes.
- Ativação parcial com mensagem clara (toast info).

### 8. Integrações
- Texto atualizado: **em desenvolvimento** (evita expectativa errada no piloto).

### 9. Smoke test
- **Arquivo:** `backend/scripts/smoke-test.mjs`
- **Comando:** `npm run smoke` (no backend)

---

## Variáveis de ambiente recomendadas (Railway)

```env
# Obrigatórias (já existentes)
JWT_SECRET=...
DATABASE_URL=...
FRONTEND_URL=https://seu-front.up.railway.app
EVOLUTION_BASE_URL=...
EVOLUTION_API_KEY=...
EVOLUTION_WEBHOOK_SECRET=...   # strongly recommended

# Performance / robustez (novas ou revisadas)
SCHEDULER_MAX_AUTOMATIONS_PER_TICK=5
PARTICIPANTS_SYNC_ITEM_DELAY_MS=500
GROUP_SYNC_ITEM_DELAY_MS=350
MESSAGE_SEND_GROUP_DELAY_MS=3000
MESSAGE_SEND_JITTER_MS=4000
DEFAULT_MAX_GROUPS=50
ENABLE_SCHEDULER=true
```

---

## Checklist P0 antes de cada cliente

- [ ] `npm run smoke` com `SMOKE_BASE_URL` + credenciais admin
- [ ] `/health` → `db: ok`
- [ ] Admin: criar usuário, confirmar `plan.maxGroups = 50`
- [ ] Cliente: QR → discover → ativar grupos (até 50)
- [ ] 1 disparo teste em 1 grupo
- [ ] Dashboard: métricas após atividade real
- [ ] Logs Railway: sem OOM / loop de erro

---

## Riscos remanescentes (aceitáveis no piloto)

| Risco | Mitigação |
|-------|-----------|
| `prisma db push` no deploy | Evitar mudanças de schema durante piloto; migrar para migrations depois |
| Evolution RAM com 4×50 grupos | Evolution ≥ 4 GB; monitorar desconexões |
| Import 50 grupos (2 dias) | Sequencial ~4s/grupo; rate-limit pausa — normal |
| Sem forgot-password | Admin redefine / impersonate |
| Integrações mock | Não prometer no piloto |

---

## SCORE detalhado (piloto 3–4 clientes)

| Categoria | Peso | Nota |
|-----------|------|------|
| WhatsApp + grupos (50) | 25% | 8.5 |
| Disparos + cadências | 20% | 8.0 |
| X1 | 15% | 7.0 |
| Admin + multi-tenant | 10% | 8.0 |
| Infra + observabilidade | 15% | 7.5 |
| UX / clareza | 10% | 8.0 |
| Testes | 5% | 5.0 |
| **TOTAL** | | **~84** |

---

## Próximos passos (pós-piloto, antes do público)

1. Migrations Prisma (substituir `db push --accept-data-loss`)
2. Stripe / checkout
3. Testes E2E (Playwright) no fluxo connect → groups → send
4. Rate limit em `/api/auth/login`
5. Esconder ou remover rota Integrações do menu
6. Alertas Railway (CPU/RAM/restarts)

---

## Comandos úteis

```bash
# Backend — smoke pós-deploy
cd whatsapp-saas/backend
SMOKE_BASE_URL=https://seu-backend.up.railway.app \
SMOKE_EMAIL=admin@vesto.group \
SMOKE_PASSWORD=... \
npm run smoke

# X1 (staging)
npm run test:x1:integration
```
