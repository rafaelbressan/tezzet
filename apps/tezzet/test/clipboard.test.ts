import { describe, expect, it, vi } from 'vitest';
import { copyWithExpiry, type ClipboardPort } from '../src/lib/clipboard';

function fakeClipboard(initial = ''): ClipboardPort & { value: string; failRead?: boolean } {
  const state = {
    value: initial,
    failRead: false,
    async writeText(text: string) {
      state.value = text;
    },
    async readText() {
      if (state.failRead) throw new Error('leitura da área de transferência bloqueada');
      return state.value;
    },
  };
  return state;
}

describe('copyWithExpiry', () => {
  it('copia e limpa quando o prazo vence', async () => {
    const clipboard = fakeClipboard();
    const copy = await copyWithExpiry(clipboard, 'tz1abc', { ttlMs: 1000, setTimer: () => 0, clearTimer: () => {} });

    expect(clipboard.value).toBe('tz1abc');
    expect(await copy.expireNow()).toBe('cleared');
    expect(clipboard.value).toBe('');
  });

  it('não mexe quando a pessoa já copiou outra coisa', async () => {
    const clipboard = fakeClipboard();
    const copy = await copyWithExpiry(clipboard, 'tz1abc', { ttlMs: 1000, setTimer: () => 0, clearTimer: () => {} });
    clipboard.value = 'uma senha qualquer';

    expect(await copy.expireNow()).toBe('superseded');
    expect(clipboard.value).toBe('uma senha qualquer');
  });

  it('limpa mesmo sem conseguir ler — o prazo foi anunciado antes', async () => {
    const clipboard = fakeClipboard();
    const copy = await copyWithExpiry(clipboard, 'tz1abc', { ttlMs: 1000, setTimer: () => 0, clearTimer: () => {} });
    clipboard.failRead = true;

    expect(await copy.expireNow()).toBe('cleared-unverified');
    expect(clipboard.value).toBe('');
  });

  it('cancelar não limpa: a tela fechou, a cópia continua servindo', async () => {
    const clipboard = fakeClipboard();
    const copy = await copyWithExpiry(clipboard, 'tz1abc', { ttlMs: 1000, setTimer: () => 0, clearTimer: () => {} });

    copy.cancel();

    expect(clipboard.value).toBe('tz1abc');
    expect(await copy.expireNow()).toBe('cancelled');
  });

  it('vence sozinha no prazo, sem ninguém chamar', async () => {
    vi.useFakeTimers();
    try {
      const clipboard = fakeClipboard();
      const expirou = vi.fn();
      await copyWithExpiry(clipboard, 'tz1abc', { ttlMs: 45_000, onExpire: expirou });

      expect(clipboard.value).toBe('tz1abc');
      await vi.advanceTimersByTimeAsync(45_000);

      expect(expirou).toHaveBeenCalledWith('cleared');
      expect(clipboard.value).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('recusa prazo não positivo', async () => {
    await expect(copyWithExpiry(fakeClipboard(), 'tz1abc', { ttlMs: 0 })).rejects.toThrow(RangeError);
  });
});
