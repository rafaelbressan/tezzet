//! §4.3 — derivacao SLIP-0010 endurecida, no caminho Tezos `m/44'/1729'/0'/0'`.
//!
//! # Por que este codigo e nosso, e sob que condicao
//!
//! A §12.1 verificou uma por uma as bibliotecas de SLIP-0010 disponiveis:
//! `slip10` (2021, 9 estrelas), `slipped10` (**repositorio declarado devolve
//! 404** — codigo publicado sem fonte publica e o oposto de auditavel),
//! `near-slip10` (0 estrelas, fork de proposito especifico), `hd-wallet`
//! (viva, superficie muito maior que a necessidade). Nenhuma passa o criterio
//! P4 com folga.
//!
//! SLIP-0010 endurecido e uma cadeia de HMAC-SHA512. Isso **nao e
//! reimplementar primitiva** — o HMAC e o SHA-512 vem de biblioteca; e compor
//! segundo padrao publicado. A decisao esta condicionada, e as tres condicoes
//! sao verificaveis: (a) vetores oficiais do SLIP-0010 no CI
//! (`tests/vetores_slip10.rs`), (b) o cruzamento independente contra o Taquito
//! (`tests/vetores_taquito.rs`), (c) revisao de Tezos Core & Crypto. Sem as
//! tres, isto volta a ser reimplementacao e e reprovado.
//!
//! # A armadilha nomeada
//!
//! O esquema **BIP32-Ed25519 do Cardano** (crates com nome `ed25519-bip32`)
//! **nao e** SLIP-0010 e produz endereco diferente a partir da mesma
//! mnemonica. Escolher a biblioteca errada aqui gera uma carteira que nenhuma
//! outra carteira Tezos consegue restaurar. O teste
//! `nosso_esquema_nao_e_o_do_cardano` fixa qual e o nosso — a barreira e vetor,
//! nao atencao do revisor.
//!
//! # O que este modulo garante
//! - Derivacao **so endurecida**. Nivel com `i < 2^31` e recusado com
//!   [`KeyError::DerivationPath`], em qualquer curva. SLIP-0010 nao define
//!   derivacao nao-endurecida para ed25519, e uma implementacao que "aceita" e
//!   uma implementacao inventada. Para secp256k1 e P-256 o caminho da suite
//!   tambem e todo endurecido (§4.3), entao a superficie nao-endurecida nao
//!   existe — menos codigo no perimetro auditado.
//! - Escalar invalido (0, ou ≥ n) faz a nova tentativa que o SLIP-0010 manda,
//!   nunca um `panic`.
//!
//! # O que ele nao garante
//! - Compatibilidade com carteiras que derivem em caminho nao-endurecido.
//!   Essas chaves entram pela importacao de chave crua (`spsk`, `p2sk`), nao
//!   por aqui.

use crate::error::{KeyError, Result};
use crate::secret::{ChainCode, Scalar, Seed};
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha512;
use tz_params::derivation as d;
use zeroize::Zeroize;

type HmacSha512 = Hmac<Sha512>;

/// As tres curvas com esquema de derivacao definido (§4.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Curve {
    /// `tz1`. SLIP-0010 para ed25519.
    Ed25519,
    /// `tz2`. BIP-32 padrao sobre secp256k1 (identico ao SLIP-0010 no ramo
    /// endurecido, que e o unico que existe aqui).
    Secp256k1,
    /// `tz3`. SLIP-0010 para nist256p1.
    NistP256,
}

impl Curve {
    fn master_key(self) -> &'static [u8] {
        match self {
            Self::Ed25519 => d::MASTER_KEY_ED25519,
            Self::Secp256k1 => d::MASTER_KEY_SECP256K1,
            Self::NistP256 => d::MASTER_KEY_NIST256P1,
        }
    }
}

/// Um no derivado: escalar privado e chain code.
pub struct Derived {
    pub scalar: Scalar,
    pub chain_code: ChainCode,
}

