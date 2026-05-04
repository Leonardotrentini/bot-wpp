/** @param {string} seed */
export const avatar = (seed) =>
  `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`

export const mockUser = {
  id: 'u1',
  name: 'Carlos Mendes',
  email: 'carlos.mendes@empresa.com.br',
  phone: '+55 (11) 99876-5432',
  avatar: avatar('Carlos Mendes'),
  plan: 'Pro',
}

export const mockGroups = [
  {
    id: 'g1',
    name: 'Alunos Turma 2024',
    memberCount: 342,
    status: 'ativo',
    lastMessage: 'Amanhã às 20h tem live de revisão — não percam!',
    lastMessageAt: '2026-04-27T14:22:00',
    image: avatar('Alunos2024'),
    messagesPerDay: 128,
    activeMembers: 289,
    peakHour: '20h–22h',
  },
  {
    id: 'g2',
    name: 'Comunidade VIP',
    memberCount: 89,
    status: 'ativo',
    lastMessage: 'Obrigado pelo conteúdo exclusivo da semana 🙌',
    lastMessageAt: '2026-04-27T13:05:00',
    image: avatar('VIP'),
    messagesPerDay: 64,
    activeMembers: 72,
    peakHour: '19h–21h',
  },
  {
    id: 'g3',
    name: 'Suporte Clientes',
    memberCount: 156,
    status: 'ativo',
    lastMessage: 'Ticket #8842 resolvido. Precisa de mais algo?',
    lastMessageAt: '2026-04-27T12:40:00',
    image: avatar('Suporte'),
    messagesPerDay: 210,
    activeMembers: 134,
    peakHour: '9h–12h',
  },
  {
    id: 'g4',
    name: 'Lançamento Produto X',
    memberCount: 512,
    status: 'inativo',
    lastMessage: 'Campanha encerrada. Obrigado a todos!',
    lastMessageAt: '2026-04-20T18:00:00',
    image: avatar('Lancamento'),
    messagesPerDay: 12,
    activeMembers: 98,
    peakHour: '18h–20h',
  },
  {
    id: 'g5',
    name: 'Time Interno RH',
    memberCount: 24,
    status: 'ativo',
    lastMessage: 'Reunião quinta às 15h na sala virtual.',
    lastMessageAt: '2026-04-26T16:10:00',
    image: avatar('RH'),
    messagesPerDay: 45,
    activeMembers: 22,
    peakHour: '14h–17h',
  },
]

export const mockGroupMembersByGroup = {
  g1: [
    { id: 'm1', name: 'João Silva', phone: '+55 (11) 98765-4321', role: 'admin', status: 'ativo', tags: ['aluno', 'premium'], lastActivity: '2026-04-27T14:00:00' },
    { id: 'm2', name: 'Maria Santos', phone: '+55 (21) 99123-8899', role: 'membro', status: 'ativo', tags: ['aluno'], lastActivity: '2026-04-27T13:30:00' },
    { id: 'm3', name: 'Pedro Oliveira', phone: '+55 (11) 97777-1122', role: 'membro', status: 'inativo', tags: [], lastActivity: '2026-04-10T09:00:00' },
    { id: 'm4', name: 'Ana Costa', phone: '+55 (47) 98888-3344', role: 'membro', status: 'ativo', tags: ['moderador'], lastActivity: '2026-04-27T11:00:00' },
  ],
  g2: [
    { id: 'm5', name: 'Fernanda Lima', phone: '+55 (11) 96543-2211', role: 'admin', status: 'ativo', tags: ['vip'], lastActivity: '2026-04-27T14:15:00' },
    { id: 'm6', name: 'Ricardo Souza', phone: '+55 (31) 93456-7890', role: 'membro', status: 'ativo', tags: ['vip'], lastActivity: '2026-04-27T12:00:00' },
  ],
}

