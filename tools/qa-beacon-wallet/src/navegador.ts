/**
 * O mínimo de navegador que o SDK do Beacon exige para rodar no Node.
 *
 * O transporte Matrix lê `localStorage` direto — sem passar pelo `Storage`
 * que a gente injeta — para lembrar qual relay respondeu por último. Em Node
 * isso é `ReferenceError: localStorage is not defined`, no meio do
 * pareamento, sem dizer que o problema é ambiente e não protocolo.
 *
 * O remendo é em memória, e é só isso: a carteira de teste não persiste nada
 * entre execuções, e o relay escolhido é justamente o que ela **não** quer
 * lembrar — cada execução começa do zero, de propósito.
 */
class LocalStorageEmMemoria implements Storage {
  private readonly valores = new Map<string, string>();

  get length(): number {
    return this.valores.size;
  }

  clear(): void {
    this.valores.clear();
  }

  getItem(key: string): string | null {
    return this.valores.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.valores.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.valores.delete(key);
  }

  setItem(key: string, value: string): void {
    this.valores.set(key, String(value));
  }
}

/** Idempotente: num navegador de verdade não faz nada. */
export function garantirLocalStorage(): void {
  if (typeof globalThis.localStorage !== 'undefined') return;
  Object.defineProperty(globalThis, 'localStorage', {
    value: new LocalStorageEmMemoria(),
    configurable: true,
  });
}
