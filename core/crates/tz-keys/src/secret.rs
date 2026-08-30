//! §7.1.3 e principio 7 — os tipos que carregam segredo, e o que eles
//! deliberadamente **nao** sabem fazer.
//!
//! Nenhum tipo deste arquivo deriva `Serialize`, `Clone`, `Copy` ou `Debug`.
//! Isso nao e estilo. Tudo que atravessa uma fronteira de IPC passa por
//! serializacao, e a `String` intermediaria dessa serializacao e uma copia que
//! `zeroize` nao alcanca. Se o tipo nao e serializavel, ele nao atravessa — e
//! quem garante isso e o compilador, nao a disciplina de quem escreve.
//!
//! A prova esta em `tests/compilacao_deve_falhar.rs`: serializar, clonar ou
//! imprimir qualquer um destes tipos **nao compila**, com o `.stderr` fixado ao
//! lado provando que o motivo e o certo.
//!
//! # Por que o buffer e `Box`, e nao um array direto
//!
//! Em Rust, **mover um valor e um `memcpy` que nao zera a origem.** Um segredo
//! guardado num array direto deixa uma copia para tras a cada `return`, a cada
//! `Some(x)`, a cada campo de struct que muda de lugar — e o `Drop` so alcanca
//! a copia viva.
//!
//! Isso nao e teoria: o portao da §9.6 **encontrou** essa copia. Com os
//! segredos em array direto, a varredura da fase 2 achava a DEK e o escalar
//! **1x cada, depois do `lock`** — o `Drop` tinha zerado a copia viva e a
//! copia deixada por um move continuava la. Com o buffer no heap, mover o tipo
//! copia **o ponteiro**, o conteudo nunca sai do lugar, e o `Drop` alcanca
//! tudo que existe. A fase 2 passou a contar zero.
//!
//! O preco e uma alocacao por segredo. E barato.
//!
//! # O que estes tipos garantem
//! - Tamanho fixo. Nunca realocam, entao nunca deixam um buffer antigo intacto
//!   no heap (foi assim que a `String` da mnemonica vazou no BRES-36).
//! - Endereco estavel: mover o tipo nao copia o segredo.
//! - Zeroizacao no `Drop`, com escrita volatil (via `zeroize`).
//! - Que uma copia so existe se alguem escreveu `expose()` — que e grep-avel.
//!
//! # O que eles NAO garantem
//! - Que nao sobrou copia em RAM. §7.3: essa prova nao existe em sistema
//!   operacional de proposito geral. O alocador realoca, o coletor copia, o
//!   compilador otimiza, o kernel migra pagina. O que existe e o portao de
//!   regressao da §9.6, que pega a copia que **o nosso** codigo deixou.
//! - Nada sobre `mlock`. Trancar pagina e da `tz-vault`, que e quem pode falar
//!   com o sistema operacional.

use zeroize::Zeroize;