/// O caminho padrao da suite, com o indice de conta variando o **ultimo**
/// nivel (§4.3): `m/44'/1729'/0'/<account>'`.
pub fn tezos_path(account: u32) -> Result<[u32; 4]> {
    if account >= d::HARDENED {
        return Err(KeyError::DerivationPath);
    }
    let mut path = d::TEZOS_PATH;
    path[d::ACCOUNT_LEVEL_INDEX] = d::hardened(account);
    Ok(path)
}

/// Deriva a partir da semente, seguindo o caminho inteiro.
pub fn derive(curve: Curve, seed: &Seed, path: &[u32]) -> Result<Derived> {
    derive_from_seed_bytes(curve, seed.expose(), path)
}

/// Idem, com a semente em bytes crus.
///
/// Existe por uma razao so, e ela e de teste: os vetores oficiais do SLIP-0010
/// usam sementes de 16 e de 64 bytes, e um teste que roda por um caminho de
/// codigo diferente do de producao nao prova nada. Em producao a semente e
/// sempre [`Seed`], de 64 bytes, vinda do BIP-39.
#[doc(hidden)]
pub fn derive_from_seed_bytes(curve: Curve, seed: &[u8], path: &[u32]) -> Result<Derived> {
    if path.is_empty() || path.len() > tz_params::vault::PATH_LEVELS_MAX {
        return Err(KeyError::DerivationPath);
    }
    let mut node = master_from_seed_bytes(curve, seed)?;
    for &index in path {
        node = child(curve, &node, index)?;
    }
    Ok(node)
}

/// No mestre: `I = HMAC-SHA512(chave = <curva>, dados = semente)`.
/// No mestre `m`. Publico porque os vetores oficiais do SLIP-0010 comecam
/// nele; a suite sempre deriva alem dele.
pub fn master(curve: Curve, seed: &Seed) -> Result<Derived> {
    master_from_seed_bytes(curve, seed.expose())
}

/// Ver [`derive_from_seed_bytes`] — mesma razao, mesmo caminho de codigo.
#[doc(hidden)]
pub fn master_from_seed_bytes(curve: Curve, seed: &[u8]) -> Result<Derived> {
    master_with_key(curve.master_key(), curve, seed)
}

/// Deriva com **outra** chave de no mestre.
///
/// Existe so para o teste negativo da §9.2: e neste byte que o esquema
/// BIP32-Ed25519 do Cardano se separa do SLIP-0010, e o teste precisa mostrar
/// que a mesma frase leva a outro endereco. Nenhum caminho de producao chama
/// isto — a chave do no mestre de producao vem de `tz_params::derivation`.
#[doc(hidden)]
pub fn derive_with_master_key(
    master_key: &[u8],
    curve: Curve,
    seed: &[u8],
    path: &[u32],
) -> Result<Derived> {
    let mut node = master_with_key(master_key, curve, seed)?;
    for &index in path {
        node = child(curve, &node, index)?;
    }
    Ok(node)
}

fn master_with_key(master_key: &[u8], curve: Curve, seed: &[u8]) -> Result<Derived> {
    let mut i = hmac512(master_key, seed)?;
    // SLIP-0010: nas curvas de ordem n, repete enquanto IL for invalido.
    for _ in 0..32 {
        if curve == Curve::Ed25519 || scalar_is_valid(curve, &i[..32]) {
            let out = split(&i);
            i.zeroize();
            return out;
        }
        let next = hmac512(master_key, &i)?;
        i.zeroize();
        i = next;
    }
    i.zeroize();
    Err(KeyError::DerivationFailed)
}

