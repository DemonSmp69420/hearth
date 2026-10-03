//! Companion web server (F18 / D-021): serves the Hearth UI over the local
//! network so a phone can act as a remote control for the same brain.
//!
//! Trust boundary: the server binds the LAN, pairs via a one-time token shown
//! in Settings, then authenticates every API call with a bearer session.
//! Database reads/writes and generation events are bridged; API keys are NOT —
//! `secrets_get` is refused over the web client so keys never leave the desktop.

use crate::provider::{self, StreamEvent};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use futures::{SinkExt, StreamExt};
use rand::Rng;
use serde_json::{json, Value};
use sqlx::{sqlite::{SqliteConnectOptions, SqlitePool, SqliteRow}, Column, Row, TypeInfo, ValueRef};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;

/// Generation id -> StreamEvent fanout for companion websockets.
static EVENT_BUS: OnceLock<broadcast::Sender<(String, StreamEvent)>> = OnceLock::new();

pub fn publish_event(generation_id: &str, event: StreamEvent) {
    if let Some(bus) = EVENT_BUS.get() {
        let _ = bus.send((generation_id.to_string(), event));
    }
}

// ---------------------------------------------------------------------------
// Server manager (Tauri state) + companion state
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct ServerManager {
    running: Mutex<Option<RunningServer>>,
}

struct RunningServer {
    port: u16,
    pairing_token: String,
    shutdown: Arc<tokio::sync::Notify>,
    companion: CompanionState,
}

#[derive(Clone)]
struct CompanionState {
    app: AppHandle,
    pool: SqlitePool,
    sessions: Arc<RwLock<HashMap<String, SessionInfo>>>,
    pairing_token: Arc<String>,
    dist_dir: PathBuf,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct SessionInfo {
    id: String,
    created_at: i64,
    last_seen: i64,
}

pub const DEFAULT_PORT: u16 = 8770;
const SESSIONS_KEY: &str = "companion_sessions";

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn server_start(
    app: AppHandle,
    manager: tauri::State<'_, ServerManager>,
    port: Option<u16>,
) -> Result<Value, String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    if let Some(running) = manager.running.lock().expect("server manager poisoned").as_ref() {
        return Ok(status_value(running));
    }
    let running = spawn_server(app, port).await?;
    let status = status_value(&running);
    *manager.running.lock().expect("server manager poisoned") = Some(running);
    Ok(status)
}

#[tauri::command]
pub async fn server_stop(manager: tauri::State<'_, ServerManager>) -> Result<(), String> {
    let running = { manager.running.lock().expect("server manager poisoned").take() };
    if let Some(running) = running {
        running.shutdown.notify_waiters();
        persist_sessions(&running.companion).await;
        let _ = running.companion.pool.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn server_status(manager: tauri::State<'_, ServerManager>) -> Result<Value, String> {
    match manager.running.lock().expect("server manager poisoned").as_ref() {
        Some(running) => Ok(status_value(running)),
        None => Ok(json!({ "running": false })),
    }
}

#[tauri::command]
pub async fn server_revoke(
    manager: tauri::State<'_, ServerManager>,
    session_id: String,
) -> Result<(), String> {
    let companion = {
        let guard = manager.running.lock().expect("server manager poisoned");
        guard.as_ref().map(|r| r.companion.clone()).ok_or_else(|| "companion server is not running".to_string())?
    };
    companion
        .sessions
        .write()
        .expect("sessions poisoned")
        .retain(|_, s| s.id != session_id);
    persist_sessions(&companion).await;
    Ok(())
}

/// QR code (SVG) encoding the companion URL, for one-scan pairing.
#[tauri::command]
pub async fn server_pair_qr(manager: tauri::State<'_, ServerManager>) -> Result<String, String> {
    let port = {
        let guard = manager.running.lock().expect("server manager poisoned");
        guard.as_ref().map(|r| r.port).ok_or_else(|| "companion server is not running".to_string())?
    };
    let url = format!("http://{}", lan_addr(port));
    let code = qrcode::QrCode::with_error_correction_level(url.as_bytes(), qrcode::EcLevel::M)
        .map_err(|e| e.to_string())?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .dark_color(qrcode::render::svg::Color("#000000"))
        .light_color(qrcode::render::svg::Color("#ffffff"))
        .quiet_zone(true)
        .build())
}

fn status_value(running: &RunningServer) -> Value {
    let sessions = running.companion.sessions.read().expect("sessions poisoned");
    json!({
        "running": true,
        "port": running.port,
        "url": format!("http://{}", lan_addr(running.port)),
        "localUrl": format!("http://localhost:{}", running.port),
        "pairingToken": running.pairing_token,
        "sessions": sessions.values().collect::<Vec<_>>(),
    })
}

/// Best-effort LAN address for QR/UX display; falls back to the hostname.
fn lan_addr(port: u16) -> String {
    let ip = std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| {
            std::env::var("COMPUTERNAME")
                .or_else(|_| std::env::var("HOSTNAME"))
                .unwrap_or_else(|_| "localhost".into())
        });
    format!("{ip}:{port}")
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

pub(crate) async fn open_pool(db_path: &PathBuf) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(false)
        .busy_timeout(std::time::Duration::from_secs(5));
    SqlitePool::connect_with(options)
        .await
        .map_err(|e| format!("failed to open the Hearth database: {e}"))
}

