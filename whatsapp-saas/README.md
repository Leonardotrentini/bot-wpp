# GroupFlow — SaaS de gestão e automação de grupos WhatsApp

Front-end completo em **React 19** + **Vite 8**, **Tailwind CSS v4**, **React Router**, **Lucide**, **Recharts**, **Axios** e **socket.io-client** (preparado). Dados e APIs estão **mockados** em `src/services/api.js` para desenvolvimento sem backend.

## Requisitos

- Node.js 20+ (recomendado)
- npm 10+

## Instalação

```bash
cd whatsapp-saas
npm install
```

## Desenvolvimento

```bash
npm run dev
```

Abra o endereço exibido no terminal (geralmente `http://localhost:5173`).

- **Landing:** `/`
- **Login:** `/login`
- **Registro:** `/register`
- **Dashboard (protegido):** `/dashboard` — faça login com qualquer e-mail/senha válidos (validação mock).

## Build de produção

```bash
npm run build
npm run preview
```

## Variáveis de ambiente

Crie um arquivo `.env` na raiz (opcional):

```env
VITE_API_URL=https://sua-api.com/api
VITE_SOCKET_URL=https://sua-api.com
```

Sem essas variáveis, o Axios usa `http://localhost:4000/api` como base (apenas referência; as chamadas atuais são mockadas).

## Estrutura principal

- `src/pages` — Landing, Login, Register e páginas do dashboard
- `src/components/common` — Botões, inputs, modais, toasts, etc.
- `src/components/layout` — Header/footer da landing e layout do app
- `src/services/api.js` — Camada de API (mock + `axios` pronto)
- `src/services/socket.js` — Exemplo comentado para Socket.io
- `src/utils/mockData.js` — Dados fictícios em português (Brasil)

## Próximo passo: backend

Veja **`BACKEND_REQUIREMENTS.md`** para a lista de endpoints e contratos sugeridos.

## Backend real + Railway

Agora o projeto inclui a pasta `backend` com API Express + Prisma.

- Backend local: siga `backend/README.md`
- Frontend pode alternar para API real com:
  - `VITE_USE_REAL_API=true`
  - `VITE_API_URL=https://seu-backend.railway.app/api`

## Licença

Projeto de exemplo — use e adapte conforme sua necessidade.
