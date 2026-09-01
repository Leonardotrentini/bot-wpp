/** Critérios padrão para análise de negociação em conversas de vendas. */

const DEFAULT_ANALYSIS_CRITERIA = [
  {
    id: "rapport",
    label: "Rapport e empatia",
    description: "O vendedor demonstra escuta ativa, personalização e conexão emocional com o lead?",
    weight: 1,
  },
  {
    id: "discovery",
    label: "Diagnóstico / descoberta",
    description: "Fez perguntas para entender necessidade, contexto e objeções antes de empurrar oferta?",
    weight: 1,
  },
  {
    id: "clarity",
    label: "Clareza na comunicação",
    description: "Mensagens objetivas, sem confusão, com próximo passo claro quando aplicável?",
    weight: 1,
  },
  {
    id: "objections",
    label: "Tratamento de objeções",
    description: "Respondeu dúvidas e resistências de forma adequada, sem ignorar ou ser agressivo?",
    weight: 1.2,
  },
  {
    id: "closing",
    label: "Condução ao fechamento",
    description: "Conduziu a conversa em direção à conversão (link, pagamento, agendamento) no momento certo?",
    weight: 1.2,
  },
  {
    id: "followup",
    label: "Follow-up e persistência",
    description: "Retomou o lead quando necessário, sem abandono prematuro nem spam excessivo?",
    weight: 0.8,
  },
]

const DEFAULT_ANALYSIS_SYSTEM_PROMPT = `Você é um auditor sênior de vendas por WhatsApp.
Analise a conversa completa entre VENDEDOR e CLIENTE com rigor e imparcialidade.
Avalie cada critério de 1 a 5 (1 = falha grave, 3 = mediano, 5 = excelente).
Identifique falhas concretas com citação curta da conversa quando possível.
Responda SOMENTE em JSON válido, no idioma indicado pelo campo locale.`

module.exports = { DEFAULT_ANALYSIS_CRITERIA, DEFAULT_ANALYSIS_SYSTEM_PROMPT }
