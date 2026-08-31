import { describe, expect, it } from 'vitest';
import { parseNetworkCatalog, selectNetwork } from '../src/config/networks';
import { explorerAccountUrl, explorerOperationUrl } from '../src/chain/explorer';
import { readFileSync } from 'node:fs';

const catalog = parseNetworkCatalog(
  JSON.parse(readFileSync('public/networks.json', 'utf8')),
);

const HASH = 'ooYbvwL4DTAdgEBZuwi7AoQSe2Eg1ZWK9GTW9aWsDVP4GP5ZFh3';

describe('link do explorador', () => {
  it('aponta para o explorador da rede em que a operação aconteceu', () => {
    const shadownet = selectNetwork(catalog, 'shadownet');
    const mainnet = selectNetwork(catalog, 'mainnet');

    expect(explorerOperationUrl(shadownet, HASH)).toBe(`https://shadownet.tzkt.io/${HASH}`);
    expect(explorerOperationUrl(mainnet, HASH)).toBe(`https://tzkt.io/${HASH}`);
    // Um hash de teste apontando para o explorador de mainnet abre uma página
    // vazia, e página vazia parece "a operação não existe".
    expect(explorerOperationUrl(shadownet, HASH)).not.toBe(explorerOperationUrl(mainnet, HASH));
  });

  it('serve para conta também', () => {
    const mainnet = selectNetwork(catalog, 'mainnet');

    expect(explorerAccountUrl(mainnet, 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa')).toBe(
      'https://tzkt.io/tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa',
    );
  });
});
