import { describe, expect, it } from 'vitest';
import { fetchHistoryPage } from '../src/chain/history';
import { fakeTzKT } from './helpers/fake-tzkt';

const ADDRESS = 'tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';

function transaction(id: number, overrides: Record<string, unknown> = {}) {
  return {
    type: 'transaction',
    id,
    level: 10748113,
    timestamp: '2025-11-02T14:29:24Z',
    block: 'BMPMQGkBzn5hwPqfkH9LJMAdmybdwEu9a6hYbGuaUYQeeSkCopW',
    hash: 'ooYbvwL4DTAdgEBZuwi7AoQSe2Eg1ZWK9GTW9aWsDVP4GP5ZFh3',
    sender: { address: ADDRESS },
    target: { address: 'tz1aRoaRhSpRYvFdyvgWLL6TGyRoGF51wDjM' },
    amount: 1205,
    bakerFee: 268,
    status: 'applied',
    ...overrides,
  };
}

describe('fetchHistoryPage', () => {
  it('devolve cursor quando a página volta cheia', async () => {
    const { http, calls } = fakeTzKT([{ body: [transaction(3), transaction(2)] }]);
    const page = await fetchHistoryPage(http, ADDRESS, { limit: 2 });

    expect(page.entries).toHaveLength(2);
    expect(page.nextCursor).toBe(2);
    expect(calls[0]).toContain('limit=2');
    expect(calls[0]).not.toContain('lastId');
  });

  it('fecha a lista quando a página volta mais curta que o limite', async () => {
    const { http } = fakeTzKT([{ body: [transaction(9)] }]);
    const page = await fetchHistoryPage(http, ADDRESS, { limit: 2 });

    expect(page.nextCursor).toBeNull();
  });

  it('passa o cursor adiante — paginação não usa offset', async () => {
    const { http, calls } = fakeTzKT([{ body: [] }]);
    await fetchHistoryPage(http, ADDRESS, { limit: 25, cursor: 2872311087628288 });

    expect(calls[0]).toContain('lastId=2872311087628288');
    expect(calls[0]).not.toContain('offset');
  });

  it('lista vazia é lista vazia, não erro', async () => {
    const { http } = fakeTzKT([{ body: [] }]);
    const page = await fetchHistoryPage(http, ADDRESS, { limit: 25 });

    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('lê valor como bigint e marca a direção', async () => {
    const { http } = fakeTzKT([
      { body: [transaction(1, { sender: { address: 'tz1outro' }, target: { address: ADDRESS } })] },
    ]);
    const page = await fetchHistoryPage(http, ADDRESS, { limit: 25 });

    expect(page.entries[0]?.amount).toBe(1205n);
    expect(page.entries[0]?.direction).toBe('in');
  });

  it('operação sem valor fica com null, nunca com 0n', async () => {
    const { http } = fakeTzKT([
      { body: [{ ...transaction(1, { type: 'reveal' }), amount: undefined }] },
    ]);
    const page = await fetchHistoryPage(http, ADDRESS, { limit: 25 });

    expect(page.entries[0]?.amount).toBeNull();
  });

  it('levanta quando o timestamp não é uma data', async () => {
    const { http } = fakeTzKT([{ body: [transaction(1, { timestamp: 'ontem' })] }]);

    await expect(fetchHistoryPage(http, ADDRESS, { limit: 25 })).rejects.toThrow(/timestamp/);
  });
});
