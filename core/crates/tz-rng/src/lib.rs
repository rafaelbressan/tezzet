//! §4.1 e §9.1 — a fonte de entropia, nomeada, e o que acontece quando ela falha.
//!
//! Esta crate existe separada por uma razao so: ela e o **unico** lugar do
//! nucleo que fala com o sistema operacional para pedir bytes aleatorios. Isso
//! deixa a auditoria da §4.1 ser a leitura de um arquivo.
//!
//! # O que esta crate garante
//! - Que os bytes vem do CSPRNG do sistema operacional, e de mais nada.
//! - Que a chamada de sistema esta **nomeada** em [`ENTROPY_SYSCALL`], para o
//!   relatorio de build dizer o nome da syscall e nao o nome da fachada
//!   (criterio §9.1).
//! - Que a falha e um erro. **Nao existe fallback.** Nem para um PRNG de
//!   espaco de usuario, nem para `/dev/urandom` por arquivo, nem para uma
//!   mistura de fontes.
//!
//! # O que ela nao garante
//! - Que o CSPRNG do sistema e bom. Se o kernel mentir, nada aqui detecta.
//! - Entropia em alvo que nao seja Linux, Android ou Windows: nesses,
//!   [`fill`] **falha sempre**, de proposito. Um fallback silencioso e o unico
//!   erro deste arquivo que produz carteira previsivel — e previsivel e
//!   sinonimo de perdida.

#![forbid(unsafe_op_in_unsafe_fn)]

use core::fmt;

/// A unica falha que esta crate produz.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntropyUnavailable;

impl fmt::Display for EntropyUnavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CSPRNG do sistema indisponivel")
    }
}

impl std::error::Error for EntropyUnavailable {}

/// Nome da **chamada de sistema** deste build. Vai no relatorio de build (§9.1).
///
/// Nao e o nome da crate de fachada de proposito: a §9.1 pede que o relatorio
/// nomeie a syscall, para a afirmacao ser verificavel por `strace` em vez de
/// por leitura de documentacao.
pub const ENTROPY_SYSCALL: &str = syscall_name();

const fn syscall_name() -> &'static str {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        "getrandom(2)"
    }
    #[cfg(target_os = "windows")]
    {
        "BCryptGenRandom(BCRYPT_USE_SYSTEM_PREFERRED_RNG)"
    }
    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "windows")))]
    {
        "nenhuma -- alvo nao suportado"
    }
}

#[cfg(feature = "fault-injection")]
mod fault {
    use std::sync::atomic::{AtomicBool, Ordering};
    static DOWN: AtomicBool = AtomicBool::new(false);

    /// Simula o CSPRNG fora do ar. So existe com a feature `fault-injection`.
    pub fn set_csprng_unavailable(down: bool) {
        DOWN.store(down, Ordering::SeqCst);
    }

    pub(super) fn is_down() -> bool {
        DOWN.load(Ordering::SeqCst)
    }
}

#[cfg(feature = "fault-injection")]
pub use fault::set_csprng_unavailable;

#[cfg(feature = "fault-injection")]
#[inline(always)]
fn is_down() -> bool {
    fault::is_down()
}

#[cfg(not(feature = "fault-injection"))]
#[inline(always)]
fn is_down() -> bool {
    false
}

/// Preenche `buf` com bytes do CSPRNG do sistema, ou falha.
///
/// Um `Err` aqui **aborta** a operacao que chamou. Sal, DEK, nonce e entropia
/// de mnemonica saem todos daqui: um nonce previsivel quebra o AEAD tao bem
/// quanto uma semente previsivel quebra a carteira.
pub fn fill(buf: &mut [u8]) -> Result<(), EntropyUnavailable> {
    if is_down() {
        return Err(EntropyUnavailable);
    }
    fill_from_os(buf)
}

/// Conveniencia com tamanho conhecido em tempo de compilacao.
pub fn bytes<const N: usize>() -> Result<[u8; N], EntropyUnavailable> {
    let mut b = [0u8; N];
    fill(&mut b)?;
    Ok(b)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn fill_from_os(buf: &mut [u8]) -> Result<(), EntropyUnavailable> {
    let mut done = 0usize;
    while done < buf.len() {
        // `getrandom(2)` direto, sem crate de fachada no meio. flags = 0:
        // bloqueia ate o pool estar pronto. Sem fallback por arquivo, que e o
        // caminho que falha em silencio quando nao ha descritor livre.
        let n = unsafe {
            libc::getrandom(
                buf[done..].as_mut_ptr().cast::<libc::c_void>(),
                buf.len() - done,
                0,
            )
        };
        if n < 0 {
            let e = std::io::Error::last_os_error();
            if e.raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            return Err(EntropyUnavailable);
        }
        if n == 0 {
            return Err(EntropyUnavailable);
        }
        done += n as usize;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn fill_from_os(buf: &mut [u8]) -> Result<(), EntropyUnavailable> {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };
    // §4.1 — `BCryptGenRandom` com `BCRYPT_USE_SYSTEM_PREFERRED_RNG`. O buffer
    // e fatiado porque o parametro de tamanho e u32.
    for chunk in buf.chunks_mut(u32::MAX as usize) {
        let status = unsafe {
            BCryptGenRandom(
                core::ptr::null_mut(),
                chunk.as_mut_ptr(),
                chunk.len() as u32,
                BCRYPT_USE_SYSTEM_PREFERRED_RNG,
            )
        };
        if status != 0 {
            return Err(EntropyUnavailable);
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_os = "windows")))]
fn fill_from_os(_buf: &mut [u8]) -> Result<(), EntropyUnavailable> {
    // Alvos da suite: Linux, Windows e Android (ADR-0001 §8). Deixar um
    // fallback aqui seria exatamente o defeito que a §4.1 proibe pelo nome.
    Err(EntropyUnavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_syscall_esta_nomeada() {
        assert!(!ENTROPY_SYSCALL.starts_with("nenhuma"), "alvo sem CSPRNG");
    }

    #[test]
    fn dois_pedidos_nao_dao_o_mesmo_bloco() {
        let a: [u8; 32] = bytes().unwrap();
        let b: [u8; 32] = bytes().unwrap();
        assert_ne!(a, b);
        assert_ne!(a, [0u8; 32]);
    }

    #[test]
    fn preenche_tamanho_que_nao_e_multiplo_de_nada() {
        let mut v = vec![0u8; 4097];
        fill(&mut v).unwrap();
        assert!(v.iter().any(|&x| x != 0));
    }
}
