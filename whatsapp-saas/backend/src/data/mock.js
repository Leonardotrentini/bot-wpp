const groups = [
  { id: "g1", name: "Alunos Turma 2024", memberCount: 342, activeMembers: 289, messagesPerDay: 128 },
  { id: "g2", name: "Comunidade VIP", memberCount: 193, activeMembers: 154, messagesPerDay: 64 },
  { id: "g3", name: "Suporte Clientes", memberCount: 421, activeMembers: 330, messagesPerDay: 92 },
  { id: "g4", name: "Lançamento Produto X", memberCount: 108, activeMembers: 76, messagesPerDay: 36 },
]

const scheduledMessages = []
const sentMessages = []

function getAnalyticsSnapshot(period = "7d") {
  const base = period === "30d" ? 30 : period === "hoje" ? 1 : 7
  const totalMessages = groups.reduce((acc, g) => acc + g.messagesPerDay * base, 0)
  const members = groups.reduce((acc, g) => acc + g.memberCount, 0)
  const active = groups.reduce((acc, g) => acc + g.activeMembers, 0)
  const engagement = members > 0 ? (active / members) * 100 : 0

  return {
    period,
    totalMessages,
    responseRate: Number((engagement * 0.34).toFixed(1)),
    activeMembers: active,
    inactiveMembers: members - active,
    memberGrowthPct: 4.2,
    messagesByDay: ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day, idx) => ({
      day,
      count: Math.max(80, Math.round(totalMessages / 7 + (idx - 2) * 15)),
    })),
    messagesByHour: Array.from({ length: 24 }, (_, h) => ({
      hour: `${h}h`,
      count: h >= 9 && h <= 22 ? Math.round(80 + Math.random() * 120) : Math.round(Math.random() * 25),
    })),
    engagementByGroup: groups.map((g) => ({
      name: g.name,
      value: g.activeMembers,
    })),
    topMembers: [
      { name: "João Silva", msgs: 156 },
      { name: "Maria Santos", msgs: 142 },
      { name: "Ana Costa", msgs: 128 },
      { name: "Lucas Almeida", msgs: 115 },
      { name: "Fernanda Lima", msgs: 98 },
      { name: "Ricardo Souza", msgs: 87 },
      { name: "Camila Rocha", msgs: 76 },
      { name: "Patricia Gomes", msgs: 65 },
      { name: "Pedro Oliveira", msgs: 54 },
      { name: "Bruno Ferreira", msgs: 42 },
    ],
    groupComparison: groups.map((g) => ({
      id: g.id,
      name: g.name,
      messages: g.messagesPerDay * base,
      members: g.memberCount,
      engagement: (g.activeMembers / g.memberCount) * 100,
    })),
  }
}

module.exports = {
  groups,
  scheduledMessages,
  sentMessages,
  getAnalyticsSnapshot,
}
