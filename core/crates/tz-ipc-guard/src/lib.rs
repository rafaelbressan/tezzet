//! §9.7 — **a enumeracao da superficie de IPC deixa de ser mantida a mao.**
//!
//! # O residuo que esta crate fecha
//!
//! A ADR-0001 §12.1 registrou, sobre o portao P3.a: *"a enumeracao e mantida a
//! mao — nao ha teste que falhe se alguem acrescentar um `#[tauri::command]` e
//! esquecer de lista-lo. Isso vira requisito do BRES-41."* Este e o requisito.
//!
//! Por que importa: a superficie de IPC e **a** fronteira entre o codigo que ve
//! a chave e o codigo que nao ve. Um comando novo e um furo novo nessa parede,
//! e uma lista mantida a mao e uma lista que fica desatualizada — em silencio,
//! e justamente no PR apressado.
//!
//! # O que esta crate garante
//! - Que **todo** `#[tauri::command]` das fontes declaradas aparece na
//!   enumeracao, com o arquivo e a linha onde esta.
//! - Que a enumeracao nao tem comando **fantasma**: um nome listado que nao
//!   existe mais e tao ruim quanto um comando nao listado, porque treina quem
//!   revisa a nao confiar na lista.
//! - Que a enumeracao nao tem duplicata.
//!
//! # O que ela nao garante
//! - Que o comando enumerado e **seguro**. Ela conta a superficie; quem julga
//!   e a revisao. O que ela impede e a superficie crescer sem ninguem ver.
//! - Que o tipo de retorno nao vaza segredo. Isso e o portao `trybuild` de
//!   `tz-keys` (`tests/compilacao_deve_falhar.rs`): tipo com segredo nao e
//!   serializavel, logo nao atravessa.
//! - Nada sobre macros que gerem comandos. A varredura e textual e assume
//!   `#[tauri::command]` escrito no fonte — que e como o Tauri se usa. Um
//!   gerador de comandos entra como decisao de revisao, nao como surpresa.
//!
//! # Como o produto liga isto
//!
//! O manifesto `ipc-surface.toml` na raiz do workspace declara os diretorios
//! de fonte e a lista de comandos. Quando o shell Tauri do Tezzet (BRES-45) e
//! do TAPS (BRES-48) existir, ele acrescenta o diretorio dele ali — e o portao
//! passa a valer para o produto sem uma linha de codigo nova.

use std::fmt;
use std::path::{Path, PathBuf};

/// Um comando encontrado no fonte.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Command {
    pub name: String,
    pub file: PathBuf,
    pub line: usize,
}

/// O que nao bate entre o fonte e a enumeracao.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Divergence {
    /// Existe no fonte e **nao** esta na enumeracao. E este o caso que a
    /// ADR-0001 §12.1 deixou em aberto.
    NotDeclared {
        name: String,
        file: PathBuf,
        line: usize,
    },
    /// Esta na enumeracao e **nao** existe no fonte.
    Ghost { name: String },
    /// Aparece duas vezes no fonte, ou duas vezes na enumeracao.
    Duplicated { name: String },
}

impl fmt::Display for Divergence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotDeclared { name, file, line } => write!(
                f,
                "`{name}` e um #[tauri::command] em {}:{line} e NAO esta na superficie de IPC declarada",
                file.display()
            ),
            Self::Ghost { name } => write!(
                f,
                "`{name}` esta na superficie de IPC declarada e nao existe mais no fonte"
            ),
            Self::Duplicated { name } => write!(f, "`{name}` aparece duas vezes"),
        }
    }
}

