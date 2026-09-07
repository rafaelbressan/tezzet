# shadownet-stake-probe

Mede, **assinando na Shadownet**, a diferença entre o stake que o app pede e o
stake que a cadeia congela. É a medição da BRES-119.

## Por que isto não está em `apps/tezzet`

Porque aqui há assinatura. `apps/tezzet/test/sem-chave.test.ts` reprova
`@taquito/signer` — e qualquer outro material de chave — dentro do app, e é
para continuar reprovando: o Tezzet é uma carteira não-custodial e a chave é
da carteira do usuário, nunca do app.

A pergunta da BRES-119, porém, só fecha assinando: `stakedBalance <= pedido`
numa conta que nunca stakeou exige que alguém stakeie. Esta ferramenta é esse
alguém, e fica do lado de fora da barreira.

## Onde a chave mora

Fora do repositório. O caminho vem de `TEZZET_SHADOWNET_KEY`, **sem valor
padrão** — sem a variável o processo recusa subir. Na máquina do Rafael ela
fica em `~/workspace/tezzet/shadownet-probe/secrets/`, em 0600, junto das
outras pastas de projeto do workspace.

`apps/tezzet/test/sem-chave.test.ts` confere que nenhum arquivo daqui aponta
para dentro do repositório e que nenhum `edsk…` foi commitado.

## Rodar

```sh
npm install
export TEZZET_SHADOWNET_KEY=~/workspace/tezzet/shadownet-probe/secrets/shadownet.json
node gerar-chave.mjs
npx @tacoinfra/get-tez <o tz1 que ele imprimiu> --amount 100 --network shadownet
npm run medir
```

Gasta XTZ de torneira de rede de teste, e nada mais. A ferramenta recusa
qualquer chave que não diga `"network": "shadownet"`.

## O que ela mede

1. **O primeiro stake da conta.** Pede um valor redondo e lê o que ficou
   congelado. Deu 1 mutez a menos em todas as medições.
2. **Um segundo stake por cima.** O crédito não fecha com o pedido tampouco,
   agora para cima: o saldo já existente foi reavaliado no meio.
3. **Uma saída de stake.** Compara o `em stake − pedido` que o app mostrava
   com o que a cadeia registrou.
4. **A deriva.** Relê o mesmo saldo 90 s depois, sem assinar nada.

O resultado sai em `medicao.json` (fora do git) e é copiado para
`apps/tezzet/test/fixtures/bres-119-stake-medido.json`, que é o que o teste
do app afirma.
