//! OpenAI-compatible chat-completions adapter: the universal wire protocol
//! (D-016). Covers OpenAI, OpenRouter, DeepSeek, Together, Groq, Mistral,
//! xAI, LM Studio, vLLM, llama.cpp, KoboldCpp and Ollama via base URL.

use super::{emit_event, read_key, ProviderRequest, StreamEvent};
use futures::StreamExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;

pub async fn stream(
    app: &AppHandle,
    request: &ProviderRequest,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let key = read_key(&request.api_key_account)?;
    let url = format!("{}/chat/completions", request.base_url.trim_end_matches('/'));

    let mut body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "stream": true,
    });
    if let serde_json::Value::Object(extra) = &request.params {
        if let serde_json::Value::Object(body_obj) = &mut body {
            for (k, v) in extra {
                body_obj.insert(k.clone(), v.clone());
            }
        }
    }
    // Ask for provider-reported usage when the backend supports it; harmless
    // for those that ignore the field.
    if body.get("stream_options").is_none() {
        if let serde_json::Value::Object(body_obj) = &mut body {
            body_obj.insert(
                "stream_options".into(),
                serde_json::json!({ "include_usage": true }),
            );
        }
    }

    let client = reqwest::Client::new();
    let mut req = client.post(&url).header("Content-Type", "application/json");
    if !key.is_empty() {
        req = req.bearer_auth(&key);
    }
    let response = req
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("provider returned {status}: {}", text.chars().take(400).collect::<String>()));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut usage: Option<(u64, u64)> = None;
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
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };
            if let Some(u) = value.get("usage") {
                usage = Some((
                    u.get("prompt_tokens").and_then(|x| x.as_u64()).unwrap_or(0),
                    u.get("completion_tokens").and_then(|x| x.as_u64()).unwrap_or(0),
                ));
            }
            if let Some(fr) = value.pointer("/choices/0/finish_reason").and_then(|x| x.as_str()) {
                if !fr.is_empty() {
                    finish = fr.to_string();
                }
            }
            if let Some(content) = value.pointer("/choices/0/delta/content").and_then(|x| x.as_str()) {
                if !content.is_empty() {
                    emit_event(app, &request.generation_id, StreamEvent::Delta { text: content.to_string() });
                }
            }
        }
    }

    if cancelled {
        finish = "cancelled".into();
    }
    if let Some((prompt_tokens, completion_tokens)) = usage {
        emit_event(app, &request.generation_id, StreamEvent::Usage { prompt_tokens, completion_tokens });
    }
    emit_event(app, &request.generation_id, StreamEvent::Done { finish_reason: finish });
    Ok(())
}
