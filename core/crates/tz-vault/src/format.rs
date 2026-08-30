//! §5.2 — o arquivo do cofre, byte a byte, na versao **emendada pelo BRES-68**.
//!
//! O que a emenda mudou, e que muda o formato e nao so o texto: a entrada da
//! tabela de embrulhos passou de **76 para 77 bytes** por causa do campo novo
//! `wrap_aead_id`, e o `aead_id` do cabecalho virou `body_aead_id` porque
//! descreve o corpo e so ele. Arquivo no formato anterior **nao abre**, e nao
//! existe migracao: apaga e regrava. `format_version` continua `0x01` porque
//! nao ha cofre de usuario em producao (BRES-35).
//!
//! Todos os inteiros sao little-endian.
//!
//! # O que este modulo garante
//! - Que toda recusa estrutural acontece **antes** de qualquer trabalho caro:
//!   `magic`, versao, `reserved`, ids conhecidos, faixa de KDF, bits
//!   reservados de `wrap_flags` e preenchimento de nonce. §5.6 e §9.5 pedem
//!   isso medido por tempo, e `tests/cofre.rs` mede.
//! - Que o parser nunca aloca o que o arquivo mandar: `ctx_len` e `body_len`
//!   tem teto, e o fuzzing da §9.5 encontra isso em segundos quando falta.
//! - Que **toda escolha de algoritmo esta autenticada**: `wrap_aead_id` entra
//!   na AAD junto com `wrap_type` e `wrap_flags`; `body_aead_id` esta no
//!   cabecalho, que e AAD do corpo inteiro.
//!
//! # O que ele nao garante
//! - Nada sobre o conteudo antes de a tag fechar. Um parser bem-sucedido
//!   significa "a forma esta certa", nunca "o conteudo e confiavel".

use crate::aead::{Algorithm, NonceField};
use crate::error::{Result, VaultError};
use tz_params::vault as v;
use zeroize::Zeroize;

/// Cabecalho de 48 bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    pub profile_id: u8,
    pub body_aead: Algorithm,
    pub wrap_count: u8,
    pub m_kib: u32,
    pub t: u32,
    pub parallel: u32,
    pub salt: [u8; v::KDF_SALT_LEN],
    pub created_at: u64,
}

impl Header {
    pub fn to_bytes(&self) -> [u8; v::HEADER_LEN] {
        use v::header_at as at;
        let mut h = [0u8; v::HEADER_LEN];
        h[at::MAGIC..at::MAGIC + v::MAGIC.len()].copy_from_slice(&v::MAGIC);
        h[at::FORMAT_VERSION] = v::FORMAT_VERSION;
        h[at::KDF_ID] = v::KDF_ARGON2ID;
        h[at::PROFILE_ID] = self.profile_id;
        h[at::BODY_AEAD_ID] = self.body_aead.id();
        h[at::WRAP_COUNT] = self.wrap_count;
        h[at::RESERVED] = 0x00;
        h[at::ARGON2_M_KIB..at::ARGON2_M_KIB + 4].copy_from_slice(&self.m_kib.to_le_bytes());
        h[at::ARGON2_T..at::ARGON2_T + 4].copy_from_slice(&self.t.to_le_bytes());
        h[at::ARGON2_P..at::ARGON2_P + 4].copy_from_slice(&self.parallel.to_le_bytes());
        h[at::KDF_SALT..at::KDF_SALT + v::KDF_SALT_LEN].copy_from_slice(&self.salt);
        h[at::CREATED_AT..at::CREATED_AT + 8].copy_from_slice(&self.created_at.to_le_bytes());
        h
    }

