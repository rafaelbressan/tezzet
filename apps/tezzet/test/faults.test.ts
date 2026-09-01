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
