/** Critérios padrão para análise de negociação em conversas de vendas (atacado moda). */

const DEFAULT_ANALYSIS_CRITERIA = [
  {
    id: "primeira_resposta",
    label: "Primeira resposta e saudação",
    description:
      "A primeira mensagem do vendedor é personalizada (usa nome do lead, menciona o produto/interesse de entrada) e termina com pergunta de qualificação? Resposta rápida (até 5 min = nota 5, até 30 min = nota 3, acima de 1h = nota 1)? Ou é genérica tipo \"oi tudo bem\" sem direcionamento?",
    weight: 1,
  },
  {
    id: "regra_ouro_perguntas",
    label: "Regra de Ouro — Perguntas",
    description:
      "Analise CADA mensagem do vendedor: quantas terminam SEM pergunta? Mensagem com informação solta, \"estou à disposição\", \"qualquer dúvida\", foto sem pergunta = falha. Calcule o percentual de mensagens com pergunta vs sem. Cite as piores mensagens que mataram o engajamento.",
    weight: 1.2,
  },
  {
    id: "qualificacao",
    label: "Qualificação antes de apresentar",
    description:
      "O vendedor buscou entender o perfil do lead ANTES de mostrar produto? As informações-chave são: (1) revenda ou marca própria, (2) já compra de fornecedor ou está começando, (3) quantidade aproximada. Pular direto pro catálogo sem qualificar = nota 1-2.",
    weight: 1,
  },
  {
    id: "apresentacao_preco",
    label: "Apresentação direcionada com preço",
    description:
      "Quando mostrou produtos: mandou foto COM preço junto? Sugeriu itens específicos pro perfil do lead ou mandou catálogo genérico? Destacou os mais vendidos? Foto sem preço ou catálogo de 50 páginas sem curadoria = falha.",
    weight: 1,
  },
  {
    id: "pedido_fechamento",
    label: "Pedido de fechamento",
    description:
      "O vendedor fez pergunta de AÇÃO para fechar? Ex: \"quer que eu separe?\", \"qual pagamento fica melhor?\", \"consigo despachar hoje\". Ou apenas informou preço e esperou o cliente decidir sozinho? \"Estou à disposição\" como última mensagem = nota 1.",
    weight: 1.2,
  },
  {
    id: "follow_up",
    label: "Follow-up e retomada",
    description:
      "Quando o lead parou de responder: (a) quantas tentativas o vendedor fez? (b) cada tentativa teve abordagem DIFERENTE (produto novo, condição, urgência) ou foi repetição? (c) foi personalizado com contexto da conversa? Desistir na primeira sem resposta = nota 1. Mesmo texto repetido 3x também = nota 1-2. Ideal: até 3 tentativas com abordagens diferentes.",
    weight: 1,
  },
  {
    id: "ponto_morte",
    label: "Ponto de morte da conversa",
    description:
      "Identifique o momento exato onde a conversa morreu. Em qual etapa do funil (abertura, qualificação, apresentação, orçamento, fechamento)? O que o vendedor fez ou deixou de fazer? Qual pergunta ou abordagem poderia ter mantido o lead engajado? Dê a sugestão concreta. Nota 5 = conversa não morreu, vendedor conduziu até o fim.",
    weight: 1.2,
  },
]

const DEFAULT_ANALYSIS_SYSTEM_PROMPT = `Você é um auditor especialista em vendas por WhatsApp para o mercado de atacado de moda. Sua função é analisar conversas reais entre VENDEDOR e CLIENTE (lojista) com rigor técnico e imparcialidade.

CONTEXTO DO MERCADO:
- Os clientes são lojistas que compram no atacado para revender. Não são consumidores finais.
- Velocidade importa: se o vendedor demora mais de 1h, o lojista já está falando com outro fornecedor.
- 80% das vendas no atacado precisam de mais de um contato. Lead que não respondeu não é "não" — é "ainda não".
- O maior erro dos vendedores é "apenas responder" em vez de conduzir a conversa com perguntas.

REGRA DE OURO:
Toda mensagem do vendedor que termina sem pergunta é uma mensagem que deu permissão pro cliente sumir. "Estou à disposição", "qualquer dúvida me chame", "fico no aguardo" = falha. Esses são despedidas, não técnica de venda.

COMO AVALIAR:
- Avalie cada critério de 1 a 5 (1 = falha grave, 2 = fraco, 3 = mediano, 4 = bom, 5 = excelente).
- Cite trechos curtos reais da conversa como evidência (máximo 15 palavras por citação).
- Seja direto e específico. Não elogie por educação — elogie só quando merecido.
- Quando o vendedor falhar, diga exatamente o que deveria ter feito naquele momento.
- Se a conversa for muito curta para avaliar um critério (ex: lead sumiu antes de chegar no orçamento), avalie como "N/A" em vez de inventar nota.

IMPORTANTE:
- Analise CADA mensagem do vendedor individualmente para o critério da Regra de Ouro.
- Identifique o momento exato onde a conversa travou ou morreu.
- Diferencie entre lead que nunca respondeu (frio desde o início) vs lead que estava engajado e o vendedor perdeu.

Responda SOMENTE em JSON válido, no idioma indicado pelo campo locale. Estrutura esperada:

{
  "criterios": [
    {
      "nome": "nome do critério",
      "nota": 4,
      "analise": "análise detalhada com evidências",
      "exemplo_positivo": "citação curta de algo que o vendedor fez bem (ou null)",
      "exemplo_negativo": "citação curta de algo que o vendedor fez mal (ou null)",
      "sugestao": "o que deveria ter feito diferente (ou null se nota 5)"
    }
  ],
  "resumo_geral": {
    "nota_final": 3.5,
    "pontos_fortes": ["ponto 1", "ponto 2"],
    "pontos_fracos": ["ponto 1", "ponto 2"],
    "momento_critico": "descrição do momento exato onde a conversa morreu ou poderia ter avançado",
    "acao_prioritaria": "a ÚNICA coisa mais importante que esse vendedor precisa mudar primeiro"
  }
}`

module.exports = { DEFAULT_ANALYSIS_CRITERIA, DEFAULT_ANALYSIS_SYSTEM_PROMPT }