/// Varre um diretorio recursivamente atras de `#[tauri::command]`.
pub fn scan_dir(dir: &Path) -> std::io::Result<Vec<Command>> {
    let mut out = Vec::new();
    let mut pilha = vec![dir.to_path_buf()];
    while let Some(d) = pilha.pop() {
        if !d.exists() {
            continue;
        }
        for entrada in std::fs::read_dir(&d)? {
            let p = entrada?.path();
            if p.is_dir() {
                // `target/` e artefato de build: varrer ali acha o fonte das
                // dependencias e transforma o portao em ruido.
                if p.file_name().is_some_and(|n| n == "target" || n == ".git") {
                    continue;
                }
                pilha.push(p);
            } else if p.extension().is_some_and(|e| e == "rs") {
                let texto = std::fs::read_to_string(&p)?;
                out.extend(scan_text(&texto, &p));
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// A varredura de um fonte so. Publica porque e o que os testes de fixture
/// exercitam, e porque um portao que nao da para testar isoladamente e um
/// portao em que ninguem confia.
pub fn scan_text(texto: &str, file: &Path) -> Vec<Command> {
    let linhas: Vec<&str> = texto.lines().collect();
    let mut out = Vec::new();
    for (i, linha) in linhas.iter().enumerate() {
        let l = linha.trim_start();
        if l.starts_with("//") {
            continue;
        }
        // Aceita `#[tauri::command]`, `#[command]` (quando ha
        // `use tauri::command;`) e as duas com argumentos.
        let e_comando = l.starts_with("#[tauri::command")
            || l.starts_with("#[command")
            || l.contains("#[tauri::command");
        if !e_comando {
            continue;
        }
        // A `fn` pode estar na mesma linha ou depois de outros atributos.
        for (j, seguinte) in linhas.iter().enumerate().skip(i) {
            if let Some(nome) = nome_da_fn(seguinte) {
                out.push(Command {
                    name: nome,
                    file: file.to_path_buf(),
                    line: j + 1,
                });
                break;
            }
            // Um atributo solto ou uma linha em branco entre o atributo e a
            // `fn` e normal; qualquer outra coisa quer dizer que a `fn` nao
            // veio, e insistir produziria um nome errado.
            let s = seguinte.trim_start();
            let continua = j == i
                || s.is_empty()
                || s.starts_with('#')
                || s.starts_with("//")
                || s.starts_with("///");
            if !continua {
                break;
            }
        }
    }
    out
}

fn nome_da_fn(linha: &str) -> Option<String> {
    let l = linha.trim_start();
    let resto = l
        .strip_prefix("pub ")
        .unwrap_or(l)
        .trim_start()
        .strip_prefix("async ")
        .map(str::trim_start)
        .unwrap_or_else(|| l.strip_prefix("pub ").unwrap_or(l).trim_start());
    let resto = resto.strip_prefix("fn ")?;
    let nome: String = resto
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if nome.is_empty() {
        None
    } else {
        Some(nome)
    }
}

/// **O portao.** Compara o que o fonte tem com o que a enumeracao declara.
pub fn audit(found: &[Command], declared: &[String]) -> Result<(), Vec<Divergence>> {
    let mut problemas = Vec::new();

    let mut vistos: Vec<&str> = Vec::new();
    for c in found {
        if vistos.contains(&c.name.as_str()) {
            problemas.push(Divergence::Duplicated {
                name: c.name.clone(),
            });
        }
        vistos.push(&c.name);
        if !declared.iter().any(|d| d == &c.name) {
            problemas.push(Divergence::NotDeclared {
                name: c.name.clone(),
                file: c.file.clone(),
                line: c.line,
            });
        }
    }
    let mut declarados_vistos: Vec<&str> = Vec::new();
    for d in declared {
        if declarados_vistos.contains(&d.as_str()) {
            problemas.push(Divergence::Duplicated { name: d.clone() });
        }
        declarados_vistos.push(d);
        if !found.iter().any(|c| &c.name == d) {
            problemas.push(Divergence::Ghost { name: d.clone() });
        }
    }

    if problemas.is_empty() {
        Ok(())
    } else {
        Err(problemas)
    }
}

/// O manifesto `ipc-surface.toml`, lido sem dependencia de parser de TOML.
///
/// O formato e deliberadamente minusculo — duas listas de strings — porque
/// arrastar um parser de TOML para dentro do perimetro auditado por causa de
/// um arquivo de configuracao de teste seria trocar risco por conveniencia.
pub struct Manifest {
    pub sources: Vec<PathBuf>,
    pub commands: Vec<String>,
}

impl Manifest {
    pub fn parse(texto: &str, root: &Path) -> Self {
        let mut sources = Vec::new();
        let mut commands = Vec::new();
        let mut secao = "";
        for linha in texto.lines() {
            let l = linha.split('#').next().unwrap_or("").trim();
            if l.is_empty() {
                continue;
            }
            if let Some(chave) = l.strip_suffix('[') {
                let chave = chave.trim().trim_end_matches('=').trim();
                secao = match chave {
                    "sources" => "sources",
                    "commands" => "commands",
                    _ => "",
                };
                continue;
            }
            if l == "]" {
                secao = "";
                continue;
            }
            let valor = l.trim_end_matches(',').trim().trim_matches('"');
            if valor.is_empty() {
                continue;
            }
            match secao {
                "sources" => sources.push(root.join(valor)),
                "commands" => commands.push(valor.to_string()),
                _ => {}
            }
        }
        Self { sources, commands }
    }
}
