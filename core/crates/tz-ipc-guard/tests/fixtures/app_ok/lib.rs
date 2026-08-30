//! Fixture: um shell Tauri minusculo cuja superficie de IPC esta enumerada.
use tauri::command;

#[tauri::command]
pub fn create_wallet() -> Result<String, String> {
    Ok(String::new())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn unlock() -> Result<(), String> {
    Ok(())
}

/// Um comentario entre o atributo e a `fn` nao pode confundir o varredor.
#[command]
#[allow(dead_code)]
pub fn sign_operation(_bytes: Vec<u8>) -> Result<String, String> {
    Ok(String::new())
}

// Isto nao e comando e nao pode contar.
pub fn helper_interno() {}
