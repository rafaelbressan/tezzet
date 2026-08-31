import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Quatro estados, e nenhum deles é um zero.
 *
 * `idle` e `loading` mostram esqueleto, `error` mostra a falha com os
 * números, `ready` mostra o dado com a hora em que foi lido. Um hook que
 * devolvesse `data ?? valorPadrão` apagaria a diferença entre "ainda não
 * chegou" e "chegou e é zero", que é a diferença que importa.
 */
export type AsyncState<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown; readonly attempts: number }
  | { readonly kind: 'ready'; readonly value: T };

export interface AsyncResult<T> {
  readonly state: AsyncState<T>;
  readonly reload: () => void;
}

export function useAsync<T>(task: (() => Promise<T>) | null, deps: readonly unknown[]): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ kind: 'idle' });
  const [nonce, setNonce] = useState(0);
  const attempts = useRef(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!task) {
      setState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    attempts.current += 1;
    setState({ kind: 'loading' });
    task()
      .then((value) => {
        if (cancelled) return;
        attempts.current = 0;
        setState({ kind: 'ready', value });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ kind: 'error', error, attempts: attempts.current });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { state, reload };
}
