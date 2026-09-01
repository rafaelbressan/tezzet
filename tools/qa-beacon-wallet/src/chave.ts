import { randomBytes } from 'node:crypto';
import { InMemorySigner } from '@taquito/signer';
import { b58Encode, PrefixV2 } from '@taquito/utils';

/**
 * A chave que a carteira de teste usa.
 *
 * Ela é **descartável**: 32 bytes de `crypto.randomBytes`, viva só enquanto o
 * processo roda, e só existe na Shadownet, onde XTZ não vale dinheiro. Ela
 * nunca é gravada em disco, nunca sai deste processo, e nunca entra no app —
 * `apps/tezzet/test/sem-chave.test.ts` reprova qualquer pacote de assinatura
 * no `package.json` do app, e é por isso que esta carteira mora num pacote
 * próprio, fora da árvore de dependências do produto.
 *
 * Nada de criptografia é escrito aqui. `randomBytes` é a semente, o `b58Encode`
 * do Taquito é só codificação, e a derivação ed25519 é do `@taquito/signer`.
 */
export interface ChaveDescartavel {
  readonly signer: InMemorySigner;
  readonly address: string;
  /** Chave pública em formato `edpk…` — o Beacon a exige na permissão. */
  readonly publicKey: string;
}

export async function gerarChaveDescartavel(): Promise<ChaveDescartavel> {
  // `Ed25519Seed` é a semente de 32 bytes (`edsk…` curto), não a chave
  // expandida de 64 bytes. O `InMemorySigner` aceita as duas formas.
  const secret = b58Encode(randomBytes(32), PrefixV2.Ed25519Seed);
  const signer = new InMemorySigner(secret);
  const [address, publicKey] = await Promise.all([signer.publicKeyHash(), signer.publicKey()]);
  return { signer, address, publicKey };
}
