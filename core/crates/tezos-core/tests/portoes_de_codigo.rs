//! Portoes que se aplicam ao **codigo inteiro** do nucleo, e nao a uma funcao.
//!
//! Cada um existe por causa de um defeito com nome e linha em `ANALYSIS.md` ou
//! no anti-catalogo da §10. Um portao sem defeito de origem e cerimonia; estes
//! tem.
//!
//! Eles sao textuais de proposito. Um lint de verdade seria melhor, e um lint
//! que ninguem escreveu e pior que uma varredura que existe.

use std::path::{Path, PathBuf};

fn raiz() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("raiz do workspace")
        .to_path_buf()
}

/// Todo `.rs` de `crates/*/src`. Testes ficam de fora: um teste **precisa**
/// escrever o valor esperado, e um `assert_eq!(m, 65_536)` e o teste fazendo o
/// seu trabalho, nao um parametro duplicado.
fn fontes_de_producao() -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    let mut pilha = vec![raiz().join("crates")];
    while let Some(d) = pilha.pop() {
        let Ok(entradas) = std::fs::read_dir(&d) else {
            continue;
        };
        for e in entradas.flatten() {
            let p = e.path();
            if p.is_dir() {
                if p.file_name()
                    .is_some_and(|n| n == "target" || n == "tests" || n == "examples")
                {
                    continue;
                }
                pilha.push(p);
            } else if p.extension().is_some_and(|x| x == "rs") {
                if let Ok(t) = std::fs::read_to_string(&p) {
                    out.push((p, sem_blocos_de_teste(&t)));
                }
            }
        }
    }
    assert!(out.len() >= 15, "poucos fontes encontrados: {}", out.len());
    out
}

/// Corta tudo a partir de `#[cfg(test)]`.
///
/// Um `assert!` dentro de `mod tests` e um teste fazendo o seu trabalho, nao um
/// `panic` no caminho da chave. Cortar no marcador e grosseiro e suficiente:
/// por convencao do repositorio, `#[cfg(test)]` num fonte de producao aparece
/// uma vez so, no fim do arquivo.
fn sem_blocos_de_teste(texto: &str) -> String {
    match texto.find("#[cfg(test)]") {
        Some(i) => texto[..i].to_string(),
        None => texto.to_string(),
    }
}

fn e_comentario(l: &str) -> bool {
    let l = l.trim_start();
    l.starts_with("//") || l.starts_with("///") || l.starts_with("//!")
}

/// **Criterio de aceite do BRES-41:** nenhum parametro criptografico hardcoded
/// fora de um unico modulo de configuracao.
///
/// A lista e de valores **inequivocos** — memoria do Argon2id, `coin_type` do
/// Tezos, bit de endurecimento, chaves de no mestre do SLIP-0010. Numeros
/// ambiguos como `32` ou `64` nao entram: eles sao tamanho de buffer em
/// metade do codigo, e um portao que grita sem motivo e um portao que alguem
/// desliga.
#[test]
fn parametro_criptografico_so_vive_em_tz_params() {
    const PROIBIDOS: &[(&str, &str)] = &[
        ("65_536", "memoria do perfil v1-mobile"),
        ("65536", "memoria do perfil v1-mobile"),
        ("262_144", "memoria do perfil v1-desktop"),
        ("262144", "memoria do perfil v1-desktop"),
        ("19_456", "piso de memoria da §5.6"),
        ("19456", "piso de memoria da §5.6"),
        ("1_048_576", "teto de memoria da §5.6"),
        ("1048576", "teto de memoria da §5.6"),
        ("1729", "coin_type do Tezos"),
        ("0x8000_0000", "bit de endurecimento do BIP-32"),
        ("0x80000000", "bit de endurecimento do BIP-32"),
        ("2147483648", "bit de endurecimento do BIP-32"),
        ("\"ed25519 seed\"", "chave de no mestre do SLIP-0010"),
        ("\"Nist256p1 seed\"", "chave de no mestre do SLIP-0010"),
        ("\"Bitcoin seed\"", "chave de no mestre do SLIP-0010"),
        ("b\"mnemonic\"", "sal do PBKDF2 do BIP-39"),
        ("TZVLT", "magic do arquivo de cofre"),
    ];
    for (arquivo, texto) in fontes_de_producao() {
        if arquivo.components().any(|c| c.as_os_str() == "tz-params") {
            continue;
        }
        for (n, linha) in texto.lines().enumerate() {
            if e_comentario(linha) {
                continue;
            }
            for (agulha, o_que_e) in PROIBIDOS {
                assert!(
                    !linha.contains(agulha),
                    "{}:{} escreve `{agulha}` ({o_que_e}) fora de `tz-params`:\n  {}",
                    arquivo.display(),
                    n + 1,
                    linha.trim()
                );
            }
        }
    }
}

