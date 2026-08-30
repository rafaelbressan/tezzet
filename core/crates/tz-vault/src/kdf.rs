//! §5.3 e §5.6 — Argon2id, os perfis, e a validacao de faixa que roda **antes**
//! do KDF.
//!
//! # A sutileza que importa
//!
//! Os parametros do KDF vivem no cabecalho, e o cabecalho e AAD — portanto
//! adulterar quebra a tag. **Mas o KDF roda antes de a tag ser verificada.** Um
//! atacante com escrita no arquivo pode entao pedir 8 GiB de memoria e derrubar
//! o processo, ou pedir 8 KiB e observar o comportamento.
//!
//! Por isso [`Profile::validate_range`] roda **antes** de qualquer trabalho
//! caro, e recusa fora da faixa com erro tipado. O parametro no cabecalho
//! existe para **subir** o custo no futuro sem quebrar cofre antigo, nao para o
//! arquivo mandar no processo.
//!
//! # O que este modulo garante
//! - Que os numeros vem de `tz_params::kdf`, e de nenhum outro lugar. §3 item 3
//!   proibe `Default::default()` de terceiro no caminho de abertura — foi assim
//!   que o spike BRES-36 herdou um scrypt de 512 MiB que ninguem escolheu.
//! - Que os tres valores do arquivo sao **exatamente** os do perfil declarado.
//!
//! # O que ele nao garante
//! - Que a senha e boa. §2.3: o KDF nao conserta passphrase fraca, ele compra
//!   margem. A margem esta em `policy`.

use crate::error::{Result, VaultError};
use tz_params::kdf as p;
use zeroize::Zeroize;

/// §5.3 — os dois perfis. Os numeros sao da especificacao e nao se mexe neles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Profile {
    /// 64 MiB, t=3, p=4. Android. Segunda opcao recomendada da RFC 9106 §4.
    Mobile,
    /// 256 MiB, t=3, p=4. Linux e Windows.
    Desktop,
}

impl Profile {
    /// O perfil corrente **desta** plataforma. §5.7 usa isto para decidir a
    /// reencriptacao oportunista.
    pub fn current_platform() -> Self {
        #[cfg(target_os = "android")]
        {
            Self::Mobile
        }
        #[cfg(not(target_os = "android"))]
        {
            Self::Desktop
        }
    }

    pub fn id(self) -> u8 {
        match self {
            Self::Mobile => p::PROFILE_MOBILE_ID,
            Self::Desktop => p::PROFILE_DESKTOP_ID,
        }
    }

    pub fn from_id(id: u8) -> Result<Self> {
        match id {
            p::PROFILE_MOBILE_ID => Ok(Self::Mobile),
            p::PROFILE_DESKTOP_ID => Ok(Self::Desktop),
            _ => Err(VaultError::KdfParamsOutOfRange),
        }
    }

    /// `(memoria em KiB, passagens, paralelismo)`.
    pub fn params(self) -> (u32, u32, u32) {
        match self {
            Self::Mobile => p::PROFILE_MOBILE,
            Self::Desktop => p::PROFILE_DESKTOP,
        }
    }

    /// §5.6 — faixa **e** coerencia com o perfil declarado. Roda antes do KDF.
    pub fn validate_range(self, m_kib: u32, t: u32, parallel: u32) -> Result<()> {
        let na_faixa = (p::M_KIB_MIN..=p::M_KIB_MAX).contains(&m_kib)
            && (p::T_MIN..=p::T_MAX).contains(&t)
            && (p::P_MIN..=p::P_MAX).contains(&parallel);
        if !na_faixa {
            return Err(VaultError::KdfParamsOutOfRange);
        }
        if (m_kib, t, parallel) != self.params() {
            return Err(VaultError::KdfParamsOutOfRange);
        }
        Ok(())
    }
}

/// A KEK derivada da passphrase. 32 bytes, zerada no drop, sem `Clone`,
/// `Debug` ou serializacao — como todo segredo (§7.1.3).
/// Ver `tz_keys::secret` para o porque do `Box`: mover um valor em Rust e um
/// `memcpy` que nao zera a origem, e o portao da §9.6 encontrou essa copia.
pub struct Kek(Box<[u8; p::KEK_LEN]>);

impl Kek {
    pub fn expose(&self) -> &[u8; p::KEK_LEN] {
        &self.0
    }
}

impl Drop for Kek {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// `KEK_pass = Argon2id(passphrase, sal, params do cabecalho)`.
///
/// Chame **depois** de [`Profile::validate_range`]. A funcao revalida por
/// seguranca, porque uma ordem de chamada errada nao pode custar 8 GiB.
pub fn kek_from_passphrase(
    profile: Profile,
    m_kib: u32,
    t: u32,
    parallel: u32,
    passphrase: &[u8],
    salt: &[u8],
) -> Result<Kek> {
    profile.validate_range(m_kib, t, parallel)?;
    let params = argon2::Params::new(m_kib, t, parallel, Some(p::KEK_LEN))
        .map_err(|_| VaultError::KdfParamsOutOfRange)?;
    let a = argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
    let mut out = Kek(Box::new([0u8; p::KEK_LEN]));
    a.hash_password_into(passphrase, salt, out.0.as_mut_slice())
        .map_err(|_| VaultError::KdfParamsOutOfRange)?;
    Ok(out)
}

impl Kek {
    /// A KEK que veio do cofre de chaves do sistema operacional (§6.2). Entra
    /// no mesmo tipo que a derivada da passphrase para ter o mesmo `Drop`.
    pub fn from_bytes(b: [u8; p::KEK_LEN]) -> Self {
        let mut k = Self(Box::new([0u8; p::KEK_LEN]));
        k.0.copy_from_slice(&b);
        k
    }
}
