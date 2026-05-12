# Backend Vesto Group

API Node.js/Express para autenticação, grupos, mensagens, analytics e sessão WhatsApp via Evolution API.

## Stack

- Node.js + Express
- Prisma + PostgreSQL
- JWT
- Socket.io

## Rodar local

1. Copie `.env.example` para `.env`.
2. Configure `DATABASE_URL`.
3. Rode:

```bash
npm install
npm run prisma:generate
npm run prisma:push
npm run dev
```

API local: `http://localhost:4000`

## Rotas principais

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/groups`
- `GET /api/analytics`
- `POST /api/messages/send`
- `POST /api/messages/schedule`
- `GET /api/messages/scheduled`
- `GET /api/messages/history`
- `GET /api/whatsapp/status`
- `POST /api/whatsapp/connect`
- `POST /api/whatsapp/confirm-scan`
- `POST /api/whatsapp/disconnect`

## Deploy Railway

Crie 2 serviços no mesmo projeto:

1. **backend**
   - Root Directory: `backend`
   - Build Command: `npm install && npm run prisma:generate`
   - Start Command: `npm run prisma:push && npm start`
   - Variáveis: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`

2. **frontend**
   - Root Directory: `.`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run preview -- --host 0.0.0.0 --port $PORT`
   - Variáveis: `VITE_API_URL=https://<url-do-backend>/api`, `VITE_USE_REAL_API=true`

## WhatsApp real (Evolution)

Defina as variáveis no backend:

- `EVOLUTION_BASE_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE_PREFIX` (opcional, padrão `vesto`)
- `EVOLUTION_WEBHOOK_URL` (opcional)

As rotas abaixo já usam Evolution API:

- `GET /api/whatsapp/status`
- `POST /api/whatsapp/connect`
- `POST /api/whatsapp/disconnect`
