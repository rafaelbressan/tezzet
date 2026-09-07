import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planStake, planUnstake } from '../src/wallet/staking';
import type { TransferEstimate } from '../src/wallet/transfer';

/**
 * BRES-119 — o teste que a issue pediu, e o que a medição respondeu.
 *
 * A issue propôs afirmar `stakedBalance ≤ pedido` depois de stakear numa conta
 * sem stake. `tools/shadownet-stake-probe` stakeou de verdade, quatro contas
 * novas, e a afirmação **não se sustenta**:
 *
 *  - lida no bloco seguinte ao stake, três contas deram 1 mutez a menos que o
 *    pedido — e uma deu 6 mutez **a mais**;
 *  - relidas dez minutos depois, as que ficaram abaixo já tinham passado por
 *    cima: 7,000000 pedidos lendo 7,000026.
 *
 * O motivo é o mesmo dos dois lados. O que a cadeia guarda são pseudotokens.
 * O crédito é `floor(pedido / taxa)`, que perde no máximo 1 mutez; o que se lê
 * depois é `floor(pseudotokens × taxa_de_agora)`, e a taxa sobe a cada bloco
 * com o rendimento do baker. Em poucos minutos a subida cobre o arredondamento
 * e ultrapassa.
 *
 * Um teste com `≤` passaria hoje e reprovaria amanhã, e o pior é que
 * reprovaria sem nada ter quebrado. O que estas linhas travam é o que é
 * verdade em qualquer instante: **o saldo em stake nunca é o valor pedido, e a
 * diferença não tem sinal fixo.** Enquanto isso valer, a revisão precisa
 * avisar — e a tela não pode escrever "arredonda para baixo", porque não
 * arredonda só para baixo.
 */
interface StakeMedido {
  readonly conta: string;
  readonly hash: string;
  readonly pedidoMutez: string;
  readonly lidoNoBlocoSeguinteMutez: string;
  readonly pseudotokens: string;
  /** Nem toda conta foi relida: as que stakearam de novo deixaram de servir. */
  readonly relidoMutez?: string;
}

interface StakePorCima {
  readonly pedidoMutez: string;
  readonly emStakeAntesMutez: string;
  readonly emStakeDepoisMutez: string;
}

interface SaidaMedida {
  readonly emStakeAntesMutez: string;
  readonly saidaMutez: string;
  readonly prometidoPeloAppMutez: string;
  readonly lidoLogoDepoisMutez: string;
  readonly lidoApos90sMutez: string;
}

const medicao = JSON.parse(
  readFileSync('test/fixtures/bres-119-stake-medido.json', 'utf8'),
) as {
  readonly primeirosStakes: readonly StakeMedido[];
  readonly stakePorCimaDeStake: StakePorCima;
  readonly saidaDoStake: SaidaMedida;
};

const BAKER = 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa';
const TAXA: TransferEstimate = { feeMutez: 500n, burnMutez: 0n, gasLimit: 1000, storageLimit: 0 };

const erro = (m: StakeMedido) =>
  BigInt(m.lidoNoBlocoSeguinteMutez) - BigInt(m.pedidoMutez);

