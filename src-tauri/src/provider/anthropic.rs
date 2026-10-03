//! Native Anthropic Messages API adapter (M1.2).
//! Base URL convention: `https://api.anthropic.com` (a trailing `/v1` is
//! tolerated). System text goes top-level; user/assistant become messages.

use super::{emit_event, read_key, ProviderRequest, StreamEvent};
use futures::StreamExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;

pub fn messages_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let base = base.strip_suffix("/v1").unwrap_or(base);
    format!("{base}/v1/messages")
}

pub fn build_body(request: &ProviderRequest) -> serde_json::Value {
    let system: Vec<&String> = request
        .messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| &m.content)
        .collect();
    let messages: Vec<serde_json::Value> = request
        .messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| {
            serde_json::json!({
                "role": m.role,
                "content": m.content,
            })
        })
        .collect();

    let params = &request.params;
    let mut body = serde_json::json!({
        "model": request.model,
        "max_tokens": params.get("max_tokens").and_then(|v| v.as_u64()).unwrap_or(1024),
        "stream": true,
        "messages": messages,
    });
    let system_text = system.iter().map(|s| s.as_str()).collect::<Vec<&str>>().join("\n\n");
    if !system_text.is_empty() {
        body["system"] = serde_json::Value::String(system_text);
    }
    if let Some(t) = params.get("temperature").and_then(|v| v.as_f64()) {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(p) = params.get("top_p").and_then(|v| v.as_f64()) {
        body["top_p"] = serde_json::json!(p);
    }
    body
}

pub async fn stream(
    app: &AppHandle,
    request: &ProviderRequest,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let key = read_key(&request.api_key_account)?;
    if key.is_empty() {
        return Err("Anthropic profile has no API key stored in the keychain.".into());
    }
    let client = reqwest::Client::new();
    let response = client
        .post(messages_url(&request.base_url))
        .header("Content-Type", "application/json")
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .json(&build_body(request))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!(
            "provider returned {status}: {}",
            text.chars().take(400).collect::<String>()
        ));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut prompt_tokens: Option<u64> = None;
    let mut completion_tokens: Option<u64> = None;
    let mut finish = String::from("stop");
    let mut cancelled = false;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        let bytes = chunk.map_err(|e| format!("stream error: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buffer.find('\n') {
            let line: String = buffer.drain(..pos + 1).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };
            match value.get("type").and_then(|t| t.as_str()) {
                Some("content_block_delta") => {
                    if let Some(text) = value.pointer("/delta/text").and_then(|x| x.as_str()) {
                        if !text.is_empty() {
                            emit_event(app, &request.generation_id, StreamEvent::Delta { text: text.to_string() });
                        }
                    }
                }
                Some("message_start") => {
                    prompt_tokens = value
                        .pointer("/message/usage/input_tokens")
                        .and_then(|x| x.as_u64());
                }
                Some("message_delta") => {
                    if let Some(stop) = value.pointer("/delta/stop_reason").and_then(|x| x.as_str()) {
                        finish = match stop {
                            "end_turn" | "stop_sequence" => "stop".into(),
                            "max_tokens" => "length".into(),
                            other => other.to_string(),
                        };
                    }
                    if let Some(out) = value.pointer("/usage/output_tokens").and_then(|x| x.as_u64()) {
                        completion_tokens = Some(out);
                    }
                }
                Some("message_stop") => {}
                Some("error") => {
                    let message = value
                        .pointer("/error/message")
                        .and_then(|x| x.as_str())
                        .unwrap_or("unknown Anthropic error")
                        .to_string();
                    return Err(message);
                }
                _ => {}
            }
        }
    }

    if cancelled {
        finish = "cancelled".into();
    }
    if let (Some(p), Some(c)) = (prompt_tokens, completion_tokens) {
        emit_event(app, &request.generation_id, StreamEvent::Usage { prompt_tokens: p, completion_tokens: c });
    }
    emit_event(app, &request.generation_id, StreamEvent::Done { finish_reason: finish });
    Ok(())
}
