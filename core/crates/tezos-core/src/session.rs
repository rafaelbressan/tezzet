//! §5.9 e §8 — o ciclo de vida da carteira e da sessao aberta.
//!
//! # O que a sessao aberta guarda, e o que ela nao guarda
//!
//! **Guarda:** a DEK (32 B) e o escalar da chave (32 B). E so.
//!
//! **Nao guarda:** a passphrase, a `KEK_pass`, a mnemonica, nem a semente de
//! 64 bytes depois da derivacao. Essa regra sozinha elimina a classe inteira de
//! "duas copias da mnemonica na RAM a cada unlock" que o spike BRES-36
//! encontrou — e e ela que o portao da §9.6 verifica, nas duas fases.
//!
//! # Quando ela fecha
//!
//! Bloqueio manual, *timeout* de inatividade (padrao 5 minutos, configuravel
//! entre 1 e 30), suspensao do sistema, o app ir para segundo plano no Android,
//! e encerramento do processo. Os tres ultimos sao eventos do produto: ele
//! chama [`Session::lock`]. Os dois primeiros estao aqui.
//!
//! # O que este modulo garante
//! - Que a mnemonica **so existe na criacao e na importacao**. Destravar
//!   devolve escalar, nunca palavras: [`unlock`] nao tem como reconstrui-la,
//!   porque o cofre guarda a semente e a semente e zerada depois da derivacao.
//! - Que assinar exige verificacao de usuario nativa, sem fallback silencioso.
//! - Que [`Session::lock`] zera de verdade — e o portao da §9.6 fase 2 mede
//!   isso na memoria do processo, nao no codigo.
//!
//! # O que ele nao garante
//! - Que nao sobrou copia em RAM (§7.3). Nao existe essa prova.
//! - Nada contra malware ativo com o cofre aberto (N1). O teto de seguranca de
//!   qualquer carteira em software e esse, e o que passa do teto e assinador em
//!   hardware.

use crate::error::{CoreError, Result};
use crate::prompt::{Purpose, UserPrompt};
use tz_keys::address::Address;
use tz_keys::derive::{self, Curve};
use tz_keys::mnemonic::Mnemonic;
use tz_keys::secret::{Entropy, Phrase, Scalar, Seed};
use tz_keys::sign::{ForgedOperation, PublicKey, SecretKey, Signature, Watermark};
use tz_params::vault as pv;
use tz_vault::format::{Payload, VaultFile};
use tz_vault::hw::Hardware;
use tz_vault::kdf::Profile;
use tz_vault::policy;
use tz_vault::vault::{self, Dek, Wraps};

/// O que o produto pode mostrar sem destravar nada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicIdentity {
    pub address: String,
    pub public_key: String,
}

/// Uma carteira destravada.
///
/// Nao deriva `Clone`, `Debug` nem serializacao: ela carrega dois segredos.
pub struct Session {
    dek: Option<Dek>,
    key: Option<SecretKey>,
    identity: PublicIdentity,
    idle_timeout_secs: u64,
    last_activity: std::time::Instant,
}

impl Session {
    /// §5.9 — o que a sessao mostra sem destravar nada.
    pub fn identity(&self) -> &PublicIdentity {
        &self.identity
    }

    /// Acesso mutavel a identidade publica.
    ///
    /// Existe porque o produto pode querer reetiquetar a conta; **e publico por
    /// natureza**. Um mutante do arnes usa este ponto para tentar colar a
    /// mnemonica na identidade, e o portao da §9.6 fica vermelho — que e a
    /// prova de que o portao pega esse defeito.
    pub fn identity_mut(&mut self) -> &mut PublicIdentity {
        &mut self.identity
    }

    pub fn is_locked(&self) -> bool {
        self.key.is_none()
    }

    /// §5.9 — *timeout* de inatividade. Padrao 5 minutos.
    pub fn set_idle_timeout_secs(&mut self, secs: u64) {
        self.idle_timeout_secs = secs.clamp(
            tz_params::session::IDLE_TIMEOUT_SECS_MIN,
            tz_params::session::IDLE_TIMEOUT_SECS_MAX,
        );
    }

    pub fn expired(&self) -> bool {
        self.last_activity.elapsed().as_secs() >= self.idle_timeout_secs
    }

    /// Zera a DEK e o escalar. Chamado no bloqueio manual, no *timeout*, na
    /// suspensao e quando o app vai para segundo plano.
    ///
    /// Depois disto a identidade publica continua disponivel — e ela **deve**
    /// continuar: o produto mostra o endereco com a carteira trancada, e o
    /// portao da §9.6 fase 2 conta com isso como controle positivo.
    pub fn lock(&mut self) {
        // `Drop` de `Dek` e de `Scalar` zera o buffer.
        self.dek = None;
        self.key = None;
    }

