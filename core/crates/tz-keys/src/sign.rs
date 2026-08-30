//! §4.5 e §4.6 — assinatura, e o watermark que nao tem default.
//!
//! Tezos assina o **digest**, nao a mensagem. A composicao, conferida em
//! `octez` `src/lib_crypto/ed25519.ml:329-334`:
//!
//! ```text
//! assinatura = Sign(sk, BLAKE2b-256(watermark ‖ mensagem))
//! ```
//!
//! # O que este modulo garante
//! - **O watermark e argumento obrigatorio e tipado.** Nao existe valor
//!   default e nao existe sobrecarga que o omita — chamar sem ele nao compila,
//!   e ha um caso `trybuild` fixando isso.
//! - **Nao existe `Custom`.** A §4.6 item 3 proibe: e o buraco por onde
//!   "assinar uma mensagem" vira "transferir fundos". Aqui a proibicao e a
//!   ausencia da variante — `Watermark::Custom(..)` nao compila, e tambem ha
//!   caso `trybuild` para isso. Habilitar exige nova passada da especificacao.
//! - **Normalizacao low-S obrigatoria** em secp256k1 e P-256, com nonce
//!   deterministico RFC 6979. Sem normalizar, `(r, s)` e `(r, n−s)` sao as
//!   duas assinaturas validas da mesma mensagem; num sistema de payout que
//!   decide idempotencia olhando o que ja foi enviado, duas representacoes da
//!   mesma coisa e uma classe de bug de dinheiro.
//! - **A v1 assina apenas operacao generica (`0x03`).** Cabecalho de bloco e
//!   attestation existem no tipo, exigem `chain_id` explicito e **nunca
//!   inferido**, e sao recusados em execucao com [`KeyError::WatermarkRefused`].
//!
//! # O que ele NAO garante
//! - Que os bytes assinados sao a operacao que o usuario pediu. Este modulo
//!   nao forja e nao confere operacao — isso e da camada de cadeia (BRES-42),
//!   e a §4.6 item 5 diz a regra: o nucleo **recusa assinar bytes arbitrarios**
//!   e recebe uma operacao forjada e conferida localmente, nunca bytes prontos
//!   vindos de um RPC. O tipo [`ForgedOperation`] existe para essa fronteira
//!   ser visivel na assinatura da funcao.
//! - Assinatura `tz4` (BLS). Fora da v1 por §4.7.

use crate::address::{Address, AddressKind};
use crate::base58;
use crate::derive::Curve;
use crate::error::{KeyError, Result};
use crate::secret::Scalar;
use blake2::digest::consts::{U20, U32};
use blake2::{Blake2b, Digest};
use tz_params::base58 as pfx;
use tz_params::sizes;
use tz_params::watermark as wm;

type Blake2b160 = Blake2b<U20>;
type Blake2b256 = Blake2b<U32>;

/// §4.6 — o prefixo que diz **que tipo de coisa** esta sendo assinada.
///
/// Nao ha `Default`, nao ha `Custom` e nao ha construtor a partir de bytes
/// crus. As duas variantes de baker carregam `chain_id` explicito porque
/// inferir chain id e como se assina consenso na rede errada.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Watermark {
    /// `0x03`. O unico que a v1 assina.
    GenericOperation,
    /// `0x01 ‖ chain_id`. Perfil de baker, fora da v1.
    BlockHeader { chain_id: [u8; sizes::CHAIN_ID_LEN] },
    /// `0x02 ‖ chain_id`. Perfil de baker, fora da v1.
    Attestation { chain_id: [u8; sizes::CHAIN_ID_LEN] },
}

impl Watermark {
    /// Os bytes que entram antes da mensagem no BLAKE2b-256.
    pub fn bytes(&self) -> Vec<u8> {
        match self {
            Self::GenericOperation => vec![wm::GENERIC_OPERATION],
            Self::BlockHeader { chain_id } => {
                let mut v = vec![wm::BLOCK_HEADER];
                v.extend_from_slice(chain_id);
                v
            }
            Self::Attestation { chain_id } => {
                let mut v = vec![wm::ATTESTATION];
                v.extend_from_slice(chain_id);
                v
            }
        }
    }

    /// Politica da v1 (§4.6 item 2).
    pub fn allowed_in_v1(&self) -> bool {
        matches!(self, Self::GenericOperation)
    }
}

/// Bytes de uma operacao **forjada e conferida localmente**.
///
/// O tipo nao acrescenta seguranca sozinho — ele torna a regra da §4.6 item 5
/// visivel na assinatura da funcao, para que "assinar bytes vindos do RPC"
/// precise de uma conversao explicita que alguem tem que escrever e um revisor
/// tem que ver.
pub struct ForgedOperation(Vec<u8>);

