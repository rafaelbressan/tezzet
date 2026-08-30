//! §9.7 e P3.c — **o caminho de erro, auditado com uma operacao deliberadamente
//! falha.**
//!
//! *"Caminho de erro e de log auditados, com uma operacao deliberadamente
//! falha mostrando o que chega a camada de UI."*
//!
//! O que este teste procura ativamente: bytes do segredo, a senha tentada, a
//! senha do cofre, `edsk`, e ate a **geometria** (`64`, `32`) — que serviria de
//! oraculo sobre o tipo de carteira.

use tezos_core::error::{wire_code, CoreError};
use tezos_core::prompt::{Purpose, UserPrompt};
use tezos_core::session::VaultLocation;
use tz_keys::secret::Phrase;

const SENHA_BOA: &str = "correto-Cavalo-Bateria-Grampo-2026!";
const SENHA_ERRADA: &str = "errada-Cavalo-Bateria-Grampo-2026!";

struct PromptCom(&'static str);

impl UserPrompt for PromptCom {
    fn passphrase(&self, _p: Purpose) -> tezos_core::Result<Phrase> {
        Phrase::new(self.0).ok_or(tz_keys::KeyError::MnemonicWordCount.into())
    }
    fn verify_user(&self, _p: Purpose) -> tezos_core::Result<()> {
        Ok(())
    }
}

struct PromptQueNega;

impl UserPrompt for PromptQueNega {
    fn passphrase(&self, _p: Purpose) -> tezos_core::Result<Phrase> {
        Err(CoreError::UserVerificationFailed)
    }
    fn verify_user(&self, _p: Purpose) -> tezos_core::Result<()> {
        Err(CoreError::UserVerificationFailed)
    }
}

fn tempdir(nome: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("tezos-core-{nome}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).expect("temp dir");
    d
}

/// A operacao deliberadamente falha: abrir o cofre com a senha errada.
#[test]
fn a_senha_errada_nao_vaza_nada() {
    let dir = tempdir("erro");
    let cofre = dir.join("carteira.vault");
    let loc = VaultLocation {
        path: &cofre,
        hardware: None,
    };

    let (sessao, frase) =
        tezos_core::create_wallet(&loc, &PromptCom(SENHA_BOA), None).expect("criar");
    let endereco = sessao.identity().address.clone();
    let palavras = frase.expose().to_string();
    drop(frase);
    drop(sessao);

    let erro = match tezos_core::unlock(&loc, &PromptCom(SENHA_ERRADA)) {
        Err(e) => e,
        Ok(_) => panic!("o cofre abriu com a senha errada"),
    };

    let debug = format!("{erro:?}");
    let display = erro.to_string();
    let fio = wire_code(&erro);
    println!("Debug   = {debug}");
    println!("Display = {display}");
    println!("wire    = {fio}");

    // Nada do que e segredo pode aparecer em nenhuma das tres saidas.
    for saida in [&debug, &display, &fio.to_string()] {
        for proibido in [SENHA_BOA, SENHA_ERRADA, "edsk", "spsk", "p2sk", &palavras] {
            assert!(
                !saida.to_lowercase().contains(&proibido.to_lowercase()),
                "o caminho de erro vazou {proibido:?} em {saida:?}"
            );
        }
        // Geometria: `64` e `32` diriam se o cofre guarda semente ou escalar.
        for oraculo in ["64", "32", "128"] {
            assert!(
                !saida.contains(oraculo),
                "o erro vazou a geometria {oraculo} em {saida:?}"
            );
        }
        // E nem sequer o endereco, que e publico: um erro que muda de texto
        // conforme a carteira e um erro que vira canal.
        assert!(!saida.contains(&endereco));
    }

    assert_eq!(fio, "VAULT_CANNOT_OPEN");
    let _ = std::fs::remove_dir_all(&dir);
}

/// §9.5 — senha errada e arquivo adulterado chegam a UI **iguais**. Se
/// diferissem, a diferenca seria o oraculo.
#[test]
fn senha_errada_e_arquivo_adulterado_chegam_iguais_a_ui() {
    let dir = tempdir("oraculo");
    let cofre = dir.join("carteira.vault");
    let loc = VaultLocation {
        path: &cofre,
        hardware: None,
    };
    let (s, f) = tezos_core::create_wallet(&loc, &PromptCom(SENHA_BOA), None).expect("criar");
    drop(f);
    drop(s);

    let senha_errada = match tezos_core::unlock(&loc, &PromptCom(SENHA_ERRADA)) {
        Err(e) => e,
        Ok(_) => panic!("abriu com a senha errada"),
    };

    let mut bytes = std::fs::read(&cofre).expect("ler");
    let ultimo = bytes.len() - 1;
    bytes[ultimo] ^= 0x01;
    std::fs::write(&cofre, &bytes).expect("gravar");
    let adulterado = match tezos_core::unlock(&loc, &PromptCom(SENHA_BOA)) {
        Err(e) => e,
        Ok(_) => panic!("abriu com o arquivo adulterado"),
    };

    assert_eq!(senha_errada, adulterado, "as variantes diferem");
    assert_eq!(format!("{senha_errada:?}"), format!("{adulterado:?}"));
    assert_eq!(senha_errada.to_string(), adulterado.to_string());
    assert_eq!(wire_code(&senha_errada), wire_code(&adulterado));
    let _ = std::fs::remove_dir_all(&dir);
}

/// §8.1 — **ausencia de mecanismo nao e permissao.** Um prompt que nega faz a
/// assinatura falhar; nao existe caminho que caia em silencio.
#[test]
fn assinar_sem_verificacao_de_usuario_falha() {
    let dir = tempdir("verificacao");
    let cofre = dir.join("carteira.vault");
    let loc = VaultLocation {
        path: &cofre,
        hardware: None,
    };
    let (mut sessao, f) =
        tezos_core::create_wallet(&loc, &PromptCom(SENHA_BOA), None).expect("criar");
    drop(f);

    let op = tz_keys::sign::ForgedOperation::from_locally_forged(vec![0xaa, 0xbb]);
    let erro = match sessao.sign(
        tz_keys::sign::Watermark::GenericOperation,
        &op,
        &PromptQueNega,
    ) {
        Err(e) => e,
        Ok(_) => panic!("assinou sem verificacao de usuario"),
    };
    assert_eq!(erro, CoreError::UserVerificationFailed);
    assert_eq!(wire_code(&erro), "USER_VERIFICATION_FAILED");

    // E com verificacao, assina.
    assert!(sessao
        .sign(
            tz_keys::sign::Watermark::GenericOperation,
            &op,
            &PromptCom(SENHA_BOA)
        )
        .is_ok());
    let _ = std::fs::remove_dir_all(&dir);
}

/// §5.9 — depois de trancar, assinar falha, e a identidade publica continua.
#[test]
fn depois_de_trancar_nao_se_assina() {
    let dir = tempdir("trancado");
    let cofre = dir.join("carteira.vault");
    let loc = VaultLocation {
        path: &cofre,
        hardware: None,
    };
    let (mut sessao, f) =
        tezos_core::create_wallet(&loc, &PromptCom(SENHA_BOA), None).expect("criar");
    drop(f);
    let endereco = sessao.identity().address.clone();
    sessao.lock();

    let op = tz_keys::sign::ForgedOperation::from_locally_forged(vec![0xaa]);
    let erro = match sessao.sign(
        tz_keys::sign::Watermark::GenericOperation,
        &op,
        &PromptCom(SENHA_BOA),
    ) {
        Err(e) => e,
        Ok(_) => panic!("assinou com a carteira trancada"),
    };
    assert_eq!(erro, CoreError::SessionLocked);
    assert_eq!(sessao.identity().address, endereco);
    let _ = std::fs::remove_dir_all(&dir);
}

/// §2.3 — senha fraca nao cria cofre. Sem "pular por enquanto".
#[test]
fn senha_fraca_nao_cria_cofre() {
    let dir = tempdir("fraca");
    let cofre = dir.join("carteira.vault");
    let loc = VaultLocation {
        path: &cofre,
        hardware: None,
    };
    let erro = match tezos_core::create_wallet(&loc, &PromptCom("hunter2"), None) {
        Err(e) => e,
        Ok(_) => panic!("criou carteira com senha fraca"),
    };
    assert_eq!(wire_code(&erro), "PASSPHRASE_TOO_WEAK");
    assert!(!cofre.exists(), "gravou o cofre antes de validar a senha");
    let _ = std::fs::remove_dir_all(&dir);
}

/// §4.2 — importar com checksum invalido **falha**, e falha com o erro certo.
#[test]
fn importacao_com_checksum_invalido_falha() {
    let dir = tempdir("import");
    let cofre = dir.join("carteira.vault");
    let loc = VaultLocation {
        path: &cofre,
        hardware: None,
    };
    let ruim = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon";
    let erro = match tezos_core::import_wallet(&loc, ruim, "", &PromptCom(SENHA_BOA), None) {
        Err(e) => e,
        Ok(_) => panic!("importou uma frase com checksum invalido"),
    };
    assert_eq!(erro, CoreError::Key(tz_keys::KeyError::MnemonicChecksum));
    assert!(!cofre.exists());

    // E a boa importa, e da a mesma carteira do vetor cruzado com o Taquito.
    let boa = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
    let sessao =
        tezos_core::import_wallet(&loc, boa, "", &PromptCom(SENHA_BOA), None).expect("importar");
    assert_eq!(
        sessao.identity().address,
        "tz1YegD188fgGzXotMUQMcM4UFCyNAvHtw6p"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// O tamanho do erro fixa que ele nao carrega dado: `CoreError` embrulha dois
/// enums fechados **sem payload**.
#[test]
fn o_erro_nao_carrega_dado() {
    assert!(
        std::mem::size_of::<CoreError>() <= 2,
        "CoreError cresceu para {} bytes — alguma variante ganhou payload",
        std::mem::size_of::<CoreError>()
    );
    assert_eq!(std::mem::size_of::<tz_keys::KeyError>(), 1);
    // `VaultError::Key(KeyError)` embrulha outro enum de 1 byte; o niching do
    // compilador cabe tudo em 1. Se algum dia virar 2, ainda esta certo — o que
    // nao pode e crescer para o tamanho de um ponteiro, que e o sinal de que
    // alguem colocou uma `String` la dentro.
    assert!(std::mem::size_of::<tz_vault::VaultError>() <= 2);
}
