# Canário Evo1 — patch `shouldSyncHistoryMessage` (syncType !== 2)

## Baseline atual (rollback)

| Campo | Valor |
|-------|-------|
| Serviço produção | `evolution-api` (`77d831c6-52b3-48cb-95b8-82db22efec77`) |
| Deploy ID | `0737e20c-b727-4cf7-9729-b6ae950f5fc6` |
| Repo | `Leonardotrentini/evolution-api` |
| Branch | `main` |
| Commit | `fa09d37892cdbb1d65a250155d293d92230c5b30` |
| Evolution | `2.3.7` |
| Baileys | `7.0.0-rc.9` |
| Image digest | `sha256:9a9b4de2665d995c2f4b22ff20e08740ba0b4c97e541d149700fa6e96fbd97db` |

### Rollback Evo1 produção (se alguém deployar o patch nela por engano)

```bash
# Redeploy do commit conhecido-bom (NÃO logout / NÃO delete instâncias)
railway redeploy \
  --project 711341c4-2da7-47b7-a60e-22abe6eabfd4 \
  --environment production \
  --service evolution-api \
  --deployment 0737e20c-b727-4cf7-9729-b6ae950f5fc6
```

Ou:

```bash
cd evolution-api-src
git checkout fa09d37892cdbb1d65a250155d293d92230c5b30
# apontar o serviço evolution-api de volta para main@fa09d37 e redeploy
```

## Patch

Em `makeWASocket`:

```ts
shouldSyncHistoryMessage: (msg) => {
  this.historySyncNotification(msg) // side-effects Chatwoot
  return Number(msg?.syncType) !== 2 // bloqueia FULL, libera bootstrap/recent/on_demand
}
```

`SYNC_FULL_HISTORY` permanece `false`.

### Trade-off Baileys rc.9 → rc13

- **rc13** corrige regressões de `messaging-history.set` / mensagens pending reportadas em Evolution 2.3.7.
- Commit upstream que remove o override buggy: `c81c074` (já coberto pelo callback explícito).
- **Nesta rodada NÃO trocamos a versão do Baileys** — só o callback. Avaliar rc13 depois do canário OK.

## Passo a passo — conectar 1 conta de teste no canário

1. Garantir serviço `evolution-api-canary` no ar (branch `canary/sync-history-patch`) com envs de persistência iguais à Evo2 (ver `evo1-persistence-canary-env.md`).
2. No CRM, criar/usar **conta de teste** (não cliente).
3. Apontar `evolutionHost` dessa conta para o host canário (via Admin hosts dinâmicos / env `EVOLUTION_CANARY_*` se provisionado) **OU** criar instância direto na API canário e registrar no CRM.
4. Conectar via QR **somente nessa conta de teste**.
5. Validar 72h:
   - `GET /api/admin/canary-sync-health?instanceName=...`
   - Critérios: sem `empty_store_zombie`, `findChats > 0`, mensagens após ociosidade.

## Critério de promoção

Só promover o patch para Evo1 produção depois de canário OK + aprovação explícita.
**Nunca** deployar o patch em `evolution-api` sem canário aprovado.