    /// **A funcao de assinar.**
    ///
    /// Ordem, e ela e normativa (Apendice A): watermark aceito → verificacao de
    /// usuario nativa → digest → assinatura. Nao existe caminho que pule o
    /// segundo passo, e nao existe fallback silencioso quando a plataforma nao
    /// tem mecanismo.
    pub fn sign(
        &mut self,
        watermark: Watermark,
        op: &ForgedOperation,
        prompt: &dyn UserPrompt,
    ) -> Result<Signature> {
        if self.expired() {
            self.lock();
        }
        let key = self.key.as_ref().ok_or(CoreError::SessionLocked)?;
        // §8.1 — sem `if (biometria_disponivel)`. Recusa e recusa.
        prompt.verify_user(Purpose::SignOperation)?;
        let sig = key.sign(watermark, op)?;
        self.last_activity = std::time::Instant::now();
        Ok(sig)
    }

    /// Existe **so** para o portao de memoria da §9.6, que precisa procurar os
    /// bytes exatos que a sessao aberta guarda.
    ///
    /// Fica atras da feature `memscan-gate`, que o CI liga e o build de
    /// producto nunca liga — `tests/portoes_de_codigo.rs` reprova se ela
    /// aparecer numa dependencia de producao.
    #[doc(hidden)]
    #[cfg(feature = "memscan-gate")]
    pub fn secret_material(&self) -> Option<(&[u8; 32], &[u8; 32])> {
        Some((
            self.dek.as_ref()?.expose(),
            self.key.as_ref()?.scalar_bytes()?,
        ))
    }
}

/// Onde o cofre vive e como esta plataforma o protege.
pub struct VaultLocation<'a> {
    pub path: &'a std::path::Path,
    /// §6.1 — no Linux e `None` na v1: nao ha equivalente ao Keystore, e nao se
    /// inventa historia de biometria para Linux.
    pub hardware: Option<Hardware<'a>>,
}

/// Cria uma carteira nova e devolve a mnemonica **uma unica vez**, para a
/// cerimonia de backup.
///
/// Depois que quem chamou soltar a [`Phrase`], ela nao existe mais em lugar
/// nenhum: o cofre guarda a **semente**, e destravar devolve o escalar.
///
/// A passphrase e coletada por prompt nativo (§8.2) — ela nao e parametro
/// desta funcao, e essa ausencia e verificavel na assinatura.
pub fn create_wallet(
    loc: &VaultLocation<'_>,
    prompt: &dyn UserPrompt,
    product_entropy_estimate_bits: Option<f64>,
) -> Result<(Session, Phrase)> {
    // §4.1 — 256 bits do CSPRNG do sistema. Se ele falhar, aborta.
    let bytes: [u8; 32] = tz_rng::bytes()?;
    let entropy = Entropy::new(&bytes).ok_or(tz_keys::KeyError::EntropyLength)?;
    let mnemonic = Mnemonic::from_entropy(&entropy)?;
    let seed = mnemonic.to_seed("")?;

    let passphrase = prompt.passphrase(Purpose::CreateWallet)?;
    policy::accept_passphrase(passphrase.expose(), product_entropy_estimate_bits)?;

    let session = write_new_vault(loc, passphrase.expose().as_bytes(), &seed)?;
    // A frase sai daqui **uma vez**, para a cerimonia de backup. `Phrase::new`
    // copia para outro buffer fixo e a `Mnemonic` zera o dela no `Drop`.
    let frase =
        Phrase::new(mnemonic.phrase().expose()).ok_or(tz_keys::KeyError::MnemonicWordCount)?;
    Ok((session, frase))
}

/// Importa uma carteira existente. **Aqui e onde a validacao decide tudo**: a
/// frase passa por wordlist e checksum antes de virar carteira (§4.2).
///
/// `bip39_passphrase` e a "25a palavra": aceita na importacao porque carteira
/// alheia a usa, e **nao** oferecida na criacao.
pub fn import_wallet(
    loc: &VaultLocation<'_>,
    phrase: &str,
    bip39_passphrase: &str,
    prompt: &dyn UserPrompt,
    product_entropy_estimate_bits: Option<f64>,
) -> Result<Session> {
    let mnemonic = Mnemonic::parse(phrase)?;
    let seed = mnemonic.to_seed(bip39_passphrase)?;
    let passphrase = prompt.passphrase(Purpose::CreateWallet)?;
    policy::accept_passphrase(passphrase.expose(), product_entropy_estimate_bits)?;
    write_new_vault(loc, passphrase.expose().as_bytes(), &seed)
}

fn write_new_vault(loc: &VaultLocation<'_>, passphrase: &[u8], seed: &Seed) -> Result<Session> {
    let payload = Payload::new(
        pv::SECRET_KIND_BIP39_SEED,
        pv::CURVE_ED25519,
        pv::DERIV_SLIP10_HARDENED,
        &tz_params::derivation::TEZOS_PATH,
        seed.expose(),
    )?;
    let wraps = Wraps {
        passphrase,
        hardware: clone_hw(&loc.hardware),
    };
    let file = vault::create(Profile::current_platform(), &wraps, &payload)?;
    vault::write_atomic(loc.path, &file)?;
    let (dek, payload) = vault::open_with_passphrase(&file, passphrase)?;
    session_from(dek, &payload)
}

