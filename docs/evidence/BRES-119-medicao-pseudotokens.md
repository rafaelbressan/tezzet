# BRES-119 — o stake não é guardado em mutez, e a revisão prometia mutez

| | |
|---|---|
| **Data** | 2026-09-06 (achado ao validar a BRES-97), medição própria em 2026-09-07 |
| **Redes** | Shadownet e Mainnet |
| **Issue** | BRES-119 |
| **Por que existe** | A revisão do stake afirmava números exatos em mutez. O protocolo guarda stake externo em **pseudotokens**, e o valor em mutez é recalculado a cada leitura com uma taxa que sobe todo bloco. Era o único ponto do fluxo em que o número prometido antes de assinar não era o que a cadeia registrou. |

## 1. O saldo em stake nunca é o valor pedido — e não erra sempre para o mesmo lado

Quatro contas novas, quatro valores, assinadas com
`tools/shadownet-stake-probe`. A coluna que importa é a última.

| conta | pedido | lido no bloco seguinte | dif. | relido às 11:10Z | dif. |
|---|---|---|---|---|---|
| `tz1ZX9RvjeGi1RXCV2syu3vE7CiNfvhmuNPT` | 50,000000 | 49,999999 | **−1** | (stakeou de novo) | |
| `tz1T2rKnbmiaMWeQoncLmZLMUEpfaoSWQ9ia` | 7,000000 | 6,999999 | **−1** | 7,000026 | **+26** |
| `tz1cttXMnXq2FF2whGr9zp6Ck6YuJhvnzt41` | 87,654321 | 87,654320 | **−1** | 87,654623 | **+302** |
| `tz1fGoHcDpZTd84XZVpy1GYYqdXyJYJdBJmU` | 33,333333 | 33,333339 | **+6** | (stakeou de novo) | |

Hashes, na ordem: `ooETy9MRM56AJqL9L98Jihg4FAEdySYS96i7L274YEsf2wsE1A9`,
`opCdD2yQwxuyW7cCwCC6T1rce9kEmaQRE91DTNx7ACtQR31PgQ7`,
`oovgBzBkQVQeWj6XDeRgeKZ2pSvR1hQbqrd4PFdvqxmWVZKTqpK`,
`ooK9uXw4tAguj5b2HTfV78H21A5xdr5735BS1i6EhB1C1V44Bxu`. As duas primeiras
medições da issue (50,000000 → 49,999999 e 90,000000 → 89,999999, ao validar
a BRES-97) batem com a coluna do bloco seguinte.

### O mecanismo, que explica os dois sinais

O crédito é `floor(pedido / taxa)` em pseudotokens — perde no máximo 1 mutez.
O que se lê depois é `floor(pseudotokens × taxa_de_agora)`, e **a taxa sobe a
cada bloco** com o rendimento do baker. Medida às 11:10Z na Shadownet, ela
estava em ≈ 1,12300382 nas quatro contas.

Então: ler no bloco seguinte mostra o arredondamento (−1). Esperar alguns
blocos mostra a subida, que em minutos cobre o arredondamento e ultrapassa. A
conta de 33,333333 leu +6 porque a leitura caiu alguns blocos depois do
stake; a de 87,654321 saiu de −1 para +302 em dez minutos.

### O que isso invalida

**A afirmação que a issue propôs — `stakedBalance ≤ pedido` — é falsa.** Ela
vale no instante da operação e deixa de valer minutos depois. Um teste escrito
assim passaria hoje e reprovaria amanhã, sem nada ter quebrado.

**E a tela não pode escrever "arredonda para baixo".** Seria trocar uma
afirmação errada por outra. O que é verdade em qualquer instante é o que o
aviso diz: o número não bate, e se move nos dois sentidos.

### O relato original também precisa de correção

A issue dizia que um stake por cima de stake existente "entrou exato". Não
entra. Na mesma conta, um segundo stake de **1,000000** moveu o saldo de
49,999999 para 51,000009 — **1,000010 creditados**
(`ooeU1MjerREGec6EurxgwYaQ4SPViUHZ4nB4pyLSvJcYbyLcFQd`). O excedente é o saldo
que já estava lá sendo reavaliado entre um bloco e outro.

## 2. "Continua em stake" é uma subtração sobre um saldo que a cadeia reavalia

`planUnstake` devolvia `stakedMutez − amountMutez` e a tela mostrava isso como
exato:

- ao validar a BRES-97: prometido 29,999999 → lido 30,000004 minutos depois →
  30,000028 mais tarde; e `tz1cJ9Bi4ygAYUvL31fmMCgK2GmWiTQ6ioGP` saiu de
  89,999999 para 90,000017 em poucos blocos;
- na medição de 2026-09-07, saindo 20,000000 de 51,000009
  (`onkS6fzXefiFD8kAKtZtZigr3AFXRR7brZeP3dbCaBwSZGwNmYu`): a subtração dava
  31,000009, a cadeia mostrou **31,000009 no bloco seguinte** e **31,000015
  noventa segundos depois**.

O detalhe que a medição acrescenta: no instante da operação a subtração
**bate**. Ela só erra com o tempo. Uma tela que confira o número logo depois
de assinar não vê nada de errado — e é por isso que o problema passou pela
validação da BRES-97 sem ser encontrado no unstake.

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
| 1 e 2, contra o que a cadeia registrou ao assinar | `apps/tezzet/test/stake-medido.test.ts`, sobre a fixture medida |
| 3, contra a cadeia viva | `apps/tezzet/test/contract/staking.contract.test.ts` |
| 4 | `apps/tezzet/test/ui-staking.test.tsx` — o ciclo vira entre carregar e revisar |

## 5. Como a medição é refeita

`tools/shadownet-stake-probe` é a ferramenta que assina. Ela mora fora do app
porque `apps/tezzet/test/sem-chave.test.ts` reprova qualquer pacote de
assinatura dentro de `apps/tezzet` — e é para continuar reprovando: o Tezzet é
uma carteira não-custodial, e a chave é da carteira do usuário.

A chave da conta de teste fica **fora do repositório**, em caminho apontado por
`TEZZET_SHADOWNET_KEY`, sem valor padrão: sem a variável o processo recusa
subir. O `sem-chave.test.ts` foi estendido para conferir três coisas na
ferramenta — nenhum `edsk…` commitado, nenhum caminho de segredo apontando
para dentro do repositório, e nenhum valor padrão para a variável.

```sh
cd tools/shadownet-stake-probe && npm install
export TEZZET_SHADOWNET_KEY=~/workspace/tezzet/shadownet-probe/secrets/shadownet.json
node gerar-chave.mjs
npx @tacoinfra/get-tez <tz1…> --amount 100 --network shadownet
npm run medir
```

Gasta XTZ de torneira de rede de teste, e nada mais. A ferramenta recusa
qualquer chave que não diga `"network": "shadownet"`.

O que ela registra está copiado em
`apps/tezzet/test/fixtures/bres-119-stake-medido.json` e é afirmado em
`apps/tezzet/test/stake-medido.test.ts` — não como `stakedBalance ≤ pedido`,
que a medição derrubou, mas como o que sobrevive a qualquer instante de
leitura: o saldo nunca é o pedido, a diferença aparece nos dois sentidos, e
quem ficou abaixo passa por cima em minutos.