async fn spawn_server(app: AppHandle, port: u16) -> Result<RunningServer, String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("hearth.db");
    let pool = open_pool(&db_path).await?;

    let sessions = Arc::new(RwLock::new(load_sessions(&pool).await));
    let pairing_token = pairing_token();
    let dist_dir = dist_dir();

    let companion = CompanionState {
        app: app.clone(),
        pool,
        sessions,
        pairing_token: Arc::new(pairing_token.clone()),
        dist_dir,
    };

    let _ = EVENT_BUS.get_or_init(|| {
        let (tx, _) = broadcast::channel(256);
        tx
    });

    let protected = Router::new()
        .route("/api/invoke/{cmd}", post(invoke_handler))
        .route("/ws", get(ws_handler));

    let public = Router::new()
        .route("/api/info", get(info_handler))
        .route("/api/pair", post(pair_handler))
        .fallback(get(static_handler));

    let router = public.merge(protected).with_state(companion.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("cannot bind port {port}: {e}"))?;

    let shutdown = Arc::new(tokio::sync::Notify::new());
    let shutdown_for_task = Arc::clone(&shutdown);

    tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                shutdown_for_task.notified().await;
            })
            .await
            .ok();
    });

    Ok(RunningServer {
        port,
        pairing_token,
        shutdown,
        companion,
    })
}

fn dist_dir() -> PathBuf {
    // Dev: `cargo run` starts in src-tauri, so ../dist is the frontend build.
    // Prod: the UI is embedded and served through the asset resolver; the
    // disk path is only a fallback.
    PathBuf::from("../dist")
}

fn pairing_token() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::rng();
    let raw: Vec<u8> = (0..8)
        .map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())])
        .collect();
    let s = String::from_utf8(raw).expect("ascii");
    format!("{}-{}", &s[..4], &s[4..])
}

fn session_token() -> String {
    let mut rng = rand::rng();
    (0..16).map(|_| format!("{:02x}", rng.random::<u8>())).collect()
}

async fn load_sessions(pool: &SqlitePool) -> HashMap<String, SessionInfo> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(SESSIONS_KEY)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    row.and_then(|(v,)| serde_json::from_str(&v).ok()).unwrap_or_default()
}

async fn persist_sessions(state: &CompanionState) {
    let value = {
        let sessions = state.sessions.read().expect("sessions poisoned");
        serde_json::to_string(&*sessions).unwrap_or_else(|_| "{}".into())
    };
    let _ = sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(SESSIONS_KEY)
    .bind(value)
    .execute(&state.pool)
    .await;
}

