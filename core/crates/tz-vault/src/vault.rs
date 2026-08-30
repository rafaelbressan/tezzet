//! O cofre: criar, gravar, abrir. A ordem das operacoes e a do Apendice A da
//! SPEC-0001, e e a ordem que importa.
//!
//! # O que este modulo garante
//! - **Nenhum oraculo.** Senha errada e arquivo adulterado produzem a mesma
//!   variante de erro e o mesmo texto (§9.5).
//! - **Nada caro antes da validacao estrutural.** Faixa de KDF, ids de AEAD,
//!   bits reservados e preenchimento de nonce recusam **antes** do Argon2id.
//! - **DEK nova, sal novo e nonces novos a cada gravacao** (§4.8). A DEK antiga
//!   nunca e reutilizada, o que limita o alcance de uma DEK exposta em RAM.
//! - **Gravacao atomica** (§5.8): temporario no mesmo diretorio, `fsync`,
//!   `rename`, `fsync` do diretorio. O original nunca e truncado. Um cofre
//!   corrompido **e** fundo perdido.
//! - **Reencriptacao oportunista** (§5.7): abrir um cofre de perfil menor no
//!   desktop regrava com o perfil corrente, na hora, sem perguntar. Nao existe
//!   tela de "atualize seu cofre".
//!
//! # O que ele nao garante
//! - Que a passphrase digitada foi coletada por prompt nativo. Isso e do
//!   produto (§8.2) — o que este modulo garante e que **ele nunca recebe senha
//!   por um comando de fronteira**, porque quem chama e o `tezos-core` no lado
//!   Rust, nunca a webview.
//! - Nada sobre backup. Trocar a passphrase **nao** protege uma copia antiga do
//!   arquivo que ja tenha vazado: aquela copia continua abrindo com a senha
//!   antiga (§4.8).

use crate::aead::{self, Algorithm, NonceField};
use crate::error::{Result, VaultError};
use crate::format::{Header, Payload, VaultFile, Wrap};
use crate::hw::Hardware;
use crate::kdf::{self, Kek, Profile};
use tz_params::vault as v;
use zeroize::Zeroize;

/// A chave que cifra o corpo. 32 bytes, zerada no drop, sem `Clone`, `Debug`
/// ou serializacao.
/// Ver `tz_keys::secret` para o porque do `Box`.
pub struct Dek(Box<[u8; v::DEK_LEN]>);

impl Dek {
    /// DEK nova do CSPRNG do sistema. Se ele falhar, **aborta**: um nonce ou
    /// uma DEK previsiveis quebram o AEAD tao bem quanto uma semente
    /// previsivel quebra a carteira.
    pub fn fresh() -> Result<Self> {
        let mut d = Self(Box::new([0u8; v::DEK_LEN]));
        tz_rng::fill(d.0.as_mut_slice())?;
        Ok(d)
    }

    pub fn expose(&self) -> &[u8; v::DEK_LEN] {
        &self.0
    }

    fn from_slice(b: &[u8]) -> Result<Self> {
        if b.len() != v::DEK_LEN {
            return Err(VaultError::CannotOpen);
        }
        let mut d = Self(Box::new([0u8; v::DEK_LEN]));
        d.0.copy_from_slice(b);
        Ok(d)
    }
}

impl Drop for Dek {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Quais embrulhos este cofre vai ter.
pub struct Wraps<'a> {
    /// §5.1(A) — **sempre presente**. Raiz de recuperacao.
    pub passphrase: &'a [u8],
    /// §5.1(B) — conveniencia. Ausente no Linux na v1 (§6.1).
    pub hardware: Option<Hardware<'a>>,
}

