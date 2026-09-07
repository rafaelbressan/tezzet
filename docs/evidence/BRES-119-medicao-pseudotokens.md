# BRES-119 — o stake não é guardado em mutez, e a revisão prometia mutez

| | |
|---|---|
| **Data** | 2026-09-06 (assinado na Shadownet), releitura em 2026-09-07 |
| **Redes** | Shadownet e Mainnet |
| **Issue** | BRES-119 |
| **Por que existe** | A revisão do stake afirmava números exatos em mutez. O protocolo guarda stake externo em **pseudotokens**: a ida arredonda para baixo e a volta é reavaliada com o tempo. Era o único ponto do fluxo em que o número prometido antes de assinar não era o que a cadeia registrou. |

## 1. Congelar perde alguns mutez na primeira conversão da conta

| conta | pedido | congelado | diferença | hash |
|---|---|---|---|---|
| `tz1USvTYjY1mPfrFkqMbdahAKNuhmu2eSczg` | 50,000000 | 49,999999 | −1 mutez | `oooDEQosxqr24D3tR9D1s7R6rSqYAHGadx9k8TmPjXawRCGwhFu` |
| `tz1cJ9Bi4ygAYUvL31fmMCgK2GmWiTQ6ioGP` | 90,000000 | 89,999999 | −1 mutez | `onvznQ2e6993PgkmHcejpkqYVRg7XQ1rfzpHoDNYxbbB9ZrEwoc` |

Um stake por cima de stake existente entrou exato — 1,000000 → 1,000000,
`onj93ZRNvHuQz2orwTqxjuHwmNAzKA45mimY8jUJBrCN3pwN6uy`. A perda é da primeira
conversão.

A TzKT mostra as duas contabilidades lado a lado. Para a primeira conta, no
`/v1/staking/updates`: `amount` 50000000 mutez, `pseudotokens` 44528255. O
`/v1/accounts/…` traz `stakedBalance` **e** `stakedPseudotokens`, e é o
segundo que a cadeia guarda.

## 2. "Continua em stake" é uma subtração sobre um saldo que a cadeia reavalia

`planUnstake` devolvia `stakedMutez − amountMutez` e a tela mostrava isso como
exato:

- prometido 29,999999 → lido 30,000004 minutos depois → 30,000028 mais tarde;
- `tz1cJ9Bi4ygAYUvL31fmMCgK2GmWiTQ6ioGP` saiu de 89,999999 para 90,000017 em
  poucos blocos.

Ninguém assinou nada no meio. O valor sobe com o rendimento do baker e desce
com punição.

## 3. A divergência é geral, não é da Shadownet

Soma dos pedidos (`Σ stake.amount − Σ unstake.amount` em
`/v1/staking/updates`) contra o `stakedBalance` da conta, lido em 2026-09-07:

| rede | conta | pedido | em stake | diferença |
|---|---|---|---|---|
| Shadownet | `tz1USvTYjY1m…` | 31000000 | 31000123 | +123 |
| Shadownet | `tz1cJ9Bi4ygA…` | 90000000 | 90000328 | +328 |
| Shadownet | `tz1eHoEWMhAz…` | 29998117 | 30030641 | +32 524 |
| Mainnet | `tz1Ykfq2xL3A…` | 315000 | 315209 | +209 |
| Mainnet | `tz3cC4osV2bz…` | 3440996187 | 3732419774 | +291 423 587 |
| Mainnet | `tz1P9VQN6UtA…` | 60170000000 | 60171415290 | +1 415 290 |

Contas sem tempo de cadeia batem exatamente. Por isso o teste de contrato
afirma que **alguma** conta diverge, e não que todas divergem: exigir
divergência de todas reprovaria por causa de uma conta nova.

## 4. A espera do unstake era calculada uma vez, ao carregar

`StakeScreen` chamava `computeUnstakeWait` dentro de `loadStaking`, com deps
`[network.id, address]`, e reaproveitava o resultado na revisão. Uma tela
aberta atravessando a virada de ciclo — 1 dia na Shadownet — prometeria um
ciclo de liberação já vencido, no último momento em que ainda dá para
desistir. Não foi reproduzido em rede (exigiria a sessão aberta por um ciclo
inteiro); foi reproduzido em teste, virando o ciclo entre carregar e revisar.

## O que trava cada um

| ponto | teste |
|---|---|
| 1 e 2, no domínio | `apps/tezzet/test/staking-plan.test.ts` — o plano não tem campo de saldo em stake depois, e o do unstake se chama `stakedAfterApproxMutez` |
| 1 e 2, na tela | `apps/tezzet/test/ui-staking.test.tsx` — a revisão diz "Sai do gastável", "Continua em stake, aproximado", e traz o aviso |
| 3, contra a cadeia | `apps/tezzet/test/contract/staking.contract.test.ts` |
| 4 | `apps/tezzet/test/ui-staking.test.tsx` — o ciclo vira entre carregar e revisar |

## O que não foi feito

O teste que a issue pediu — stakear um valor conhecido numa conta sem stake e
afirmar `stakedBalance ≤ pedido` — exige assinar. Não há chave neste
repositório, e `apps/tezzet/test/sem-chave.test.ts` existe para garantir que
não vai haver. A mesma afirmação está feita pelo lado da leitura, na seção 3.
