# Requisitos de API — GroupFlow (backend)

Este documento lista as APIs que o backend deve expor para substituir os mocks em `src/services/api.js`. Todas as respostas devem usar JSON. Autenticação sugerida: **JWT** no header `Authorization: Bearer <token>`.

Convenção de base: `VITE_API_URL` (ex.: `https://api.seudominio.com/v1`).

---

## Autenticação

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/auth/login` | Body: `{ email, password }` → `{ user, token }` |
| `POST` | `/auth/register` | Body: `{ name, email, password }` → `{ user, token }` |
| `POST` | `/auth/logout` | Invalida refresh token (opcional) |
| `POST` | `/auth/forgot-password` | Body: `{ email }` |
| `GET` | `/auth/me` | Usuário atual a partir do JWT |

---

## WhatsApp / sessão

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/whatsapp/status` | `{ connected, lastSync, sessionId? }` |
| `GET` | `/whatsapp/qr` | Stream ou polling de QR (ou WebSocket — ver Socket.io) |
| `POST` | `/whatsapp/connect` | Inicia sessão / solicita QR |
| `POST` | `/whatsapp/disconnect` | Encerra sessão |

---

## Grupos

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/groups` | Lista: nome, foto, membros, status, última mensagem, ids |
| `GET` | `/groups/:id` | Detalhe + estatísticas + `settings` |
| `PATCH` | `/groups/:id/settings` | Boas-vindas, auto-mod, palavras proibidas, limites, mídias |
| `GET` | `/groups/:id/members` | Lista paginada com filtros (query: `status`, `role`, `q`) |
| `GET` | `/groups/:id/activity` | Série temporal para gráficos |

---

## Mensagens

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/messages/send` | Body: `{ groupIds[], body, attachments?[] }` |
| `POST` | `/messages/schedule` | Body: `{ groupIds[], body, scheduledAt (ISO) }` |
| `GET` | `/messages/scheduled` | Lista agendadas |
| `DELETE` | `/messages/scheduled/:id` | Cancela agendamento |
| `GET` | `/messages/history` | Query: `from`, `to`, `groupId`, `status`, paginação |

---

## Automações

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/automations` | Lista automações |
| `POST` | `/automations` | Cria (tipo: boas-vindas, agendada, gatilho + config) |
| `PATCH` | `/automations/:id` | Atualiza |
| `POST` | `/automations/:id/duplicate` | Duplica |
| `DELETE` | `/automations/:id` | Remove |

---

## Membros (global)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/members` | Query: `groupId`, `tag`, `status`, `inactiveDays`, `q`, paginação |
| `GET` | `/members/:id` | Detalhe |
| `POST` | `/members/bulk-tags` | Adicionar/remover tags |
| `POST` | `/members/bulk-message` | Envio em massa (fila) |
| `GET` | `/members/export` | CSV / streaming |

---

## Analytics

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/analytics/summary` | Métricas agregadas (cards dashboard) |
| `GET` | `/analytics` | Query: `period=today|7d|30d|custom&from&to` — séries, pizza, top membros, comparativo |

---

## Integrações

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/integrations` | Status por provedor |
| `POST` | `/integrations/:provider/connect` | OAuth ou chaves |
| `PATCH` | `/integrations/:provider` | Atualiza config |

Provedores: `hotmart`, `kiwify`, `eduzz`, `google_sheets`, `zapier`, `api`.

---

## Configurações / conta

| Método | Rota | Descrição |
|--------|------|-----------|
| `PATCH` | `/users/me` | Perfil (nome, email, telefone, avatar) |
| `PATCH` | `/users/me/password` | Troca de senha |
| `GET` | `/billing/plan` | Plano atual e uso |
| `POST` | `/billing/checkout` | Upgrade/downgrade |
| `PATCH` | `/users/me/notifications` | Preferências e-mail / push / WhatsApp |
| `GET` | `/teams/members` | Equipe |
| `POST` | `/teams/invites` | Convidar por e-mail + permissão |

---

## Socket.io (tempo real)

Canal sugerido (mesmo host ou `VITE_SOCKET_URL`):

- Eventos: `whatsapp:qr`, `whatsapp:status`, `message:sent`, `group:updated`, `automation:triggered`
- Autenticação na conexão: `socket.auth.token = JWT`

---

## Erros

Use códigos HTTP consistentes (`400` validação, `401` não autenticado, `403` sem permissão, `404`, `409` conflito, `422` regra de negócio). Corpo sugerido:

```json
{ "error": "CODE", "message": "Descrição legível" }
```

---

## Observações

- **LGPD / Meta:** trate números de telefone e conteúdo de mensagens com base legal, políticas da Meta e termos do WhatsApp.
- **Rate limiting:** essencial em envio em massa e webhooks.
- **Filas:** envio agendado e automações devem usar workers (Bull, SQS, etc.).
