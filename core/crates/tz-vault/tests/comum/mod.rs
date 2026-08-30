#![allow(dead_code)]

//! Dublê do cofre de chaves do sistema operacional, para os testes.
//!
//! Ele imita o **mecanismo** do AndroidKeyStore, nao a seguranca dele: AES-256
//! -GCM com a chave nunca saindo daqui, IV sorteado por ele e nao por nos, e
//! recusa quando o "prompt" e negado. E o que permite testar a §9.5 sem um
//! aparelho — o que **nao** substitui a medicao de P5 em hardware (BRES-67).

use std::cell::Cell;
use tz_vault::aead::Algorithm;
use tz_vault::error::{Result, VaultError};
use tz_vault::hw::{HardwareKek, HardwareSealer};
use tz_vault::kdf::Kek;

/// Chave fixa, para o vetor de bytes do cofre de dois AEADs ser reproduzivel.
pub const CHAVE_DO_DUBLE: [u8; 32] = [
    0x4b, 0x45, 0x59, 0x53, 0x54, 0x4f, 0x52, 0x45, 0x2d, 0x44, 0x55, 0x42, 0x4c, 0x45, 0x2d, 0x30,
    0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67,
];

pub struct KeystoreFalso {
    pub alias: &'static str,
    /// `false` = o usuario negou o prompt biometrico.
    pub autorizado: bool,
    contador: Cell<u32>,
}

impl KeystoreFalso {
    pub fn novo(autorizado: bool) -> Self {
        Self {
            alias: "tzvault.kek_hw.v1",
            autorizado,
            contador: Cell::new(1),
        }
    }

    fn iv(&self) -> Vec<u8> {
        // O Keystore de verdade sorteia; o duble conta, para duas gravacoes
        // seguidas darem IVs diferentes de forma deterministica.
        let n = self.contador.get();
        self.contador.set(n + 1);
        let mut iv = vec![0u8; 12];
        iv[..4].copy_from_slice(&n.to_be_bytes());
        iv[11] = 0x2a;
        iv
    }
}

impl HardwareSealer for KeystoreFalso {
    fn ctx(&self) -> Vec<u8> {
        self.alias.as_bytes().to_vec()
    }

    fn aead(&self) -> Algorithm {
        Algorithm::Aes256Gcm
    }

    fn seal(&self, aad: &[u8], dek: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>)> {
        use aes_gcm::aead::{Aead, KeyInit, Payload};
        if !self.autorizado {
            return Err(VaultError::HardwareKeyRefused);
        }
        let iv = self.iv();
        let c = aes_gcm::Aes256Gcm::new((&CHAVE_DO_DUBLE).into());
        let ct = c
            .encrypt(
                iv.as_slice()
                    .try_into()
                    .map_err(|_| VaultError::BadHardwareIv)?,
                Payload { msg: dek, aad },
            )
            .map_err(|_| VaultError::HardwareKeyRefused)?;
        Ok((iv, ct))
    }

    fn open(&self, aad: &[u8], iv: &[u8], ct_and_tag: &[u8]) -> Result<Kek> {
        use aes_gcm::aead::{Aead, KeyInit, Payload};
        // A recusa acontece **aqui**, na operacao criptografica — nao numa
        // tela que nao abre. E essa a diferenca que P5 mede.
        if !self.autorizado {
            return Err(VaultError::HardwareKeyRefused);
        }
        let c = aes_gcm::Aes256Gcm::new((&CHAVE_DO_DUBLE).into());
        let claro = c
            .decrypt(
                iv.try_into().map_err(|_| VaultError::BadHardwareIv)?,
                Payload {
                    msg: ct_and_tag,
                    aad,
                },
            )
            .map_err(|_| VaultError::CannotOpen)?;
        let a: [u8; 32] = claro
            .as_slice()
            .try_into()
            .map_err(|_| VaultError::CannotOpen)?;
        Ok(Kek::from_bytes(a))
    }
}

/// Dublê do `KeyCredentialManager` do Windows: a KEK **sai** para o nosso
/// processo, e por isso o nonce e nosso e o AEAD e XChaCha20-Poly1305 (§6.2).
pub struct HelloFalso {
    pub autorizado: bool,
}

impl HardwareKek for HelloFalso {
    fn ctx(&self) -> Vec<u8> {
        b"hello:tezos-suite".to_vec()
    }

    fn aead(&self) -> Algorithm {
        Algorithm::XChaCha20Poly1305
    }

    fn unlock(&self, _ctx: &[u8]) -> Result<Kek> {
        if !self.autorizado {
            return Err(VaultError::HardwareKeyRefused);
        }
        Ok(Kek::from_bytes(CHAVE_DO_DUBLE))
    }
}
