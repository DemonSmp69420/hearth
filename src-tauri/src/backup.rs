// ---------------------------------------------------------------------------
// Backups (M4.8): scheduled VACUUM INTO + rotation (F14)
// ---------------------------------------------------------------------------
// A live WAL database must be backed up with VACUUM INTO, never a file copy.
// The scheduler reads its config from the `settings` table (key 'backups':
// { enabled, interval_hours, keep }) and records the last run under
// 'backups_last' (ms epoch). The UI writes the same keys.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::server::open_pool;

const DEFAULT_KEEP: usize = 7;
const CHECK_INTERVAL_SECS: u64 = 30 * 60;

fn parse_config(value: Option<Value>) -> (bool, u64, usize) {
    match value {
        Some(v) => {
            let enabled = v.get("enabled").and_then(|x| x.as_bool()).unwrap_or(false);
            let interval = v.get("interval_hours").and_then(|x| x.as_u64()).unwrap_or(24).max(1);
            let keep = v
                .get("keep")
                .and_then(|x| x.as_u64())
                .unwrap_or(DEFAULT_KEEP as u64)
                .clamp(1, 60) as usize;
            (enabled, interval, keep)
        }
        None => (false, 24, DEFAULT_KEEP),
    }
}

async fn read_setting(pool: &sqlx::SqlitePool, key: &str) -> Option<Value> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    row.and_then(|(v,)| serde_json::from_str(&v).ok())
}

async fn write_setting(pool: &sqlx::SqlitePool, key: &str, value: Value) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(serde_json::to_string(&value).map_err(|e| e.to_string())?)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Keep the newest `keep` files named `hearth-*.db`; delete the rest.
/// Returns (kept, removed).
fn rotate(dir: &Path, keep: usize) -> Result<(usize, usize), String> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            matches!(p.extension().and_then(|e| e.to_str()), Some("db"))
                && p.file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .starts_with("hearth-")
        })
        .collect();
    files.sort();
    let total = files.len();
    let mut removed = 0;
    if total > keep {
        for p in &files[..total - keep] {
            if std::fs::remove_file(p).is_ok() {
                removed += 1;
            }
        }
    }
    Ok((total - removed, removed))
}

/// Create one backup now. Returns the backup path + rotation summary.
pub async fn run_backup(app: &tauri::AppHandle) -> Result<Value, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = data_dir.join("hearth.db");
    if !db_path.exists() {
        return Err("database not found".into());
    }
    let backup_dir = data_dir.join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let pool = open_pool(&db_path).await?;
    let cfg = parse_config(read_setting(&pool, "backups").await);
    let keep = cfg.2;

    // VACUUM INTO refuses to overwrite, so a collision is an error — the ms
    // timestamp makes that practically impossible.
    let out = backup_dir.join(format!("hearth-{}.db", now_ms()));
    sqlx::query("VACUUM INTO ?")
        .bind(out.to_string_lossy().as_ref())
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    write_setting(&pool, "backups_last", json!(now_ms())).await?;
    let _ = pool.close().await;

    let (kept, removed) = rotate(&backup_dir, keep)?;
    Ok(json!({ "path": out.to_string_lossy(), "kept": kept, "removed": removed }))
}

async fn maybe_run_scheduled(app: &tauri::AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = data_dir.join("hearth.db");
    if !db_path.exists() {
        return Ok(());
    }
    let pool = open_pool(&db_path).await?;
    let cfg = parse_config(read_setting(&pool, "backups").await);
    let last = read_setting(&pool, "backups_last")
        .await
        .and_then(|v| v.as_u64());
    let _ = pool.close().await;

    let (enabled, interval_hours, _) = cfg;
    if !enabled {
        return Ok(());
    }
    if let Some(last) = last {
        if now_ms().saturating_sub(last) < interval_hours * 3_600_000 {
            return Ok(());
        }
    }
    run_backup(app).await.map(|_| ())
}

/// Hourly-ish loop; first run happens on the next tick after boot.
pub async fn scheduler(app: tauri::AppHandle) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(CHECK_INTERVAL_SECS)).await;
        if let Err(e) = maybe_run_scheduled(&app).await {
            eprintln!("scheduled backup failed: {e}");
        }
    }
}