// ---------------------------------------------------------------------------
// Auth + pairing (header-based; applied inside the protected handlers)
// ---------------------------------------------------------------------------

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::to_owned)
}

fn is_authorized(state: &CompanionState, headers: &HeaderMap) -> bool {
    let Some(token) = bearer_token(headers) else {
        return false;
    };
    let authorized = state.sessions.read().expect("sessions poisoned").contains_key(&token);
    if authorized {
        let mut sessions = state.sessions.write().expect("sessions poisoned");
        if let Some(info) = sessions.get_mut(&token) {
            info.last_seen = now_ms();
        }
    }
    authorized
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized — pair this device in Hearth Settings" })),
    )
        .into_response()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

async fn info_handler() -> impl IntoResponse {
    Json(json!({ "app": "hearth-companion", "version": env!("CARGO_PKG_VERSION") }))
}

async fn pair_handler(
    State(state): State<CompanionState>,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(body)) = body else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "missing body" }))).into_response();
    };
    let supplied = body.get("token").and_then(|t| t.as_str()).unwrap_or("");
    if !tokens_match(&state.pairing_token, supplied) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "invalid pairing token" })),
        )
            .into_response();
    }
    let id = session_token();
    let info = SessionInfo { id: id.clone(), created_at: now_ms(), last_seen: now_ms() };
    state
        .sessions
        .write()
        .expect("sessions poisoned")
        .insert(id.clone(), info);
    persist_sessions(&state).await;
    Json(json!({ "session": id })).into_response()
}

fn tokens_match(expected: &str, supplied: &str) -> bool {
    let e = expected.bytes().collect::<Vec<_>>();
    let s = supplied.bytes().collect::<Vec<_>>();
    e.len() == s.len() && e.iter().zip(s.iter()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

// ---------------------------------------------------------------------------
// Command bridge: POST /api/invoke/{cmd}
// ---------------------------------------------------------------------------

async fn invoke_handler(
    State(state): State<CompanionState>,
    Path(cmd): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !is_authorized(&state, &headers) {
        return unauthorized();
    }
    let args = match body {
        Ok(Json(v)) => v,
        Err(_) => json!({}),
    };
    let result: Result<Value, String> = match cmd.as_str() {
        "db_select" => db_select(&state, &args).await,
        "db_execute" => db_execute(&state, &args).await,
        "provider_stream" => provider_stream_bridge(&state, &args),
        "janny_fetch_character" => {
            let uuid = str_arg(&args, "uuid");
            crate::janny_fetch_character(uuid)
                .await
                .map(|data_url| json!(data_url))
        }
        "provider_cancel" => {
            let generation_id = args
                .get("generation_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            provider::provider_cancel(state.app.state::<provider::CancellationMap>(), generation_id)
                .map(|_| json!(null))
        }
        "provider_test" => {
            let kind = str_arg(&args, "kind");
            let base_url = str_arg(&args, "base_url");
            let account = opt_str_arg(&args, "api_key_account");
            provider::provider_test(kind, base_url, account).await
        }
        "provider_list_models" => {
            let kind = str_arg(&args, "kind");
            let base_url = str_arg(&args, "base_url");
            let account = opt_str_arg(&args, "api_key_account");
            provider::provider_list_models(kind, base_url, account)
                .await
                .map(|v| json!(v))
        }
        "secrets_set" => {
            let account = str_arg(&args, "account");
            let secret = str_arg(&args, "secret");
            secrets_set_impl(&account, &secret).map(|_| json!(null))
        }
        // D-021: API keys never leave the desktop. The web client gets a
        // null (UI treats it as "key stored, not shown"); writes still work.
        "secrets_get" => Ok(json!(null)),
        "secrets_delete" => {
            let account = str_arg(&args, "account");
            secrets_delete_impl(&account).map(|_| json!(null))
        }
        other => Err(format!("unknown command over companion server: {other}")),
    };

    match result {
        Ok(data) => Json(json!({ "ok": true, "data": data })).into_response(),
        Err(message) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "error": message })),
        )
            .into_response(),
    }
}

