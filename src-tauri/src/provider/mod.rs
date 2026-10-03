pub mod anthropic;
pub mod gemini;
pub mod mock;
pub mod openai_compat;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Deserialize, Serialize)]
pub struct ReqMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct ProviderRequest {
    pub generation_id: String,
    pub kind: String,
    pub base_url: String,
    pub api_key_account: Option<String>,
    pub model: String,
    pub messages: Vec<ReqMessage>,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta { text: String },
    Usage { prompt_tokens: u64, completion_tokens: u64 },
    Done { finish_reason: String },
    Error { message: String },
}

/// Generation id -> cancel flag. The webview never holds keys or network
/// handles; it only addresses generations. Cheaply cloned into tasks via Arc.
#[derive(Default, Clone)]
pub struct CancellationMap(pub Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

impl CancellationMap {
    fn register(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.0.lock().expect("cancellation map poisoned").insert(id.to_string(), flag.clone());
        flag
    }

    fn cancel(&self, id: &str) {
        if let Some(flag) = self.0.lock().expect("cancellation map poisoned").get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    fn unregister(&self, id: &str) {
        self.0.lock().expect("cancellation map poisoned").remove(id);
    }
}

pub fn emit_event(app: &AppHandle, generation_id: &str, event: StreamEvent) {
    let _ = app.emit(&format!("provider://stream/{generation_id}"), event.clone());
    crate::server::publish_event(generation_id, event);
}

/// Reads the profile's API key from the OS keychain at call time. Empty when
/// absent — local endpoints need no key.
pub fn read_key(account: &Option<String>) -> Result<String, String> {
    let Some(account) = account else {
        return Ok(String::new());
    };
    if account.is_empty() {
        return Ok(String::new());
    }
    let entry = keyring::Entry::new("hearth", account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(secret) => Ok(secret),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Spawns the generation task and returns immediately with the generation id.
#[tauri::command]
pub fn provider_stream(
    app: AppHandle,
    state: State<'_, CancellationMap>,
    request: ProviderRequest,
) -> Result<String, String> {
    let generation_id = request.generation_id.clone();
    let flag = state.register(&generation_id);
    let cancellations = state.inner().clone();
    let task_app = app.clone();
    let task_gid = generation_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = match request.kind.as_str() {
            "mock" => mock::stream(&task_app, &request, &flag).await,
            "openai_compat" => openai_compat::stream(&task_app, &request, &flag).await,
            "anthropic" => anthropic::stream(&task_app, &request, &flag).await,
            "gemini" => gemini::stream(&task_app, &request, &flag).await,
            other => Err(format!("unknown provider kind: {other}")),
        };
        if let Err(message) = result {
            emit_event(&task_app, &task_gid, StreamEvent::Error { message });
        }
        cancellations.unregister(&task_gid);
    });
    Ok(generation_id)
}

#[tauri::command]
pub fn provider_cancel(state: State<'_, CancellationMap>, generation_id: String) -> Result<(), String> {
    state.cancel(&generation_id);
    Ok(())
}

/// Kind-aware model-list probe so Test Connection / Fetch Models work for
/// every wire protocol, not just OpenAI-compatible ones.
fn models_probe(kind: &str, base_url: &str, key: &str) -> (String, reqwest::RequestBuilder) {
    let client = reqwest::Client::new();
    let base = base_url.trim_end_matches('/');
    match kind {
        "anthropic" => {
            let base = base.strip_suffix("/v1").unwrap_or(base);
            let url = format!("{base}/v1/models");
            let req = client
                .get(&url)
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01");
            (url, req)
        }
        "gemini" => {
            let base = base.strip_suffix("/v1beta").unwrap_or(base);
            let url = format!("{base}/v1beta/models");
            let req = client.get(&url).header("x-goog-api-key", key);
            (url, req)
        }
        // openai_compat and mock (mock never hits this path in practice)
        _ => {
            let url = format!("{base}/models");
            let mut req = client.get(&url);
            if !key.is_empty() {
                req = req.bearer_auth(key);
            }
            (url, req)
        }
    }
}

fn parse_model_ids(value: &serde_json::Value) -> Vec<String> {
    // OpenAI: data[].id · Anthropic: data[].id · Gemini: models[].name ("models/x")
    let names = value
        .get("models")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("name").and_then(|i| i.as_str()))
                .map(|s| s.strip_prefix("models/").unwrap_or(s).to_string())
                .collect::<Vec<_>>()
        });
    names.unwrap_or_else(|| {
        value
            .get("data")
            .and_then(|d| d.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// GET the profile's model list with its key. Diagnostics name the endpoint.
#[tauri::command]
pub async fn provider_test(
    kind: String,
    base_url: String,
    api_key_account: Option<String>,
) -> Result<serde_json::Value, String> {
    let key = read_key(&api_key_account)?;
    let (url, req) = models_probe(&kind, &base_url, &key);
    let response = req.send().await.map_err(|e| format!("request failed: {e}"))?;
    let status = response.status();
    if status.is_success() {
        Ok(serde_json::json!({ "ok": true, "detail": format!("{url} → {status}") }))
    } else {
        let text = response.text().await.unwrap_or_default();
        Ok(serde_json::json!({ "ok": false, "detail": format!("{url} → {status}: {text}") }))
    }
}

#[tauri::command]
pub async fn provider_list_models(
    kind: String,
    base_url: String,
    api_key_account: Option<String>,
) -> Result<Vec<String>, String> {
    let key = read_key(&api_key_account)?;
    let (url, req) = models_probe(&kind, &base_url, &key);
    let response = req.send().await.map_err(|e| format!("request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("{} → {}", url, response.status()));
    }
    let value: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(parse_model_ids(&value))
}
