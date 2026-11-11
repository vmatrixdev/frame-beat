use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct EngineOutput {
    pub stdout: String,
    pub stderr: String,
    pub status: i32,
}

#[tauri::command]
pub async fn invoke_engine<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    args: Vec<String>,
) -> Result<EngineOutput, String> {
    // Try sidecar binary "amv-engine" first; fall back to python script invocation
    if let Ok(sidecar) = app.shell().sidecar("amv-engine") {
        let output = sidecar
            .args(&args)
            .output()
            .await
            .map_err(|e| e.to_string())?;

        Ok(EngineOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            status: output.status.code().unwrap_or(-1),
        })
    } else {
        // Fallback: direct process invocation with python / uv
        let mut cmd = Command::new("python3");
        cmd.arg("engine/main.py").args(&args);

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to spawn python engine: {}", e))?;

        Ok(EngineOutput {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            status: output.status.code().unwrap_or(-1),
        })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![invoke_engine])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
