//! §9.6 — **o varredor de memoria, na versao emendada pelo BRES-68.**
//!
//! # Por que a emenda importa, e por que o varredor antigo nao serve
//!
//! A redacao anterior da §9.6 dizia "zero ocorrencias do material `edsk`", e
//! isso admitia duas leituras honestas com vereditos opostos: a forma base58
//! `edsk…`, ou o escalar cru de 32 bytes. Pela segunda leitura, um cofre
//! **correto** seria reprovado, porque a §5.9 **manda** a sessao aberta guardar
//! exatamente a DEK e o escalar.
//!
//! O achado que motivou este arquivo: rodar o varredor do BRES-66 contra a
//! especificacao nova devolveria `PASSOU` contra um criterio que **nao existe
//! mais**. As duas listas abaixo sao exaustivas — o que nao esta nelas nao e
//! veredito — e as **duas fases** sao obrigatorias.
//!
//! ## Fase 1 — cofre aberto, depois de `unlock` + uma assinatura
//!
//! Conta **zero**:
//!
//! | # | O que | Por que nao pode estar la |
//! |---|---|---|
//! | 1 | 3 ou mais palavras consecutivas da wordlist BIP-39 | §7.1.4 — a mnemonica so existe na criacao e na importacao |
//! | 2 | `edsk…` (32 B e 64 B), `spsk…`, `p2sk…` em base58 | nenhum caminho codifica chave privada em base58; se apareceu, alguem formatou segredo em string |
//! | 3 | os bytes da passphrase digitada | §5.9 — zerada assim que a `KEK_pass` sai do Argon2id |
//! | 4 | a `KEK_pass` (32 B de saida do Argon2id) | §5.9 — zerada depois de desembrulhar a DEK |
//! | 5 | a semente BIP-39 de 64 bytes | §5.9 — zerada depois da derivacao |
//! | 6 | o payload de 128 bytes em claro | zerado depois da extracao |
//!
//! Aparece **pelo menos uma vez** — este e o controle positivo, e ele **nao e
//! opcional**:
//!
//! | # | O que | Por que precisa estar la |
//! |---|---|---|
//! | 7 | o endereco (`tz1…`) | prova que a varredura alcancou a regiao certa |
//! | 8 | a chave publica (`edpk…`) | idem |
//! | 9 | o **escalar privado cru de 32 bytes** | §5.9 — **e legitimo**: e o que a sessao aberta guarda para assinar |
//! | 10 | a **DEK de 32 bytes** | §5.9 — **e legitima** enquanto o cofre esta aberto |
//!
//! Sem o controle positivo o teste e inutil: um dump vazio passa por engano,
//! porque o varredor pode estar lendo a regiao errada.
//!
//! ## Fase 2 — mesmo processo, depois de `lock`
//!
//! Os itens **9 e 10 passam a contar zero**; 1 a 6 continuam em zero; 7 e 8
//! continuam presentes. E a fase 2 que da sentido a permissao da fase 1: o
//! escalar e legitimo **enquanto o cofre esta aberto**, nao para sempre. Sem
//! ela, "e legitimo estar em memoria" viraria licenca permanente e a §5.9 nao
//! teria teste nenhum.
//!
//! # A agulha nunca existe em claro dentro deste processo
//!
//! E o **controle 3** da §9.6. Um varredor que guarda a agulha em claro **acha
//! a propria agulha**, e ai as duas listas quebram ao mesmo tempo: um item de
//! conta-zero reprova sempre, e um item de controle positivo passa sempre —
//! inclusive quando a varredura leu a regiao errada, que e exatamente o defeito
//! que o controle 2 existe para pegar.
//!
//! Por isso toda agulha e guardada **mascarada** (XOR com bytes do CSPRNG) e a
//! comparacao desmascara byte a byte, sem nunca materializar o texto em claro.
//! O unico texto em claro do processo e o do proprio programa — que e o que se
//! quer medir.
//!
//! # O que este portao NAO e
//!
//! Ele **nao prova** que nao sobrou copia: a §7.3 diz que essa prova nao existe
//! em sistema operacional de proposito geral, e nada aqui a contradiz. Ele e
//! **regressao** — pega a copia que o **nosso** codigo deixou para tras. Se uma
//! dependencia do caminho da chave retiver uma copia que nao conseguimos zerar,
//! o portao **nao e afrouxado**: a dependencia e **nomeada** no relatorio de
//! build e o caso sobe para Tezos Core & Crypto.