export const mockMembersGlobal = [
  { id: 'm1', name: 'João Silva', phone: '+55 (11) 98765-4321', groups: ['Alunos Turma 2024'], tags: ['aluno', 'premium'], status: 'ativo', lastActivity: '2026-04-27T14:00:00', avatar: avatar('João Silva') },
  { id: 'm2', name: 'Maria Santos', phone: '+55 (21) 99123-8899', groups: ['Alunos Turma 2024'], tags: ['aluno'], status: 'ativo', lastActivity: '2026-04-27T13:30:00', avatar: avatar('Maria Santos') },
  { id: 'm3', name: 'Pedro Oliveira', phone: '+55 (11) 97777-1122', groups: ['Alunos Turma 2024'], tags: [], status: 'inativo', lastActivity: '2026-04-10T09:00:00', avatar: avatar('Pedro Oliveira') },
  { id: 'm4', name: 'Ana Costa', phone: '+55 (47) 98888-3344', groups: ['Alunos Turma 2024'], tags: ['moderador'], status: 'ativo', lastActivity: '2026-04-27T11:00:00', avatar: avatar('Ana Costa') },
  { id: 'm5', name: 'Fernanda Lima', phone: '+55 (11) 96543-2211', groups: ['Comunidade VIP'], tags: ['vip'], status: 'ativo', lastActivity: '2026-04-27T14:15:00', avatar: avatar('Fernanda Lima') },
  { id: 'm6', name: 'Ricardo Souza', phone: '+55 (31) 93456-7890', groups: ['Comunidade VIP'], tags: ['vip'], status: 'ativo', lastActivity: '2026-04-27T12:00:00', avatar: avatar('Ricardo Souza') },
  { id: 'm7', name: 'Lucas Almeida', phone: '+55 (11) 91234-5678', groups: ['Suporte Clientes', 'Alunos Turma 2024'], tags: ['cliente'], status: 'ativo', lastActivity: '2026-04-27T10:00:00', avatar: avatar('Lucas Almeida') },
  { id: 'm8', name: 'Camila Rocha', phone: '+55 (61) 99876-1234', groups: ['Suporte Clientes'], tags: ['suporte'], status: 'ativo', lastActivity: '2026-04-26T18:00:00', avatar: avatar('Camila Rocha') },
  { id: 'm9', name: 'Bruno Ferreira', phone: '+55 (85) 98765-0000', groups: ['Lançamento Produto X'], tags: ['lead'], status: 'inativo', lastActivity: '2026-04-05T08:00:00', avatar: avatar('Bruno Ferreira') },
  { id: 'm10', name: 'Patricia Gomes', phone: '+55 (11) 97700-8899', groups: ['Time Interno RH'], tags: ['interno'], status: 'ativo', lastActivity: '2026-04-27T09:30:00', avatar: avatar('Patricia Gomes') },
]

export const mockDashboardMetrics = {
  totalGroups: 12,
  totalMembers: 2847,
  messagesToday: 1842,
  engagementRate: 34.2,
  messagesLast7Days: [
    { day: 'Seg', count: 1200 },
    { day: 'Ter', count: 1450 },
    { day: 'Qua', count: 1320 },
    { day: 'Qui', count: 1680 },
    { day: 'Sex', count: 2100 },
    { day: 'Sáb', count: 890 },
    { day: 'Dom', count: 720 },
  ],
  topGroups: mockGroups.slice(0, 4).map((g) => ({
    id: g.id,
    name: g.name,
    messages24h: Math.round(g.messagesPerDay * 0.4 + Math.random() * 50),
  })),
  recentActivities: [
    { id: 'a1', text: 'Mensagem agendada enviada para Comunidade VIP', time: 'Há 12 min' },
    { id: 'a2', text: 'Novo membro em Alunos Turma 2024: Pedro Henrique', time: 'Há 35 min' },
    { id: 'a3', text: 'Automação “Boas-vindas” ativada em Suporte Clientes', time: 'Há 1 h' },
    { id: 'a4', text: 'Relatório semanal exportado (Analytics)', time: 'Há 2 h' },
  ],
}

export const mockAutomations = [
  { id: 'auto1', name: 'Boas-vindas novos membros', type: 'boas-vindas', status: 'ativa', groupIds: ['g1', 'g2'], messagePreview: 'Olá! Seja bem-vindo(a) à nossa comunidade...' },
  { id: 'auto2', name: 'Lembrete aula ao vivo', type: 'agendada', status: 'ativa', groupIds: ['g1'], messagePreview: 'Em 30 minutos começamos a live!' },
  { id: 'auto3', name: 'Resposta palavra-chave OFERTA', type: 'gatilho', status: 'inativa', groupIds: ['g3'], messagePreview: 'Segue o link da promoção exclusiva...' },
]

