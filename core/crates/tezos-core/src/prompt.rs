//! §8 — verificacao de usuario, e a regra que nao tem `if`.
//!
//! > **Toda assinatura exige verificacao de usuario nativa. Biometria e
//! > substituto aceito do PIN onde a plataforma oferece prompt respaldado por
//! > hardware. Onde nao oferece, o mecanismo e o PIN em janela nativa. Nunca
//! > cai em silencio.**
//!
//! **Nao existe `if (biometria_disponivel)`.** Ausencia de mecanismo nao e
//! permissao — e erro. O portao e "uma verificacao de usuario nativa teve
//! sucesso", e essa e a proposicao que o codigo testa. O item 15 do
//! anti-catalogo nomeia o defeito que isso evita, e ele aconteceu no spike
//! BRES-36 (`lib.rs:132`).
//!
//! # Por que a passphrase entra por aqui e nao por parametro
//!
//! §8.2: passphrase e PIN **NAO DEVEM** ser coletados por HTML. A consequencia
//! direta e verificavel na API e esta: nenhuma funcao publica deste nucleo
//! recebe senha como argumento. `create_wallet`, `unlock` e `sign` recebem um
//! [`UserPrompt`], e **o nucleo coleta**. O item 14 do anti-catalogo e
//! justamente "senha como parametro de comando da fronteira".
//!
//! # O que este modulo garante
//! - Que existe um lugar unico onde o produto pluga o dialogo nativo.
//! - Que o caminho de assinar chama [`UserPrompt::verify_user`] **antes** de
//!   assinar, e propaga a recusa.
//!
//! # O que ele nao garante
//! - Que o produto implementou um prompt de verdade. Um `UserPrompt` que
//!   devolve `Ok(())` sem perguntar nada e uma fraude, e nenhum tipo detecta
//!   isso — e por isso que a revisao da implementacao por plataforma e
//!   obrigatoria (§8.2).
//! - Nada sob X11 no Linux (N6): qualquer cliente da mesma sessao le o teclado
//!   de qualquer outro, e um dialogo GTK **nao** esta protegido. Sob Wayland
//!   esta. O prompt nativo continua estritamente melhor que a webview, e nao e
//!   blindado.

use crate::error::Result;
use tz_keys::secret::Phrase;

/// Para que a verificacao esta sendo pedida. Vai no texto do dialogo nativo:
/// um prompt que nao diz o que vai acontecer treina o usuario a aceitar tudo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    /// Criar carteira nova.
    CreateWallet,
    /// Destravar o cofre para entrar (§8.3).
    Unlock,
    /// Assinar uma operacao (§8.4 — PIN de transacao).
    SignOperation,
    /// Trocar a passphrase (§4.8).
    RotatePassphrase,
}

/// O dialogo **nativo do sistema operacional**. Implementado pelo produto:
/// `BiometricPrompt` no Android, `UserConsentVerifier` no Windows, dialogo GTK
/// no Linux.
pub trait UserPrompt {
    /// Coleta a passphrase. **Nunca** de um `<input>` HTML.
    fn passphrase(&self, purpose: Purpose) -> Result<Phrase>;

    /// Verificacao de usuario nativa: biometria onde ha prompt respaldado por
    /// hardware, PIN em janela nativa onde nao ha.
    ///
    /// Devolver `Err(crate::error::CoreError::UserVerificationFailed)` e o comportamento
    /// correto quando o usuario nega **e** quando a plataforma nao tem
    /// mecanismo. As duas coisas sao "nao verificou".
    fn verify_user(&self, purpose: Purpose) -> Result<()>;
}