    /// Apendice A, passo (1): validacao estrutural **antes** de qualquer
    /// trabalho caro.
    pub fn parse(b: &[u8]) -> Result<Self> {
        use v::header_at as at;
        if b.len() < v::HEADER_LEN {
            return Err(VaultError::Malformed);
        }
        if b[at::MAGIC..at::MAGIC + v::MAGIC.len()] != v::MAGIC {
            return Err(VaultError::BadMagic);
        }
        if b[at::FORMAT_VERSION] != v::FORMAT_VERSION || b[at::KDF_ID] != v::KDF_ARGON2ID {
            return Err(VaultError::UnsupportedVersion);
        }
        // §5.2 — "Leitor recusa valor diferente".
        if b[at::RESERVED] != 0x00 {
            return Err(VaultError::UnsupportedVersion);
        }
        let body_aead = Algorithm::from_id(b[at::BODY_AEAD_ID])?;
        let wrap_count = b[at::WRAP_COUNT];
        if !(v::WRAP_COUNT_MIN..=v::WRAP_COUNT_MAX).contains(&wrap_count) {
            return Err(VaultError::Malformed);
        }
        Ok(Self {
            profile_id: b[at::PROFILE_ID],
            body_aead,
            wrap_count,
            m_kib: le32(b, at::ARGON2_M_KIB),
            t: le32(b, at::ARGON2_T),
            parallel: le32(b, at::ARGON2_P),
            salt: {
                let mut s = [0u8; v::KDF_SALT_LEN];
                s.copy_from_slice(&b[at::KDF_SALT..at::KDF_SALT + v::KDF_SALT_LEN]);
                s
            },
            created_at: {
                let mut e = [0u8; 8];
                e.copy_from_slice(&b[at::CREATED_AT..at::CREATED_AT + 8]);
                u64::from_le_bytes(e)
            },
        })
    }
}

fn le32(b: &[u8], at: usize) -> u32 {
    let mut e = [0u8; 4];
    e.copy_from_slice(&b[at..at + 4]);
    u32::from_le_bytes(e)
}

/// Uma entrada da tabela de embrulhos: 77 bytes fixos + `ctx_len`.
#[derive(Clone, PartialEq, Eq)]
pub struct Wrap {
    pub wrap_type: u8,
    pub wrap_flags: u8,
    pub wrap_aead: Algorithm,
    pub nonce: NonceField,
    pub wrapped_dek: [u8; v::DEK_LEN],
    pub tag: [u8; v::TAG_LEN],
    /// Alias da chave no Keystore, handle do TPM, credential id do WebAuthn.
    /// **Nunca segredo** — §5.2 diz isso com todas as letras.
    pub ctx: Vec<u8>,
}

impl Wrap {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(v::WRAP_FIXED_LEN + self.ctx.len());
        out.push(self.wrap_type);
        out.push(self.wrap_flags);
        out.push(self.wrap_aead.id());
        out.extend_from_slice(&(self.ctx.len() as u16).to_le_bytes());
        out.extend_from_slice(&self.nonce.0);
        out.extend_from_slice(&self.wrapped_dek);
        out.extend_from_slice(&self.tag);
        out.extend_from_slice(&self.ctx);
        out
    }

    /// `aad = header ‖ wrap_type ‖ wrap_flags ‖ wrap_aead_id ‖ ctx`.
    ///
    /// `wrap_aead_id` entra aqui porque **toda escolha de algoritmo e
    /// autenticada**: trocar o id por outro valor valido tem que virar falha de
    /// abertura, nao decifragem por outro caminho.
    pub fn aad(&self, header: &[u8; v::HEADER_LEN]) -> Vec<u8> {
        let mut a = Vec::with_capacity(v::HEADER_LEN + 3 + self.ctx.len());
        a.extend_from_slice(header);
        a.push(self.wrap_type);
        a.push(self.wrap_flags);
        a.push(self.wrap_aead.id());
        a.extend_from_slice(&self.ctx);
        a
    }

    pub fn ciphertext_and_tag(&self) -> Vec<u8> {
        let mut ct = self.wrapped_dek.to_vec();
        ct.extend_from_slice(&self.tag);
        ct
    }

    fn parse(b: &[u8], off: usize) -> Result<(Self, usize)> {
        use v::wrap_at as at;
        if b.len() < off + v::WRAP_FIXED_LEN {
            return Err(VaultError::Malformed);
        }
        let wrap_flags = b[off + at::WRAP_FLAGS];
        // §5.2 — bits 1 a 7 DEVEM ser zero.
        if wrap_flags & v::WRAP_FLAGS_RESERVED_MASK != 0 {
            return Err(VaultError::ReservedFlagSet);
        }
        let wrap_aead = Algorithm::from_id(b[off + at::WRAP_AEAD_ID])?;
        let ctx_len = u16::from_le_bytes([b[off + at::CTX_LEN], b[off + at::CTX_LEN + 1]]) as usize;
        if ctx_len > v::CTX_LEN_MAX || b.len() < off + v::WRAP_FIXED_LEN + ctx_len {
            return Err(VaultError::Malformed);
        }
        let mut campo = [0u8; v::NONCE_FIELD_LEN];
        campo.copy_from_slice(&b[off + at::WRAP_NONCE..off + at::WRAP_NONCE + v::NONCE_FIELD_LEN]);
        // §5.2 — preenchimento zero conferido antes do KDF.
        let nonce = NonceField::validated(wrap_aead, campo)?;
        let mut wrapped_dek = [0u8; v::DEK_LEN];
        wrapped_dek.copy_from_slice(&b[off + at::WRAPPED_DEK..off + at::WRAPPED_DEK + v::DEK_LEN]);
        let mut tag = [0u8; v::TAG_LEN];
        tag.copy_from_slice(&b[off + at::WRAP_TAG..off + at::WRAP_TAG + v::TAG_LEN]);
        let ctx = b[off + at::CTX..off + at::CTX + ctx_len].to_vec();
        Ok((
            Self {
                wrap_type: b[off + at::WRAP_TYPE],
                wrap_flags,
                wrap_aead,
                nonce,
                wrapped_dek,
                tag,
                ctx,
            },
            off + v::WRAP_FIXED_LEN + ctx_len,
        ))
    }
}