describe('o primeiro stake de uma conta, assinado na Shadownet', () => {
  it('são quatro contas e quatro valores diferentes — uma só seria coincidência', () => {
    const pedidos = medicao.primeirosStakes.map((s) => s.pedidoMutez);
    expect(pedidos.length).toBeGreaterThanOrEqual(4);
    expect(new Set(pedidos).size).toBe(pedidos.length);
    expect(new Set(medicao.primeirosStakes.map((s) => s.conta)).size).toBe(pedidos.length);
  });

  it.each(medicao.primeirosStakes.map((s) => [s.pedidoMutez, s] as const))(
    'pedido de %s mutez: a cadeia não congelou isso',
    (_pedido, medido) => {
      // A afirmação que sobrevive a qualquer instante de leitura. Se um dia
      // bater, o stake voltou a ser guardado em mutez e o aviso da revisão
      // virou texto morto.
      expect(
        BigInt(medido.lidoNoBlocoSeguinteMutez),
        `${medido.hash}: pediu ${medido.pedidoMutez} e leu ${medido.lidoNoBlocoSeguinteMutez}`,
      ).not.toBe(BigInt(medido.pedidoMutez));

      // A unidade que a cadeia guarda é outra, e é menor: a taxa é maior que 1.
      expect(BigInt(medido.pseudotokens)).toBeLessThan(BigInt(medido.pedidoMutez));

      // A diferença é de alguns mutez, não uma fração do valor. 87 XTZ erram
      // tanto quanto 7 XTZ — se isso mudar, o aviso precisa de outro texto.
      const distancia = erro(medido) < 0n ? -erro(medido) : erro(medido);
      expect(distancia).toBeLessThan(1000n);
    },
  );

  it('a diferença não tem sinal fixo: nem sempre para baixo', () => {
    const erros = medicao.primeirosStakes.map(erro);

    // Esta é a linha que impede a tela de voltar a escrever "arredonda para
    // baixo". A conversão arredonda; o saldo lido, não — ele sobe com a taxa.
    expect(erros.some((d) => d < 0n), `todas as diferenças foram ${erros}`).toBe(true);
    expect(erros.some((d) => d > 0n), `todas as diferenças foram ${erros}`).toBe(true);
  });

  it('as que ficaram abaixo já tinham passado por cima dez minutos depois', () => {
    const relidas = medicao.primeirosStakes.filter((s) => s.relidoMutez !== undefined);
    expect(relidas.length).toBeGreaterThan(0);

    for (const medido of relidas) {
      const pedido = BigInt(medido.pedidoMutez);
      const naHora = BigInt(medido.lidoNoBlocoSeguinteMutez);
      const depois = BigInt(medido.relidoMutez as string);

      expect(naHora, `${medido.conta} não ficou abaixo na hora`).toBeLessThan(pedido);
      // Sem ninguém assinar nada entre uma leitura e outra.
      expect(depois, `${medido.conta} não subiu na releitura`).toBeGreaterThan(pedido);
    }
  });

  it('o plano pede o valor cheio: a diferença é da cadeia, e o app não a compensa', () => {
    for (const medido of medicao.primeirosStakes) {
      const pedidoMutez = BigInt(medido.pedidoMutez);
      const plan = planStake({
        amountMutez: pedidoMutez,
        spendableMutez: pedidoMutez + 10_000_000n,
        currentDelegate: BAKER,
        estimate: TAXA,
      });

      // Compensar no app — pedir 1 mutez a mais para "acertar" o saldo — seria
      // assinar um valor diferente do que a pessoa leu na tela. E, como a
      // diferença troca de sinal, nem daria certo.
      expect(plan.amountMutez).toBe(pedidoMutez);
      expect(plan.amountMutez).not.toBe(BigInt(medido.lidoNoBlocoSeguinteMutez));
    }
  });
});

describe('stake por cima de stake, assinado na Shadownet', () => {
  it('o saldo se move mais que o pedido, porque o que já estava lá foi reavaliado', () => {
    const { pedidoMutez, emStakeAntesMutez, emStakeDepoisMutez } = medicao.stakePorCimaDeStake;
    const creditado = BigInt(emStakeDepoisMutez) - BigInt(emStakeAntesMutez);

    // 1,000000 pedidos moveram o saldo em 1,000010. Somar o pedido ao saldo
    // anterior erra, e erra para cima.
    expect(creditado).toBeGreaterThan(BigInt(pedidoMutez));
  });
});

describe('a saída do stake, assinada na Shadownet', () => {
  it('o "continua em stake" bate no bloco seguinte e erra minutos depois', () => {
    const { emStakeAntesMutez, saidaMutez, prometidoPeloAppMutez, lidoLogoDepoisMutez, lidoApos90sMutez } =
      medicao.saidaDoStake;

    const plan = planUnstake({
      amountMutez: BigInt(saidaMutez),
      stakedMutez: BigInt(emStakeAntesMutez),
      spendableMutez: 10_000_000n,
      estimate: TAXA,
    });

    expect(plan.stakedAfterApproxMutez).toBe(BigInt(prometidoPeloAppMutez));

    // No bloco seguinte a subtração bate — e é por isso que o problema passou
    // pela validação da BRES-97 sem ser pego no unstake. Quem confere logo
    // depois de assinar não vê nada de errado.
    expect(BigInt(lidoLogoDepoisMutez)).toBe(plan.stakedAfterApproxMutez);

    // Noventa segundos depois, sem ninguém assinar nada, já era outro número.
    expect(BigInt(lidoApos90sMutez)).toBeGreaterThan(plan.stakedAfterApproxMutez);
  });
});
