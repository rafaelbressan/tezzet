# SPEC-0002 — Camada de cadeia da Suíte Tezos

| | |
|---|---|
| **Status** | **Normativa — implementada.** Pacote `@tezos-suite/chain`, 75 testes de unidade e 8 de contrato passando em 2026-08-30. |
| **Data** | 2026-08-30 |
| **Dono** | Tezos Chain & Payouts |
| **Issue** | BRES-42 |
| **Base factual** | [`../tezos-network-facts.md`](../tezos-network-facts.md) (BRES-38). Onde esta SPEC e aquele documento divergirem, **o documento manda** — ele é reproduzível. |
| **Vale para** | Tezzet e TAPS. A ADR-0001 §6 fixa que o TypeScript é dono desta camada nos dois desfechos, então ela é **uma só**. |

---

## 1. O que esta camada é

Tudo que depende de **como a rede Tezos se comporta hoje**: constantes de
protocolo, leitura da TzKT, modelo econômico de Adaptive Issuance, validação
de endereço, montagem e validação de lote, e confirmação de operação.

Ela **não** guarda chave, não assina e não decide política de produto. Chave é
a SPEC-0001 (`tz-keys` + `tz-vault`), atrás da interface `Signer` do Taquito.

## 2. O erro estrutural que ela existe para não repetir

Os dois sistemas herdados **escreveram no código valores que pertencem à
cadeia** — `BLOCKS_PER_CYCLE = 4096`, `CYCLES_UNTIL_DELIVERED = 5`,
`DEFAULT_GAS_LIMIT = 15400`. Todos são de antes de 2020 e todos mudaram.

A prova de que a regra não é estética: `blocks_per_cycle` é **14400 em mainnet
e Shadownet e 3600 em Bakingnet**, com o mesmo protocolo e a mesma versão do
Octez. Um valor escrito na fonte erra por **4×** no próprio testnet do TAPS, e
erra em silêncio, porque nada na resposta o contradiz.

## 3. Requisitos normativos

Cada linha traz o teste que a prova. Um requisito sem teste que possa reprovar
não é requisito.

| # | Requisito | Como se prova |
|---|---|---|
| **N1** | Constante de protocolo se lê de `/chains/main/blocks/head/context/constants` em execução. Zero constantes de protocolo no código. | `scripts/check-no-protocol-constants.mjs` no CI, e um teste que o reprova contra `BLOCKS_PER_CYCLE = 4096` |
| **N2** | O cache de constantes tem chave **`(chain_id, protocol_hash)`** e TTL de um ciclo, derivado das próprias constantes. | teste que troca o hash de protocolo no mesmo instante e exige releitura |
| **N3** | Campo esperado ausente em API externa **levanta erro com o nome do campo**. Nenhum `\|\| 0`, nenhum default. | teste que remove um campo e exige a mensagem com o nome |
| **N4** | Só campos `attestation*`. Os `endorsement*` estão marcados `DEPRECATED` no OpenAPI da TzKT. | teste que verifica que nenhum campo lido começa por `endorsement` |
| **N5** | Paginação iterada até a lista fechar. Página padrão 100, máximo 10 000. | teste com **60 258** delegadores exigindo 7 páginas |
| **N6** | `Σ delegators[].delegatedBalance == externalDelegatedBalance` **aborta** quando falha. | teste com lista truncada que reprova |
| **N7** | `bakingPower == staked + delegated / edge_of_staking_over_delegation`, com o edge lido da cadeia. | conferido contra dado real de dois bakers |
| **N8** | O único pool distribuído é `Σ(*Delegated)`. `*StakedShared` já foi creditado pelo protocolo; `*StakedOwn` e `*StakedEdge` são do baker. | teste que confere `Σ(*StakedShared) == Σ(actualStakers[].rewards)` e que nenhum dos três entra no pagável |
| **N9** | O edge do baker se **lê** (`edge_of_baking_over_staking_billionth`, dividir por 1e9), nunca se recalcula. | teste de leitura em billionth; a reconstrução foi medida 706 mutez errada |
| **N10** | Valor monetário é `bigint` em mutez de ponta a ponta. XTZ só na borda de exibição, como string. | teste que `tezToMutez('0.00397')` dá 3970 enquanto `Math.floor(0.00397*1e6)` dá 3969 |
| **N11** | Taxa do baker é racional inteiro (`num/den`), nunca float. Rateio com floor; a sobra fica com o baker. | invariante `parte_own + taxa + Σ valor + sobra == pool` conferido contra o exemplo do §3.5 |
| **N12** | Validação de endereço é `validateAddress` do `@taquito/utils` — com checksum. `tz1`, `tz2`, `tz3`, **`tz4`** e `KT1` aceitos; `tz5` recusado com "ainda não suportado". | teste com endereço de um dígito trocado que todo regex aceita |
| **N13** | 429 tratado antes de parsear: o corpo vem em **HTML** do nginx e **não há `Retry-After`**. Backoff exponencial com jitter, concorrência 1–4. | teste com o corpo HTML real do nginx |
| **N14** | 204 com corpo vazio é "desconhecida", não erro nem "não paga". | teste de confirmação com 204 |
| **N15** | Frescor conferido por `tzkt-level` / `tzkt-synced-at`: indexador atrasado devolve 200 com dado velho. | teste com indexador 151 blocos atrás |
| **N16** | Uma chamada `estimate.batch()`; usar o `gasLimit`/`storageLimit`/`fee` retornados. `storage_limit` nunca fixo em 0. | teste de plano com burn de alocação derivado de `origination_size × cost_per_byte` |
| **N17** | O lote é dimensionado pelo **gas estimado acumulado** contra `hard_gas_limit_per_block`, nunca por contagem fixa de operações. | teste que três operações no teto por operação não cabem num bloco |
| **N18** | Saldo do baker conferido contra `Σ valores + Σ taxas + Σ burns` antes de assinar. | teste que reprova com um mutez a menos |
| **N19** | Confirmação pelo critério de Tenderbake: incluída em `L`, `head >= L+2`, **e releitura** confirmando bloco e status. | teste em que a releitura acha outro bloco e a operação **não** é dada por confirmada |
| **N20** | Só é seguro reenviar depois de `branch_level + max_operations_time_to_live`. Antes disso, ausência não prova nada. | teste que o reenvio em `pending` levanta |
| **N21** | O valor mínimo de pagamento é a **taxa estimada da própria transferência** (+ burn se o destino estiver `emptied`), nunca uma constante. O que fica abaixo acumula para o ciclo seguinte e é dívida com o delegador. | teste de corte e acúmulo, conferido contra o §3.6 |
| **N22** | Atribuição "Powered by TzKT API" com link é **exigência de licença** do free tier. | exportada como `TZKT_ATTRIBUTION`; toda superfície que exibe dado da TzKT renderiza |

