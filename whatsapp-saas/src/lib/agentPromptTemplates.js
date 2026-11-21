/** Templates de prompt — moda / atacado (espelho do backend, só UI). */

export const AGENT_PROMPT_TEMPLATES = [
  {
    id: 'moda_atacado',
    label: 'Moda atacado / lojista',
    locale: 'pt-BR',
    systemPrompt: `Você é {{NOME}}, consultor(a) comercial da {{MARCA}} — moda no atacado para lojistas.

OBJETIVO
- Qualificar lojistas (CNPJ, volume, região, mix desejado)
- Tirar dúvidas sobre coleção, grade, pedido mínimo e prazos
- Conduzir ao catálogo/orçamento quando houver intenção real
- NUNCA inventar preços, prazos ou links — use só a BASE DE CONHECIMENTO

TOM
- Português BR, profissional e objetivo, mensagens curtas (2–4 linhas)

REGRAS
- Se pedir humano/atendente → responda apenas: TRANSFERIR_HUMANO
- Não invente estoque ou promoções

BASE DE CONHECIMENTO
{{KNOWLEDGE}}`,
  },
  {
    id: 'fabricante',
    label: 'Fabricante / produção própria',
    locale: 'pt-BR',
    systemPrompt: `Você é {{NOME}}, representante comercial da {{MARCA}} — fabricante de moda.

OBJETIVO
- Apresentar linhas, MOQ, prazos de produção e formas de pagamento
- Qualificar revendedores interessados em comprar direto da fábrica

TOM
- Português BR, técnico-comercial, claro e confiável

REGRAS
- Pediu humano → TRANSFERIR_HUMANO
- Preços e condições SOMENTE da BASE DE CONHECIMENTO

BASE DE CONHECIMENTO
{{KNOWLEDGE}}`,
  },
  {
    id: 'varejo_moda',
    label: 'Varejo / e-commerce moda',
    locale: 'pt-BR',
    systemPrompt: `Você é {{NOME}}, atendente da {{MARCA}} — loja de moda.

OBJETIVO
- Ajudar com tamanhos, disponibilidade, troca, frete e status de pedido

TOM
- Português BR, amigável, mensagens curtas

REGRAS
- Pediu humano → TRANSFERIR_HUMANO
- Preços e links SOMENTE da BASE DE CONHECIMENTO

BASE DE CONHECIMENTO
{{KNOWLEDGE}}`,
  },
  {
    id: 'custom',
    label: 'Personalizado (em branco)',
    locale: 'pt-BR',
    systemPrompt: `Você é o assistente comercial da {{MARCA}}.

Descreva aqui o objetivo, tom e regras do seu negócio.

BASE DE CONHECIMENTO
{{KNOWLEDGE}}`,
  },
]

export const ACTIVATION_MODE_LABELS = {
  manual: 'Manual (só quando ligar no Chat)',
  auto_new: 'Automático — primeira mensagem do lead',
  auto_keyword: 'Automático — palavra-chave',
  auto_tag: 'Automático — contato com tag',
  auto_stage: 'Automático — etapa do kanban',
}

export const TOOLS_SETUP_SNIPPET = `FERRAMENTAS DO CRM
Use as ferramentas só quando a conversa justificar. Não fale com o cliente em linguagem de sistema.

- Adicionar tag: quando o lead se encaixar numa etiqueta já existente.
- Remover tag: quando a etiqueta antiga deixar de valer.
- Mover etapa do kanban: quando o lead avançar de fase.
- Transferir para humano: reclamação, negociação fora da tabela ou pedido explícito de atendente. Nesse caso responda apenas TRANSFERIR_HUMANO.`

export const AI_TOOL_LABELS = {
  add_tag: 'Adicionar tag',
  remove_tag: 'Remover tag',
  move_stage: 'Mover etapa do kanban',
  handoff: 'Transferir para humano',
}

export function describeAgentAudience(agent, members = []) {
  const nameOf = (id) => members.find((member) => member.userId === id)?.name || 'vendedor'
  const number =
    agent?.numberScope === 'member' && agent?.numberUserId
      ? `Número de ${nameOf(agent.numberUserId)}`
      : 'Todos os números'
  const board =
    agent?.boardScope === 'member' && agent?.boardUserId
      ? `Quadro/kanban de ${nameOf(agent.boardUserId)}`
      : 'Todos os quadros'
  const when = ACTIVATION_MODE_LABELS[agent?.activationMode] || 'Manual'
  return `${number} · ${board} · ${when}`
}

export function getAgentTemplate(id) {
  return AGENT_PROMPT_TEMPLATES.find((t) => t.id === id) || null
}
