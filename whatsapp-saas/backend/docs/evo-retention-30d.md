# Retenção 30 dias na Evolution (quando SAVE_DATA estiver ligado)

O CRM guarda o histórico; a Evolution só precisa de store recente para `findChats` / `findMessages` / recovery.

## Env sugerido (canário / futura Evo1)

```bash
DATABASE_SAVE_DATA_CHATS=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_DATA_HISTORIC=true
DATABASE_SAVE_DATA_LABELS=true
DATABASE_SAVE_MESSAGE_UPDATE=true
# Sem FULL history Baileys
SYNC_FULL_HISTORY=false
CONFIG_SESSION_SYNC_FULL_HISTORY=false
```

Evolution **não** traz TTL nativo confiável de 30d nas envs padrão → usamos job SQL no Postgres da Evo.

## Job (dry-run)

```bash
# DB da Evo1 = Postgres-Py8r (confirmar no Railway)
railway variables -s Postgres-Py8r -e production --json | node scripts/evo-message-retention-cleanup.js --days=30
```

## Job (aplicar)

```bash
railway variables -s Postgres-Py8r -e production --json | node scripts/evo-message-retention-cleanup.js --days=30 --apply
```

Agendar (cron Railway / script diário) quando a persistência estiver ON.

## Notas

- Apaga só `Message` / `MessageUpdate` antigas — **não** apaga Instance / auth / sessões.
- Rodar em batches (`--limit`) se o volume for alto.
- Canário: apontar o script para o Postgres do canário quando existir.
