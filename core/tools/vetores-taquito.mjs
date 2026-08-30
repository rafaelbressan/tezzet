import signerPkg from '@taquito/signer';
const { InMemorySigner } = signerPkg;
import utils from '@taquito/utils';
const { b58Encode, PrefixV2 } = utils;

const M24 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
const M12 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const OP_SHORT = "aabb";
const OP_LONG  = "03a5f2b8e4c6d0197b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829a6c00e0b4e4b60a3b0b0e1e2d3c4b5a69788796a5b4c3d2e1f00102030405060708";

const out = [];
async function fromMnemonic(label, mnemonic, path, password, curve) {
  const s = await InMemorySigner.fromMnemonic({ mnemonic, derivationPath: path, password, curve });
  out.push({ label, kind: 'mnemonic', mnemonic, path, password: password ?? '', curve,
    pkh: await s.publicKeyHash(), pk: await s.publicKey(),
    sk: await s.secretKey(),
    sig_short: (await s.sign(OP_SHORT, new Uint8Array([3]))).prefixSig,
    gsig_short: (await s.sign(OP_SHORT, new Uint8Array([3]))).sig,
    sig_long: (await s.sign(OP_LONG, new Uint8Array([3]))).prefixSig,
    sig_nowm: (await s.sign(OP_SHORT)).prefixSig });
}
async function fromSk(label, sk) {
  const s = new InMemorySigner(sk);
  out.push({ label, kind: 'rawkey', sk,
    pkh: await s.publicKeyHash(), pk: await s.publicKey(),
    sig_short: (await s.sign(OP_SHORT, new Uint8Array([3]))).prefixSig,
    gsig_short: (await s.sign(OP_SHORT, new Uint8Array([3]))).sig,
    sig_long: (await s.sign(OP_LONG, new Uint8Array([3]))).prefixSig });
}

const scalar = Buffer.from('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', 'hex');
const scalar2 = Buffer.from('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318', 'hex');

await fromMnemonic('ed25519/24/conta0', M24, "m/44'/1729'/0'/0'", '', 'ed25519');
await fromMnemonic('ed25519/24/conta1', M24, "m/44'/1729'/0'/1'", '', 'ed25519');
await fromMnemonic('ed25519/12/conta0', M12, "m/44'/1729'/0'/0'", '', 'ed25519');
await fromMnemonic('ed25519/24/passphrase', M24, "m/44'/1729'/0'/0'", 'hunter2', 'ed25519');
await fromSk('secp256k1/spsk1', b58Encode(scalar, PrefixV2.Secp256k1SecretKey));
await fromSk('p256/p2sk1', b58Encode(scalar, PrefixV2.P256SecretKey));
await fromSk('secp256k1/spsk2', b58Encode(scalar2, PrefixV2.Secp256k1SecretKey));
await fromSk('p256/p2sk2', b58Encode(scalar2, PrefixV2.P256SecretKey));
await fromSk('ed25519/edsk32', b58Encode(scalar, PrefixV2.Ed25519Seed));

console.log(JSON.stringify({ OP_SHORT, OP_LONG, vectors: out }, null, 2));