export const mockScheduledMessages = [
  { id: 'sch1', groupNames: ['Comunidade VIP'], body: 'Amanhã soltamos o módulo bônus às 10h.', scheduledAt: '2026-04-28T10:00:00', status: 'pendente' },
  { id: 'sch2', groupNames: ['Alunos Turma 2024'], body: 'Lista de materiais atualizada no drive.', scheduledAt: '2026-04-29T08:00:00', status: 'pendente' },
]

export const mockMessageHistory = [
  { id: 'h1', group: 'Suporte Clientes', body: 'Olá! Seu chamado foi atualizado.', sentAt: '2026-04-27T09:00:00', status: 'entregue' },
  { id: 'h2', group: 'Alunos Turma 2024', body: 'Gravação da aula já está disponível.', sentAt: '2026-04-26T21:30:00', status: 'entregue' },
  { id: 'h3', group: 'Comunidade VIP', body: 'Conteúdo secreto da semana 🔐', sentAt: '2026-04-26T18:00:00', status: 'parcial' },
]

export const mockAnalytics = {
  period: '7d',
  totalMessages: 12480,
  responseRate: 28.4,
  activeMembers: 1920,
  inactiveMembers: 927,
  memberGrowthPct: 4.2,
  messagesByDay: mockDashboardMetrics.messagesLast7Days.map((d, i) => ({ ...d, full: `2026-04-${21 + i}` })),
  messagesByHour: Array.from({ length: 24 }, (_, h) => ({ hour: `${h}h`, count: h >= 9 && h <= 22 ? Math.round(80 + Math.random() * 120) : Math.round(Math.random() * 30) })),
  engagementByGroup: [
    { name: 'Alunos Turma 2024', value: 420 },
    { name: 'Comunidade VIP', value: 280 },
    { name: 'Suporte Clientes', value: 310 },
    { name: 'Lançamento Produto X', value: 90 },
  ],
  topMembers: [
    { name: 'João Silva', msgs: 156 },
    { name: 'Maria Santos', msgs: 142 },
    { name: 'Ana Costa', msgs: 128 },
    { name: 'Lucas Almeida', msgs: 115 },
    { name: 'Fernanda Lima', msgs: 98 },
    { name: 'Ricardo Souza', msgs: 87 },
    { name: 'Camila Rocha', msgs: 76 },
    { name: 'Patricia Gomes', msgs: 65 },
    { name: 'Pedro Oliveira', msgs: 54 },
    { name: 'Bruno Ferreira', msgs: 42 },
  ],
  groupComparison: mockGroups.map((g) => ({
    id: g.id,
    name: g.name,
    messages: g.messagesPerDay * 7,
    members: g.memberCount,
    engagement: (g.activeMembers / g.memberCount) * 100,
  })),
}

export const mockIntegrations = [
  { id: 'hotmart', name: 'Hotmart', description: 'Sincronize compras e libere acesso automático aos grupos.', connected: true },
  { id: 'kiwify', name: 'Kiwify', description: 'Webhooks de vendas e recuperação de carrinho.', connected: false },
  { id: 'eduzz', name: 'Eduzz', description: 'Integração com produtos digitais.', connected: false },
  { id: 'sheets', name: 'Google Sheets', description: 'Exporte leads e métricas para planilhas.', connected: true },
  { id: 'zapier', name: 'Zapier', description: 'Conecte milhares de apps sem código.', connected: false },
  { id: 'api', name: 'API Própria', description: 'REST API para fluxos customizados.', connected: false },
]

export const mockWhatsAppStatus = { connected: true, lastSync: '2026-04-27T14:30:00' }

export const mockGroupSettings = {
  welcomeEnabled: true,
  welcomeMessage: 'Bem-vindo(a)! Leia as regras fixadas e apresente-se no tópico #apresentações.',
  autoModEnabled: true,
  bannedWords: 'spam golpe pix clonado',
  messageLimitPerUser: 15,
  allowMedia: true,
}