macro_rules! segredo_fixo {
    ($(#[$meta:meta])* $t:ident, $n:expr) => {
        $(#[$meta])*
        pub struct $t(Box<[u8; $n]>);

        impl $t {
            pub const LEN: usize = $n;

            /// Copia `b` para dentro do tipo.
            ///
            /// **`b` continua sendo de quem chamou, e continua em claro.** Use
            /// [`Self::zeroed`] + [`Self::expose_mut`] sempre que o material
            /// puder nascer ja dentro do tipo; este construtor existe para as
            /// fronteiras onde isso nao e possivel.
            pub fn from_bytes(b: [u8; $n]) -> Self {
                let mut s = Self::zeroed();
                s.0.copy_from_slice(&b);
                s
            }

            /// Zerado no heap, para ser preenchido no lugar.
            pub fn zeroed() -> Self {
                Self(Box::new([0u8; $n]))
            }

            /// Unica leitura possivel. Emprestimo, nunca copia dona.
            pub fn expose(&self) -> &[u8; $n] {
                &self.0
            }

            /// Escrita no lugar, para o material nascer dentro do tipo em vez
            /// de num buffer solto que alguem precisa lembrar de zerar.
            pub fn expose_mut(&mut self) -> &mut [u8; $n] {
                &mut self.0
            }
        }

        impl Drop for $t {
            fn drop(&mut self) {
                self.0.zeroize();
            }
        }
    };
}

segredo_fixo!(
    /// Semente BIP-39 de 64 bytes. **E isto que o cofre guarda**, nunca as 24
    /// palavras (§4.2).
    Seed, 64
);
segredo_fixo!(
    /// Escalar privado de 32 bytes — Ed25519, secp256k1 ou P-256.
    Scalar, 32
);
segredo_fixo!(
    /// Chain code do BIP-32/SLIP-0010. Nao e chave, mas com o escalar ao lado
    /// deriva a subarvore inteira; recebe o mesmo tratamento.
    ChainCode, 32
);

/// Entropia de mnemonica: 16, 20, 24, 28 ou 32 bytes (§4.1).
///
/// Buffer fixo de 32 com comprimento util, porque um `Vec` realoca.
pub struct Entropy {
    buf: Box<[u8; 32]>,
    len: usize,
}

impl Entropy {
    /// Comprimentos aceitos, em bytes.
    pub const ACCEPTED: [usize; 5] = [16, 20, 24, 28, 32];

    pub fn new(bytes: &[u8]) -> Option<Self> {
        if !Self::ACCEPTED.contains(&bytes.len()) {
            return None;
        }
        let mut buf = Box::new([0u8; 32]);
        buf[..bytes.len()].copy_from_slice(bytes);
        Some(Self {
            buf,
            len: bytes.len(),
        })
    }

    pub fn expose(&self) -> &[u8] {
        &self.buf[..self.len]
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl Drop for Entropy {
    fn drop(&mut self) {
        self.buf.zeroize();
        self.len = 0;
    }
}

/// A frase de recuperacao. Buffer fixo, **nunca** `String`.
///
/// §7.1.4 — ela existe na criacao e na importacao, por milissegundos, e nunca
/// e rematerializada. Destravar o cofre devolve semente ou escalar, jamais
/// palavras. Essa regra sozinha elimina a classe "duas copias da mnemonica na
/// RAM a cada unlock".
pub struct Phrase {
    buf: Box<[u8; Self::CAP]>,
    len: usize,
}

impl Phrase {
    /// 24 palavras da wordlist inglesa cabem em 216 bytes com folga.
    pub const CAP: usize = 256;

    pub fn new(s: &str) -> Option<Self> {
        let b = s.as_bytes();
        if b.len() > Self::CAP {
            return None;
        }
        let mut buf = Box::new([0u8; Self::CAP]);
        buf[..b.len()].copy_from_slice(b);
        Some(Self { buf, len: b.len() })
    }

    pub fn expose(&self) -> &str {
        // Veio de `&str` por construcao, entao e UTF-8 valido.
        core::str::from_utf8(&self.buf[..self.len]).unwrap_or("")
    }

    pub fn word_count(&self) -> usize {
        self.expose().split_whitespace().count()
    }
}

impl Drop for Phrase {
    fn drop(&mut self) {
        self.buf.zeroize();
        self.len = 0;
    }
}

/// §3 item 4 — comparacao de segredo, hash ou tag em **tempo constante**,
/// sempre.
///
/// Existe aqui, e exportada, para que nenhum outro arquivo precise decidir
/// como comparar: o portao `tz-vault/tests/comparacao_em_tempo_constante.rs`
/// varre a arvore inteira atras de `==` sobre bytes de segredo e manda usar
/// esta funcao. Foi `computedHash === hash.toUpperCase()` — TAPS
/// `wallet-encryption.service.ts:138-139` — que produziu esta regra.
#[must_use]
pub fn secrets_equal(a: &[u8], b: &[u8]) -> bool {
    constant_time_eq::constant_time_eq(a, b)
}
