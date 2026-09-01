import { defaultValues, Storage, type StorageKey, type StorageKeyReturnType } from '@ecadlabs/beacon-wallet';

/**
 * Armazenamento do Beacon em memória.
 *
 * A carteira de teste não persiste nada: a chave é descartável e a sessão
 * morre com o processo. Gravar em disco criaria material de chave sobrevivendo
 * a uma execução, que é exatamente o que esta carteira não pode fazer.
 *
 * Guarda o valor tipado direto, sem passar por JSON. O `LocalStorage` do SDK
 * serializa porque o `localStorage` do navegador só aceita texto — um `Map`
 * não tem essa restrição, e a ida e volta por texto só criaria uma chance de
 * o valor voltar diferente do que entrou.
 */
export class MemoriaStorage extends Storage {
  private readonly valores = new Map<StorageKey, unknown>();

  async get<K extends StorageKey>(key: K): Promise<StorageKeyReturnType[K]> {
    if (!this.valores.has(key)) return defaultValues[key];
    return this.valores.get(key) as StorageKeyReturnType[K];
  }

  async set<K extends StorageKey>(key: K, value: StorageKeyReturnType[K]): Promise<void> {
    if (value === undefined) {
      this.valores.delete(key);
      return;
    }
    this.valores.set(key, value);
  }

  async delete<K extends StorageKey>(key: K): Promise<void> {
    this.valores.delete(key);
  }

  /** Não há outra aba nem outro processo mexendo aqui. */
  async subscribeToStorageChanged(): Promise<void> {}

  getPrefixedKey<K extends StorageKey>(key: K): string {
    return key;
  }
}
