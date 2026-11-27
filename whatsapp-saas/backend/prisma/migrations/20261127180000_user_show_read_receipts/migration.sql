-- Preferência do CRM: exibir ✓ / ✓✓ (status de visualização) nas mensagens enviadas.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "showReadReceipts" BOOLEAN NOT NULL DEFAULT true;
