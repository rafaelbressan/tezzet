/**
 * Cria a conta de teste da Shadownet, uma vez.
 *
 * A chave nasce fora deste repositório e nunca entra nele: o destino vem de
 * `TEZZET_SHADOWNET_KEY` e um teste garante que ele não aponta para cá. O
 * arquivo é escrito em 0600.
 *
 * Não escreve criptografia: a semente são 32 bytes do CSPRNG do sistema, e a
 * derivação do par de chaves é do `@taquito/signer`.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { InMemorySigner } from '@taquito/signer';
import { PrefixV2, b58Encode } from '@taquito/utils';

const destino = process.env.TEZZET_SHADOWNET_KEY;
if (!destino) throw new Error('TEZZET_SHADOWNET_KEY não está definida — ela diz onde a chave vai morar');
if (existsSync(destino)) throw new Error(`já existe ${destino} — apague à mão se quiser outra conta`);

const sk = b58Encode(new Uint8Array(randomBytes(32)), PrefixV2.Ed25519Seed);
const address = await new InMemorySigner(sk).publicKeyHash();

writeFileSync(destino, JSON.stringify({ network: 'shadownet', address, sk }, null, 2) + '\n', { mode: 0o600 });
chmodSync(destino, 0o600);
console.log(address);
console.log(`\nabasteça na torneira:\n  npx @tacoinfra/get-tez ${address} --amount 100 --network shadownet`);