impl ForgedOperation {
    /// Chame **depois** de forjar localmente e conferir contra o que o usuario
    /// pediu. Nunca com o que um RPC devolveu pronto.
    pub fn from_locally_forged(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

/// Chave publica serializada — 32 bytes em Ed25519, 33 comprimidos nas outras.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublicKey {
    Ed25519([u8; sizes::ED25519_PUBLIC_LEN]),
    Secp256k1([u8; sizes::COMPRESSED_PUBLIC_LEN]),
    NistP256([u8; sizes::COMPRESSED_PUBLIC_LEN]),
}

impl PublicKey {
    pub fn as_bytes(&self) -> &[u8] {
        match self {
            Self::Ed25519(b) => b,
            Self::Secp256k1(b) | Self::NistP256(b) => b,
        }
    }

    /// `edpk…`, `sppk…` ou `p2pk…`.
    pub fn to_base58(&self) -> String {
        let prefix: &[u8] = match self {
            Self::Ed25519(_) => &pfx::EDPK,
            Self::Secp256k1(_) => &pfx::SPPK,
            Self::NistP256(_) => &pfx::P2PK,
        };
        base58::encode(prefix, self.as_bytes())
    }

    /// §4.4 — endereco = base58check(prefixo ‖ BLAKE2b-160(chave publica)).
    pub fn address(&self) -> Address {
        let mut h = Blake2b160::new();
        h.update(self.as_bytes());
        let digest = h.finalize();
        let mut hash = [0u8; sizes::PKH_HASH_LEN];
        hash.copy_from_slice(&digest);
        let kind = match self {
            Self::Ed25519(_) => AddressKind::Tz1,
            Self::Secp256k1(_) => AddressKind::Tz2,
            Self::NistP256(_) => AddressKind::Tz3,
        };
        Address::new(kind, hash)
    }

    pub fn curve(&self) -> Curve {
        match self {
            Self::Ed25519(_) => Curve::Ed25519,
            Self::Secp256k1(_) => Curve::Secp256k1,
            Self::NistP256(_) => Curve::NistP256,
        }
    }
}

/// `(r, s)` cru de 64 bytes, ja com low-S onde a curva pede.
#[derive(Clone, PartialEq, Eq)]
pub struct Signature {
    curve: Curve,
    bytes: [u8; sizes::ED25519_SIGNATURE_LEN],
}

impl Signature {
    pub fn as_bytes(&self) -> &[u8; sizes::ED25519_SIGNATURE_LEN] {
        &self.bytes
    }

    /// `edsig…`, `spsig…` ou `p2sig…`.
    pub fn to_base58(&self) -> String {
        let prefix: &[u8] = match self.curve {
            Curve::Ed25519 => &pfx::EDSIG,
            Curve::Secp256k1 => &pfx::SPSIG,
            Curve::NistP256 => &pfx::P2SIG,
        };
        base58::encode(prefix, &self.bytes)
    }

    /// `sig…` — a forma generica, que o RPC aceita para qualquer curva.
    pub fn to_generic_base58(&self) -> String {
        base58::encode(&pfx::GENERIC_SIG, &self.bytes)
    }
}

/// A chave privada em memoria.
///
/// Nao deriva `Clone`, `Copy`, `Debug` nem serializacao. O escalar mora num
/// [`Scalar`], que zera no drop.
pub struct SecretKey {
    curve: Curve,
    scalar: Scalar,
}

impl SecretKey {
    /// A partir do escalar derivado (§5.9 — e isto que a sessao aberta guarda).
    pub fn from_scalar(curve: Curve, scalar: Scalar) -> Result<Self> {
        // Valida agora, para a falha nao aparecer na hora de assinar.
        let sk = Self { curve, scalar };
        sk.public_key()?;
        Ok(sk)
    }

    /// Importacao de chave crua: `edsk` de 32 B, `edsk` de 64 B, `spsk`, `p2sk`.
    ///
    /// §4.4 — o decodificador casa **prefixo e comprimento**. `edsk` tem dois
    /// prefixos diferentes e aceitar um pelo outro ja causou bug em producao
    /// em outros projetos.
    pub fn from_base58(text: &str) -> Result<Self> {
        let mut scalar = Scalar::zeroed();
        let curve = if text.starts_with("edsk") {
            // Semente de 32 B primeiro; se nao casar, chave expandida de 64 B,
            // da qual so os 32 primeiros bytes sao a semente.
            match base58::decode_exact(text, &pfx::EDSK_SEED, sizes::ED25519_SCALAR_LEN) {
                Ok(v) => {
                    scalar.expose_mut().copy_from_slice(&v);
                    Curve::Ed25519
                }
                Err(_) => {
                    let v = base58::decode_exact(
                        text,
                        &pfx::EDSK_EXPANDED,
                        sizes::ED25519_SIGNATURE_LEN,
                    )?;
                    scalar
                        .expose_mut()
                        .copy_from_slice(&v[..sizes::ED25519_SCALAR_LEN]);
                    Curve::Ed25519
                }
            }
        } else if text.starts_with("spsk") {
            let v = base58::decode_exact(text, &pfx::SPSK, sizes::ECDSA_SCALAR_LEN)?;
            scalar.expose_mut().copy_from_slice(&v);
            Curve::Secp256k1
        } else if text.starts_with("p2sk") {
            let v = base58::decode_exact(text, &pfx::P2SK, sizes::ECDSA_SCALAR_LEN)?;
            scalar.expose_mut().copy_from_slice(&v);
            Curve::NistP256
        } else {
            return Err(KeyError::Base58Prefix);
        };
        Self::from_scalar(curve, scalar)
    }