/// Cria o arquivo do cofre em memoria. Grave com [`write_atomic`].
pub fn create(profile: Profile, wraps: &Wraps<'_>, payload: &Payload) -> Result<VaultFile> {
    let (m_kib, t, parallel) = profile.params();
    let salt: [u8; v::KDF_SALT_LEN] = tz_rng::bytes()?;
    let dek = Dek::fresh()?;

    // O cabecalho precisa estar **final** antes de qualquer AAD: ele e AAD de
    // todos os embrulhos e do corpo. Por isso `wrap_count` e calculado aqui e
    // nao ajustado depois.
    let wrap_count = 1 + u8::from(wraps.hardware.is_some());
    let header = Header {
        profile_id: profile.id(),
        // §6.3 — o corpo e XChaCha20-Poly1305 mesmo no Android, porque um
        // aparelho de entrada nao tem AES-NI.
        body_aead: Algorithm::XChaCha20Poly1305,
        wrap_count,
        m_kib,
        t,
        parallel,
        salt,
        created_at: now_secs(),
    };
    let hb = header.to_bytes();

    let mut lista: Vec<Wrap> = Vec::with_capacity(wrap_count as usize);

    // (A) KEK_pass.
    {
        let alg = Algorithm::XChaCha20Poly1305;
        let nonce = NonceField::fresh(alg)?;
        let mut w = Wrap {
            wrap_type: v::WRAP_PASS,
            wrap_flags: 0,
            wrap_aead: alg,
            nonce,
            wrapped_dek: [0u8; v::DEK_LEN],
            tag: [0u8; v::TAG_LEN],
            ctx: Vec::new(),
        };
        let kek = kdf::kek_from_passphrase(profile, m_kib, t, parallel, wraps.passphrase, &salt)?;
        let sealed = aead::seal(alg, kek.expose(), &w.nonce, &w.aad(&hb), dek.expose())?;
        split_into(&sealed, &mut w)?;
        lista.push(w);
    }

    // (B) KEK_hw.
    if let Some(hw) = &wraps.hardware {
        let alg = hw.aead();
        let ctx = hw.ctx();
        let mut w = Wrap {
            wrap_type: v::WRAP_HW,
            wrap_flags: 0,
            wrap_aead: alg,
            nonce: NonceField(([0u8; v::NONCE_FIELD_LEN]).to_owned()),
            wrapped_dek: [0u8; v::DEK_LEN],
            tag: [0u8; v::TAG_LEN],
            ctx,
        };
        match hw {
            Hardware::Kek(h) => {
                // Windows: a KEK vem para o nosso processo, entao o nonce e
                // nosso e a excecao da §5.4 nao vale.
                w.nonce = NonceField::fresh(alg)?;
                let kek = h.unlock(&w.ctx)?;
                let sealed = aead::seal(alg, kek.expose(), &w.nonce, &w.aad(&hb), dek.expose())?;
                split_into(&sealed, &mut w)?;
            }
            Hardware::Sealer(h) => {
                // Android: quem sela e o Keystore, e quem sorteia o IV e ele.
                // A AAD depende do `nonce`? Nao: `Wrap::aad` usa header, tipo,
                // flags, aead_id e ctx — nenhum deles muda com o IV. Por isso a
                // AAD pode ser montada antes de o IV existir.
                let aad = w.aad(&hb);
                let (iv, sealed) = h.seal(&aad, dek.expose())?;
                w.nonce = NonceField::from_platform_iv(alg, &iv)?;
                split_into(&sealed, &mut w)?;
            }
        }
        lista.push(w);
    }

    // Corpo: AAD = cabecalho ‖ tabela de embrulhos inteira.
    let mut aad_corpo = hb.to_vec();
    for w in &lista {
        aad_corpo.extend_from_slice(&w.to_bytes());
    }
    let body_nonce = NonceField::fresh(header.body_aead)?;
    let mut claro = payload.to_bytes();
    let body = aead::seal(
        header.body_aead,
        dek.expose(),
        &body_nonce,
        &aad_corpo,
        &claro,
    )?;
    claro.zeroize();

    Ok(VaultFile {
        header,
        wraps: lista,
        body_nonce,
        body,
    })
}

fn split_into(sealed: &[u8], w: &mut Wrap) -> Result<()> {
    if sealed.len() != v::DEK_LEN + v::TAG_LEN {
        return Err(VaultError::Malformed);
    }
    w.wrapped_dek.copy_from_slice(&sealed[..v::DEK_LEN]);
    w.tag.copy_from_slice(&sealed[v::DEK_LEN..]);
    Ok(())
}

/// Abre pelo embrulho da passphrase. **Sempre disponivel** — e a raiz de
/// recuperacao (§5.1).
pub fn open_with_passphrase(file: &VaultFile, passphrase: &[u8]) -> Result<(Dek, Payload)> {
    let profile = Profile::from_id(file.header.profile_id)?;
    // §5.6 — antes do KDF.
    profile.validate_range(file.header.m_kib, file.header.t, file.header.parallel)?;
    let w = file.wrap_of(v::WRAP_PASS)?;
    let kek = kdf::kek_from_passphrase(
        profile,
        file.header.m_kib,
        file.header.t,
        file.header.parallel,
        passphrase,
        &file.header.salt,
    )?;
    unwrap_and_open(file, w, &kek)
}

