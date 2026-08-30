//! Fixture do portao da §9.6: **um processo separado** cria o cofre e morre
//! com a mnemonica.
//!
//! Isto nao e conveniencia de teste. O BRES-36 mostrou que um processo nao
//! consegue esquecer o que a `bip39` copiou durante a geracao: a crate monta a
//! frase numa `String` que nao controlamos, e zerar o buffer dela e o melhor
//! que da para fazer sem reimplementar a crate. Enquanto isso for verdade, a
//! unica forma **honesta** de testar a §7.1.4 e a de producao: o app e morto e
//! reaberto, e o processo que destrava nunca viu a mnemonica.
//!
//! Ele imprime tambem, **em hexadecimal**, o material que o portao precisa
//! procurar em **bytes crus**: a semente, a `KEK_pass` e o payload em claro. O
//! processo que varre decodifica o hexadecimal, mascara e zera — assim ele
//! nunca precisa recalcular nada, e portanto nao deixa residuo proprio que
//! seria confundido com vazamento do produto.
//!
//! Uso: `cria_cofre <caminho-do-cofre>`. Cinco linhas, nesta ordem:
//! endereco, chave publica, semente (hex), `KEK_pass` (hex), payload (hex).

use tezos_core::prompt::{Purpose, UserPrompt};
use tezos_core::session::VaultLocation;
use tezos_core::Result;
use tz_keys::secret::Phrase;
use tz_params::vault as pv;
use tz_vault::format::VaultFile;
use tz_vault::kdf::{self, Profile};

/// A mesma senha do teste. Passa o piso de 60 bits e **nao** e uma sequencia
/// da wordlist BIP-39 — senao o item 1 da §9.6 confundiria a senha com a
/// mnemonica, e o portao acusaria a si mesmo.
pub const SENHA: &str = "correto-Cavalo-Bateria-Grampo-2026!";

struct PromptFixo;

impl UserPrompt for PromptFixo {
    fn passphrase(&self, _p: Purpose) -> Result<Phrase> {
        Phrase::new(SENHA).ok_or(tz_keys::KeyError::MnemonicWordCount.into())
    }
    fn verify_user(&self, _p: Purpose) -> Result<()> {
        Ok(())
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn main() {
    let caminho: std::path::PathBuf = match std::env::args().nth(1) {
        Some(a) => a.into(),
        None => {
            eprintln!("uso: cria_cofre <caminho>");
            std::process::exit(2);
        }
    };
    let loc = VaultLocation {
        path: &caminho,
        hardware: None,
    };
    let (sessao, frase) = match tezos_core::create_wallet(&loc, &PromptFixo, None) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("falhou: {e}");
            std::process::exit(1);
        }
    };
    // A frase existe aqui, na cerimonia de backup, e morre com este processo.
    // Ela nunca atravessa para quem chamou.
    if frase.word_count() != 24 {
        eprintln!("mnemonica com {} palavras", frase.word_count());
        std::process::exit(1);
    }

    let bytes = std::fs::read(&caminho).unwrap_or_default();
    let arquivo = match VaultFile::parse(&bytes) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("cofre recem-gravado nao parseia: {e}");
            std::process::exit(1);
        }
    };
    let perfil = Profile::current_platform();
    let (m, t, p) = perfil.params();
    let kek =
        match kdf::kek_from_passphrase(perfil, m, t, p, SENHA.as_bytes(), &arquivo.header.salt) {
            Ok(k) => k,
            Err(e) => {
                eprintln!("kek: {e}");
                std::process::exit(1);
            }
        };
    let (_dek, payload) = match tz_vault::vault::open_with_passphrase(&arquivo, SENHA.as_bytes()) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("abrir: {e}");
            std::process::exit(1);
        }
    };
    let payload_bytes = payload.to_bytes();
    let semente = payload.secret().to_vec();
    let _ = pv::SECRET_KIND_BIP39_SEED;

    println!("{}", sessao.identity().address);
    println!("{}", sessao.identity().public_key);
    println!("{}", hex(&semente));
    println!("{}", hex(kek.expose()));
    println!("{}", hex(&payload_bytes));
}
