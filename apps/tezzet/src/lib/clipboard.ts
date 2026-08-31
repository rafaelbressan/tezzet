/**
 * Cópia que expira.
 *
 * Trocar o endereço na área de transferência é um dos ataques mais baratos
 * contra usuário de cripto: um programa qualquer observa o clipboard, vê algo
 * que começa com `tz1` e substitui pelo endereço do atacante. O app antigo
 * copiava o endereço e nunca limpava — ele ficava lá por horas, disponível
 * para ser trocado muito depois de a pessoa ter esquecido que copiou.
 *
 * Aqui a cópia tem prazo. Quando ele vence:
 *  - se a área de transferência ainda tem o que este app colocou, o app apaga;
 *  - se tem outra coisa, o app não mexe — a pessoa copiou algo depois;
 *  - se não dá para ler (Android restringe leitura em segundo plano), o app
 *    apaga assim mesmo. O prazo foi anunciado na tela antes da cópia.
 */

export interface ClipboardPort {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export type ExpiryOutcome =
  /** A área de transferência ainda tinha o texto e foi limpa. */
  | 'cleared'
  /** Já tinha outra coisa; nada foi tocado. */
  | 'superseded'
  /** Não foi possível ler; limpou por precaução. */
  | 'cleared-unverified'
  /** Cancelado antes de vencer (nova cópia, ou a tela fechou). */
  | 'cancelled';

export interface ExpiringCopyOptions {
  readonly ttlMs: number;
  readonly onExpire?: (outcome: ExpiryOutcome) => void;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface ExpiringCopy {
  /** Cancela o prazo sem limpar. Use quando outra cópia substituir esta. */
  cancel(): void;
  /** Vence agora. Devolve o que aconteceu. */
  expireNow(): Promise<ExpiryOutcome>;
}

export async function copyWithExpiry(
  clipboard: ClipboardPort,
  text: string,
  options: ExpiringCopyOptions,
): Promise<ExpiringCopy> {
  if (options.ttlMs <= 0) {
    throw new RangeError(`copyWithExpiry: ttlMs precisa ser > 0, veio ${options.ttlMs}`);
  }
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  await clipboard.writeText(text);

  let settled = false;

  const finish = (outcome: ExpiryOutcome): ExpiryOutcome => {
    settled = true;
    options.onExpire?.(outcome);
    return outcome;
  };

  const expire = async (): Promise<ExpiryOutcome> => {
    if (settled) return 'cancelled';
    let current: string;
    try {
      current = await clipboard.readText();
    } catch {
      await clipboard.writeText('');
      return finish('cleared-unverified');
    }
    if (current !== text) return finish('superseded');
    await clipboard.writeText('');
    return finish('cleared');
  };

  const handle = setTimer(() => {
    void expire();
  }, options.ttlMs);

  return {
    cancel() {
      if (settled) return;
      settled = true;
      clearTimer(handle);
      options.onExpire?.('cancelled');
    },
    async expireNow() {
      clearTimer(handle);
      return expire();
    },
  };
}

/** Porta real: plugin do Tauri quando há Tauri, `navigator.clipboard` fora dele. */
export function systemClipboard(): ClipboardPort {
  return {
    async writeText(text) {
      const tauri = await tauriClipboard();
      if (tauri) return tauri.writeText(text);
      await navigator.clipboard.writeText(text);
    },
    async readText() {
      const tauri = await tauriClipboard();
      if (tauri) return tauri.readText();
      return navigator.clipboard.readText();
    },
  };
}

type TauriClipboard = { writeText(text: string): Promise<void>; readText(): Promise<string> };

async function tauriClipboard(): Promise<TauriClipboard | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
  const plugin = await import('@tauri-apps/plugin-clipboard-manager');
  return { writeText: plugin.writeText, readText: plugin.readText };
}
