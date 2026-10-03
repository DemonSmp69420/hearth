//! Native Google Gemini adapter (M1.3).
//! Base URL convention: `https://generativelanguage.googleapis.com`.
//! Streams `models/{model}:streamGenerateContent?alt=sse`; system text goes
//! to `systemInstruction`; assistant roles map to `model`; consecutive
//! same-role messages are merged (Gemini rejects some consecutive roles).

use super::{emit_event, read_key, ProviderRequest, StreamEvent};
use futures::StreamExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;

pub fn stream_url(base_url: &str, model: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let base = base.strip_suffix("/v1beta").unwrap_or(base);
    format!("{base}/v1beta/models/{model}:streamGenerateContent?alt=sse")
}

pub fn build_body(request: &ProviderRequest) -> serde_json::Value {
    let system: Vec<&String> = request
        .messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| &m.content)
        .collect();

    // Merge consecutive same-role messages; map assistant -> model.
    let mut contents: Vec<serde_json::Value> = Vec::new();
    for m in &request.messages {
        if m.role == "system" || m.content.is_empty() {
            continue;
        }
        let role = if m.role == "assistant" { "model" } else { "user" };
        match contents.last_mut() {
            Some(last) if last.get("role").and_then(|r| r.as_str()) == Some(role) => {
                if let Some(parts) = last.get_mut("parts").and_then(|p| p.as_array_mut()) {
                    parts.push(serde_json::json!({ "text": m.content }));
                }
            }
            _ => contents.push(serde_json::json!({
                "role": role,
                "parts": [{ "text": m.content }],
            })),
        }
    }

    let params = &request.params;
    let mut generation_config = serde_json::json!({});
    if let Some(t) = params.get("temperature").and_then(|v| v.as_f64()) {
        generation_config["temperature"] = serde_json::json!(t);
    }
    if let Some(p) = params.get("top_p").and_then(|v| v.as_f64()) {
        generation_config["topP"] = serde_json::json!(p);
    }
    if let Some(m) = params.get("max_tokens").and_then(|v| v.as_u64()) {
        generation_config["maxOutputTokens"] = serde_json::json!(m);
    }

    let mut body = serde_json::json!({
        "contents": contents,
        "generationConfig": generation_config,
    });
    let system_text = system.iter().map(|s| s.as_str()).collect::<Vec<&str>>().join("\n\n");
    if !system_text.is_empty() {
        body["systemInstruction"] = serde_json::json!({ "parts": [{ "text": system_text }] });
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
        return Err("Gemini profile has no API key stored in the keychain.".into());
    }
    let client = reqwest::Client::new();
    let response = client
        .post(stream_url(&request.base_url, &request.model))
        .header("Content-Type", "application/json")
        .header("x-goog-api-key", &key)
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
            if let Some(parts) = value.pointer("/candidates/0/content/parts").and_then(|p| p.as_array()) {
                for part in parts {
                    if let Some(text) = part.get("text").and_then(|x| x.as_str()) {
                        if !text.is_empty() {
                            emit_event(app, &request.generation_id, StreamEvent::Delta { text: text.to_string() });
                        }
                    }
                }
            }
            if let Some(reason) = value.pointer("/candidates/0/finishReason").and_then(|x| x.as_str()) {
                finish = match reason {
                    "STOP" => "stop".into(),
                    "MAX_TOKENS" => "length".into(),
                    "SAFETY" => "content_filter".into(),
                    other => other.to_lowercase(),
                };
            }
            if let Some(usage) = value.get("usageMetadata") {
                if let Some(p) = usage.get("promptTokenCount").and_then(|x| x.as_u64()) {
                    prompt_tokens = Some(p);
                }
                if let Some(c) = usage.get("candidatesTokenCount").and_then(|x| x.as_u64()) {
                    completion_tokens = Some(c);
                }
            }
            if let Some(err) = value.get("error") {
                let message = err
                    .get("message")
                    .and_then(|x| x.as_str())
                    .unwrap_or("unknown Gemini error")
                    .to_string();
                return Err(message);
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
