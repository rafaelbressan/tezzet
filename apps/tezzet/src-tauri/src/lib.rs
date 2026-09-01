//! Casca do Tezzet.
//!
//! Nesta onda o Rust não tem nada de criptografia: ele abre a janela, deixa o
//! link do explorador ir para o navegador do sistema e dá acesso à área de
//! transferência para a cópia que expira. Chave privada é a onda de custódia,
//! e quando ela chegar mora atrás desta fronteira — nunca no JavaScript.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Tezzet");
}
