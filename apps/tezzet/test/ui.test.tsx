import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Address, Amount, EmptyState, Fault, NetworkBadge, Skeleton, StatusBadge } from '../src/ui/primitives';

const ADDRESS = 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa';

describe('Amount', () => {
  it('mostra seis casas e a unidade separada', () => {
    render(<Amount mutez={3970n} />);

    expect(screen.getByText('0.003970')).toBeDefined();
    expect(screen.getByText('XTZ')).toBeDefined();
  });
});

describe('Address', () => {
  it('trunca no meio e guarda o endereço inteiro no title', () => {
    render(<Address address={ADDRESS} />);
    const shown = screen.getByTitle(ADDRESS);

    expect(shown.textContent).toBe('tz1fwnfJ…3ghoJa');
    expect(shown.className).toContain('t-address');
  });

  it('mostra inteiro quando pedido', () => {
    render(<Address address={ADDRESS} full />);

    expect(screen.getByText(ADDRESS)).toBeDefined();
  });
});

describe('NetworkBadge', () => {
  it('usa a classe da natureza da rede, e o nome vem em texto', () => {
    const { container } = render(<NetworkBadge label="Shadownet" kind="test" />);

    expect(container.querySelector('.t-network--test')).not.toBeNull();
    expect(screen.getByText('Shadownet')).toBeDefined();
  });

  it('rede real fica quieta', () => {
    const { container } = render(<NetworkBadge label="Mainnet" kind="main" />);

    expect(container.querySelector('.t-network--main')).not.toBeNull();
  });
});

describe('estados do dado de cadeia', () => {
  it('carregando é esqueleto, nunca um zero', () => {
    const { container } = render(<Skeleton width="12ch" label="Saldo" />);

    expect(container.querySelector('.t-skeleton')).not.toBeNull();
    expect(container.textContent).not.toContain('0');
    expect(screen.getByRole('status').getAttribute('aria-label')).toContain('Saldo');
  });

  it('falha diz o quê, de onde e o que ficou sem saber', () => {
    render(<Fault what="HTTP 429." where="api.tzkt.io · 3 tentativas" cost="O saldo não foi lido." />);

    expect(screen.getByRole('alert').textContent).toContain('429');
    expect(screen.getByRole('alert').textContent).toContain('3 tentativas');
    expect(screen.getByRole('alert').textContent).toContain('não foi lido');
  });

  it('vazio é convite, não lamento, e não mostra zero', () => {
    const { container } = render(<EmptyState title="Nenhuma operação ainda" next="A primeira aparece aqui." />);

    expect(container.textContent).not.toContain('0');
  });
});

describe('StatusBadge', () => {
  it('o texto carrega o significado — cor sozinha não diz nada', () => {
    render(<StatusBadge status="applied" />);

    expect(screen.getByText('aplicada')).toBeDefined();
  });

  it('situação desconhecida aparece como veio, sem inventar', () => {
    render(<StatusBadge status="algo_novo" />);

    expect(screen.getByText('algo_novo')).toBeDefined();
  });
});