/// §8.3 — destravar. Tenta o embrulho de hardware primeiro; a passphrase e
/// **sempre** o caminho de recuperacao (Apendice A, passo 2).
pub fn unlock(loc: &VaultLocation<'_>, prompt: &dyn UserPrompt) -> Result<Session> {
    vault::check_permissions(loc.path)?;
    let bytes = std::fs::read(loc.path).map_err(|_| tz_vault::VaultError::Io)?;
    let file = VaultFile::parse(&bytes)?;

    if let Some(hw) = &loc.hardware {
        // O prompt nativo esta **dentro** da implementacao de `Hardware`: e o
        // `BiometricPrompt` com `CryptoObject`, nao um booleano antes dele.
        if let Ok((dek, payload)) = vault::open_with_hardware(&file, hw) {
            let s = session_from(dek, &payload)?;
            reencrypt(loc, &file, &payload, prompt)?;
            return Ok(s);
        }
    }

    let passphrase = prompt.passphrase(Purpose::Unlock)?;
    let (dek, payload) = vault::open_with_passphrase(&file, passphrase.expose().as_bytes())?;
    let s = session_from(dek, &payload)?;
    // §5.7 — sem perguntar, sem tela de "atualize seu cofre".
    let wraps = Wraps {
        passphrase: passphrase.expose().as_bytes(),
        hardware: clone_hw(&loc.hardware),
    };
    vault::reencrypt_if_outdated(loc.path, &file, &wraps, &payload)?;
    Ok(s)
}

/// A reencriptacao pelo caminho de hardware precisa da passphrase para
/// reconstruir o embrulho (A), que **sempre** existe. Ela e pedida so quando
/// ha o que regravar — perguntar sem necessidade treina o usuario a digitar a
/// senha sem olhar.
fn reencrypt(
    loc: &VaultLocation<'_>,
    file: &VaultFile,
    payload: &Payload,
    prompt: &dyn UserPrompt,
) -> Result<()> {
    let atual = Profile::from_id(file.header.profile_id)?;
    if atual >= Profile::current_platform() {
        return Ok(());
    }
    let passphrase = prompt.passphrase(Purpose::RotatePassphrase)?;
    let wraps = Wraps {
        passphrase: passphrase.expose().as_bytes(),
        hardware: clone_hw(&loc.hardware),
    };
    vault::reencrypt_if_outdated(loc.path, file, &wraps, payload)?;
    Ok(())
}

fn clone_hw<'a>(hw: &Option<Hardware<'a>>) -> Option<Hardware<'a>> {
    match hw {
        Some(Hardware::Kek(h)) => Some(Hardware::Kek(*h)),
        Some(Hardware::Sealer(h)) => Some(Hardware::Sealer(*h)),
        None => None,
    }
}

/// Deriva a partir do payload e **zera a semente** antes de devolver: a §5.9
/// diz que a sessao aberta nao guarda a semente de 64 bytes depois da
/// derivacao, e e aqui que isso acontece.
fn session_from(dek: Dek, payload: &Payload) -> Result<Session> {
    let key = match payload.secret_kind {
        pv::SECRET_KIND_BIP39_SEED => {
            // A semente nasce **dentro** do tipo: nenhum array em claro passa
            // pela pilha, e mover `Seed` copia so o ponteiro.
            let mut seed = Seed::zeroed();
            seed.expose_mut().copy_from_slice(payload.secret());
            let no = derive::derive(Curve::Ed25519, &seed, payload.path())?;
            // `no.scalar` e **movido**, nao copiado. Um `*expose()` aqui
            // criaria um `[u8; 32]` em claro na pilha que ninguem zera — e foi
            // exatamente isso que o portao da §9.6 pegou.
            SecretKey::from_scalar(Curve::Ed25519, no.scalar)?
        }
        outro => {
            let curve = match outro {
                pv::SECRET_KIND_ED25519_SCALAR => Curve::Ed25519,
                pv::SECRET_KIND_SECP256K1 => Curve::Secp256k1,
                pv::SECRET_KIND_P256 => Curve::NistP256,
                _ => return Err(tz_vault::VaultError::PayloadMalformed.into()),
            };
            let mut escalar = Scalar::zeroed();
            escalar.expose_mut().copy_from_slice(payload.secret());
            SecretKey::from_scalar(curve, escalar)?
        }
    };
    let pk = key.public_key()?;
    let identity = PublicIdentity {
        address: pk.address().as_str().to_owned(),
        public_key: pk.to_base58(),
    };
    Ok(Session {
        dek: Some(dek),
        key: Some(key),
        identity,
        idle_timeout_secs: tz_params::session::IDLE_TIMEOUT_SECS_DEFAULT,
        last_activity: std::time::Instant::now(),
    })
}

/// A chave publica derivada de um escalar, sem sessao. Util para o produto
/// conferir um endereco que ele guardou.
pub fn public_from(curve: Curve, scalar: Scalar) -> Result<(Address, PublicKey)> {
    let sk = SecretKey::from_scalar(curve, scalar)?;
    let pk = sk.public_key()?;
    Ok((pk.address(), pk))
}
