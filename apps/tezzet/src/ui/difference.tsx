/**
 * A diferença entre delegar e stakear, na tela, sempre.
 *
 * Depois do Adaptive Issuance existem duas ações com o mesmo baker, e elas
 * não são "a mesma coisa com rendimento diferente": uma empresta peso e a
 * outra entrega dinheiro para o risco do baker. Quem confunde as duas
 * descobre a diferença no dia em que o baker é punido, e aí é tarde.
 *
 * Por isso este bloco fica no topo das duas telas, e não atrás de um "saiba
 * mais". A linha que mais importa é a da punição, e ela é a última — é a que
 * fica na tela quando a pessoa para de ler.
 */
const ROWS: readonly { readonly what: string; readonly delegating: string; readonly staking: string }[] = [
  {
    what: 'O seu dinheiro',
    delegating: 'continua gastável, e continua seu',
    staking: 'congela, e sai do gastável',
  },
  {
    what: 'Para desfazer',
    delegating: 'uma operação, e vale já',
    staking: 'uma operação, a espera, e outra operação',
  },
  {
    what: 'Quem te paga',
    delegating: 'o baker, por fora da cadeia, do jeito dele',
    staking: 'a cadeia, direto na sua conta, por regra do protocolo',
  },
  {
    what: 'Se o baker for punido',
    delegating: 'você não perde nada',
    staking: 'você perde parte do que congelou',
  },
];

export function DelegateVersusStake({ highlight }: { highlight: 'delegating' | 'staking' }) {
  return (
    <table className="difference">
      <caption className="difference__caption">
        Delegar e stakear são duas ações diferentes, com o mesmo baker.
      </caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="visually-hidden">O quê</span>
          </th>
          <th scope="col" aria-current={highlight === 'delegating' ? 'true' : undefined}>
            Delegar
          </th>
          <th scope="col" aria-current={highlight === 'staking' ? 'true' : undefined}>
            Stakear
          </th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.what}>
            <th scope="row">{row.what}</th>
            <td className={highlight === 'delegating' ? 'difference__here' : undefined}>
              {/* Rótulo de verdade no DOM, não `content` de CSS: em tela
                  estreita o cabeçalho de coluna sai, e sem ele os dois valores
                  ficariam soltos, um embaixo do outro, sem dizer qual é qual.
                  Em tela larga ele é `display: none` e some da árvore de
                  acessibilidade, onde o `<th scope="col">` já faz o trabalho. */}
              <span className="difference__for">Delegar</span>
              <span className="difference__value">{row.delegating}</span>
            </td>
            <td className={highlight === 'staking' ? 'difference__here' : undefined}>
              <span className="difference__for">Stakear</span>
              <span className="difference__value">{row.staking}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
