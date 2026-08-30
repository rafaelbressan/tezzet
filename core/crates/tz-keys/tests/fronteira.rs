//! §1 — **a fronteira entre `tz-keys` e `tz-vault`, verificada em vez de
//! prometida.**
//!
//! A regra da especificacao: *"`tz-keys` NAO DEVE ler nem escrever arquivo,
//! nem chamar API do sistema operacional."* Uma regra escrita so num
//! comentario e uma regra que dura ate a proxima sexta-feira. Este teste le o
//! codigo-fonte da propria crate e o `Cargo.toml`, e reprova quando alguem
//! atravessa a linha.
//!
//! Por que isso importa e nao e purismo: um bug em `tz-keys` nao deve exigir
//! reauditar o `tz-vault`, e vice-versa. E o que torna o perimetro auditavel
//! um numero pequeno de linhas em vez de "o app".

use std::path::Path;

fn fontes() -> Vec<(String, String)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    let mut pilha = vec![dir];
    while let Some(d) = pilha.pop() {
        for e in std::fs::read_dir(&d).expect("ler src/") {
            let p = e.expect("entrada").path();
            if p.is_dir() {
                pilha.push(p);
            } else if p.extension().is_some_and(|x| x == "rs") {
                let texto = std::fs::read_to_string(&p).expect("ler fonte");
                out.push((p.display().to_string(), texto));
            }
        }
    }
    assert!(!out.is_empty(), "nenhum fonte encontrado");
    out
}

/// Lista fechada. Acrescentar item aqui e decisao de revisao, nao de quem
/// esta implementando.
const PROIBIDO_NO_CODIGO: &[(&str, &str)] = &[
    ("std::fs", "tz-keys nao toca disco (§1)"),
    ("std::net", "tz-keys nao fala rede (§1)"),
    ("std::env", "tz-keys nao le ambiente (§1)"),
    ("std::process", "tz-keys nao chama processo (§1)"),
    (
        "std::time",
        "tz-keys e deterministico: relogio nao entra (§1)",
    ),
    ("libc::", "chamada de sistema e de tz-rng ou tz-vault (§1)"),
    (
        "getrandom",
        "sortear e de tz-rng; aqui a entropia entra por argumento (§4.1)",
    ),
    ("thread_rng", "PRNG de espaco de usuario e proibido (§4.1)"),
];

#[test]
fn tz_keys_nao_fala_com_o_sistema_operacional() {
    for (arquivo, texto) in fontes() {
        for (agulha, porque) in PROIBIDO_NO_CODIGO {
            assert!(
                !texto.contains(agulha),
                "{arquivo} contem `{agulha}` — {porque}"
            );
        }
    }
}

/// A mesma fronteira, um nivel acima: se a dependencia entrar no `Cargo.toml`,
/// o `use` aparece na semana seguinte.
#[test]
fn tz_keys_nao_depende_de_crate_de_sistema() {
    let manifesto =
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"))
            .expect("ler Cargo.toml");
    let deps = manifesto
        .split("[dev-dependencies]")
        .next()
        .expect("secao de dependencias");
    for proibida in ["libc", "tz-rng", "windows-sys", "rand", "tokio", "serde"] {
        assert!(
            !deps.lines().any(|l| l.trim_start().starts_with(proibida)),
            "`{proibida}` entrou nas dependencias de tz-keys, o que quebra a fronteira da §1"
        );
    }
}

/// §3 item 9 — falha e `Result`, nunca `panic` no caminho da chave. Um
/// `.expect()` no caminho do KDF transforma disco cheio em crash de app.
#[test]
fn nao_ha_panic_no_caminho_da_chave() {
    for (arquivo, texto) in fontes() {
        for (n, linha) in texto.lines().enumerate() {
            let l = linha.trim_start();
            if l.starts_with("//") || l.starts_with("///") || l.starts_with("//!") {
                continue;
            }
            for agulha in [
                ".unwrap()",
                ".expect(",
                "panic!(",
                "unreachable!(",
                "todo!(",
            ] {
                assert!(
                    !l.contains(agulha),
                    "{arquivo}:{} usa `{agulha}` — §3 item 9 proibe no caminho da chave:\n  {l}",
                    n + 1
                );
            }
        }
    }
}

/// §3 item 4 — nenhuma comparacao de segredo com igualdade de linguagem. Foi
/// `computedHash === hash.toUpperCase()` (TAPS `:138-139`) que gerou a regra.
///
/// O varredor e conservador de proposito: ele proibe `==` em qualquer linha que
/// tambem mencione material secreto. Falso positivo aqui custa uma linha de
/// codigo mais explicita; falso negativo custa um canal lateral de tempo.
#[test]
fn nenhuma_comparacao_de_segredo_com_igualdade_de_linguagem() {
    const MATERIAL: &[&str] = &[
        "scalar.expose",
        "seed.expose",
        "secret.expose",
        "dek.expose",
        "kek",
        "phrase.expose",
        "tag",
        "checksum_bytes",
    ];
    for (arquivo, texto) in fontes() {
        for (n, linha) in texto.lines().enumerate() {
            let l = linha.trim_start();
            if l.starts_with("//") || l.starts_with("///") || l.starts_with("//!") {
                continue;
            }
            if !(l.contains(" == ") || l.contains(" != ")) {
                continue;
            }
            for m in MATERIAL {
                assert!(
                    !l.contains(m),
                    "{arquivo}:{} compara segredo com `==`/`!=`; use `secret::secrets_equal` (§3 item 4):\n  {l}",
                    n + 1
                );
            }
        }
    }
}
