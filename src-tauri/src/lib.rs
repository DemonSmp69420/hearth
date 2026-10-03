use keyring::Entry;
use tauri_plugin_sql::{Migration, MigrationKind};

mod backup;
mod provider;
mod server;

const SERVICE: &str = "hearth";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "fts5 index",
            sql: include_str!("../../migrations/0002_fts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "chat tags",
            sql: include_str!("../../migrations/0003_chat_tags.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "prompt entry sort",
            sql: include_str!("../../migrations/0004_entry_sort.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "group chats",
            sql: include_str!("../../migrations/0005_group_chats.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "chapters",
            sql: include_str!("../../migrations/0006_chapters.sql"),
            kind: MigrationKind::Up,
        },
    ];
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:hearth.db", migrations)
                .build(),
        )
        .manage(provider::CancellationMap::default())
        .manage(server::ServerManager::default())
        .setup(|app| {
            tauri::async_runtime::spawn(server::autostart(app.handle().clone()));
            tauri::async_runtime::spawn(backup::scheduler(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secrets_set,
            secrets_get,
            secrets_delete,
            save_text_file,
            open_text_file,
            backup_now,
            janny_fetch_character,
            provider::provider_stream,
            provider::provider_cancel,
            provider::provider_test,
            provider::provider_list_models,
            server::server_start,
            server::server_stop,
            server::server_status,
            server::server_revoke,
            server::server_pair_qr
        ])
        .run(tauri::generate_context!())
        .expect("failed to run hearth");
}

// ---- Secrets (API keys, proxy passwords) ----
// Keys live ONLY in the OS keychain, keyed by account (profile id or `proxy:<id>`).
// They never enter the database, exports, logs, or IPC payloads in the other direction.

#[tauri::command]
fn secrets_set(account: String, secret: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    entry.set_password(&secret).map_err(|e| e.to_string())
}

#[tauri::command]
fn secrets_get(account: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secrets_delete(account: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---- Backups ----

#[tauri::command]
async fn backup_now(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    backup::run_backup(&app).await
}

// ---- Character link import (JannyAI mirror of JanitorAI; same approach as SillyTavern) ----

#[tauri::command]
async fn janny_fetch_character(uuid: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("https://api.jannyai.com/api/v1/download")
        .timeout(std::time::Duration::from_secs(30))
        .json(&serde_json::json!({ "characterId": uuid }))
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status()));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| format!("bad response: {e}"))?;
    let status = body.get("status").and_then(|s| s.as_str()).unwrap_or("");
    if status != "ok" {
        let msg = body
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("character not found in the JannyAI dataset");
        return Err(format!("api: {msg}"));
    }
    let url = body
        .get("downloadUrl")
        .and_then(|u| u.as_str())
        .ok_or_else(|| "api: response had no download URL".to_string())?;
    let img = client
        .get(url)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("download: {e}"))?;
    if !img.status().is_success() {
        return Err(format!("download http {}", img.status()));
    }
    let bytes = img.bytes().await.map_err(|e| format!("read: {e}"))?;
    use base64::Engine as _;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

// ---- Import / export file dialogs (desktop only; companion uses browser download) ----

#[derive(serde::Serialize)]
pub struct OpenTextFile {
    name: String,
    contents: String,
}

#[tauri::command]
async fn save_text_file(file_name: String, contents: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new().set_file_name(&file_name).save_file() else {
            return Ok(None);
        };
        std::fs::write(&path, contents).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_text_file(extensions: Option<Vec<String>>) -> Result<Option<OpenTextFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exts = extensions.unwrap_or_default();
        let mut dialog = rfd::FileDialog::new();
        if !exts.is_empty() {
            let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
            dialog = dialog.add_filter("Supported files", &refs);
        }
        let Some(path) = dialog.pick_file() else {
            return Ok(None);
        };
        let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        Ok(Some(OpenTextFile {
            name: path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            contents,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