/// §5.2 — payload em claro, **sempre 128 bytes**.
///
/// Sem preenchimento, o tamanho do arquivo distinguiria uma semente de 64
/// bytes de um escalar de 32 e denunciaria o tipo de carteira. Custa 27 bytes e
/// fecha um canal de metadado de graca.
pub struct Payload {
    pub secret_kind: u8,
    pub curve: u8,
    pub deriv_scheme: u8,
    pub path_len: u8,
    pub path: [u32; v::PATH_LEVELS_MAX],
    /// No heap pelo mesmo motivo dos tipos de `tz_keys::secret`: mover a
    /// struct nao pode deixar uma copia do segredo para tras.
    secret: Box<[u8; 64]>,
}

impl Drop for Payload {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}

impl Payload {
    pub fn new(
        secret_kind: u8,
        curve: u8,
        deriv_scheme: u8,
        path: &[u32],
        secret: &[u8],
    ) -> Result<Self> {
        if path.len() > v::PATH_LEVELS_MAX || secret.len() > 64 {
            return Err(VaultError::PayloadMalformed);
        }
        if Self::secret_len_of(secret_kind)? != secret.len() {
            return Err(VaultError::PayloadMalformed);
        }
        let mut p = [0u32; v::PATH_LEVELS_MAX];
        p[..path.len()].copy_from_slice(path);
        let mut s = Box::new([0u8; 64]);
        s[..secret.len()].copy_from_slice(secret);
        Ok(Self {
            secret_kind,
            curve,
            deriv_scheme,
            path_len: path.len() as u8,
            path: p,
            secret: s,
        })
    }

    fn secret_len_of(kind: u8) -> Result<usize> {
        match kind {
            v::SECRET_KIND_BIP39_SEED => Ok(64),
            v::SECRET_KIND_ED25519_SCALAR | v::SECRET_KIND_SECP256K1 | v::SECRET_KIND_P256 => {
                Ok(32)
            }
            _ => Err(VaultError::PayloadMalformed),
        }
    }

    /// O segredo util, com o comprimento do `secret_kind`.
    pub fn secret(&self) -> &[u8] {
        match Self::secret_len_of(self.secret_kind) {
            Ok(n) => &self.secret[..n],
            // Inalcancavel por construcao — `new` e `parse` validam o kind —,
            // mas §3 item 9 proibe `panic` no caminho da chave, entao a saida
            // e um segredo vazio e nao um crash.
            Err(_) => &[],
        }
    }

    pub fn path(&self) -> &[u32] {
        &self.path[..self.path_len as usize]
    }

    pub fn to_bytes(&self) -> [u8; v::PAYLOAD_LEN] {
        use v::payload_at as at;
        let mut b = [0u8; v::PAYLOAD_LEN];
        b[at::PAYLOAD_VERSION] = v::PAYLOAD_VERSION;
        b[at::SECRET_KIND] = self.secret_kind;
        b[at::CURVE] = self.curve;
        b[at::DERIV_SCHEME] = self.deriv_scheme;
        b[at::PATH_LEN] = self.path_len;
        for (i, lvl) in self.path.iter().enumerate() {
            b[at::PATH + i * 4..at::PATH + i * 4 + 4].copy_from_slice(&lvl.to_le_bytes());
        }
        b[at::SECRET..at::SECRET + 64].copy_from_slice(self.secret.as_slice());
        b
    }

