# bot-wpp — Vesto Group / GroupFlow

Monorepositório com o **front-end** (React + Vite) e o **back-end** (Express + Prisma) na pasta `whatsapp-saas/`.

- **Aplicação web:** `whatsapp-saas/`
- **API:** `whatsapp-saas/backend/`

## Requisitos locais

- Node.js 20+
- npm 10+
- PostgreSQL (para o back-end com API real)

## Desenvolvimento

```bash
cd whatsapp-saas
npm install
npm run dev
```

Front: em geral `http://localhost:5173`.

Back-end (opcional):

```bash
cd whatsapp-saas/backend
cp .env.example .env
# ajuste DATABASE_URL
npm install
npm run prisma:generate
npm run prisma:push
npm run dev
```

## Deploy no Railway

Instruções detalhadas + checklist pós-push: **[RAILWAY.md](./RAILWAY.md)**.

Repositório: [github.com/Leonardotrentini/bot-wpp](https://github.com/Leonardotrentini/bot-wpp)
