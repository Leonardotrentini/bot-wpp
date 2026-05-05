# Imagem de produção: build Vite + servidor estático (evita Railpack a arrancar o comando errado)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve@14.2.4
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 8080
CMD ["sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT:-8080}"]
