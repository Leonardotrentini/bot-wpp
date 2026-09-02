/**
 * Tools (function calling) permitidas para o agente de IA.
 */

const { logContactActivity } = require("./crmContactActivity")

const TOOL_DEFS = {
  add_tag: {
    type: "function",
    function: {
      name: "add_tag",
      description: "Adiciona uma tag ao contato da conversa.",
      parameters: {
        type: "object",
        properties: {
          tagId: { type: "string", description: "ID da tag a adicionar." },
        },
        required: ["tagId"],
      },
    },
  },
  remove_tag: {
    type: "function",
    function: {
      name: "remove_tag",
      description: "Remove uma tag do contato da conversa.",
      parameters: {
        type: "object",
        properties: {
          tagId: { type: "string", description: "ID da tag a remover." },
        },
        required: ["tagId"],
      },
    },
  },
  move_stage: {
    type: "function",
    function: {
      name: "move_stage",
      description: "Move a conversa para outra etapa do kanban.",
      parameters: {
        type: "object",
        properties: {
          stageId: { type: "string", description: "ID da etapa destino." },
        },
        required: ["stageId"],
      },
    },
  },
  handoff: {
    type: "function",
    function: {
      name: "handoff",
      description: "Transfere a conversa para um atendente humano.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Motivo breve da transferência." },
        },
      },
    },
  },
}

function buildOpenAiTools(agent) {
  const allowed = Array.isArray(agent.allowedTools) ? agent.allowedTools : []
  return allowed.map((name) => TOOL_DEFS[name]).filter(Boolean)
}

function tagAllowed(agent, tagId) {
  const whitelist = Array.isArray(agent.allowedTagIds) ? agent.allowedTagIds : []
  if (!whitelist.length) return true
  return whitelist.includes(String(tagId))
}

async function executeTool(deps, { agent, conversation, toolName, args }) {
  const { prisma } = deps
  const name = String(toolName || "")

  if (name === "add_tag") {
    const tagId = String(args?.tagId || "")
    if (!tagId || !tagAllowed(agent, tagId)) {
      return { ok: false, error: "Tag não permitida." }
    }
    try {
      await prisma.crmContactTag.create({
        data: { contactId: conversation.contactId, tagId },
      })
    } catch (err) {
      if (err?.code !== "P2002") throw err
    }
    await logContactActivity(prisma, {
      contactId: conversation.contactId,
      userId: conversation.userId,
      type: "ai_tool",
      payload: { action: "add_tag", tagId },
    })
    return { ok: true, action: "add_tag", tagId }
  }

  if (name === "remove_tag") {
    const tagId = String(args?.tagId || "")
    if (!tagId || !tagAllowed(agent, tagId)) {
      return { ok: false, error: "Tag não permitida." }
    }
    await prisma.crmContactTag.deleteMany({
      where: { contactId: conversation.contactId, tagId },
    })
    await logContactActivity(prisma, {
      contactId: conversation.contactId,
      userId: conversation.userId,
      type: "ai_tool",
      payload: { action: "remove_tag", tagId },
    })
    return { ok: true, action: "remove_tag", tagId }
  }

  if (name === "move_stage") {
    const stageId = String(args?.stageId || "")
    if (!stageId) return { ok: false, error: "Etapa inválida." }
    await prisma.crmConversation.update({
      where: { id: conversation.id },
      data: { kanbanStageId: stageId },
    })
    await logContactActivity(prisma, {
      contactId: conversation.contactId,
      userId: conversation.userId,
      type: "ai_tool",
      payload: { action: "move_stage", stageId },
    })
    return { ok: true, action: "move_stage", stageId }
  }

  if (name === "handoff") {
    const { prisma, io } = deps
    await prisma.crmConversation.update({
      where: { id: conversation.id },
      data: { aiEnabled: false, assignedTo: "human", status: "pending" },
    })
    if (io) {
      io.to(`user:${conversation.userId}`).emit("crm:handoff", {
        conversationId: conversation.id,
        reason: args?.reason || "tool_handoff",
      })
    }
    return { ok: true, action: "handoff", handoff: true }
  }

  return { ok: false, error: "Tool desconhecida." }
}

module.exports = {
  TOOL_DEFS,
  buildOpenAiTools,
  tagAllowed,
  executeTool,
}