/// §3 item 9 — falha e `Result`, nunca `panic` no caminho da chave.
///
/// Um `.expect()` no caminho do KDF transforma disco cheio em crash de app, e
/// o spike BRES-36 tinha quatro deles em `kdf.rs`.
#[test]
fn nada_de_panic_no_caminho_da_chave() {
    const PROIBIDOS: &[&str] = &[
        ".unwrap()",
        ".expect(",
        "panic!(",
        "unreachable!(",
        "todo!(",
        "unimplemented!(",
        "assert!(",
        "assert_eq!(",
    ];
    for (arquivo, texto) in fontes_de_producao() {
        for (n, linha) in texto.lines().enumerate() {
            if e_comentario(linha) {
                continue;
            }
            for agulha in PROIBIDOS {
                assert!(
                    !linha.contains(agulha),
                    "{}:{} usa `{agulha}` — §3 item 9 proibe no caminho da chave:\n  {}",
                    arquivo.display(),
                    n + 1,
                    linha.trim()
                );
            }
        }
    }
}

/// §3 item 4 e item 4 do anti-catalogo — nenhuma comparacao de segredo com
/// igualdade de linguagem. A origem: `computedHash === hash.toUpperCase()`,
/// TAPS `wallet-encryption.service.ts:138-139`.
///
/// **Como isto foi verificado, para a resposta nao ser "confie em mim":** a
/// unica comparacao de segredo que o nucleo faz e a da tag do AEAD, e ela
/// acontece **dentro** da biblioteca (`chacha20poly1305` e `aes-gcm`), que ja e
/// de tempo constante. Nao ha comparacao propria de tag, de hash ou de senha
/// em lugar nenhum — nao existe "hash de verificacao" no formato, porque a tag
/// do AEAD **e** a verificacao (§5.4). Onde uma comparacao propria for
/// inevitavel no futuro, `tz_keys::secret::secrets_equal` (que e
/// `constant_time_eq`) e o unico caminho, e este teste e o que impede a
/// alternativa.
#[test]
fn nenhuma_comparacao_de_segredo_com_igualdade_de_linguagem() {
    // `expose()` e a **unica** porta para os bytes de um segredo — e regra dos
    // tipos de `tz_keys::secret` e de `tz_vault`. Entao "comparar segredo com
    // `==`" e, exatamente, "uma linha com `==` e `expose(`". A varredura e
    // precisa em vez de aproximada porque um portao que grita a toa e um
    // portao que alguem desliga.
    for (arquivo, texto) in fontes_de_producao() {
        for (n, linha) in texto.lines().enumerate() {
            if e_comentario(linha) {
                continue;
            }
            let tem_comparacao = linha.contains(" == ") || linha.contains(" != ");
            let tem_segredo = linha.contains("expose(") || linha.contains("expose_mut(");
            assert!(
                !(tem_comparacao && tem_segredo),
                "{}:{} compara segredo com igualdade de linguagem; use `tz_keys::secret::secrets_equal` (§3 item 4):\n  {}",
                arquivo.display(),
                n + 1,
                linha.trim()
            );
        }
    }
}

/// §3 item 3 e item 12 do anti-catalogo — parametro de KDF nunca vem de
/// `Default::default()` de dependencia.
///
/// Foi assim que o spike BRES-36 herdou, via `tauri-plugin-stronghold`, um
/// scrypt de `N = 2¹⁹` (512 MiB) que ninguem escolheu e que era a causa
/// provavel dos 45–60 s de abertura no Android.
#[test]
fn nenhum_parametro_de_kdf_vem_de_default_de_biblioteca() {
    for (arquivo, texto) in fontes_de_producao() {
        for (n, linha) in texto.lines().enumerate() {
            if e_comentario(linha) {
                continue;
            }
            for agulha in ["Params::default()", "Argon2::default()", "::default()"] {
                assert!(
                    !linha.contains(agulha),
                    "{}:{} usa `{agulha}`; parametro de cripto vem de `tz-params` (§3 item 3):\n  {}",
                    arquivo.display(),
                    n + 1,
                    linha.trim()
                );
            }
        }
    }
}

