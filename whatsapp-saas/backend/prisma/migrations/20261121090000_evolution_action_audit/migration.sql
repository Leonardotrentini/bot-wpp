-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppEvolutionActionAudit" (
    "id" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT 'primary',
    "action" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "reason" TEXT,
    "result" TEXT,
    "error" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppEvolutionActionAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhatsAppEvolutionActionAudit_instanceName_createdAt_idx"
  ON "WhatsAppEvolutionActionAudit"("instanceName", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppEvolutionActionAudit_action_createdAt_idx"
  ON "WhatsAppEvolutionActionAudit"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppEvolutionActionAudit_allowed_createdAt_idx"
  ON "WhatsAppEvolutionActionAudit"("allowed", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppEvolutionActionAudit_source_createdAt_idx"
  ON "WhatsAppEvolutionActionAudit"("source", "createdAt");
