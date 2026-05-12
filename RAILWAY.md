# Deploy no Railway

Use **um projeto Railway** com **PostgreSQL** + **2 serviços** (backend e frontend), conforme a estrutura deste repo.

## Estrutura no GitHub

| Pasta no repo | Papel |
|---------------|--------|
| `whatsapp-saas/` | Raiz do **frontend** (Vite) |
| `whatsapp-saas/backend/` | Raiz do **backend** (Express + Prisma) |

## 1. Banco de dados

1. No projeto Railway, adicione **PostgreSQL**.
2. Copie a variável `DATABASE_URL` (ou use a referência do plugin Postgres ao montar variáveis do backend).

## 2. Serviço — Backend

- **Root Directory:** `whatsapp-saas/backend`
- O ficheiro **`whatsapp-saas/backend/railway.json`** define build/start para o Railway (podes apagar os comandos manuais no painel se estiverem em conflito).
- **Build / Start** (equivalente ao ficheiro): `npm install && npm run prisma:generate` → `npm run prisma:push && npm start`  
  *(Em produção madura, prefira migrações versionadas: `prisma migrate deploy`.)*

**Obrigatório nas variáveis do backend:** `JWT_SECRET` (texto longo aleatório) e `FRONTEND_URL` (URL HTTPS exata do front), além de `DATABASE_URL` ligada ao Postgres.

**Variáveis de ambiente:**

| Variável | Exemplo / notas |
|----------|-----------------|
| `DATABASE_URL` | Fornecida pelo Postgres do Railway |
| `JWT_SECRET` | String longa e aleatória (obrigatório em produção) |
| `FRONTEND_URL` | URL pública do front no Railway, ex. `https://seu-front.up.railway.app` |
| `PORT` | O Railway injeta automaticamente; o servidor já usa `process.env.PORT` |
| `EVOLUTION_BASE_URL` | URL base da sua Evolution API |
| `EVOLUTION_API_KEY` | API key da Evolution |
| `EVOLUTION_INSTANCE_PREFIX` | Prefixo dos nomes de instância (ex. `vesto`) |
| `EVOLUTION_WEBHOOK_URL` | URL pública opcional para receber eventos |

Health check opcional: `GET /health`

## 3. Serviço — Frontend

- **Root Directory:** `whatsapp-saas`
- O ficheiro **`whatsapp-saas/railway.json`** força **`builder: DOCKERFILE`** para o Railway **não** usar Railpack (evita builds com `railpack-plan.json` / Prisma no front).
- Nos **Build Logs** do front deves ver **Docker build** (ex.: `FROM node:20-alpine`), **não** `npm run start` como passo de build nem cópias em cache do **Prisma**.
- Nos **Deploy Logs** após arrancar **não** deve aparecer `node src/server.js` nem `Backend online` — isso indica que o serviço ainda está a usar a pasta do **backend**.
- Se no painel tiveres **Start Command** manual, **apaga-o** (o `CMD` do Dockerfile já define o start).

**Variáveis de ambiente (build e/ou runtime):**

| Variável | Valor |
|----------|--------|
| `VITE_USE_REAL_API` | `true` (opcional se usares runtime abaixo) |
| `VITE_API_URL` | `https://<URL-pública-do-backend>/api` (opcional se usares runtime abaixo) |
| `BACKEND_API_BASE` | `https://<URL-pública-do-backend>/api` — **lida em runtime** pelo arranque do container; ideal para mudar a API **sem** rebuild (define no serviço `bot-wpp` e **reinicia**). |
| `BACKEND_USE_REAL_API` | `true` (default no script) — força API real quando usas `BACKEND_API_BASE`. |

O domínio público do backend aparece no painel do serviço (Settings → Networking / Domains). Deve terminar com `/api` porque o cliente Axios já usa essa base.

**Importante:** variáveis `VITE_*` são embutidas no **build**. Se só usares `BACKEND_API_BASE`, podes alterar a URL da API com **reinício** do serviço (o `railway-serve.mjs` injeta `window.__VESTO_ENV__` no `dist/index.html` ao arrancar). Após o **primeiro** deploy com esta imagem, confirma que `BACKEND_API_BASE` está definida. Se mudares `VITE_*`, é preciso **rebuild** do frontend.

## 4. Conectar o repositório

1. Railway → **New Project** → **Deploy from GitHub repo**.
2. Selecione `Leonardotrentini/bot-wpp`.
3. Crie os dois serviços acima com os **Root Directory** corretos.
4. No Postgres, use **Connect** / variáveis referenciadas para passar `DATABASE_URL` ao backend.

## 5. Ordem sugerida

1. Subir **Postgres** → configurar **backend** (deploy até `/health` responder).
2. Anotar a URL HTTPS do backend.
3. Configurar variáveis do **frontend** com essa URL em `VITE_API_URL`.
4. Deploy do **frontend** e definir `FRONTEND_URL` no backend com a URL do front.

Depois disso, registro/login passam a usar a API real e o restante das rotas mockadas no front podem ser migradas gradualmente.

---

## 6. Checklist rápido após cada `git push`

*(O Cursor não altera o teu painel Railway; isto é só o que falta clicar.)*

### Backend

1. **Variables:** `DATABASE_URL` (Postgres), **`JWT_SECRET`**, **`FRONTEND_URL`** (URL HTTPS exata do front).
2. **Deploy:** sem comandos manuais em conflito com `whatsapp-saas/backend/railway.json` (ou apaga overrides).
3. **Networking:** porta pública = `PORT` dos **Deploy Logs**.
4. **Redeploy** se mudaste variáveis.

### Front (`bot-wpp`)

1. **Root Directory:** `whatsapp-saas`.
2. **Variables:** `BACKEND_API_BASE=https://<backend>/api` e `BACKEND_USE_REAL_API=true` (recomendado), **ou** `VITE_USE_REAL_API=true` + `VITE_API_URL=https://<backend>/api` (rebuild ao mudar).
3. **Deploy:** remove **Start Command** que aponte para Express; com **Dockerfile** em `whatsapp-saas/`, o Railway deve fazer build Docker.
4. **Redeploy** após mudar `VITE_*`.

### Teste

- Front `/` → landing (não `Cannot GET /`).
- Backend `/health` → `ok: true`.
