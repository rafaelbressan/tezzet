import { describe, expect, it, vi } from 'vitest';

/**
 * O defeito que a QA reprovou: no webview não existe `Buffer`, e o SDK do
 * Beacon toca nele para criar a chave de sessão. O erro **não** sobe para
 * quem chamou — o SDK o engole num `console.error` —, então o botão
 * "Conectar carteira" ficava em "Aguardando a carteira…" para sempre e
 * nenhuma tela dizia nada.
 *
 * Os 76 testes anteriores não podiam pegar isso: jsdom roda sob Node, onde
 * `Buffer` é global. Estes dois rodam com o global apagado, que é o navegador.
 */
function semBufferDoNode() {
  const original = globalThis.Buffer;
  // @ts-expect-error apagando um global de propósito: é o que o webview tem
  delete globalThis.Buffer;
  return () => {
    globalThis.Buffer = original;
  };
}

function capturarConsoleError() {
  const vistos: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    vistos.push(String(args[0]));
  });
  return { vistos, restaurar: () => spy.mockRestore() };
}

describe('Beacon fora do Node', () => {
  it('sem polyfill o SDK estoura em segundo plano, e o erro não chega a quem clicou', async () => {
    vi.resetModules();
    const restaurarBuffer = semBufferDoNode();
    const { vistos, restaurar } = capturarConsoleError();
    try {
      const { BeaconWallet } = await import('@taquito/beacon-wallet');
      // Não lança: é exatamente por isso que a tela não tinha o que mostrar.
      expect(() => new BeaconWallet({ name: 'Tezzet', network: { type: 'shadownet' as never } })).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      restaurar();
      restaurarBuffer();
    }

    expect(vistos.some((linha) => /Buffer is not defined/.test(linha))).toBe(true);
  }, 20_000);

  it('carregar o módulo da carteira do Tezzet define Buffer antes do SDK', async () => {
    vi.resetModules();
    const restaurarBuffer = semBufferDoNode();
    const { vistos, restaurar } = capturarConsoleError();
    try {
      const { BeaconWalletPort } = await import('../src/wallet/beacon');
      expect(typeof globalThis.Buffer).toBe('function');
      expect(Buffer.from('tz1', 'utf8')).toHaveLength(3);

      new BeaconWalletPort({
        id: 'shadownet',
        label: 'Shadownet',
        kind: 'test',
        beaconNetworkType: 'shadownet',
        endpoints: {
          name: 'shadownet',
          rpcUrl: 'https://rpc.shadownet.teztnets.com',
          tzktApiUrl: 'https://api.shadownet.tzkt.io',
        },
        explorerUrl: 'https://shadownet.tzkt.io',
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      restaurar();
      restaurarBuffer();
    }

    expect(vistos.filter((linha) => /Buffer is not defined/.test(linha))).toEqual([]);
  }, 20_000);
});