/// Abre pelo embrulho de hardware. **E este o caminho que P5 mede.**
///
/// Nao ha "se autenticou, mostra a tela": o desembrulho da DEK depende de o
/// sistema operacional liberar a chave, e negar o prompt faz esta funcao
/// devolver [`VaultError::HardwareKeyRefused`].
pub fn open_with_hardware(file: &VaultFile, hw: &Hardware<'_>) -> Result<(Dek, Payload)> {
    let w = file.wrap_of(v::WRAP_HW)?;
    let hb = file.header.to_bytes();
    match hw {
        Hardware::Kek(h) => {
            let kek = h.unlock(&w.ctx)?;
            unwrap_and_open(file, w, &kek)
        }
        Hardware::Sealer(h) => {
            let kek = h.open(
                &w.aad(&hb),
                w.nonce.used(w.wrap_aead),
                &w.ciphertext_and_tag(),
            )?;
            let dek = Dek::from_slice(kek.expose())?;
            let payload = open_body(file, &dek)?;
            Ok((dek, payload))
        }
    }
}

fn unwrap_and_open(file: &VaultFile, w: &Wrap, kek: &Kek) -> Result<(Dek, Payload)> {
    let hb = file.header.to_bytes();
    let mut claro = aead::open(
        w.wrap_aead,
        kek.expose(),
        &w.nonce,
        &w.aad(&hb),
        &w.ciphertext_and_tag(),
    )?;
    let dek = Dek::from_slice(&claro)?;
    claro.zeroize();
    let payload = open_body(file, &dek)?;
    Ok((dek, payload))
}

fn open_body(file: &VaultFile, dek: &Dek) -> Result<Payload> {
    let mut claro = aead::open(
        file.header.body_aead,
        dek.expose(),
        &file.body_nonce,
        &file.body_aad(),
        &file.body,
    )?;
    let payload = Payload::parse(&claro);
    claro.zeroize();
    payload
}

/// §5.7 — reencriptacao oportunista. Devolve `true` quando regravou.
///
/// Sem perguntar, sem migracao manual, sem tela de "atualize seu cofre". Subir
/// os parametros no futuro passa a ser trocar uma constante em `tz-params`.
pub fn reencrypt_if_outdated(
    path: &std::path::Path,
    file: &VaultFile,
    wraps: &Wraps<'_>,
    payload: &Payload,
) -> Result<bool> {
    let atual = Profile::from_id(file.header.profile_id)?;
    let corrente = Profile::current_platform();
    if atual >= corrente {
        return Ok(false);
    }
    let novo = create(corrente, wraps, payload)?;
    write_atomic(path, &novo)?;
    Ok(true)
}

/// §5.8 — gravacao atomica. **Nunca** trunca o arquivo original.
pub fn write_atomic(path: &std::path::Path, file: &VaultFile) -> Result<()> {
    use std::io::Write;
    let dir = path.parent().ok_or(VaultError::Io)?;
    let nome = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or(VaultError::Io)?;
    // Mesmo diretorio: `rename` so e atomico dentro do mesmo sistema de
    // arquivos.
    let tmp = dir.join(format!(".{nome}.tmp"));
    {
        let mut f = std::fs::File::create(&tmp).map_err(|_| VaultError::Io)?;
        set_owner_only(&f)?;
        f.write_all(&file.to_bytes()).map_err(|_| VaultError::Io)?;
        f.sync_all().map_err(|_| VaultError::Io)?;
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        let _ = e;
        VaultError::Io
    })?;
    // `fsync` do diretorio: sem isto o `rename` pode nao sobreviver a uma
    // queda de energia, mesmo com o arquivo novo integro.
    if let Ok(d) = std::fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

/// §6.1 e §6.2 — permissao de dono. `0600` no Unix.
#[cfg(unix)]
fn set_owner_only(f: &std::fs::File) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    f.set_permissions(std::fs::Permissions::from_mode(0o600))
        .map_err(|_| VaultError::Io)
}

#[cfg(not(unix))]
fn set_owner_only(_f: &std::fs::File) -> Result<()> {
    // Windows: a ACL so-dono e aplicada pelo instalador no diretorio
    // `%LOCALAPPDATA%\TezosSuite\vault`, com heranca desabilitada (§6.2). Um
    // `set_permissions` aqui nao expressa ACL, e fingir que expressa seria o
    // item 7 do anti-catalogo.
    Ok(())
}

/// §6.1 — na abertura, recusa se a permissao estiver mais frouxa que `0600`.
#[cfg(unix)]
pub fn check_permissions(path: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let md = std::fs::metadata(path).map_err(|_| VaultError::Io)?;
    if md.permissions().mode() & 0o077 != 0 {
        return Err(VaultError::Io);
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn check_permissions(_path: &std::path::Path) -> Result<()> {
    Ok(())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
