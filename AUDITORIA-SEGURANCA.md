# Auditoria de segurança — Vesto Group

**Data:** 2026-06-02  
**Escopo:** vazamento de dados, acesso não autorizado, segredos, multi-tenant.

---

## Veredicto

| Nível | Status |
|-------|--------|
| **Piloto 3–4 clientes (pós-correções)** | **Aceitável** se checklist Railway abaixo estiver OK |
| **Abertura ao público** | Ainda exige billing, auditoria LGPD formal e testes E2E |

**SCORE segurança (piloto):** **78 / 100** (era ~55 antes das correções desta auditoria)

---

## O que estava OK antes

| Item | Detalhe |
|------|---------|
| Senhas | `bcrypt` — hash nunca retornado na API |
| JWT | Assinado com `JWT_SECRET`; rotas protegidas com `authMiddleware` |
| Admin | `requireAdmin` valida role na BD (não só no token) |
| Impersonação | Bloqueada entre admins |
| Multi-tenant | Rotas filtram por `req.user.sub` / `userId` |
| `.gitignore` | `.env` excluído do Git |
| Respostas auth | Login/registro não expõem se e-mail existe além de 409 genérico |

---

## Riscos encontrados e correções aplicadas

### Crítico — webhook Evolution aberto

**Problema:** Sem `EVOLUTION_WEBHOOK_SECRET`, qualquer um podia POST em `/api/evolution/webhook` e injetar eventos falsos.

**Correção:** Em `NODE_ENV=production`, webhook **rejeitado (401)** se secret ausente. Módulo `lib/security.js`.

**Ação sua:** Definir `EVOLUTION_WEBHOOK_SECRET` no Railway (string longa aleatória) e o mesmo valor na Evolution.

---

### Alto — cadastro público aberto

**Problema:** `/api/auth/register` criava conta para qualquer pessoa na internet.

**Correção:** Em produção, registro **desligado** por padrão. Clientes entram só via **Admin → criar usuário**.

Para reabrir temporariamente: `ALLOW_PUBLIC_REGISTER=true` no Railway.

---

### Alto — troca de senha sem senha atual

**Problema:** Com JWT roubado, atacante trocava a senha sem saber a antiga.

**Correção:** `PUT /api/auth/profile` exige `currentPassword` ao definir `newPassword`. UI em Configurações atualizada.

---

### Médio — vazamento em erros da Evolution

**Problema:** Respostas 502 incluíam `rawPreview` / `details` da API externa.

**Correção:** Em produção, cliente recebe só mensagem genérica; detalhes ficam nos logs do servidor.

---

### Médio — CORS permissivo

**Problema:** `FRONTEND_URL` ausente → CORS `*` (qualquer site poderia chamar a API com token do usuário).

**Correção:** Em produção sem `FRONTEND_URL`, CORS **bloqueia** browsers (`origin: false`).

**Ação sua:** `FRONTEND_URL=https://seu-front.exato.up.railway.app` no backend.

---

### Médio — brute force login/registro

**Correção:** Rate limit **20 tentativas / 15 min** por IP em login e registro (`authRateLimit.js`).

---

### Médio — senhas padrão em scripts de teste

**Problema:** `test-x1-*.js` tinham senhas e webhook secret hardcoded no repo.

**Correção:** Scripts exigem variáveis de ambiente; sem default de senha.

---

### Baixo — headers HTTP

**Correção:** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.

---

## O que NÃO vaza hoje (desde que env esteja correto)

| Dado | Onde fica |
|------|-----------|
| `JWT_SECRET` | Só Railway env |
| `EVOLUTION_API_KEY` | Só backend env — nunca enviado ao front |
| `DATABASE_URL` | Só backend env |
| Senhas usuários | Só hash bcrypt na BD |
| Mensagens WhatsApp | Postgres — isoladas por `userId` |
| Token JWT | `localStorage` do browser (risco XSS, ver abaixo) |

---

## Riscos remanescentes (aceitáveis no piloto)

| Risco | Mitigação manual |
|-------|------------------|
| JWT em `localStorage` | Não instalar extensões suspeitas; CSP futuro |
| Sem 2FA admin | Senha forte + trocar seed admin |
| Seed no deploy | `ADMIN_SEED_PASSWORD` forte; senha existente não é sobrescrita no upsert |
| Impersonação admin | Só você usa; não compartilhar conta admin |
| Logs Railway | Não logar bodies com mídia base64 |
| LGPD / Meta | Termo de uso + base legal para números/mensagens |

---

## Checklist obrigatório no Railway (backend)

Marque antes de onboardar clientes:

- [ ] `JWT_SECRET` — **32+ caracteres aleatórios** (nunca o exemplo do `.env.example`)
- [ ] `FRONTEND_URL` — URL **exata** do front (HTTPS)
- [ ] `EVOLUTION_WEBHOOK_SECRET` — secret forte; igual na Evolution
- [ ] `EVOLUTION_API_KEY` — só no backend, rotacionar se vazou
- [ ] `ADMIN_SEED_PASSWORD` — senha forte; **trocar** se ainda usa `Admin@ChangeMe!2026`
- [ ] `NODE_ENV=production` (Railway costuma definir)
- [ ] **Não** definir `ALLOW_PUBLIC_REGISTER=true` no piloto
- [ ] Confirmar que **nenhum** `.env` está no GitHub

---

## Checklist Evolution / WhatsApp

- [ ] Webhook aponta para `https://seu-backend/api/evolution/webhook?secret=SEU_SECRET`
- [ ] Instâncias por cliente (`vesto-{userId}`) — não compartilhar QR
- [ ] API key Evolution não exposta no front nem em repositório público

---

## Como verificar após deploy

```powershell
# Health
curl https://SEU-BACKEND/health

# Registro público deve falhar (403)
curl -X POST https://SEU-BACKEND/api/auth/register -H "Content-Type: application/json" -d "{\"name\":\"Test\",\"email\":\"x@test.com\",\"password\":\"123456\"}"

# Webhook sem secret deve falhar (401) em produção
curl -X POST https://SEU-BACKEND/api/evolution/webhook -H "Content-Type: application/json" -d "{}"
```

Smoke completo:

```powershell
cd whatsapp-saas/backend
$env:SMOKE_BASE_URL="https://SEU-BACKEND"
$env:SMOKE_EMAIL="admin@vesto.group"
$env:SMOKE_PASSWORD="sua_senha_forte"
npm run smoke
```

---

## Arquivos de segurança adicionados

| Arquivo | Função |
|---------|--------|
| `backend/src/lib/security.js` | CORS, webhook, registro, sanitização de erros |
| `backend/src/lib/authRateLimit.js` | Limite login/registro |
| `AUDITORIA-SEGURANCA.md` | Este documento |

---

## Resumo para você

**Está seguro para o piloto fechado** se:

1. Trocou a senha do admin  
2. Configurou `EVOLUTION_WEBHOOK_SECRET`  
3. `FRONTEND_URL` e `JWT_SECRET` corretos no Railway  
4. Clientes criados **só pelo admin** (registro público off)  

**Nada crítico deve vazar** pelo código atual — o maior risco era **webhook aberto** e **cadastro aberto**, ambos corrigidos para produção.
