//! §9.7 e ADR-0001 §12.1 — o portao da superficie de IPC, exercitado.
//!
//! Tres fixtures, tres desfechos. Sem eles, o portao seria um bloco de codigo
//! que ninguem sabe se dispara — que e como a enumeracao a mao chegou onde
//! chegou.

use std::path::Path;
use tz_ipc_guard::{audit, scan_dir, Divergence, Manifest};

const DECLARADOS: [&str; 3] = ["create_wallet", "unlock", "sign_operation"];

fn fixture(nome: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(nome)
}

fn declarados() -> Vec<String> {
    DECLARADOS.iter().map(|s| s.to_string()).collect()
}

#[test]
fn enumeracao_correta_passa() {
    let achados = scan_dir(&fixture("app_ok")).unwrap();
    let nomes: Vec<&str> = achados.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(nomes, ["create_wallet", "sign_operation", "unlock"]);
    assert!(audit(&achados, &declarados()).is_ok());
}

/// **O caso que a ADR-0001 §12.1 deixou em aberto.**
#[test]
fn comando_novo_nao_enumerado_reprova() {
    let achados = scan_dir(&fixture("app_comando_novo")).unwrap();
    let erro = audit(&achados, &declarados()).expect_err("comando novo passou despercebido");
    assert!(
        erro.iter().any(
            |d| matches!(d, Divergence::NotDeclared { name, .. } if name == "export_secret_key")
        ),
        "{erro:?}"
    );
    // E a mensagem diz **onde**, para o conserto nao virar cacada.
    let texto = erro
        .iter()
        .map(|d| d.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        texto.contains("export_secret_key") && texto.contains("lib.rs:"),
        "{texto}"
    );
}

/// Comando fantasma tambem reprova: uma lista com nome que nao existe mais
/// treina quem revisa a nao confiar na lista.
#[test]
fn comando_removido_e_ainda_enumerado_reprova() {
    let achados = scan_dir(&fixture("app_comando_removido")).unwrap();
    let erro = audit(&achados, &declarados()).expect_err("fantasma passou");
    assert!(
        erro.iter()
            .any(|d| matches!(d, Divergence::Ghost { name } if name == "sign_operation")),
        "{erro:?}"
    );
}

#[test]
fn duplicata_na_enumeracao_reprova() {
    let achados = scan_dir(&fixture("app_ok")).unwrap();
    let mut d = declarados();
    d.push("unlock".into());
    let erro = audit(&achados, &d).expect_err("duplicata passou");
    assert!(erro
        .iter()
        .any(|x| matches!(x, Divergence::Duplicated { name } if name == "unlock")));
}

/// O portao de verdade: le `ipc-surface.toml` da raiz do workspace e audita as
/// fontes que ele declara.
///
/// Hoje o repositorio ainda **nao tem** shell Tauri — BRES-45 e BRES-48 o
/// trazem. Enquanto nao tiver, o manifesto declara zero comandos e o portao
/// passa; no dia em que o primeiro `#[tauri::command]` for escrito num
/// diretorio declarado, ele fica vermelho ate ser enumerado. Nao ha uma linha
/// de codigo a escrever nesse dia — so um caminho a acrescentar no manifesto.
#[test]
fn a_superficie_declarada_no_manifesto_bate_com_o_fonte() {
    let raiz = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("raiz do workspace")
        .to_path_buf();
    let caminho = raiz.join("ipc-surface.toml");
    let texto = std::fs::read_to_string(&caminho)
        .unwrap_or_else(|e| panic!("ler {}: {e}", caminho.display()));
    let m = Manifest::parse(&texto, &raiz);
    assert!(
        !m.sources.is_empty(),
        "o manifesto nao declara nenhuma fonte"
    );

    let mut achados = Vec::new();
    for s in &m.sources {
        achados.extend(scan_dir(s).unwrap_or_else(|e| panic!("varrer {}: {e}", s.display())));
    }
    achados.sort_by(|a, b| a.name.cmp(&b.name));
    if let Err(problemas) = audit(&achados, &m.commands) {
        let texto = problemas
            .iter()
            .map(|d| d.to_string())
            .collect::<Vec<_>>()
            .join("\n  ");
        panic!("a superficie de IPC divergiu de `ipc-surface.toml`:\n  {texto}");
    }
}