/// No filho, **so endurecido**:
/// `I = HMAC-SHA512(chain code, 0x00 ‖ k_par ‖ ser32(i))`.
fn child(curve: Curve, parent: &Derived, index: u32) -> Result<Derived> {
    if index < d::HARDENED {
        // §4.3 — nao-endurecido nao existe nesta implementacao, em curva
        // nenhuma. Ver o cabecalho do modulo.
        return Err(KeyError::DerivationPath);
    }
    let mut data = Vec::with_capacity(1 + Scalar::LEN + 4);
    data.push(0x00);
    data.extend_from_slice(parent.scalar.expose());
    data.extend_from_slice(&index.to_be_bytes());

    for _ in 0..32 {
        let mut i = hmac512(parent.chain_code.expose(), &data)?;
        if curve == Curve::Ed25519 {
            let out = split(&i);
            i.zeroize();
            data.zeroize();
            return out;
        }
        match add_mod_n(curve, &i[..32], parent.scalar.expose()) {
            Some(k) => {
                let mut node = Derived {
                    scalar: Scalar::from_bytes(k),
                    chain_code: ChainCode::zeroed(),
                };
                node.chain_code.expose_mut().copy_from_slice(&i[32..]);
                i.zeroize();
                data.zeroize();
                return Ok(node);
            }
            None => {
                // SLIP-0010: `data = 0x01 ‖ IR ‖ ser32(i)` e tenta de novo.
                data.clear();
                data.push(0x01);
                data.extend_from_slice(&i[32..]);
                data.extend_from_slice(&index.to_be_bytes());
                i.zeroize();
            }
        }
    }
    data.zeroize();
    Err(KeyError::DerivationFailed)
}

fn split(i: &[u8; 64]) -> Result<Derived> {
    let mut scalar = Scalar::zeroed();
    let mut chain_code = ChainCode::zeroed();
    scalar.expose_mut().copy_from_slice(&i[..32]);
    chain_code.expose_mut().copy_from_slice(&i[32..]);
    Ok(Derived { scalar, chain_code })
}

fn hmac512(key: &[u8], data: &[u8]) -> Result<[u8; 64]> {
    let mut mac =
        <HmacSha512 as KeyInit>::new_from_slice(key).map_err(|_| KeyError::DerivationFailed)?;
    mac.update(data);
    let out = mac.finalize().into_bytes();
    let mut b = [0u8; 64];
    b.copy_from_slice(&out);
    Ok(b)
}

/// `IL` cabe na ordem da curva e nao e zero?
fn scalar_is_valid(curve: Curve, il: &[u8]) -> bool {
    match curve {
        Curve::Ed25519 => true,
        Curve::Secp256k1 => k256_scalar(il).is_some(),
        Curve::NistP256 => p256_scalar(il).is_some(),
    }
}

/// `(IL + k_par) mod n`, com as recusas do SLIP-0010: `IL ≥ n` ou soma zero.
fn add_mod_n(curve: Curve, il: &[u8], k_par: &[u8; 32]) -> Option<[u8; 32]> {
    match curve {
        Curve::Ed25519 => None,
        Curve::Secp256k1 => {
            use k256::elliptic_curve::PrimeField;
            let a = k256_scalar(il)?;
            let b = k256::Scalar::from_repr((*k_par).into()).into_option()?;
            let sum = a + b;
            if sum == k256::Scalar::ZERO {
                return None;
            }
            Some(sum.to_repr().into())
        }
        Curve::NistP256 => {
            use p256::elliptic_curve::PrimeField;
            let a = p256_scalar(il)?;
            let b = p256::Scalar::from_repr((*k_par).into()).into_option()?;
            let sum = a + b;
            if sum == p256::Scalar::ZERO {
                return None;
            }
            Some(sum.to_repr().into())
        }
    }
}

fn k256_scalar(b: &[u8]) -> Option<k256::Scalar> {
    use k256::elliptic_curve::PrimeField;
    let arr: [u8; 32] = b.try_into().ok()?;
    let s = k256::Scalar::from_repr(arr.into()).into_option()?;
    if s == k256::Scalar::ZERO {
        return None;
    }
    Some(s)
}

fn p256_scalar(b: &[u8]) -> Option<p256::Scalar> {
    use p256::elliptic_curve::PrimeField;
    let arr: [u8; 32] = b.try_into().ok()?;
    let s = p256::Scalar::from_repr(arr.into()).into_option()?;
    if s == p256::Scalar::ZERO {
        return None;
    }
    Some(s)
}