export const mockTestimonials = [
  { name: 'Renata Vieira', role: 'Infoprodutora, SP', text: 'Triplicamos conversões com réguas automáticas nos grupos. O painel é claríssimo.', seed: 'Renata' },
  { name: 'Marcos Duarte', role: 'Agência de tráfego, BH', text: 'Finalmente uma ferramenta que aguenta volume e não derruba o WhatsApp Business.', seed: 'Marcos' },
  { name: 'Juliana Prado', role: 'Community manager', text: 'Moderação e analytics no mesmo lugar. Economizamos horas toda semana.', seed: 'Juliana' },
  { name: 'Felipe Nogueira', role: 'SaaS B2B', text: 'Integração Hotmart + grupos VIP funcionou em menos de um dia.', seed: 'Felipe' },
]

export const mockFaq = [
  { q: 'Preciso ter WhatsApp Business API?', a: 'Não obrigatoriamente. Você pode conectar via sessão segura (QR Code) para grupos e comunidades, conforme as políticas da Meta aplicáveis ao seu caso.' },
  { q: 'Os dados ficam seguros?', a: 'Sim. Utilizamos criptografia em trânsito, logs auditáveis e opções de permissão por equipe.' },
  { q: 'Consigo agendar mensagens para vários grupos?', a: 'Sim. Selecione múltiplos grupos, personalize o texto e defina data e hora com fuso horário de Brasília.' },
  { q: 'Há limite de membros?', a: 'Os limites dependem do plano. O Enterprise oferece capacidade ampliada e suporte dedicado.' },
  { q: 'Funciona com Hotmart e Kiwify?', a: 'Sim, temos integrações nativas e webhooks para automatizar entradas e saídas de membros.' },
  { q: 'Posso cancelar quando quiser?', a: 'Planos mensais podem ser cancelados antes da renovação. Sem multa nos planos padrão.' },
  { q: 'Oferecem suporte em português?', a: 'Suporte em PT-BR em horário comercial; planos superiores incluem canal prioritário.' },
  { q: 'Há período de teste?', a: 'Sim, oferecemos trial para você validar automações e métricas com seus próprios grupos.' },
]

export const mockPlans = [
  { name: 'Básico', price: 'R$ 97', period: '/mês', desc: 'Para quem está começando', features: ['Até 3 grupos', '1.000 membros', 'Automações básicas', 'Suporte por e-mail'], highlighted: false },
  { name: 'Pro', price: 'R$ 297', period: '/mês', desc: 'Mais vendas com escala', features: ['Até 15 grupos', '10.000 membros', 'IA e analytics', 'Integrações', 'Suporte prioritário'], highlighted: true },
  { name: 'Enterprise', price: 'Sob consulta', period: '', desc: 'Grandes operações', features: ['Grupos ilimitados', 'Membros ilimitados', 'API dedicada', 'SLA', 'Customer success'], highlighted: false },
]

export const featureCards = [
  { title: 'Automação de Mensagens', desc: 'Dispare, agende e crie gatilhos inteligentes sem planilhas.', icon: 'Zap' },
  { title: 'Gestão Centralizada', desc: 'Todos os grupos em um só painel, com papéis e permissões.', icon: 'LayoutGrid' },
  { title: 'Moderação e Segurança', desc: 'Listas de palavras, limites e trilhas de auditoria.', icon: 'Shield' },
  { title: 'Inteligência Artificial', desc: 'Sugestões de resposta e resumos de conversas (quando ativado).', icon: 'Sparkles' },
  { title: 'Analytics e Relatórios', desc: 'Picos de engajamento, funil e comparativo entre grupos.', icon: 'BarChart3' },
  { title: 'Gestão de Membros', desc: 'Tags, inatividade e ações em massa com segurança.', icon: 'Users' },
  { title: 'Integrações', desc: 'Hotmart, Kiwify, Zapier, Sheets e API própria.', icon: 'Plug' },
  { title: 'Réguas de Relacionamento', desc: 'Sequências que acompanham o ciclo do lead até a venda.', icon: 'GitBranch' },
]