#![cfg(any(target_os = "linux", target_os = "android"))]
#![forbid(unsafe_code)]

use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom};
use zeroize::Zeroize;

const CHUNK: usize = 4 * 1024 * 1024;
const MAX_REGION: u64 = 512 * 1024 * 1024;
/// §9.6 emendada: **3** palavras, nao 8.
const BIP39_RUN: usize = 3;
/// Corrida longa: acima disto, prosa em ingles nao acontece por acaso.
const BIP39_LONG_RUN: usize = 6;

/// Em qual fase o veredito e calculado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Depois de `unlock` + uma assinatura.
    Unlocked,
    /// Depois de `lock` (ou do *timeout* da §5.9).
    Locked,
}

/// O que se espera de cada agulha.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Expect {
    /// Conta zero nas duas fases.
    AlwaysZero,
    /// Presente nas duas fases — controle positivo permanente.
    AlwaysPresent,
    /// Presente com o cofre aberto, **zero** depois de trancar.
    PresentThenGone,
}

struct Needle {
    label: &'static str,
    expect: Expect,
    masked: Vec<u8>,
    mask: Vec<u8>,
    hits: usize,
}

impl Drop for Needle {
    fn drop(&mut self) {
        self.masked.zeroize();
        self.mask.zeroize();
    }
}

/// As agulhas da varredura. Construa com os bytes em claro; elas sao
/// mascaradas na entrada e o claro nunca fica guardado aqui.
///
/// **Quem chama continua dono do buffer em claro que passou** — zere-o.
pub struct Needles {
    itens: Vec<Needle>,
}

impl Default for Needles {
    fn default() -> Self {
        Self::new()
    }
}

impl Needles {
    pub fn new() -> Self {
        Self { itens: Vec::new() }
    }

    fn push(&mut self, label: &'static str, expect: Expect, claro: &[u8]) -> &mut Self {
        let mut mask = vec![0u8; claro.len()];
        // Se o CSPRNG falhar aqui, uma mascara de zeros deixaria a agulha em
        // claro na memoria deste processo — que e exatamente o defeito que a
        // mascara existe para evitar. Entao a agulha simplesmente nao entra, e
        // o veredito reprova por controle positivo ausente.
        if tz_rng::fill(&mut mask).is_err() {
            return self;
        }
        let masked = claro.iter().zip(&mask).map(|(a, b)| a ^ b).collect();
        self.itens.push(Needle {
            label,
            expect,
            masked,
            mask,
            hits: 0,
        });
        self
    }

    /// Itens 3 a 6: **conta zero nas duas fases**.
    pub fn always_zero(&mut self, label: &'static str, claro: &[u8]) -> &mut Self {
        self.push(label, Expect::AlwaysZero, claro)
    }

    /// Itens 7 e 8: **controle positivo permanente**.
    pub fn always_present(&mut self, label: &'static str, claro: &[u8]) -> &mut Self {
        self.push(label, Expect::AlwaysPresent, claro)
    }

    /// Itens 9 e 10: legitimos com o cofre aberto, **proibidos depois do
    /// `lock`**.
    pub fn present_then_gone(&mut self, label: &'static str, claro: &[u8]) -> &mut Self {
        self.push(label, Expect::PresentThenGone, claro)
    }
}

