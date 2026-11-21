-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppZombieEvent" (
    "id" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "userId" TEXT,
    "host" TEXT NOT NULL DEFAULT 'primary',
    "eventType" TEXT NOT NULL,
    "proofReason" TEXT,
    "outcome" TEXT,
    "softRestartsTried" INTEGER NOT NULL DEFAULT 0,
    "messagesRecovered" INTEGER,
    "disconnectCode" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppZombieEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppZombieEvent_instanceName_createdAt_idx" ON "WhatsAppZombieEvent"("instanceName", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppZombieEvent_host_createdAt_idx" ON "WhatsAppZombieEvent"("host", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppZombieEvent_eventType_createdAt_idx" ON "WhatsAppZombieEvent"("eventType", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppZombieEvent_userId_createdAt_idx" ON "WhatsAppZombieEvent"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppZombieEvent_disconnectCode_createdAt_idx" ON "WhatsAppZombieEvent"("disconnectCode", "createdAt");
