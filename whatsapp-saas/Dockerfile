# bookworm (glibc): npm ci no Alpine falhava no Railway; npm install + Debian evita binários opcionais quebrados em musl
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
RUN npm install -g serve@14.2.4
COPY --from=builder /app/dist ./dist
COPY scripts/railway-serve.mjs ./scripts/railway-serve.mjs
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "scripts/railway-serve.mjs"]
