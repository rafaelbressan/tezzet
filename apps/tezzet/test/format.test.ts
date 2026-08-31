import { describe, expect, it } from 'vitest';
import { formatXtz, truncateAddress } from '../src/lib/format';

const ADDRESS = 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa';

describe('truncateAddress', () => {
  it('corta no meio: começo e fim ficam visíveis', () => {
    const shown = truncateAddress(ADDRESS);

    expect(shown.startsWith('tz1fwnfJ')).toBe(true);
    expect(shown.endsWith('3ghoJa')).toBe(true);
    expect(shown).toContain('…');
  });

  it('nunca corta só o fim — o fim é metade da conferência', () => {
    const shown = truncateAddress(ADDRESS);

    expect(shown.endsWith('…')).toBe(false);
    expect(shown.slice(-6)).toBe(ADDRESS.slice(-6));
  });

  it('mostra inteiro quando cortar não economiza', () => {
    expect(truncateAddress('tz1abc', 8, 6)).toBe('tz1abc');
  });
});

describe('formatXtz', () => {
  it('mostra sempre seis casas', () => {
    expect(formatXtz(1n)).toBe('0.000001');
    expect(formatXtz(1_000_000n)).toBe('1.000000');
    expect(formatXtz(235999207943n)).toBe('235999.207943');
  });

  it('não perde o último mutez, que é o que um float perderia', () => {
    // Math.floor(0.00397 * 1e6) dá 3969. O caminho de bigint dá 3970.
    expect(formatXtz(3970n)).toBe('0.003970');
  });
});