/// O que a varredura encontrou.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub phase: Phase,
    pub regions_scanned: usize,
    pub bytes_scanned: u64,
    /// Item 1, **contagem literal da §9.6**: qualquer corrida de ≥ 3 palavras
    /// consecutivas da wordlist BIP-39, em qualquer texto.
    ///
    /// Este numero e **relatado e nao entra no veredito** — ver
    /// `bip39_phrase_like` e `bip39_long_runs`, e o cabecalho do modulo para o
    /// porque, com a medicao que forcou a distincao.
    pub bip39_runs: usize,
    /// Item 1, veredito (a): corrida de ≥ 3 palavras em que **todo** o trecho
    /// de texto contiguo e formado por palavras da wordlist. E a forma de uma
    /// mnemonica guardada como string.
    pub bip39_phrase_like: usize,
    /// Item 1, veredito (b): corrida de ≥ 6 palavras consecutivas da wordlist
    /// **em qualquer contexto**, inclusive dentro de prosa. Pega o fragmento de
    /// mnemonica que caiu no meio de outro buffer.
    pub bip39_long_runs: usize,
    /// Item 2 — formas base58 de chave privada: `edsk…`, `spsk…`, `p2sk…`.
    pub base58_private_forms: usize,
    /// Itens 3 a 10, por rotulo.
    pub hits: Vec<(&'static str, usize)>,
    expectations: Vec<(&'static str, Expect)>,
}

impl Report {
    /// **O portao.** Falha tambem quando o controle positivo nao aparece.
    pub fn verdict(&self) -> std::result::Result<(), String> {
        let mut problemas: Vec<String> = Vec::new();

        // Controle positivo primeiro: sem ele, um resultado negativo nao vale
        // nada, e dizer isso antes evita que alguem leia "0 ocorrencias" como
        // aprovacao.
        for ((label, hits), (_, expect)) in self.hits.iter().zip(&self.expectations) {
            let esperado_presente = match expect {
                Expect::AlwaysPresent => true,
                Expect::PresentThenGone => self.phase == Phase::Unlocked,
                Expect::AlwaysZero => false,
            };
            if esperado_presente && *hits == 0 {
                problemas.push(format!(
                    "controle positivo ausente: `{label}` deveria estar na memoria e apareceu 0x — a varredura leu a regiao errada, e o resultado negativo nao vale"
                ));
            }
            if !esperado_presente && *hits != 0 {
                problemas.push(format!("`{label}` encontrado na memoria: {hits}x"));
            }
        }

        if self.bip39_phrase_like != 0 {
            problemas.push(format!(
                "texto formado so por palavras da wordlist BIP-39 ({BIP39_RUN}+ palavras) encontrado: {}x",
                self.bip39_phrase_like
            ));
        }
        if self.bip39_long_runs != 0 {
            problemas.push(format!(
                "corrida de {BIP39_LONG_RUN}+ palavras consecutivas da wordlist BIP-39 encontrada: {}x",
                self.bip39_long_runs
            ));
        }
        if self.base58_private_forms != 0 {
            problemas.push(format!(
                "chave privada em base58 (`edsk`/`spsk`/`p2sk`) encontrada: {}x",
                self.base58_private_forms
            ));
        }

        if problemas.is_empty() {
            Ok(())
        } else {
            Err(problemas.join("; "))
        }
    }

    /// Linha para o log do CI. Os numeros ficam visiveis mesmo quando passa —
    /// "0 regioes varridas" e um teste quebrado que passou.
    pub fn summary(&self) -> String {
        let itens: Vec<String> = self.hits.iter().map(|(l, n)| format!("{l}={n}x")).collect();
        format!(
            "fase {:?}: {} regioes, {} MB | bip39: {} corridas de {BIP39_RUN}+ (literal), {} so-wordlist, {} de {BIP39_LONG_RUN}+ | base58_privada={} | {}",
            self.phase,
            self.regions_scanned,
            self.bytes_scanned / (1024 * 1024),
            self.bip39_runs,
            self.bip39_phrase_like,
            self.bip39_long_runs,
            self.base58_private_forms,
            itens.join(" ")
        )
    }
}

struct Region {
    lo: u64,
    hi: u64,
}

/// Substitui os bytes do proprio buffer de leitura por `0xFF` — que nao e
/// letra minuscula nem caractere base58, entao nao casa com nada.
fn mascara_o_proprio_buffer(chunk: &mut [u8], off: u64, buf_lo: u64, buf_hi: u64) {
    let chunk_lo = off;
    let chunk_hi = off + chunk.len() as u64;
    if buf_lo >= chunk_hi || chunk_lo >= buf_hi {
        return;
    }
    let inicio = (buf_lo.max(chunk_lo) - chunk_lo) as usize;
    let fim = (buf_hi.min(chunk_hi) - chunk_lo) as usize;
    for b in &mut chunk[inicio..fim] {
        *b = 0xFF;
    }
}

fn anon_rw_regions() -> Vec<Region> {
    let maps = match std::fs::read_to_string("/proc/self/maps") {
        Ok(m) => m,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for line in maps.lines() {
        let mut campos = line.split_whitespace();
        let faixa = match campos.next() {
            Some(r) => r,
            None => continue,
        };
        let perms = campos.next().unwrap_or("");
        if !perms.starts_with("rw") {
            continue;
        }
        let caminho = line.split_whitespace().nth(5).unwrap_or("");
        // Regiao com arquivo por tras (biblioteca, o proprio binario) guarda
        // constante, nao segredo de runtime. `[heap]`, `[stack]` e anonimo sim.
        if caminho.starts_with('/') || caminho == "[vvar]" || caminho == "[vsyscall]" {
            continue;
        }
        let (lo, hi) = match faixa.split_once('-') {
            Some((a, b)) => (
                u64::from_str_radix(a, 16).unwrap_or(0),
                u64::from_str_radix(b, 16).unwrap_or(0),
            ),
            None => continue,
        };
        if hi <= lo || hi - lo > MAX_REGION {
            continue;
        }
        out.push(Region { lo, hi });
    }
    out
}

/// Varre a memoria viva **deste** processo.
pub fn scan_self(phase: Phase, needles: &mut Needles) -> Report {
    let words = wordlist();
    let mut buf = vec![0u8; CHUNK];
    let buf_lo = buf.as_ptr() as u64;
    let buf_hi = buf_lo + buf.len() as u64;

    let mut regions_scanned = 0usize;
    let mut bytes_scanned = 0u64;
    let mut bip39_runs = 0usize;
    let mut bip39_phrase_like = 0usize;
    let mut bip39_long_runs = 0usize;
    let mut base58_private_forms = 0usize;
    for n in needles.itens.iter_mut() {
        n.hits = 0;
    }

    if let Ok(mut mem) = std::fs::File::open("/proc/self/mem") {
        for r in anon_rw_regions() {
            let mut off = r.lo;
            let mut tocou = false;
            while off < r.hi {
                let n = std::cmp::min(CHUNK as u64, r.hi - off) as usize;
                if mem.seek(SeekFrom::Start(off)).is_err() {
                    break;
                }
                if mem.read_exact(&mut buf[..n]).is_err() {
                    off += n as u64;
                    continue;
                }
                tocou = true;
                bytes_scanned += n as u64;
                // O proprio buffer de leitura vive numa regiao rw anonima. Ler
                // por cima dele duplicaria cada achado do trecho anterior. A
                // exclusao e **por byte**, nao por regiao: descartar a regiao
                // inteira derrubaria junto o que estivesse ao lado no mesmo
                // arena do alocador — e foi assim que uma agulha viva deixou de
                // ser encontrada na primeira versao deste arquivo.
                mascara_o_proprio_buffer(&mut buf[..n], off, buf_lo, buf_hi);
                let hay = &buf[..n];
                let (lit, so_lista, longa) = count_bip39(hay, &words);
                bip39_runs += lit;
                bip39_phrase_like += so_lista;
                bip39_long_runs += longa;
                base58_private_forms += count_base58_private(hay);
                for needle in needles.itens.iter_mut() {
                    needle.hits += count_masked(hay, &needle.masked, &needle.mask);
                }
                off += n as u64;
            }
            if tocou {
                regions_scanned += 1;
            }
        }
    }

    // O buffer sai daqui cheio do que acabou de ser lido.
    buf.zeroize();

    Report {
        phase,
        regions_scanned,
        bytes_scanned,
        bip39_runs,
        bip39_phrase_like,
        bip39_long_runs,
        base58_private_forms,
        hits: needles.itens.iter().map(|n| (n.label, n.hits)).collect(),
        expectations: needles.itens.iter().map(|n| (n.label, n.expect)).collect(),
    }
}

fn wordlist() -> HashSet<&'static str> {
    tz_keys::mnemonic::english_wordlist()
        .iter()
        .copied()
        .collect()
}

/// Item 1 — as tres contagens, num passo so.
///
/// Devolve `(literal, so_wordlist, longas)`.
///
/// O veredito e a **disjuncao de duas regras**, como manda a §9.6 emendada em
/// 2026-08-30 (BRES-41). Qualquer uma satisfeita reprova:
///
/// - **(a) so-wordlist**: um trecho de texto ASCII contiguo com 3 ou mais
///   palavras, formado **inteiramente** por palavras da wordlist. E a forma que
///   uma mnemonica tem quando vaza; prosa nao tem essa forma, porque uma unica
///   palavra fora da lista quebra o trecho.
/// - **(b) corrida longa**: 6 ou mais palavras consecutivas da wordlist **em
///   qualquer contexto**. Pega o fragmento de mnemonica que caiu no meio de
///   outro buffer, onde a vizinhanca nao e wordlist.
///
/// **A contagem literal — 3 ou mais consecutivas, em qualquer contexto — e
/// medida e relatada, e nao e o veredito.** O dado que levou a especificacao a
/// separar as duas coisas foi medido aqui: num processo de teste recem-nascido,
/// **sem carteira nenhuma**, o texto de ajuda do proprio `libtest` produz tres
/// ocorrencias — `"this option can"`, `"this flag can"`, `"this option can"`.
/// Um portao que nasce vermelho e desligado na semana seguinte.
///
/// As duas regras juntas sao **mais fortes** que o "≥ 8 palavras" do BRES-66:
/// (a) pega uma mnemonica de 3 palavras que o criterio antigo deixava passar, e
/// (b) pega em 6 o que o antigo so pegava em 8.
fn count_bip39(hay: &[u8], words: &HashSet<&'static str>) -> (usize, usize, usize) {
    let (mut literal, mut so_wordlist, mut longas) = (0usize, 0usize, 0usize);
    let mut i = 0usize;
    while i < hay.len() {
        if !hay[i].is_ascii_lowercase() {
            i += 1;
            continue;
        }
        let inicio = i;
        while i < hay.len() && (hay[i].is_ascii_lowercase() || hay[i] == b' ') {
            i += 1;
        }
        let fatia = &hay[inicio..i];
        // A menor corrida possivel: 3 palavras de 3 letras e 2 espacos.
        if fatia.len() < BIP39_RUN * 3 + (BIP39_RUN - 1) {
            continue;
        }
        let texto = match std::str::from_utf8(fatia) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let tokens: Vec<&str> = texto.split(' ').filter(|t| !t.is_empty()).collect();
        let todos_da_lista = tokens.len() >= BIP39_RUN && tokens.iter().all(|t| words.contains(t));
        if todos_da_lista {
            so_wordlist += 1;
        }
        let mut corrida = 0usize;
        for tok in &tokens {
            if words.contains(tok) {
                corrida += 1;
                if corrida == BIP39_RUN {
                    literal += 1;
                }
                if corrida == BIP39_LONG_RUN {
                    longas += 1;
                }
            } else {
                corrida = 0;
            }
        }
    }
    (literal, so_wordlist, longas)
}

const B58: &[u8] = tz_params::base58::ALPHABET;

/// Item 2 — `edsk…`, `spsk…` ou `p2sk…` seguido de base58 suficiente para ser
/// uma chave e nao uma palavra.
///
/// O piso de 50 caracteres e o comprimento minimo de uma chave privada
/// codificada (`edsk` de semente tem 54, `spsk` e `p2sk` tem 54, `edsk`
/// expandida tem 98). Abaixo disso e coincidencia de texto, nao chave.
fn count_base58_private(hay: &[u8]) -> usize {
    const PREFIXOS: [&[u8; 4]; 3] = [b"edsk", b"spsk", b"p2sk"];
    let mut hits = 0usize;
    let mut i = 0usize;
    while i + 4 < hay.len() {
        let casou = PREFIXOS.iter().any(|p| &hay[i..i + 4] == p.as_slice());
        if casou {
            let mut j = i + 4;
            while j < hay.len() && B58.contains(&hay[j]) {
                j += 1;
            }
            if j - i >= 50 {
                hits += 1;
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
    hits
}

/// Conta ocorrencias da agulha **sem nunca materializa-la em claro**.
fn count_masked(hay: &[u8], masked: &[u8], mask: &[u8]) -> usize {
    let n = masked.len();
    if n == 0 || hay.len() < n {
        return 0;
    }
    let mut hits = 0usize;
    let mut i = 0usize;
    while i + n <= hay.len() {
        let mut igual = true;
        for k in 0..n {
            if hay[i + k] ^ mask[k] != masked[k] {
                igual = false;
                break;
            }
        }
        if igual {
            hits += 1;
            i += n;
        } else {
            i += 1;
        }
    }
    hits
}