    pub fn curve(&self) -> Curve {
        self.curve
    }

    /// Os 32 bytes crus do escalar.
    ///
    /// Existe **so** para o portao de memoria da §9.6, que precisa procurar
    /// exatamente estes bytes no dump. Fica atras da feature `memscan-gate`,
    /// que o CI liga e o build de produto nunca liga.
    #[doc(hidden)]
    #[cfg(feature = "memscan-gate")]
    pub fn scalar_bytes(&self) -> Option<&[u8; 32]> {
        Some(self.scalar.expose())
    }

    pub fn public_key(&self) -> Result<PublicKey> {
        match self.curve {
            Curve::Ed25519 => {
                let sk = ed25519_dalek::SigningKey::from_bytes(self.scalar.expose());
                Ok(PublicKey::Ed25519(sk.verifying_key().to_bytes()))
            }
            Curve::Secp256k1 => {
                let sk = k256::ecdsa::SigningKey::from_slice(self.scalar.expose())
                    .map_err(|_| KeyError::MalformedKeyMaterial)?;
                let point = sk.verifying_key().to_sec1_point(true);
                let mut b = [0u8; sizes::COMPRESSED_PUBLIC_LEN];
                b.copy_from_slice(point.as_bytes());
                Ok(PublicKey::Secp256k1(b))
            }
            Curve::NistP256 => {
                let sk = p256::ecdsa::SigningKey::from_slice(self.scalar.expose())
                    .map_err(|_| KeyError::MalformedKeyMaterial)?;
                let point = sk.verifying_key().to_sec1_point(true);
                let mut b = [0u8; sizes::COMPRESSED_PUBLIC_LEN];
                b.copy_from_slice(point.as_bytes());
                Ok(PublicKey::NistP256(b))
            }
        }
    }

    pub fn address(&self) -> Result<Address> {
        Ok(self.public_key()?.address())
    }

    /// **A funcao de assinar.** `watermark` e obrigatorio e tipado.
    ///
    /// Recusa tudo que nao for operacao generica enquanto a v1 estiver de pe.
    pub fn sign(&self, watermark: Watermark, op: &ForgedOperation) -> Result<Signature> {
        if !watermark.allowed_in_v1() {
            return Err(KeyError::WatermarkRefused);
        }
        let digest = tezos_digest(watermark, op.as_bytes());
        self.sign_digest(&digest)
    }

    fn sign_digest(&self, digest: &[u8; sizes::DIGEST_LEN]) -> Result<Signature> {
        let mut bytes = [0u8; sizes::ED25519_SIGNATURE_LEN];
        match self.curve {
            Curve::Ed25519 => {
                use ed25519_dalek::Signer;
                let sk = ed25519_dalek::SigningKey::from_bytes(self.scalar.expose());
                bytes.copy_from_slice(&sk.sign(digest).to_bytes());
            }
            Curve::Secp256k1 => {
                use k256::ecdsa::signature::hazmat::PrehashSigner;
                let sk = k256::ecdsa::SigningKey::from_slice(self.scalar.expose())
                    .map_err(|_| KeyError::MalformedKeyMaterial)?;
                let sig: k256::ecdsa::Signature = sk
                    .sign_prehash(digest)
                    .map_err(|_| KeyError::DerivationFailed)?;
                // §4.5 — low-S obrigatorio.
                let sig = sig.normalize_s();
                bytes.copy_from_slice(&sig.to_bytes());
            }
            Curve::NistP256 => {
                use p256::ecdsa::signature::hazmat::PrehashSigner;
                let sk = p256::ecdsa::SigningKey::from_slice(self.scalar.expose())
                    .map_err(|_| KeyError::MalformedKeyMaterial)?;
                let sig: p256::ecdsa::Signature = sk
                    .sign_prehash(digest)
                    .map_err(|_| KeyError::DerivationFailed)?;
                let sig = sig.normalize_s();
                bytes.copy_from_slice(&sig.to_bytes());
            }
        }
        Ok(Signature {
            curve: self.curve,
            bytes,
        })
    }
}

/// `BLAKE2b-256(watermark ‖ mensagem)` — o que Tezos realmente assina.
pub fn tezos_digest(watermark: Watermark, message: &[u8]) -> [u8; sizes::DIGEST_LEN] {
    let mut h = Blake2b256::new();
    h.update(watermark.bytes());
    h.update(message);
    let out = h.finalize();
    let mut d = [0u8; sizes::DIGEST_LEN];
    d.copy_from_slice(&out);
    d
}
