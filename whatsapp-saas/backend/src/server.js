require("dotenv").config()

const express = require("express")
const cors = require("cors")
const bcrypt = require("bcryptjs")
const QRCode = require("qrcode")
const { z } = require("zod")
const { v4: uuid } = require("uuid")
const { createServer } = require("http")
const { Server } = require("socket.io")
const { prisma } = require("./lib/prisma")
const { signToken, authMiddleware } = require("./lib/auth")
const { groups, scheduledMessages, sentMessages, getAnalyticsSnapshot } = require("./data/mock")

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  },
})

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  }),
)
app.use(express.json({ limit: "8mb" }))

let whatsappState = {
  connected: false,
  qr: null,
  lastSync: null,
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "vesto-backend", ts: new Date().toISOString() })
})

app.post("/api/auth/register", async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })

  const { name, email, password } = parsed.data
  const exists = await prisma.user.findUnique({ where: { email } })
  if (exists) return res.status(409).json({ error: "EMAIL_IN_USE", message: "E-mail já cadastrado." })

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: { name, email, passwordHash },
  })
  const token = signToken(user)
  return res.status(201).json({ user: { id: user.id, name: user.name, email: user.email }, token })
})

app.post("/api/auth/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Credenciais inválidas." })

  const { email, password } = parsed.data
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." })

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." })

  const token = signToken(user)
  return res.json({ user: { id: user.id, name: user.name, email: user.email }, token })
})

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } })
  if (!user) return res.status(404).json({ error: "NOT_FOUND", message: "Usuário não encontrado." })
  return res.json({ user: { id: user.id, name: user.name, email: user.email } })
})

app.get("/api/groups", authMiddleware, (_req, res) => {
  res.json({ groups })
})

app.get("/api/analytics", authMiddleware, (req, res) => {
  const period = req.query.period || "7d"
  res.json(getAnalyticsSnapshot(period))
})

app.get("/api/messages/history", authMiddleware, (_req, res) => {
  res.json({ items: sentMessages.slice(0, 100) })
})

app.get("/api/messages/scheduled", authMiddleware, (_req, res) => {
  res.json({ items: scheduledMessages })
})

app.post("/api/messages/send", authMiddleware, (req, res) => {
  const schema = z.object({
    groupIds: z.array(z.string()).min(1),
    body: z.string().min(1),
    attachments: z.array(z.any()).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Payload inválido." })

  const item = {
    id: uuid(),
    groupIds: parsed.data.groupIds,
    group: groups.find((g) => g.id === parsed.data.groupIds[0])?.name || "Grupo",
    body: parsed.data.body,
    status: "entregue",
    sentAt: new Date().toISOString(),
  }
  sentMessages.unshift(item)
  io.emit("message:sent", item)
  res.status(201).json({ message: item })
})

app.post("/api/messages/schedule", authMiddleware, (req, res) => {
  const schema = z.object({
    groupIds: z.array(z.string()).min(1),
    body: z.string().min(1),
    scheduledAt: z.string(),
    recurrence: z.string().optional(),
    timezone: z.string().optional(),
    retryPolicy: z.string().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Payload inválido." })

  const row = {
    id: `sch-${uuid()}`,
    groupNames: groups.filter((g) => parsed.data.groupIds.includes(g.id)).map((g) => g.name),
    body: parsed.data.body,
    scheduledAt: parsed.data.scheduledAt,
    recurrence: parsed.data.recurrence || "unico",
    timezone: parsed.data.timezone || "America/Sao_Paulo",
    retryPolicy: parsed.data.retryPolicy || "2x",
    status: "pendente",
  }
  scheduledMessages.unshift(row)
  res.status(201).json({ item: row })
})

app.get("/api/whatsapp/status", authMiddleware, (_req, res) => {
  res.json({
    connected: whatsappState.connected,
    qr: whatsappState.qr,
    lastSync: whatsappState.lastSync,
  })
})

app.post("/api/whatsapp/connect", authMiddleware, async (_req, res) => {
  const payload = `vesto:${Date.now()}`
  const qr = await QRCode.toDataURL(payload)
  whatsappState = {
    connected: false,
    qr,
    lastSync: whatsappState.lastSync,
  }
  io.emit("whatsapp:qr", { qr })
  res.status(201).json({ connected: false, qr })
})

app.post("/api/whatsapp/confirm-scan", authMiddleware, (_req, res) => {
  whatsappState = {
    connected: true,
    qr: null,
    lastSync: new Date().toISOString(),
  }
  io.emit("whatsapp:status", { connected: true, lastSync: whatsappState.lastSync })
  res.json({ connected: true, lastSync: whatsappState.lastSync })
})

app.post("/api/whatsapp/disconnect", authMiddleware, (_req, res) => {
  whatsappState = { connected: false, qr: null, lastSync: new Date().toISOString() }
  io.emit("whatsapp:status", { connected: false, lastSync: whatsappState.lastSync })
  res.json({ connected: false, lastSync: whatsappState.lastSync })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno do servidor." })
})

const port = Number(process.env.PORT || 4000)

httpServer.listen(port, () => {
  console.log(`Backend online na porta ${port}`)
})