## 4. Onde a implementação mora

**`packages/tezos-chain/` no repositório do TAPS**, publicada como
`@tezos-suite/chain`.

Não é o lugar definitivo por princípio; é o único lugar onde ela já roda hoje.
O TAPS é o repositório com TypeScript, e é lá que está a aritmética de maior
risco. O Tezzet ainda não tem shell TypeScript — ele nasce no estágio 4.

**A condição que torna a escolha barata:** o pacote não depende de NestJS, de
Prisma nem de nada do TAPS. As únicas dependências de runtime são
`@taquito/taquito` e `@taquito/utils`. Extrair para repositório próprio é um
`git mv`, e essa propriedade é normativa: **um import de produto dentro do
pacote reprova a revisão.**

Rafael decide se ela migra para um repositório próprio quando o shell do
Tezzet existir. Até lá, o Tezzet consome por dependência de git.

### O que cada produto consome

| | Tezzet | TAPS |
|---|---|---|
| constantes de protocolo | sim | sim |
| validação de endereço (`tz4`, checksum) | sim | sim |
| `bigint` mutez e formatação | sim | sim |
| leitura TzKT (saldo, operações, frescor) | sim | sim |
| confirmação Tenderbake | sim | sim |
| `estimate.batch()` e validação de lote | sim (uma operação) | sim (lote inteiro) |
| split de recompensa, paginação e invariantes | não | sim |
| payout de Adaptive Issuance | não | sim |

## 5. Redes

Configuração, nunca código. O pacote **não tem lista de redes embutida** e
recusa subir sem `TEZOS_NETWORK`, `TEZOS_RPC_URL` e `TZKT_API_URL`.

- **Shadownet** para o Tezzet (aplicação).
- **Bakingnet** para o TAPS (baker) — o registro do Shadownet pede
  explicitamente que bakers não sejam testados nele.
- **Ghostnet não existe.** Ausente de `teztnets.json`.
- Mainnet move fundos reais e é **decisão humana, toda vez**.

## 6. Regra de revisão

Nada que toque cálculo de valor, montagem de lote, idempotência de pagamento
ou leitura de constante de protocolo entra em `main` sem revisão de **Tezos
Chain & Payouts**. A seção 3 é a lista com que essa revisão é feita.

O teste de contrato contra a TzKT real roda **diariamente** e antes de cada
release. Ele é o único que reprova quando a API remove um campo — um teste
contra fixture não consegue perceber isso, e foi exatamente assim que oito
campos removidos continuaram sendo somados como zero.
