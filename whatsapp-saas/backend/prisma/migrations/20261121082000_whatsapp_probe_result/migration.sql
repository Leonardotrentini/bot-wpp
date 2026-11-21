-- AlterTable
ALTER TABLE "WhatsAppConnection" ADD COLUMN IF NOT EXISTS "lastFromMeAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppConnection" ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppProbeResult" (
    "id" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT 'primary',
    "probedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "probeOk" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "error" TEXT,
    "connectionState" TEXT,
    "lastFromMeAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "zombieSuspect" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,

    CONSTRAINT "WhatsAppProbeResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhatsAppProbeResult_instanceName_probedAt_idx" ON "WhatsAppProbeResult"("instanceName", "probedAt");
CREATE INDEX IF NOT EXISTS "WhatsAppProbeResult_host_probedAt_idx" ON "WhatsAppProbeResult"("host", "probedAt");
CREATE INDEX IF NOT EXISTS "WhatsAppProbeResult_probeOk_probedAt_idx" ON "WhatsAppProbeResult"("probeOk", "probedAt");
CREATE INDEX IF NOT EXISTS "WhatsAppProbeResult_zombieSuspect_probedAt_idx" ON "WhatsAppProbeResult"("zombieSuspect", "probedAt");
