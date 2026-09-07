import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelegateVersusStake } from '../src/ui/difference';
import { StakeScreen } from '../src/screens/StakeScreen';
import { fakeSession, fakeWallet, stubNodeFetch } from './helpers/fake-chain';
import { routedTzKT } from './helpers/fake-tzkt';

afterEach(() => vi.unstubAllGlobals());

const CONTA = 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj';
const BAKER = 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa';

/**
 * Os dois critérios de aceite que só a tela pode provar:
 *
 *  1. a diferença entre delegar e stakear fica clara **sem documentação
 *     externa** — está escrita na tela, não atrás de um link;
 *  2. a espera do unstake aparece **antes** da confirmação.
 *
 * O segundo é o que já custou dinheiro em outras carteiras: quem descobre a
 * espera depois de assinar não tem como desfazer.
 */
describe('a diferença entre delegar e stakear', () => {
  it('está na tela, com a linha da punição escrita', () => {
    render(<DelegateVersusStake highlight="delegating" />);

    const linha = screen.getByRole('row', { name: /Se o baker for punido/ });
    expect(within(linha).getByText('você não perde nada')).toBeDefined();
    expect(within(linha).getByText('você perde parte do que congelou')).toBeDefined();
  });

  it('diz que delegar não congela e que stakear congela', () => {
    render(<DelegateVersusStake highlight="staking" />);

    const linha = screen.getByRole('row', { name: /O seu dinheiro/ });
    expect(within(linha).getByText(/continua gastável/)).toBeDefined();
    expect(within(linha).getByText(/congela/)).toBeDefined();
  });

  it('mostra as duas colunas mesmo destacando uma — esconder é esconder a comparação', () => {
    render(<DelegateVersusStake highlight="staking" />);

    expect(screen.getByRole('columnheader', { name: 'Delegar' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Stakear' })).toBeDefined();
  });
});

const CONTA_COM_STAKE = {
  type: 'user',
  address: CONTA,
  balance: 3_000_000,
  stakedBalance: 2_000_000,
  unstakedBalance: 0,
  rollupBonds: 0,
  smartRollupBonds: 0,
  delegate: { address: BAKER, alias: 'Bake Nug' },
};

/** Como o nó descreve o baker: é daqui que sai todo número da conta. */
const DELEGADO_NO_NO = {
  deactivated: false,
  baking_power: '12926013094',
  own_staked: '12893367008',
  external_staked: '8972868',
  total_delegated: '71019655',
  min_delegated_in_current_cycle: { amount: '71019655' },
  active_staking_parameters: {
    limit_of_staking_over_baking_millionth: 5000000,
    edge_of_baking_over_staking_billionth: 90000000,
  },
};

/** O que só o indexador tem: nome, contagens e última atividade. */
const DELEGADO_NA_TZKT = {
  address: BAKER,
  alias: 'Bake Nug',
  numDelegators: 4,
  stakersCount: 1,
  lastActivityTime: '2026-09-05T22:52:37Z',
};

/** Pedido real da TzKT, adaptado: já liberado e com punição, que é a linha
    onde mais coisa pode sair errada na tela. */
const PEDIDO_LIBERADO = {
  id: 27514,
  cycle: 1344,
  baker: { address: BAKER },
  staker: { address: CONTA },
  requestedAmount: 900_000,
  restakedAmount: 0,
  finalizedAmount: 0,
  slashedAmount: 5_000,
  actualAmount: 900_000,
  status: 'finalizable',
  unlockCycle: 1348,
  unlockLevel: 14_865_889,
  unlockTime: '2026-09-09T05:11:43Z',
};

const PEDIDO_ESPERANDO = { ...PEDIDO_LIBERADO, id: 27515, status: 'pending', slashedAmount: 0 };

function montarTela(pedidos: readonly unknown[] = []) {
  const { http } = routedTzKT([
    ['/v1/head', { body: { chainId: 'NetXdQprcVkpaWU', level: 14_818_898, cycle: 1344, protocol: 'PsUshuai', knownLevel: 14_818_898 } }],
    ['/v1/cycles/1344', { body: { index: 1344, firstLevel: 14_808_289 } }],
    ['/v1/staking/unstake_requests', { body: pedidos }],
    [`/v1/accounts/${CONTA}`, { body: CONTA_COM_STAKE }],
    [`/v1/delegates/${BAKER}`, { body: DELEGADO_NA_TZKT }],
    ['/v1/rewards/split/', { status: 204 }],
  ]);
  vi.stubGlobal('fetch', stubNodeFetch(DELEGADO_NO_NO));
  const wallet = fakeWallet();
  render(<StakeScreen session={fakeSession(http, wallet)} address={CONTA} />);
  return wallet;
}

describe('a espera do unstake', () => {
  it('aparece antes de qualquer confirmação, com ciclo, dias e data', async () => {
    montarTela();

    const aviso = await screen.findByRole('note');

    // Quatro ciclos, não os três da constante: o ciclo corrente já está
    // correndo e não conta.
    expect(aviso.textContent).toContain('4 ciclos');
    expect(aviso.textContent).toContain('ciclo 1348');
    expect(aviso.textContent).toContain('3 dias');
    expect(aviso.textContent).toMatch(/liberando no ciclo 1348, a partir de \d{2}\/\d{2}\/\d{4}/);
  });

  it('avisa que o dinheiro não volta sozinho depois da espera', async () => {
    montarTela();

    const aviso = await screen.findByRole('note');
    expect(aviso.textContent).toContain('não volta sozinho');
  });

  it('a espera está na tela sem ninguém ter assinado nada', async () => {
    const wallet = montarTela();

    await screen.findByRole('note');
    expect(wallet.signed).toEqual([]);
  });
});

describe('a tela de stake', () => {
  it('diz para qual baker o stake vai, porque a cadeia não deixa escolher outro', async () => {
    montarTela();

    await waitFor(() => {
      expect(screen.getByText(/é o baker para quem esta conta delega/)).toBeDefined();
    });
  });

  it('mostra a comissão que a cadeia cobra, e diz que é a única verificável', async () => {
    montarTela();

    await waitFor(() => expect(screen.getByText('9,00%')).toBeDefined());
    expect(screen.getByText(/única comissão que o Tezzet consegue verificar/)).toBeDefined();
  });

  it('sem ciclo fechado, recusa mostrar rendimento em vez de mostrar zero', async () => {
    montarTela();

    await waitFor(() => {
      expect(screen.getByText(/Sem rendimento para mostrar:/)).toBeDefined();
    });
    expect(screen.getByText(/Um número aqui seria inventado/)).toBeDefined();
  });
});

/**
 * Os cinco pontos da revisão de desenho de 2026-09-06. Cada um vira um teste
 * porque os cinco eram invisíveis para o compilador: unidade repetida, número
 * cru, cor invertida, palavra divergente e uma tabela que só quebra em 375 px.
 */
describe('o que a revisão de desenho apontou', () => {
  it('a comparação carrega o rótulo da coluna dentro da célula, para quando ela empilha', () => {
    render(<DelegateVersusStake highlight="delegating" />);

    // Em tela estreita o `<thead>` sai e estes rótulos são a única coisa que
    // diz qual valor é de qual ação.
    expect(screen.getAllByText('Delegar', { selector: '.difference__for' })).toHaveLength(4);
    expect(screen.getAllByText('Stakear', { selector: '.difference__for' })).toHaveLength(4);
  });

  it('não escreve XTZ duas vezes — <Amount> já traz a unidade', async () => {
    montarTela();

    const dica = await screen.findByText(/que é o que está congelado hoje/);
    expect(dica.textContent?.match(/XTZ/g)).toHaveLength(1);
  });

  it('o valor perdido por punição sai formatado, não em mutez cru', async () => {
    montarTela([PEDIDO_LIBERADO]);

    const punicao = await screen.findByText(/punição levou/);
    expect(punicao.textContent).toContain('0.005000');
    expect(punicao.textContent).not.toContain('5000 mutez');
  });

  it('"liberado" é atenção e "esperando" é neutro — verde leria como resolvido', async () => {
    const { container } = render(<div />);
    void container;
    montarTela([PEDIDO_LIBERADO, PEDIDO_ESPERANDO]);

    const liberado = await screen.findByText('liberado');
    const esperando = screen.getByText('esperando');

    // `liberado` é a linha que ainda pede a sua assinatura.
    expect(liberado.className).toContain('t-status--pending');
    expect(liberado.className).not.toContain('t-status--paid');
    expect(esperando.className).toContain('t-status--simulated');
  });

  it('chama de comissão do baker, que é a palavra do NARRATIVE.md', async () => {
    montarTela();

    await waitFor(() => expect(screen.getByText(/Comissão do baker/)).toBeDefined());
    expect(screen.queryByText(/Fatia do baker/)).toBeNull();
  });
});

/**
 * BRES-119: a revisão prometia números que a cadeia não entrega.
 *
 * Encontrado assinando de verdade na Shadownet. O protocolo guarda stake
 * externo em pseudotokens, não em mutez: a conversão de ida arredonda para
 * baixo (50,000000 pedidos → 49,999999 congelados, duas de duas contas) e o
 * valor em mutez é reavaliado sozinho depois (29,999999 prometidos →
 * 30,000004 minutos depois → 30,000028 mais tarde).
 *
 * A tela não pode consertar o protocolo. Pode parar de afirmar exatidão que
 * não tem — e é isso que estes testes travam.
 */
describe('o que a revisão do stake pode prometer', () => {
  async function revisarStake(valor: string) {
    montarTela();
    const campo = await screen.findByLabelText(/Congelar em stake/);
    fireEvent.change(campo, { target: { value: valor } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar o stake' }));
    await screen.findByRole('button', { name: 'Assinar na carteira' });
  }

  it('mostra o que sai do gastável, que é exato — não o que fica em stake', async () => {
    await revisarStake('0.5');

    expect(screen.getByText('Sai do gastável')).toBeDefined();
    // "Congelar em stake" continua sendo o rótulo do campo, mas não pode
    // voltar a ser a linha da revisão: ali ele lê como promessa do saldo.
    expect(screen.queryByText('Congelar em stake')).toBeNull();
  });

  it('avisa que o valor congelado não bate com o pedido, nos dois sentidos', async () => {
    await revisarStake('0.5');

    const aviso = screen.getByText(/não bate com o pedido/);
    // Os dois sentidos, porque a medição achou os dois: dizer só "para baixo"
    // seria trocar uma afirmação errada por outra.
    expect(aviso.parentElement?.textContent).toContain('para baixo');
    expect(aviso.parentElement?.textContent).toContain('para cima');
  });

  it('avisa que o valor em stake muda sozinho com o tempo', async () => {
    await revisarStake('0.5');

    expect(screen.getByText(/muda sozinho com o tempo/)).toBeDefined();
  });

  it('nada disso é assinado só por revisar', async () => {
    montarTela();
    const campo = await screen.findByLabelText(/Congelar em stake/);
    fireEvent.change(campo, { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar o stake' }));
    await screen.findByRole('button', { name: 'Assinar na carteira' });

    expect(screen.queryByText(/Stake assinado/)).toBeNull();
  });
});

describe('o que a revisão da saída do stake pode prometer', () => {
  async function revisarSaida() {
    montarTela();
    const campo = await screen.findByLabelText(/Tirar do stake/);
    fireEvent.change(campo, { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar a saída' }));
    await screen.findByRole('button', { name: 'Assinar na carteira' });
  }

  it('chama de aproximado o que continua em stake, porque é uma subtração', async () => {
    await revisarSaida();

    expect(screen.getByText('Continua em stake, aproximado')).toBeDefined();
    expect(screen.queryByText('Continua em stake')).toBeNull();
  });

  it('diz que o protocolo reavalia esse valor sozinho, para cima e para baixo', async () => {
    await revisarSaida();

    const aviso = screen.getByText(/é uma conta aproximada/);
    expect(aviso.parentElement?.textContent).toContain('rendimento do baker');
    expect(aviso.parentElement?.textContent).toContain('punição');
  });
});

/**
 * BRES-119, terceiro ponto: a espera era calculada uma vez, no
 * `loadStaking`, e reaproveitada na revisão. Uma tela deixada aberta
 * atravessando a virada de ciclo — 1 dia na Shadownet — prometeria um ciclo
 * de liberação já vencido, e prometeria isso no último momento em que a
 * pessoa ainda pode desistir.
 *
 * Agora a revisão relê a cabeça da cadeia. Este teste vira o ciclo entre
 * carregar a tela e apertar "Revisar a saída".
 */
describe('a tela aberta atravessando a virada de ciclo', () => {
  const BLOCOS_POR_CICLO = 14_400;

  function montarTelaComCicloMutavel() {
    // O falso serializa o corpo a cada pedido, então mutar estes objetos é o
    // que faz a cadeia "andar" no meio do teste.
    const head = {
      chainId: 'NetXdQprcVkpaWU',
      level: 14_818_898,
      cycle: 1344,
      protocol: 'PsUshuai',
      knownLevel: 14_818_898,
    };
    const { http } = routedTzKT([
      ['/v1/head', { body: head }],
      ['/v1/cycles/1344', { body: { index: 1344, firstLevel: 14_808_289 } }],
      ['/v1/cycles/1345', { body: { index: 1345, firstLevel: 14_808_289 + BLOCOS_POR_CICLO } }],
      ['/v1/staking/unstake_requests', { body: [] }],
      [`/v1/accounts/${CONTA}`, { body: CONTA_COM_STAKE }],
      [`/v1/delegates/${BAKER}`, { body: DELEGADO_NA_TZKT }],
      ['/v1/rewards/split/', { status: 204 }],
    ]);
    vi.stubGlobal('fetch', stubNodeFetch(DELEGADO_NO_NO));
    render(<StakeScreen session={fakeSession(http, fakeWallet())} address={CONTA} />);
    return {
      virarCiclo() {
        head.cycle = 1345;
        head.level = 14_808_289 + BLOCOS_POR_CICLO + 10;
        head.knownLevel = head.level;
      },
    };
  }

  it('a revisão relê o ciclo em vez de repetir o que foi lido ao carregar', async () => {
    const cadeia = montarTelaComCicloMutavel();

    const aviso = await screen.findByRole('note');
    expect(aviso.textContent).toContain('ciclo 1348');

    cadeia.virarCiclo();

    const campo = screen.getByLabelText(/Tirar do stake/);
    fireEvent.change(campo, { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar a saída' }));
    await screen.findByRole('button', { name: 'Assinar na carteira' });

    // 1345 + 3 + 1. O 1348 lido ao carregar já venceu, e prometê-lo aqui
    // seria prometer um dia a menos de espera do que a cadeia vai dar.
    expect(screen.getByText(/fica preso até o ciclo 1349/)).toBeDefined();
    expect(screen.queryByText(/fica preso até o ciclo 1348/)).toBeNull();
  });
});
