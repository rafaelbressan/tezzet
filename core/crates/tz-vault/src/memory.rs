//! §7 — memoria, e o que "zerar" quer dizer de verdade.
//!
//! # O que este modulo garante
//! - **Melhor esforco** em duas das quatro camadas da §7.1: `mlock`/
//!   `VirtualLock` nas paginas do processo e core dump desligado. Ele devolve
//!   [`Hardening`] com o que **conseguiu**, para o relatorio de build dizer a
//!   verdade em vez de presumir.
//! - Que a camada 1 e a unica que muda um vazamento de **permanente em disco**
//!   para **transitorio em RAM**. E por isso que ela e a que merece o relatorio.
//!
//! # O que ele NAO garante, dito como impossivel (§7.3)
//!
//! Nao existe, em sistema operacional de proposito geral, prova de que nao
//! sobrou copia do segredo em RAM. O alocador realoca, o coletor copia, o
//! compilador otimiza, o kernel migra paginas. As camadas 3 e 4 — tipos de
//! tamanho fixo com zeroizacao no drop, e a mnemonica so existindo na criacao
//! — sao do `tz-keys` e do desenho, nao de uma chamada de sistema.
//!
//! `mlock` protege contra swap, **nao contra root** (N2). Quem e root le a
//! memoria de qualquer processo.
//!
//! **Medido no BRES-66:** `mlockall` **falha no Android**
//! (`RLIMIT_MEMLOCK` do app e pequeno), entao a camada 1 hoje **nao existe** no
//! nosso Android. Isso esta aqui em vez de escondido porque a §7 promete mais
//! do que a plataforma entrega nesse alvo, e [`Hardening::mlockall_ok`] e o
//! campo que denuncia.

/// O que a plataforma deixou fazer. Sem `Option`, sem `bool` solto por ai: o
/// relatorio de build le isto.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hardening {
    /// `setrlimit(RLIMIT_CORE, 0)` no Unix; WER desabilitado no Windows.
    pub core_dumps_disabled: bool,
    /// `mlockall`/`VirtualLock`. **`false` no Android** — ver o cabecalho.
    pub mlockall_ok: bool,
}

impl Hardening {
    /// Uma linha para o relatorio de build (§9.1 pede que o relatorio nomeie o
    /// que foi feito, nao que afirme que foi).
    pub fn report_line(&self) -> String {
        format!(
            "memoria: core dumps {} | mlock {}",
            if self.core_dumps_disabled {
                "desligados"
            } else {
                "NAO desligados"
            },
            if self.mlockall_ok {
                "aplicado"
            } else {
                "NAO aplicado"
            }
        )
    }
}

/// Aplica as duas camadas. Idempotente; chame no boot do processo.
#[cfg(unix)]
pub fn harden() -> Hardening {
    let core_dumps_disabled = unsafe {
        let lim = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        libc::setrlimit(libc::RLIMIT_CORE, &lim) == 0
    };
    let mlockall_ok = unsafe { libc::mlockall(libc::MCL_CURRENT | libc::MCL_FUTURE) == 0 };
    Hardening {
        core_dumps_disabled,
        mlockall_ok,
    }
}

#[cfg(windows)]
pub fn harden() -> Hardening {
    use windows_sys::Win32::System::Diagnostics::Debug::{SetErrorMode, SEM_NOGPFAULTERRORBOX};
    // Desabilita o dialogo de erro e o encaminhamento para o WER neste
    // processo. O vazamento acidental de semente mais comum do mundo e um
    // arquivo de crash.
    let core_dumps_disabled = unsafe {
        SetErrorMode(SEM_NOGPFAULTERRORBOX);
        true
    };
    // `VirtualLock` e por regiao; o equivalente a `mlockall` nao existe. As
    // paginas de segredo sao travadas pelo alocador do processo hospedeiro, e
    // por isso este alvo reporta `false` em vez de mentir `true`.
    Hardening {
        core_dumps_disabled,
        mlockall_ok: false,
    }
}

#[cfg(not(any(unix, windows)))]
pub fn harden() -> Hardening {
    Hardening {
        core_dumps_disabled: false,
        mlockall_ok: false,
    }
}