/// As features de teste **nunca** entram num build de producao.
///
/// `fault-injection` derruba o CSPRNG a pedido; `memscan-gate` expoe os bytes
/// crus do escalar. As duas existem porque um teste que nao pode falhar nao e
/// um teste — e as duas seriam um desastre num binario publicado.
#[test]
fn features_de_teste_nao_sao_padrao() {
    let mut vistos = 0usize;
    for manifesto in ["tz-rng", "tz-keys", "tz-vault", "tezos-core"] {
        let p = raiz().join("crates").join(manifesto).join("Cargo.toml");
        let t = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("ler {}: {e}", p.display()));
        for linha in t.lines() {
            let l = linha.trim();
            assert!(
                !l.starts_with("default = ["),
                "{manifesto} declara features padrao; `fault-injection` e `memscan-gate` nao podem virar padrao por descuido:\n  {l}"
            );
        }
        vistos += 1;
    }
    assert_eq!(vistos, 4);
}

/// §9.8 — nenhuma dependencia do caminho da chave com faixa aberta, e lockfile
/// commitado.
///
/// Faixa aberta e o que transforma uma bump de terceiro num deploy que ninguem
/// revisou. Toda versao do nucleo e fixada com `=`.
#[test]
fn dependencias_do_caminho_da_chave_sao_fixadas() {
    assert!(
        raiz().join("Cargo.lock").exists(),
        "o lockfile nao esta commitado (§9.8)"
    );
    for crate_ in [
        "tz-keys",
        "tz-vault",
        "tz-rng",
        "tz-memscan",
        "tezos-core",
        "tz-params",
    ] {
        let p = raiz().join("crates").join(crate_).join("Cargo.toml");
        let t = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("ler {}: {e}", p.display()));
        for (n, linha) in t.lines().enumerate() {
            let l = linha.trim();
            if l.starts_with('[') || l.starts_with('#') || l.is_empty() {
                continue;
            }
            // So interessam as linhas que declaram versao de crates.io.
            let Some(pos) = l.find("version = \"") else {
                if l.contains("workspace = true") || l.contains("path = ") || !l.contains('=') {
                    continue;
                }
                // `nome = "1.2.3"` na forma curta.
                if let Some(aspas) = l.find('"') {
                    let v = &l[aspas + 1..];
                    let v = v.split('"').next().unwrap_or("");
                    if v.chars()
                        .next()
                        .is_some_and(|c| c.is_ascii_digit() || c == '^' || c == '~' || c == '*')
                    {
                        panic!(
                            "{}:{} declara versao sem `=`: `{l}` (§9.8)",
                            p.display(),
                            n + 1
                        );
                    }
                }
                continue;
            };
            let v = &l[pos + 11..];
            let v = v.split('"').next().unwrap_or("");
            assert!(
                v.starts_with('='),
                "{}:{} declara `{v}` sem `=` (§9.8):\n  {l}",
                p.display(),
                n + 1
            );
        }
    }
}

/// §9.8 e item 18 do anti-catalogo — `continue-on-error` e proibido no portao
/// de seguranca do CI. Hoje o TAPS roda `npm audit` assim, o que faz dele um
/// portao decorativo.
#[test]
fn o_ci_nao_tem_portao_decorativo() {
    // O workflow vive na raiz do **repositorio**, um nivel acima do workspace
    // do nucleo, porque e la que o GitHub Actions procura.
    let wf = raiz()
        .parent()
        .expect("raiz do repositorio")
        .join(".github/workflows/nucleo.yml");
    let t = std::fs::read_to_string(&wf).unwrap_or_else(|e| panic!("ler {}: {e}", wf.display()));
    for (n, linha) in t.lines().enumerate() {
        if linha.trim_start().starts_with('#') {
            continue;
        }
        assert!(
            !linha.contains("continue-on-error"),
            "{}:{} usa `continue-on-error` (§9.8, item 18 do anti-catalogo):\n  {}",
            wf.display(),
            n + 1,
            linha.trim()
        );
    }
    for passo in ["cargo audit", "cargo deny", "cargo test", "cargo clippy"] {
        assert!(t.contains(passo), "o workflow nao roda `{passo}`");
    }
}