    pub fn parse(b: &[u8]) -> Result<Self> {
        use v::payload_at as at;
        if b.len() != v::PAYLOAD_LEN || b[at::PAYLOAD_VERSION] != v::PAYLOAD_VERSION {
            return Err(VaultError::PayloadMalformed);
        }
        let path_len = b[at::PATH_LEN];
        if path_len as usize > v::PATH_LEVELS_MAX {
            return Err(VaultError::PayloadMalformed);
        }
        let secret_len = Self::secret_len_of(b[at::SECRET_KIND])?;
        // §5.2 — bytes nao usados = 0, conferidos. Sem isso o preenchimento
        // vira canal para dado arbitrario passar pelo AEAD sem ninguem olhar.
        if b[at::PAD..].iter().any(|&x| x != 0) {
            return Err(VaultError::PayloadMalformed);
        }
        if b[at::SECRET + secret_len..at::PAD].iter().any(|&x| x != 0) {
            return Err(VaultError::PayloadMalformed);
        }
        let mut path = [0u32; v::PATH_LEVELS_MAX];
        for (i, lvl) in path.iter_mut().enumerate() {
            *lvl = le32(b, at::PATH + i * 4);
        }
        // Niveis nao usados = 0 (§5.2).
        if path[path_len as usize..].iter().any(|&x| x != 0) {
            return Err(VaultError::PayloadMalformed);
        }
        let mut secret = Box::new([0u8; 64]);
        secret.copy_from_slice(&b[at::SECRET..at::SECRET + 64]);
        Ok(Self {
            secret_kind: b[at::SECRET_KIND],
            curve: b[at::CURVE],
            deriv_scheme: b[at::DERIV_SCHEME],
            path_len,
            path,
            secret,
        })
    }
}

/// O arquivo inteiro, ja parseado e estruturalmente validado.
pub struct VaultFile {
    pub header: Header,
    pub wraps: Vec<Wrap>,
    pub body_nonce: NonceField,
    /// `ciphertext ‖ tag`.
    pub body: Vec<u8>,
}

impl VaultFile {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = self.header.to_bytes().to_vec();
        for w in &self.wraps {
            out.extend_from_slice(&w.to_bytes());
        }
        out.extend_from_slice(&self.body_nonce.0);
        let ct_len = (self.body.len() - v::TAG_LEN) as u32;
        out.extend_from_slice(&ct_len.to_le_bytes());
        out.extend_from_slice(&self.body);
        out
    }

    /// Apendice A, passo (1). Nenhum KDF roda aqui.
    pub fn parse(b: &[u8]) -> Result<Self> {
        let header = Header::parse(b)?;
        let mut off = v::HEADER_LEN;
        let mut wraps = Vec::with_capacity(header.wrap_count as usize);
        for _ in 0..header.wrap_count {
            let (w, next) = Wrap::parse(b, off)?;
            wraps.push(w);
            off = next;
        }
        if b.len() < off + v::NONCE_FIELD_LEN + 4 {
            return Err(VaultError::Malformed);
        }
        let mut campo = [0u8; v::NONCE_FIELD_LEN];
        campo.copy_from_slice(&b[off..off + v::NONCE_FIELD_LEN]);
        let body_nonce = NonceField::validated(header.body_aead, campo)?;
        let body_len = le32(b, off + v::NONCE_FIELD_LEN) as usize;
        off += v::NONCE_FIELD_LEN + 4;
        // Teto: sem isto um `body_len` gigante vira alocacao ilimitada, e o
        // fuzzing da §9.5 encontra em segundos.
        if body_len != v::PAYLOAD_LEN || b.len() < off + body_len + v::TAG_LEN {
            return Err(VaultError::Malformed);
        }
        Ok(Self {
            header,
            wraps,
            body_nonce,
            body: b[off..off + body_len + v::TAG_LEN].to_vec(),
        })
    }

    /// `aad` do corpo = cabecalho ‖ **tabela de embrulhos inteira**.
    pub fn body_aad(&self) -> Vec<u8> {
        let mut a = self.header.to_bytes().to_vec();
        for w in &self.wraps {
            a.extend_from_slice(&w.to_bytes());
        }
        a
    }

    pub fn wrap_of(&self, wrap_type: u8) -> Result<&Wrap> {
        self.wraps
            .iter()
            .find(|w| w.wrap_type == wrap_type)
            .ok_or(VaultError::NoSuchWrap)
    }
}
