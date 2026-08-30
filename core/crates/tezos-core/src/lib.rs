//! `tezos-core` — a fachada do nucleo criptografico da Suite Tezos.
//!
//! E o que Tezzet e TAPS consomem. Auditado uma vez, usado nos dois
//! (SPEC-0001 §1).
//!
//! ```text
//!   tz-params   constantes criptograficas, num lugar so
//!   tz-rng      a unica porta para o CSPRNG do sistema
//!   tz-keys     identidade da chave — deterministico, nao toca disco nem SO
//!   tz-vault    o cofre — formato, KDF, AEAD, embrulhos, gravacao atomica
//!   tezos-core  ← voce esta aqui: ciclo de vida da carteira e da sessao
//! ```
//!
//! # A superficie publica, e o que ela garante
//!
//! | Chamada | Garante | **Nao** garante |
//! |---|---|---|
//! | [`create_wallet`] | 256 bits do CSPRNG do sistema; mnemonica devolvida **uma vez**; cofre gravado atomicamente | que o usuario guardou a frase — N5 do modelo de ameaca |
//! | [`import_wallet`] | wordlist **e** checksum validados antes de virar carteira | que a frase e do usuario |
//! | [`unlock`] | hardware primeiro, passphrase sempre como recuperacao; reencriptacao oportunista | nada contra malware ativo (N1) |
//! | [`Session::sign`] | verificacao de usuario nativa **antes** de assinar, sem fallback silencioso | que o `UserPrompt` do produto realmente pergunta |
//! | [`Session::lock`] | DEK e escalar zerados; identidade publica preservada | que nao sobrou copia em RAM (§7.3) |
//!
//! # O que este nucleo nunca faz
//!
//! - **Receber senha por parametro.** §8.2 e o item 14 do anti-catalogo: a
//!   passphrase entra por [`prompt::UserPrompt`], que e o dialogo nativo do
//!   sistema operacional. Nenhuma funcao publica daqui tem um argumento de
//!   senha, e isso e verificavel lendo as assinaturas.
//! - **Assinar bytes arbitrarios.** §4.6 item 5: o que entra e uma
//!   [`tz_keys::sign::ForgedOperation`], forjada e conferida localmente, nunca
//!   bytes prontos vindos de um RPC.
//! - **Forjar operacao, falar RPC ou estimar gas.** Isso e a camada de cadeia
//!   (BRES-42), deliberadamente separada: ela muda a cada upgrade de protocolo
//!   e este nucleo nao deve mudar junto.
//! - **Guardar chave de payout do TAPS.** §11: a decisao e `octez-signer` em
//!   host separado, e o backend nunca ve a chave. O `tz-vault` no TAPS protege
//!   **apenas** a sessao do operador no console.
//!
//! # A posicao de fundo, registrada
//!
//! Guardar uma chave `edsk` quente num banco de dados e o modelo de maior risco
//! possivel para um sistema de payout. O teto de seguranca de qualquer carteira
//! em software e "malware ativo com o cofre aberto le a chave" (N1), e o que
//! passa desse teto e assinador em hardware — Ledger ou `octez-signer` em host
//! separado.

#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

pub mod error;
pub mod prompt;
pub mod session;

pub use error::{wire_code, CoreError, Result};
pub use prompt::{Purpose, UserPrompt};
pub use session::{create_wallet, import_wallet, unlock, PublicIdentity, Session, VaultLocation};

/// Relatorio de build (§9.1 e §7.1): o que a plataforma entregou, **nomeado**.
///
/// A §9.1 exige que o relatorio nomeie a chamada de sistema que produziu os
/// bits, e nao apenas a biblioteca de fachada. A §7.1 exige saber se `mlock`
/// pegou. As duas coisas saem daqui.
pub fn build_report() -> String {
    let h = tz_vault::memory::harden();
    format!(
        "tezos-core {} | entropia: {} | {}",
        env!("CARGO_PKG_VERSION"),
        tz_rng::ENTROPY_SYSCALL,
        h.report_line()
    )
}
