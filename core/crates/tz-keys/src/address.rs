//! §4.4 e §4.7 — endereco Tezos: construcao, validacao e os tipos que a suite
//! reconhece mas nao assina.
//!
//! # O que este modulo garante
//! - Que `tz1`, `tz2`, `tz3`, **`tz4`** e `KT1` sao aceitos na validacao e no
//!   envio. O TAPS de hoje **rejeita `tz4`**, o que significa recusar pagar um
//!   delegador legitimo — isso e defeito, nao escopo futuro (§4.7).
//! - Que `tz5` (ML-DSA) e reconhecido e recusado com
//!   [`KeyError::AddressTypeUnsupported`], nao com erro de dado corrompido. A
//!   diferenca importa: uma e mensagem correta, a outra e um bug reportado
//!   como perda de dados.
//! - Que o checksum base58check e conferido sempre.
//!
//! # O que ele nao garante
//! - Nada sobre a cadeia. Um endereco valido pode nunca ter existido.

use crate::base58;
use crate::error::{KeyError, Result};
use tz_params::base58 as pfx;
use tz_params::sizes;

/// Os tipos de endereco que a suite **usa**.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressKind {
    /// Ed25519. Padrao de toda carteira criada pela suite.
    Tz1,
    /// secp256k1. Importacao.
    Tz2,
    /// P-256. Importacao.
    Tz3,
    /// BLS12-381. **Leitura e envio na v1; assinatura nao** (§4.7).
    Tz4,
    /// Contrato originado.
    Kt1,
}

impl AddressKind {
    pub fn prefix(self) -> &'static [u8] {
        match self {
            Self::Tz1 => &pfx::TZ1,
            Self::Tz2 => &pfx::TZ2,
            Self::Tz3 => &pfx::TZ3,
            Self::Tz4 => &pfx::TZ4,
            Self::Kt1 => &pfx::KT1,
        }
    }

    /// Assinar com este tipo de chave e possivel na v1?
    pub fn can_sign_in_v1(self) -> bool {
        matches!(self, Self::Tz1 | Self::Tz2 | Self::Tz3)
    }
}

/// Um endereco valido. O texto e o hash andam juntos para ninguem precisar
/// redecodificar — e para ninguem ser tentado a comparar textos por prefixo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Address {
    kind: AddressKind,
    hash: [u8; sizes::PKH_HASH_LEN],
    text: String,
}

impl Address {
    /// Constroi a partir do hash de 20 bytes.
    pub fn new(kind: AddressKind, hash: [u8; sizes::PKH_HASH_LEN]) -> Self {
        let text = base58::encode(kind.prefix(), &hash);
        Self { kind, hash, text }
    }

    /// Valida e decodifica um endereco escrito por um humano ou vindo de um
    /// RPC. **E este o caminho que as duas UIs usam.**
    pub fn parse(text: &str) -> Result<Self> {
        let raw = base58::decode_checked(text)?;

        // `tz5` primeiro: reconhecer antes de recusar e a razao do modulo.
        if base58::starts_with(&raw, &pfx::TZ5) {
            return Err(KeyError::AddressTypeUnsupported);
        }

        let kind = [
            (AddressKind::Tz1, &pfx::TZ1[..]),
            (AddressKind::Tz2, &pfx::TZ2[..]),
            (AddressKind::Tz3, &pfx::TZ3[..]),
            (AddressKind::Tz4, &pfx::TZ4[..]),
            (AddressKind::Kt1, &pfx::KT1[..]),
        ]
        .into_iter()
        .find(|(_, p)| base58::starts_with(&raw, p))
        .map(|(k, _)| k)
        .ok_or(KeyError::Base58Prefix)?;

        let p = kind.prefix().len();
        if raw.len() != p + sizes::PKH_HASH_LEN {
            return Err(KeyError::Base58Prefix);
        }
        let mut hash = [0u8; sizes::PKH_HASH_LEN];
        hash.copy_from_slice(&raw[p..]);
        Ok(Self {
            kind,
            hash,
            text: text.to_owned(),
        })
    }

    pub fn kind(&self) -> AddressKind {
        self.kind
    }

    pub fn hash(&self) -> &[u8; sizes::PKH_HASH_LEN] {
        &self.hash
    }

    pub fn as_str(&self) -> &str {
        &self.text
    }
}

impl core::fmt::Display for Address {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&self.text)
    }
}

/// Resposta de validacao para a UI, que precisa distinguir os tres desfechos.
///
/// Um `bool` aqui e o que faz a UI dizer "endereco invalido" para um `tz5`
/// perfeitamente valido que a suite so nao suporta ainda.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Validation {
    /// Aceito. Da para enviar fundos.
    Ok(AddressKind),
    /// Bem formado, tipo reconhecido, **ainda nao suportado** (`tz5`).
    Unsupported,
    /// Nao e endereco: checksum errado, prefixo desconhecido, comprimento
    /// errado, ou lixo.
    Invalid,
}

/// O que as duas UIs chamam antes de deixar o usuario apertar "enviar".
pub fn validate(text: &str) -> Validation {
    match Address::parse(text) {
        Ok(a) => Validation::Ok(a.kind()),
        Err(KeyError::AddressTypeUnsupported) => Validation::Unsupported,
        Err(_) => Validation::Invalid,
    }
}
