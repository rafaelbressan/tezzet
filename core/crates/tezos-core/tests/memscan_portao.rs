//! §9.6 — **o portao de memoria, nas duas fases, com as duas listas
//! exaustivas e o controle positivo obrigatorio.**
//!
//! O ciclo e o real, e nao uma simulacao: um **processo filho** cria o cofre e
//! morre com a mnemonica; este processo destrava, deriva, assina e so entao
//! varre a propria memoria. E o que acontece no aparelho quando o app e morto e
//! reaberto.
//!
//! Fase 1 (aberto): itens 1 a 6 em zero, itens 7 a 10 presentes.
//! Fase 2 (trancado): 1 a 6 em zero, 9 e 10 **passam a zero**, 7 e 8 continuam.
//!
//! O controle de que **o varredor funciona** vive em `memscan_controle.rs`, em
//! processo separado de proposito — se morasse aqui, a mnemonica plantada la
//! contaminaria a varredura daqui.

#![cfg(all(
    feature = "memscan-gate",
    any(target_os = "linux", target_os = "android")
))]

use tezos_core::prompt::{Purpose, UserPrompt};
use tezos_core::session::VaultLocation;
use tz_keys::secret::Phrase;
use tz_keys::sign::{ForgedOperation, Watermark};
use tz_memscan::{scan_self, Needles, Phase};
use zeroize::Zeroize;

const SENHA: &str = "correto-Cavalo-Bateria-Grampo-2026!";

struct PromptFixo;

impl UserPrompt for PromptFixo {
    fn passphrase(&self, _p: Purpose) -> tezos_core::Result<Phrase> {
        Phrase::new(SENHA).ok_or(tz_keys::KeyError::MnemonicWordCount.into())
    }
    fn verify_user(&self, _p: Purpose) -> tezos_core::Result<()> {
        Ok(())
    }
}

fn fixture_bin() -> std::path::PathBuf {
    let mut p = std::env::current_exe().expect("caminho do teste");
    p.pop();
    if p.ends_with("deps") {
        p.pop();
    }
    p.join("examples/cria_cofre")
}

#[test]
fn o_portao_das_duas_fases() {
    let dir = std::env::temp_dir().join(format!("tz-memscan-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    let cofre = dir.join("carteira.vault");

    // ---- fase 0: outro processo cria o cofre e morre com a mnemonica.
    let saida = std::process::Command::new(fixture_bin())
        .arg(&cofre)
        .output()
        .expect("rodar o fixture (cargo build --example cria_cofre)");
    assert!(
        saida.status.success(),
        "fixture falhou: {}",
        String::from_utf8_lossy(&saida.stderr)
    );
    let mut texto = String::from_utf8(saida.stdout).expect("saida do fixture");
    let linhas: Vec<String> = texto.lines().map(|s| s.to_string()).collect();
    assert_eq!(linhas.len(), 5, "o fixture mudou de formato");
    let endereco = linhas[0].clone();
    let chave_publica = linhas[1].clone();

    // O material bruto entra mascarado e o claro e zerado na hora. Nada aqui
    // recalcula nada: recalcular deixaria residuo **deste teste**, que seria
    // lido como vazamento do produto.
    let mut agulhas = Needles::new();
    let mut senha = SENHA.as_bytes().to_vec();
    agulhas.always_zero("passphrase", &senha);
    senha.zeroize();

    let mut semente = hex_para_bytes(&linhas[2]);
    agulhas.always_zero("semente-bip39-64B", &semente);
    semente.zeroize();

    let mut kek = hex_para_bytes(&linhas[3]);
    agulhas.always_zero("kek-pass-32B", &kek);
    kek.zeroize();

    let mut payload = hex_para_bytes(&linhas[4]);
    agulhas.always_zero("payload-128B-em-claro", &payload);
    payload.zeroize();

    agulhas.always_present("endereco-tz1", endereco.as_bytes());
    agulhas.always_present("chave-publica-edpk", chave_publica.as_bytes());

    texto.zeroize();
    drop(linhas);

    // ---- fase 1: destrava, assina, varre.
    let loc = VaultLocation {
        path: &cofre,
        hardware: None,
    };
    let mut sessao = tezos_core::unlock(&loc, &PromptFixo).expect("destravar");
    assert_eq!(sessao.identity().address, endereco);
    assert_eq!(sessao.identity().public_key, chave_publica);

    let op = ForgedOperation::from_locally_forged(vec![0xaa, 0xbb]);
    let assinatura = sessao
        .sign(Watermark::GenericOperation, &op, &PromptFixo)
        .expect("assinar");
    assert!(assinatura.to_base58().starts_with("edsig"));

    {
        let (dek, escalar) = sessao.secret_material().expect("sessao aberta");
        agulhas.present_then_gone("dek-32B", dek);
        agulhas.present_then_gone("escalar-privado-32B", escalar);
    }

    let fase1 = scan_self(Phase::Unlocked, &mut agulhas);
    println!("§9.6 {}", fase1.summary());
    if let Err(por_que) = fase1.verdict() {
        panic!("§9.6 fase 1 reprovou: {por_que}");
    }

    // ---- fase 2: tranca e varre de novo, no MESMO processo.
    sessao.lock();
    assert!(sessao.is_locked());
    // A identidade publica sobrevive ao bloqueio — e ela **precisa**
    // sobreviver: e o controle positivo da fase 2, e e o que o produto mostra
    // com a carteira trancada.
    assert_eq!(sessao.identity().address, endereco);

    let fase2 = scan_self(Phase::Locked, &mut agulhas);
    println!("§9.6 {}", fase2.summary());
    if let Err(por_que) = fase2.verdict() {
        panic!("§9.6 fase 2 reprovou: {por_que}");
    }

    // Sem isto o compilador pode soltar as strings antes da varredura, e o
    // controle positivo cairia por otimizacao em vez de por defeito.
    std::hint::black_box((&endereco, &chave_publica, &sessao));
    let _ = std::fs::remove_dir_all(&dir);
}

fn hex_para_bytes(s: &str) -> Vec<u8> {
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap_or(0))
        .collect()
}
