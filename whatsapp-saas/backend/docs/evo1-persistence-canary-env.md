# Persistência Evo1 — diff para canário / produção (aguardando aprovação)

## Estado atual (produção)

| Variável | Evo1 (produção) | Evo2 (produção) |
|----------|-----------------|-----------------|
| `DATABASE_SAVE_DATA_CHATS` | `false` | `true` |
| `DATABASE_SAVE_DATA_CONTACTS` | `false` | `true` |
| `DATABASE_SAVE_DATA_NEW_MESSAGE` | `false` | `true` |
| `DATABASE_SAVE_DATA_HISTORIC` | `false` | `true` |
| `DATABASE_SAVE_DATA_LABELS` | `false` | `true` |
| `DATABASE_SAVE_MESSAGE_UPDATE` | `false` | `true` |
| `SYNC_FULL_HISTORY` | `false` | `false` |
| `CONFIG_SESSION_SYNC_FULL_HISTORY` | `false` | `false` |

## Canário (aplicar no serviço `evolution-api-canary`)

```bash
railway variables set \
  --project 711341c4-2da7-47b7-a60e-22abe6eabfd4 \
  --environment production \
  --service evolution-api-canary \
  DATABASE_SAVE_DATA_CHATS=true \
  DATABASE_SAVE_DATA_CONTACTS=true \
  DATABASE_SAVE_DATA_NEW_MESSAGE=true \
  DATABASE_SAVE_DATA_HISTORIC=true \
  DATABASE_SAVE_DATA_LABELS=true \
  DATABASE_SAVE_MESSAGE_UPDATE=true \
  SYNC_FULL_HISTORY=false \
  CONFIG_SESSION_SYNC_FULL_HISTORY=false
```

## Produção Evo1 (NÃO executar sem aprovação)

```bash
railway variables set \
  --project 711341c4-2da7-47b7-a60e-22abe6eabfd4 \
  --environment production \
  --service evolution-api \
  DATABASE_SAVE_DATA_CHATS=true \
  DATABASE_SAVE_DATA_CONTACTS=true \
  DATABASE_SAVE_DATA_NEW_MESSAGE=true \
  DATABASE_SAVE_DATA_HISTORIC=true \
  DATABASE_SAVE_DATA_LABELS=true \
  DATABASE_SAVE_MESSAGE_UPDATE=true
```

## Estimativa de impacto no banco (ordem de grandeza)

Hipóteses conservadoras por instância ativa:

- ~200–800 chats “quentes”/dia com metadados leves (chat row ~0.5–2 KB)
- ~500–3000 mensagens/dia (texto ~1–3 KB; mídia só metadados se base64 off)
- Contatos/labels: crescimento lento (~dezenas–centenas KB/dia)

**Estimativa:** ~5–40 MB/instância/dia com mensagens textuais (sem blob de mídia).
Com ~30 instâncias ativas na Evo1: **~150 MB–1.2 GB/dia**.

Volume atual `Postgres-Py8r` (Evo1 DB): ~6.4 GB / 48.8 GB — há folga, mas ligar em produção
exige monitorar 7 dias e retenção (`DATABASE_SAVE_DATA_HISTORIC` + jobs de limpeza).

## Rollback de env (produção Evo1)

```bash
railway variables set \
  --project 711341c4-2da7-47b7-a60e-22abe6eabfd4 \
  --environment production \
  --service evolution-api \
  DATABASE_SAVE_DATA_CHATS=false \
  DATABASE_SAVE_DATA_CONTACTS=false \
  DATABASE_SAVE_DATA_NEW_MESSAGE=false \
  DATABASE_SAVE_DATA_HISTORIC=false \
  DATABASE_SAVE_DATA_LABELS=false \
  DATABASE_SAVE_MESSAGE_UPDATE=false
```
