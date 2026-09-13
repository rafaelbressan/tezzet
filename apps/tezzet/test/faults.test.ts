import { describe, expect, it } from 'vitest';
import { HttpError, MissingFieldError, RateLimitedError, StaleIndexerError } from '@tezos-suite/chain';
import { describeFault } from '../src/lib/faults';

/**
 * A tela mostrou **"[object Object]"** e **"A conexão não foi lido."** quando
 * o Beacon rejeitou com um objeto simples. Os dois defeitos são deste arquivo:
 * um `String(objeto)` e uma frase montada colando sujeito em predicado fixo.
 */
describe('describeFault', () => {
  it('não devolve "[object Object]" quando o erro é um objeto qualquer', () => {
    const fault = describeFault({ title: 'Aborted', description: 'A pessoa fechou a carteira' }, 'Nada foi enviado.');

    expect(fault.what).toBe('A pessoa fechou a carteira');
    expect(`${fault.what}${fault.where}${fault.cost}`).not.toContain('[object Object]');
  });

  it('fechar o modal do Beacon mostra frase em português, não o errorType cru', () => {
    // A carga real, capturada ao fechar o modal de pareamento.
    const fault = describeFault(
      { type: 'error', errorType: 'ABORTED_ERROR', id: 'abc' },
      'A conexão com a carteira não foi feita.',
    );

    expect(fault.what).toBe('Você fechou a janela da carteira.');
    expect(fault.where).toBe('ABORTED_ERROR');
  });

  it('errorType sem tradução ainda aparece, e não o "type" genérico', () => {
    // `type` diz apenas "é um erro"; `errorType` é o único dado útil quando
    // não há tradução conhecida para ele.
    const fault = describeFault(
      { type: 'error', errorType: 'PEER_UNREACHABLE', id: 'abc' },
      'A conexão com a carteira não foi feita.',
    );

    expect(fault.what).toContain('PEER_UNREACHABLE');
    expect(fault.what).not.toContain('{');
    expect(fault.where).toContain('PEER_UNREACHABLE');
  });

  it('cai no nome do tipo quando o objeto não tem texto nenhum', () => {
    const fault = describeFault({ codigo: 7 }, 'Nada foi enviado.');

    expect(fault.what).toContain('codigo');
    expect(fault.what).not.toContain('[object Object]');
  });

  it('aguenta objeto circular sem estourar', () => {
    const circular: Record<string, unknown> = {};
    circular['eu'] = circular;

    expect(() => describeFault(circular, 'Nada foi enviado.')).not.toThrow();
    expect(describeFault(circular, 'Nada foi enviado.').what).not.toContain('[object Object]');
  });

  it('a frase de custo vem inteira de quem chama — sem concordância inventada', () => {
    expect(describeFault(new Error('x'), 'A conexão com a carteira não foi feita.').cost).toBe(
      'A conexão com a carteira não foi feita.',
    );
  });

  it('429 diz o host e que não há Retry-After', () => {
    const fault = describeFault(new RateLimitedError('https://api.tzkt.io/v1/head', '<html>'), 'O saldo não foi lido.', 3);

    expect(fault.what).toContain('429');
    expect(fault.where).toContain('api.tzkt.io');
    expect(fault.where).toContain('3 tentativas');
  });

  it('indexador atrasado diz de quantos blocos', () => {
    const fault = describeFault(new StaleIndexerError(100, 260, 60), 'O saldo não foi lido.');

    expect(fault.what).toContain('160 blocos');
    expect(fault.what).toContain('nível 100 de 260');
  });

  it('campo ausente aparece pelo nome', () => {
    const fault = describeFault(new MissingFieldError('stakedBalance', '/v1/accounts/{address}'), 'O saldo não foi lido.');

    expect(fault.what).toContain('stakedBalance');
    expect(fault.cost).toContain('não substitui campo ausente por zero');
  });

  it('HTTP genérico traz o código e o host', () => {
    const fault = describeFault(new HttpError(503, 'https://api.shadownet.tzkt.io/v1/head', ''), 'O saldo não foi lido.');

    expect(fault.what).toContain('503');
    expect(fault.where).toBe('api.shadownet.tzkt.io');
  });
});

/**
 * BRES-116: o painel de falha mostrou `(temporary)
 * proto.025-PsUshuai.delegate.unchanged` — o id cru do protocolo — para quem
 * tentou redelegar para o baker atual na Shadownet. As cargas abaixo são as
 * que o Taquito rejeita, com o `errors` do nó dentro.
 */
describe('recusa da cadeia', () => {
  const recusa = (id: string) => ({
    name: 'TezosOperationError',
    message: `(temporary) ${id}`,
    errors: [{ kind: 'temporary', id }],
  });

  it('delegar para o baker atual vira frase, e o id fica na linha de origem', () => {
    const fault = describeFault(
      recusa('proto.025-PsUshuai.delegate.unchanged'),
      'Nada foi assinado.',
    );

    expect(fault.what).toBe('Esta conta já delega para este baker.');
    expect(fault.what).not.toContain('proto.');
    expect(fault.where).toBe('proto.025-PsUshuai.delegate.unchanged');
    expect(fault.cost).toContain('Nada foi assinado.');
  });

  it('baker que não aceita stake de terceiros diz o que fazer', () => {
    const fault = describeFault(
      recusa('proto.025-PsUshuai.operations.staking_to_delegate_that_refuses_external_staking'),
      'Nada foi assinado.',
    );

    expect(fault.what).toContain('não aceita stake de terceiros');
    expect(fault.cost).toContain('trocar de baker');
  });

  it('a tradução não depende da versão do protocolo no id', () => {
    // O prefixo muda a cada protocolo; a condição não. Uma tabela que casasse
    // o id inteiro pararia de traduzir no próximo upgrade, calada.
    const fault = describeFault(recusa('proto.099-PsFuturo.delegate.unchanged'), 'Nada foi assinado.');

    expect(fault.what).toBe('Esta conta já delega para este baker.');
  });

  it('id sem tradução assume que não tem, em vez de despejar o id como frase', () => {
    const fault = describeFault(
      recusa('proto.025-PsUshuai.contract.balance_too_low'),
      'Nada foi assinado.',
    );

    expect(fault.what).toContain('não sabe traduzir');
    expect(fault.what).not.toContain('proto.');
    expect(fault.where).toBe('proto.025-PsUshuai.contract.balance_too_low');
  });

  it('escolhe o id que sabe traduzir, não a posição na pilha', () => {
    const fault = describeFault(
      {
        name: 'TezosOperationError',
        errors: [
          { kind: 'temporary', id: 'proto.025-PsUshuai.delegate.unchanged' },
          { kind: 'temporary', id: 'proto.025-PsUshuai.michelson_v1.runtime_error' },
        ],
      },
      'Nada foi assinado.',
    );

    expect(fault.what).toBe('Esta conta já delega para este baker.');
  });

  it('um objeto qualquer com "errors" não é confundido com recusa de protocolo', () => {
    const fault = describeFault(
      { message: 'A carteira recusou', errors: [{ id: 'ABORTED' }] },
      'Nada foi assinado.',
    );

    expect(fault.what).toBe('A carteira recusou');
  });
});
