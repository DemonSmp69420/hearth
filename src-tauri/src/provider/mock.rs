//! Offline development provider: streams a canned reply word by word.
//! Lets the whole chat pipeline run with zero keys and zero network.

use super::{emit_event, ProviderRequest, StreamEvent};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

pub async fn stream(
    app: &AppHandle,
    request: &ProviderRequest,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let user_text = request
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.chars().take(120).collect::<String>())
        .unwrap_or_default();
    let reply = format!(
        "This is a mock reply from Hearth's offline provider, so the whole chat pipeline \
         can be exercised without keys or network. You said: \u{201c}{user_text}\u{201d} \
         Swipe, edit, branch and fork all work on this reply like any other. \
         Configure a real provider in Providers when you are ready."
    );

    let mut words = reply.split_inclusive(' ').peekable();
    while let Some(word) = words.next() {
        if cancel.load(Ordering::Relaxed) {
            emit_event(app, &request.generation_id, StreamEvent::Done { finish_reason: "cancelled".into() });
            return Ok(());
        }
        emit_event(app, &request.generation_id, StreamEvent::Delta { text: word.to_string() });
        if words.peek().is_some() {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    }

    let prompt_tokens: u64 = request
        .messages
        .iter()
        .map(|m| (m.content.len() as u64).div_ceil(4))
        .sum();
    emit_event(
        app,
        &request.generation_id,
        StreamEvent::Usage {
            prompt_tokens,
            completion_tokens: (reply.len() as u64).div_ceil(4),
        },
    );
    emit_event(app, &request.generation_id, StreamEvent::Done { finish_reason: "stop".into() });
    Ok(())
}