fn str_arg(args: &Value, key: &str) -> String {
    args.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn opt_str_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

async fn db_select(state: &CompanionState, args: &Value) -> Result<Value, String> {
    let query = str_arg(args, "query");
    let values = args
        .get("values")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut q = sqlx::query(&query);
    for v in values {
        q = bind_value(q, v);
    }
    let rows = q.fetch_all(&state.pool).await.map_err(|e| e.to_string())?;
    let out: Vec<Value> = rows.iter().map(row_to_json).collect();
    Ok(json!(out))
}

async fn db_execute(state: &CompanionState, args: &Value) -> Result<Value, String> {
    let query = str_arg(args, "query");
    let values = args
        .get("values")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut q = sqlx::query(&query);
    for v in values {
        q = bind_value(q, v);
    }
    let result = q.execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(json!({
        "rowsAffected": result.rows_affected(),
        "lastInsertId": result.last_insert_rowid(),
    }))
}

fn bind_value<'q>(
    q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    v: Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match v {
        Value::Null => q.bind(None::<String>),
        Value::Bool(b) => q.bind(if b { 1i64 } else { 0i64 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                q.bind(i)
            } else {
                q.bind(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => q.bind(s),
        other => q.bind(other.to_string()),
    }
}

fn row_to_json(row: &SqliteRow) -> Value {
    let mut map = serde_json::Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        map.insert(col.name().to_string(), value_to_json(row, i));
    }
    Value::Object(map)
}

fn value_to_json(row: &SqliteRow, i: usize) -> Value {
    let Ok(raw) = row.try_get_raw(i) else {
        return Value::Null;
    };
    if raw.is_null() {
        return Value::Null;
    }
    match raw.type_info().name() {
        "INTEGER" => row.try_get::<i64, _>(i).map(|v| json!(v)).unwrap_or(Value::Null),
        "REAL" => row.try_get::<f64, _>(i).map(|v| json!(v)).unwrap_or(Value::Null),
        "TEXT" => row.try_get::<String, _>(i).map(|v| json!(v)).unwrap_or(Value::Null),
        "BLOB" => row
            .try_get::<Vec<u8>, _>(i)
            .ok()
            .map(|b| json!(String::from_utf8_lossy(&b).to_string()))
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn provider_stream_bridge(state: &CompanionState, args: &Value) -> Result<Value, String> {
    // The tauri client wraps command args by parameter name: { request: {...} }.
    let payload = args.get("request").unwrap_or(args);
    let request: provider::ProviderRequest =
        serde_json::from_value(payload.clone()).map_err(|e| format!("bad provider request: {e}"))?;
    let app = state.app.clone();
    provider::provider_stream(app.clone(), app.state::<provider::CancellationMap>(), request)
        .map(|id| json!(id))
}

fn secrets_set_impl(account: &str, secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new("hearth", account).map_err(|e| e.to_string())?;
    entry.set_password(secret).map_err(|e| e.to_string())
}

fn secrets_delete_impl(account: &str) -> Result<(), String> {
    let entry = keyring::Entry::new("hearth", account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// WebSocket event stream: sub/unsub by topic, forwards provider events
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WsIn {
    Sub { topic: String },
    Unsub { topic: String },
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<CompanionState>,
) -> Response {
    // Browsers cannot set custom headers on WebSocket connections, so the
    // session token travels as a query parameter and is the only WS auth.
    let token = params.get("session").cloned().unwrap_or_default();
    if !state.sessions.read().expect("sessions poisoned").contains_key(&token) {
        return unauthorized();
    }
    ws.on_upgrade(move |socket| ws_loop(socket))
}

async fn ws_loop(socket: WebSocket) {
    let (mut tx, mut rx) = socket.split();
    let mut bus = match EVENT_BUS.get() {
        Some(b) => b.subscribe(),
        None => return,
    };
    let mut topics: Vec<String> = Vec::new();

    loop {
        tokio::select! {
            incoming = rx.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(msg) = serde_json::from_str::<WsIn>(&text) {
                            match msg {
                                WsIn::Sub { topic } => topics.push(topic),
                                WsIn::Unsub { topic } => topics.retain(|t| *t != topic),
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            event = bus.recv() => {
                match event {
                    Ok((generation_id, ev)) => {
                        let topic = format!("provider://stream/{generation_id}");
                        if topics.iter().any(|t| *t == topic) {
                            let payload = serde_json::to_string(
                                &json!({ "topic": topic, "payload": ev }),
                            )
                            .unwrap_or_default();
                            if tx.send(Message::Text(payload.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Static UI (embedded assets in prod, ../dist in dev) + companion flag inject
// ---------------------------------------------------------------------------

const COMPANION_FLAG: &str = "<script>window.__HEARTH_COMPANION__=true;</script>";

async fn static_handler(
    State(state): State<CompanionState>,
    req: axum::extract::Request,
) -> Response {
    let path = req.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(bytes) = embedded_asset(&state.app, path) {
        return asset_response(path, &bytes);
    }
    let disk = state.dist_dir.join(path);
    if disk.is_file() {
        if let Ok(bytes) = std::fs::read(&disk) {
            return asset_response(path, &bytes);
        }
    }
    if !path.starts_with("assets/") {
        // SPA fallback -> index.html with the companion flag injected.
        if let Some(bytes) = embedded_asset(&state.app, "index.html") {
            return html_response(&bytes);
        }
        if let Ok(bytes) = std::fs::read(state.dist_dir.join("index.html")) {
            return html_response(&bytes);
        }
    }
    (StatusCode::NOT_FOUND, "not found").into_response()
}

fn embedded_asset(app: &AppHandle, path: &str) -> Option<Vec<u8>> {
    Some(app.asset_resolver().get(path.to_string())?.bytes)
}

fn asset_response(path: &str, bytes: &[u8]) -> Response {
    if path.ends_with(".html") {
        return html_response(bytes);
    }
    let mime = mime_for(path);
    ([(header::CONTENT_TYPE, mime)], bytes.to_vec()).into_response()
}

fn html_response(bytes: &[u8]) -> Response {
    let html = String::from_utf8_lossy(bytes).to_string();
    let injected = if html.contains("__HEARTH_COMPANION__") {
        html
    } else if let Some(pos) = html.find("</head>") {
        let mut out = String::with_capacity(html.len() + COMPANION_FLAG.len());
        out.push_str(&html[..pos]);
        out.push_str(COMPANION_FLAG);
        out.push_str(&html[pos..]);
        out
    } else {
        format!("{COMPANION_FLAG}{html}")
    };
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], injected).into_response()
}

fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "html" => "text/html; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "application/octet-stream",
    }
}

// ---------------------------------------------------------------------------
// Boot auto-start (settings.companion_server.enabled)
// ---------------------------------------------------------------------------

pub async fn autostart(app: AppHandle) {
    let db_path = match app.path().app_data_dir() {
        Ok(p) => p.join("hearth.db"),
        Err(_) => return,
    };
    if !db_path.exists() {
        return; // first run: webview migrations haven't created the DB yet
    }
    let pool = match open_pool(&db_path).await {
        Ok(p) => p,
        Err(_) => return,
    };
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = 'companion_server'")
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    let _ = pool.close().await;
    let Some((value,)) = row else { return };
    let Ok(cfg) = serde_json::from_str::<Value>(&value) else { return };
    if cfg.get("enabled").and_then(|v| v.as_bool()) != Some(true) {
        return;
    }
    let port = cfg
        .get("port")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_PORT as u64) as u16;
    let manager = app.state::<ServerManager>();
    if manager.running.lock().expect("server manager poisoned").is_some() {
        return;
    }
    let status = match spawn_server(app.clone(), port).await {
        Ok(running) => {
            *manager.running.lock().expect("server manager poisoned") = Some(running);
            json!({ "running": true, "port": port })
        }
        Err(e) => json!({ "running": false, "error": e }),
    };
    let _ = app.emit("companion://status", status);
}
