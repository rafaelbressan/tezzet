# BRES-47 — as três medições que sustentam a tela de delegação e stake

| | |
|---|---|
| **Data** | 2026-09-05 |
| **Redes** | Mainnet e Shadownet, ambas em `PsUshuai9QapM5TGj1JpuVGkdxz5GykdnEvS6Rh8SUVrARvZLCY` |
| **Issue** | BRES-47 |
| **Por que existe** | Três números da tela — a espera do unstake, a capacidade livre do baker e o rendimento — não estão em nenhuma resposta de API prontos. Eles são calculados, e cálculo sem medição é chute com casas decimais. |

Cada seção abaixo tem um teste que reprova se o resultado mudar: os de unidade
em `apps/tezzet/test/`, os que falam com a rede em
`apps/tezzet/test/contract/staking.contract.test.ts`.

---

## 1. A espera do unstake é a constante **mais um**

`unstake_finalization_delay` vale **3** nas duas redes. A espera real é de
**4 ciclos**.

| Fonte | Resultado |
|---|---|
| 400 pedidos de mainnet, ciclos 1311 a 1344 | `unlockCycle − cycle = 4` em **400 de 400** |
| 60 pedidos, cinco ciclos diferentes | `unlockLevel = firstLevel(cycle) + 4 × blocks_per_cycle` em **60 de 60** |
| Shadownet, pedido do ciclo 384 | `unlockCycle` 388, `unlockLevel` 4 982 401 — mesma conta |

A lei:

```
ciclo de liberação = ciclo do pedido + unstake_finalization_delay + 1
nível de liberação = primeiro nível do ciclo + (delay + 1) × blocos por ciclo
```

O `+1` é porque o ciclo do pedido já está correndo e não conta. **Mostrar 3
ciclos seria prometer um dia a menos de espera do que a cadeia dá.**

O primeiro nível do ciclo é lido de `/v1/cycles/{index}`, nunca obtido por
`ciclo × blocos por ciclo`: as fronteiras de ciclo andaram em migrações de
protocolo, e a multiplicação erra em toda cadeia que já migrou.

---

## 2. A conta do poder de baker: duas surpresas, 389 acertos

Referência: o campo `baking_power` do **nó**, em
`/chains/main/blocks/head/context/delegates/{pkh}`. A lei acerta em
**198 de 198** bakers ativos da mainnet e **191 de 191** da Shadownet — 389
exatos, zero erros:

```
tetoDeStake  = min(limite do baker, limite global) × stake próprio
excedente    = max(0, stake de terceiros − tetoDeStake)
stakeVálido  = stake próprio + min(stake de terceiros, tetoDeStake)
tetoDeDeleg  = limit_of_delegation_over_baking × stake próprio
delegVálida  = min(delegado mínimo do ciclo + excedente, tetoDeDeleg)
poder        = stakeVálido + delegVálida / edge_of_staking_over_delegation
```

### 2.1 Stake acima do limite não é recusado — ele vira delegação

O caso que decide é `tz1eCs8nFQiKTqwcqQjKyz8QGMCQ4JAXbPS8`: 16 996 297 589
mutez de stake de terceiros contra um teto de 14 216 495 095 — 2 779 802 494
acima. A cadeia não recusa nem devolve esse excedente: **ela o conta como
delegação**, que rende três vezes menos.

| Conta | Poder calculado | Nó reporta |
|---|---|---|
| Ingênua (`próprio + terceiros + delegado / 3`) | 21 693 861 730 | 19 840 660 068 |
| Truncando o stake no teto e descartando o resto | 18 914 059 236 | 19 840 660 068 |
| **Com o transbordo para delegação** | **19 840 660 068** | 19 840 660 068 |

**Consequência para a tela:** o excedente ocupa espaço de delegação. Uma conta
que o ignorasse diria "cabe delegação" onde a cadeia já não conta mais nada.

### 2.2 O delegado que conta é o **mínimo do ciclo**, não o de agora

| Qual delegado entra na conta | Mainnet | Shadownet |
|---|---|---|
| `total_delegated` (o de agora) | 50 de 198 | 175 de 191 |
| **`min_delegated_in_current_cycle`** | **198 de 198** | **191 de 191** |

Faz sentido: contar o de agora deixaria alguém inflar o peso por um bloco e
ser pago por ele. A **capacidade livre**, ao contrário, usa o delegado de
agora — é ele que ocupa o espaço daqui para a frente, e a conta sai
conservadora.

### 2.3 O `bakingPower` da TzKT não é o `baking_power` do nó

Para **8 dos 191** bakers ativos da Shadownet — todos abaixo do stake mínimo —
a TzKT reporta `bakingPower: 0` enquanto o nó reporta o valor calculado
(`tz1aUUTK…`: nó 2 334 500, TzKT 0).

Uma primeira versão desta implementação conferia a conta contra o campo da
TzKT. Ela reprovava nesses oito, **e reprovava por estar certa** — a conta
estava correta e a referência é que era outra coisa. A leitura passou a sair
do nó: uma chamada, um instante só, e a referência é o próprio protocolo.

---

## 3. `null` na TzKT nunca poderia virar zero por cento

`limitOfStakingOverBaking` e `edgeOfBakingOverStaking` vêm `null` em **43 dos
198** bakers ativos de mainnet — os que nunca chamaram
`set_delegate_parameters`. O valor que o protocolo aplica nesses casos, lido
do nó em `active_staking_parameters`:

```json
{ "limit_of_staking_over_baking_millionth": 0,
  "edge_of_baking_over_staking_billionth": 1000000000 }
```

Ou seja: **não aceita stake de terceiros, e fica com 100% do rendimento.**
Um `|| 0` nesses dois campos escreveria "taxa 0%" na tela do baker que fica
com tudo — a mesma família de defeito que fez o TAPS pagar zero a todos os
delegadores em silêncio, com o sinal invertido.

É a segunda razão para ler o nó: lá a política do baker nunca chega ausente.

---

## 4. O que **não** dá para medir, e por isso a tela não mostra

**A taxa de delegação não existe na cadeia.** A recompensa de delegação cai
inteira no saldo líquido do baker (`*Delegated` no reward split); quanto ele
repassa, e quando, é acordo privado — é literalmente o que o TAPS existe para
executar. Nenhum endpoint de nó ou de indexador carrega esse número.

O que a tela mostra no lugar é o **teto**: tudo que o baker recebeu por unidade
delegada, com a conta escrita. O delegador nunca recebe mais que isso.

O rendimento de **stake**, ao contrário, é medível: o protocolo credita quem
stakeia direto e reporta quanto em `*StakedShared`. A tela mostra o realizado
dos últimos ciclos fechados, com numerador, denominador e ciclos à vista, e
diz que é passado medido — a emissão da Tezos é adaptativa e nenhum número
daqui promete o próximo ciclo.

Registros de terceiros que publicam taxa de delegação declarada (o registro da
Baking Bad, por exemplo) foram **deixados de fora de propósito**: eles só
existem na mainnet, informam valor monetário em ponto flutuante, e trazem um
APY de fórmula não publicada. Um número desses na tela seria exatamente o
"número bonito" que a issue proíbe.
