//! Translation providers, LLM helpers and TTS. Network calls live here so the webview never
//! needs CORS access or sees API traffic.

use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::settings::{LlmConfig, Settings};

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

pub fn client(settings: &Settings, timeout_secs: u64) -> AppResult<reqwest::Client> {
    let mut b = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(timeout_secs));
    let proxy = settings.proxy.trim();
    if !proxy.is_empty() {
        b = b.proxy(reqwest::Proxy::all(proxy).map_err(|e| AppError::msg(format!("Invalid proxy URL: {e}")))?);
    }
    Ok(b.build()?)
}

/// English display name used inside LLM prompts.
pub fn lang_name(code: &str) -> &str {
    match code {
        "en" => "English",
        "zh-CN" => "Simplified Chinese",
        "zh-TW" => "Traditional Chinese",
        "ja" => "Japanese",
        "ko" => "Korean",
        "vi" => "Vietnamese",
        "ru" => "Russian",
        "es" => "Spanish",
        "pt" => "Portuguese",
        "fr" => "French",
        "de" => "German",
        "it" => "Italian",
        "nl" => "Dutch",
        "id" => "Indonesian",
        "ms" => "Malay",
        "sv" => "Swedish",
        "pl" => "Polish",
        "tr" => "Turkish",
        other => other,
    }
}

// ---------------------------------------------------------------- Google (free web endpoint)

pub fn parse_google(v: &Value) -> AppResult<String> {
    let parts = v
        .get(0)
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::user("translationData", "Google"))?;
    let out: String = parts
        .iter()
        .filter_map(|p| p.get(0).and_then(Value::as_str))
        .collect();
    Ok(out.trim().to_string())
}

/// Dictionary alternatives grouped by part of speech (from `dt=bd`).
pub fn parse_google_dict(v: &Value) -> Vec<DictEntry> {
    v.get(1)
        .and_then(Value::as_array)
        .map(|groups| {
            groups
                .iter()
                .filter_map(|g| {
                    let pos = g.get(0)?.as_str()?.to_string();
                    let terms = g
                        .get(1)?
                        .as_array()?
                        .iter()
                        .filter_map(|t| t.as_str().map(str::to_string))
                        .take(6)
                        .collect::<Vec<_>>();
                    (!terms.is_empty()).then_some(DictEntry { pos, terms })
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn google_raw(c: &reqwest::Client, text: &str, from: &str, to: &str, dict: bool) -> AppResult<Value> {
    let mut q: Vec<(&str, &str)> =
        vec![("client", "gtx"), ("sl", from), ("tl", to), ("dt", "t"), ("dj", "0"), ("q", text)];
    if dict {
        q.push(("dt", "bd"));
    }
    let resp = c
        .get("https://translate.googleapis.com/translate_a/single")
        .query(&q)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("Google translation request failed ({})", resp.status())));
    }
    Ok(resp.json().await?)
}

pub async fn google(c: &reqwest::Client, text: &str, from: &str, to: &str) -> AppResult<String> {
    parse_google(&google_raw(c, text, from, to, false).await?)
}

// ---------------------------------------------------------------- DeepL

fn deepl_target(code: &str) -> String {
    match code {
        "en" => "EN-US".into(),
        "pt" => "PT-BR".into(),
        "zh-CN" => "ZH-HANS".into(),
        "zh-TW" => "ZH-HANT".into(),
        c => c.to_uppercase(),
    }
}

fn deepl_source(code: &str) -> String {
    code.split('-').next().unwrap_or(code).to_uppercase()
}

pub async fn deepl(c: &reqwest::Client, key: &str, texts: &[String], from: &str, to: &str) -> AppResult<Vec<String>> {
    if key.trim().is_empty() {
        return Err(AppError::user("deeplKey", ""));
    }
    let host = if key.trim().ends_with(":fx") { "api-free.deepl.com" } else { "api.deepl.com" };
    let resp = c
        .post(format!("https://{host}/v2/translate"))
        .header("Authorization", format!("DeepL-Auth-Key {}", key.trim()))
        .json(&json!({ "text": texts, "source_lang": deepl_source(from), "target_lang": deepl_target(to) }))
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::msg(format!("DeepL request failed ({status}): {body}")));
    }
    let v: Value = resp.json().await?;
    let out = v["translations"]
        .as_array()
        .ok_or_else(|| AppError::user("translationData", "DeepL"))?
        .iter()
        .map(|t| t["text"].as_str().unwrap_or_default().to_string())
        .collect::<Vec<_>>();
    if out.len() != texts.len() {
        return Err(AppError::user("translationCount", ""));
    }
    Ok(out)
}

// ---------------------------------------------------------------- LLM (OpenAI-compatible)

/// Pulls the first JSON object or array out of a model reply (handles ``` fences and chatter).
pub fn extract_json(text: &str) -> AppResult<Value> {
    let t = text.trim();
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        return Ok(v);
    }
    let start = t.find(['{', '[']).ok_or_else(|| AppError::user("modelJson", ""))?;
    let open = t.as_bytes()[start];
    let close = if open == b'{' { '}' } else { ']' };
    let end = t.rfind(close).ok_or_else(|| AppError::user("modelJson", ""))?;
    if end <= start {
        return Err(AppError::user("modelJson", ""));
    }
    Ok(serde_json::from_str(&t[start..=end])?)
}

pub fn chat_url(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    if b.ends_with("/chat/completions") {
        b.to_string()
    } else {
        format!("{b}/chat/completions")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub async fn chat(c: &reqwest::Client, cfg: &LlmConfig, messages: &[ChatMessage], temperature: f64) -> AppResult<String> {
    if !cfg.is_ready() {
        return Err(AppError::user("llmConfig", ""));
    }
    let mut req = c.post(chat_url(&cfg.base_url)).json(&json!({
        "model": cfg.model.trim(),
        "messages": messages,
        "temperature": temperature,
        "stream": false,
    }));
    if !cfg.api_key.trim().is_empty() {
        req = req.bearer_auth(cfg.api_key.trim());
    }
    let resp = req.send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let short: String = body.chars().take(300).collect();
        return Err(AppError::msg(format!("Language model request failed ({status}): {short}")));
    }
    let v: Value = resp.json().await?;
    v["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| AppError::user("emptyResponse", ""))
}

fn sys(content: String) -> ChatMessage {
    ChatMessage { role: "system".into(), content }
}

fn user(content: String) -> ChatMessage {
    ChatMessage { role: "user".into(), content }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    pub source: String,
    pub target: String,
}

pub fn parse_segments(v: &Value) -> AppResult<Vec<Segment>> {
    let arr = v
        .get("segments")
        .and_then(Value::as_array)
        .or_else(|| v.as_array())
        .ok_or_else(|| AppError::user("missingSegments", ""))?;
    let segs: Vec<Segment> = arr
        .iter()
        .filter_map(|s| {
            let source = s.get("source")?.as_str()?.trim().to_string();
            let target = s.get("target")?.as_str()?.trim().to_string();
            (!target.is_empty()).then_some(Segment { source, target })
        })
        .collect();
    if segs.is_empty() {
        return Err(AppError::user("missingSegments", ""));
    }
    Ok(segs)
}

pub async fn llm_segments(c: &reqwest::Client, s: &Settings, text: &str, from: &str, to: &str) -> AppResult<Vec<Segment>> {
    let unit = if s.segment_mode == "clause" {
        "short clauses (split long sentences at natural pauses such as commas, keep each chunk 2-10 words)"
    } else {
        "sentences"
    };
    let prompt = format!(
        "You help a {native} speaker practise writing {target}. Split the user's text into {unit}, keeping the original order, \
and translate each chunk into natural, idiomatic {target} as a native speaker would write it in the same register \
(email, chat, comment...). Keep names, numbers and emoji. The source chunks must cover the whole text.\n\
Reply with JSON only: {{\"segments\":[{{\"source\":\"original chunk\",\"target\":\"translation\"}}]}}",
        native = lang_name(from),
        target = lang_name(to),
    );
    let reply = chat(c, &s.llm, &[sys(prompt), user(text.to_string())], 0.2).await?;
    parse_segments(&extract_json(&reply)?)
}

pub async fn llm_translate(c: &reqwest::Client, s: &Settings, text: &str, from: &str, to: &str) -> AppResult<String> {
    let prompt = format!(
        "Translate the user's {} text into natural {}. Reply with the translation only, no quotes or notes.",
        lang_name(from),
        lang_name(to)
    );
    Ok(chat(c, &s.llm, &[sys(prompt), user(text.to_string())], 0.2).await?.trim().to_string())
}

/// Translates each segment with the configured provider, preserving order.
pub async fn translate_many(s: &Settings, texts: Vec<String>, from: String, to: String) -> AppResult<Vec<String>> {
    let c = client(s, 30)?;
    match s.provider.as_str() {
        "deepl" => deepl(&c, &s.deepl_key, &texts, &from, &to).await,
        "llm" => {
            let c = client(s, 90)?;
            let mut handles = Vec::new();
            for t in texts {
                let (c, s, from, to) = (c.clone(), s.clone(), from.clone(), to.clone());
                handles.push(tauri::async_runtime::spawn(async move { llm_translate(&c, &s, &t, &from, &to).await }));
            }
            join_all(handles).await
        }
        _ => {
            let mut handles = Vec::new();
            for t in texts {
                let (c, from, to) = (c.clone(), from.clone(), to.clone());
                handles.push(tauri::async_runtime::spawn(async move { google(&c, &t, &from, &to).await }));
            }
            join_all(handles).await
        }
    }
}

async fn join_all(handles: Vec<tauri::async_runtime::JoinHandle<AppResult<String>>>) -> AppResult<Vec<String>> {
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        out.push(h.await.map_err(|e| AppError::msg(format!("Task failed: {e}")))??);
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ReviewNote {
    pub wrong: String,
    pub right: String,
    pub why: String,
}

/// Models sometimes quote numbers (`"score": "85"`); accept both and fall back to 0.
fn lenient_f64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Number(n) => n.as_f64().unwrap_or_default(),
        Value::String(s) => s.trim().trim_end_matches('%').trim().parse().unwrap_or_default(),
        _ => 0.0,
    })
}

/// Maps the model's verdict onto the three values the UI knows.
fn normalize_verdict(v: &str) -> String {
    let v = v.trim().to_lowercase();
    if v.starts_with("correct") {
        "correct".into()
    } else if v.starts_with("accept") {
        "acceptable".into()
    } else {
        "incorrect".into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AiReview {
    /// "correct" | "acceptable" | "incorrect"
    pub verdict: String,
    #[serde(deserialize_with = "lenient_f64")]
    pub score: f64,
    pub feedback: String,
    pub corrected: String,
    pub notes: Vec<ReviewNote>,
}

pub async fn llm_review(
    c: &reqwest::Client,
    s: &Settings,
    source: &str,
    reference: &str,
    answer: &str,
    from: &str,
    to: &str,
) -> AppResult<AiReview> {
    let prompt = format!(
        "You are a friendly, precise {target} writing tutor for a {native} speaker. The learner saw a {native} sentence and \
wrote their own {target} version from memory. A reference translation is given, but other natural phrasings are fine. \
Judge whether the learner's version is correct and natural. Explain in {native}, briefly.\n\
Reply with JSON only: {{\"verdict\":\"correct|acceptable|incorrect\",\"score\":0-100,\"feedback\":\"one or two sentences\",\
\"corrected\":\"the learner's sentence minimally corrected\",\"notes\":[{{\"wrong\":\"...\",\"right\":\"...\",\"why\":\"...\"}}]}}",
        native = lang_name(from),
        target = lang_name(to),
    );
    let content = format!("Original: {source}\nReference: {reference}\nLearner: {answer}");
    let reply = chat(c, &s.llm, &[sys(prompt), user(content)], 0.2).await?;
    let mut review: AiReview = serde_json::from_value(extract_json(&reply)?)?;
    review.verdict = normalize_verdict(&review.verdict);
    review.score = review.score.clamp(0.0, 100.0);
    Ok(review)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct VocabItem {
    pub term: String,
    pub pos: String,
    pub meaning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct GrammarItem {
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Breakdown {
    pub translation: String,
    pub vocabulary: Vec<VocabItem>,
    pub grammar: Vec<GrammarItem>,
    pub tip: String,
}

pub async fn llm_explain(c: &reqwest::Client, s: &Settings, sentence: &str, lang: &str, native: &str) -> AppResult<Breakdown> {
    let prompt = format!(
        "You explain {target} sentences to a {native} learner. Give the translation, 3-6 key vocabulary items or phrases \
(term exactly as written in the sentence, part of speech abbreviation, short {native} meaning), 1-3 grammar points \
(short title + one-line {native} explanation), and one usage tip in {native}.\n\
Reply with JSON only: {{\"translation\":\"\",\"vocabulary\":[{{\"term\":\"\",\"pos\":\"\",\"meaning\":\"\"}}],\
\"grammar\":[{{\"title\":\"\",\"detail\":\"\"}}],\"tip\":\"\"}}",
        native = lang_name(native),
        target = lang_name(lang),
    );
    let reply = chat(c, &s.llm, &[sys(prompt), user(sentence.to_string())], 0.3).await?;
    Ok(serde_json::from_value(extract_json(&reply)?)?)
}

pub async fn llm_ask(
    c: &reqwest::Client,
    s: &Settings,
    sentence: &str,
    history: Vec<ChatMessage>,
    lang: &str,
    native: &str,
) -> AppResult<String> {
    let prompt = format!(
        "You are an encouraging {target} tutor for a {native} speaker. The learner is asking about this sentence:\n\
\"{sentence}\"\nAnswer in {native}, concisely (under 120 words), with short {target} examples when useful. \
Use plain text or light markdown.",
        native = lang_name(native),
        target = lang_name(lang),
    );
    let mut msgs = vec![sys(prompt)];
    msgs.extend(history.into_iter().filter(|m| m.role == "user" || m.role == "assistant"));
    chat(c, &s.llm, &msgs, 0.5).await
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct DictEntry {
    pub pos: String,
    pub terms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Lookup {
    pub text: String,
    pub meaning: String,
    pub phonetic: String,
    pub dict: Vec<DictEntry>,
}

/// Looks up a word or phrase written in `lang` and explains it in `native`, using the same
/// provider the user picked for translation.
pub async fn lookup(s: &Settings, text: &str, context: &str, lang: &str, native: &str) -> AppResult<Lookup> {
    if s.provider == "llm" {
        let c = client(s, 60)?;
        let prompt = format!(
            "Define the {target} word or phrase for a {native} learner, as used in the given context. \
Reply with JSON only: {{\"meaning\":\"short {native} meaning\",\"phonetic\":\"IPA or reading, may be empty\",\
\"dict\":[{{\"pos\":\"part of speech\",\"terms\":[\"{native} equivalents\"]}}]}}",
            native = lang_name(native),
            target = lang_name(lang),
        );
        let reply = chat(&c, &s.llm, &[sys(prompt), user(format!("Word: {text}\nContext: {context}"))], 0.2).await?;
        let mut l: Lookup = serde_json::from_value(extract_json(&reply)?)?;
        l.text = text.to_string();
        return Ok(l);
    }
    let c = client(s, 20)?;
    if s.provider == "deepl" {
        let meaning = deepl(&c, &s.deepl_key, &[text.to_string()], lang, native).await?.remove(0);
        return Ok(Lookup { text: text.into(), meaning, phonetic: String::new(), dict: Vec::new() });
    }
    let v = google_raw(&c, text, lang, native, true).await?;
    Ok(Lookup { text: text.into(), meaning: parse_google(&v)?, phonetic: String::new(), dict: parse_google_dict(&v) })
}

// ---------------------------------------------------------------- TTS

/// Splits text into chunks under `max` chars at word boundaries (Google TTS limit is ~200).
pub fn chunk_text(text: &str, max: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for word in text.split_inclusive(char::is_whitespace) {
        if cur.chars().count() + word.chars().count() > max && !cur.is_empty() {
            out.push(cur.trim().to_string());
            cur.clear();
        }
        if word.chars().count() > max {
            // No spaces (e.g. CJK): hard split.
            let chars: Vec<char> = word.chars().collect();
            for piece in chars.chunks(max) {
                out.push(piece.iter().collect::<String>().trim().to_string());
            }
            continue;
        }
        cur.push_str(word);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out.into_iter().filter(|s| !s.is_empty()).collect()
}

/// Returns an MP3 as a base64 string.
pub async fn tts(s: &Settings, text: &str, lang: &str) -> AppResult<String> {
    let c = client(s, 30)?;
    let mut audio = Vec::new();
    for piece in chunk_text(text, 180) {
        let resp = c
            .get("https://translate.google.com/translate_tts")
            .query(&[("ie", "UTF-8"), ("client", "tw-ob"), ("tl", lang), ("q", piece.as_str())])
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(AppError::msg(format!("Speech synthesis failed ({})", resp.status())));
        }
        audio.extend_from_slice(&resp.bytes().await?);
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(audio))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn google_response_parsing() {
        let v: Value = serde_json::from_str(
            r#"[[["Thanks for your reply, ","感谢你的回复，",null,null,10],["see you Friday.","我们周五见。",null,null,10]],
               [["noun",["reply","answer"]]],"zh-CN"]"#,
        )
        .unwrap();
        assert_eq!(parse_google(&v).unwrap(), "Thanks for your reply, see you Friday.");
        assert_eq!(parse_google_dict(&v), vec![DictEntry { pos: "noun".into(), terms: vec!["reply".into(), "answer".into()] }]);
        assert!(parse_google(&json!({"x":1})).is_err());
    }

    #[test]
    fn json_extraction_variants() {
        assert_eq!(extract_json(r#"{"a":1}"#).unwrap()["a"], 1);
        assert_eq!(extract_json("```json\n{\"a\":2}\n```").unwrap()["a"], 2);
        assert_eq!(extract_json("Sure! Here: [1,2] done").unwrap()[1], 2);
        assert!(extract_json("no json here").is_err());
    }

    #[test]
    fn segments_parsing() {
        let v = json!({"segments":[{"source":"你好","target":"Hello"},{"source":"x","target":""}]});
        assert_eq!(parse_segments(&v).unwrap(), vec![Segment { source: "你好".into(), target: "Hello".into() }]);
        let arr = json!([{"source":"a","target":"b"}]);
        assert_eq!(parse_segments(&arr).unwrap().len(), 1);
        assert!(parse_segments(&json!({"segments":[]})).is_err());
    }

    #[test]
    fn review_tolerates_loose_json() {
        let r: AiReview = serde_json::from_value(json!({"verdict":"Acceptable","score":"85%"})).unwrap();
        assert_eq!(r.score, 85.0);
        assert_eq!(normalize_verdict(&r.verdict), "acceptable");
        let r: AiReview = serde_json::from_value(json!({"score": null, "notes": []})).unwrap();
        assert_eq!(r.score, 0.0);
        assert_eq!(normalize_verdict("wrong"), "incorrect");
    }

    #[test]
    fn chat_url_normalises() {
        assert_eq!(chat_url("https://api.deepseek.com/v1/"), "https://api.deepseek.com/v1/chat/completions");
        assert_eq!(chat_url("http://x/v1/chat/completions"), "http://x/v1/chat/completions");
    }

    #[test]
    fn deepl_codes() {
        assert_eq!(deepl_target("zh-CN"), "ZH-HANS");
        assert_eq!(deepl_target("de"), "DE");
        assert_eq!(deepl_source("zh-TW"), "ZH");
    }

    #[test]
    fn chunking() {
        let c = chunk_text("one two three four", 9);
        assert_eq!(c, vec!["one two", "three", "four"]);
        assert_eq!(chunk_text("你好世界你好", 4), vec!["你好世界", "你好"]);
        assert!(chunk_text("   ", 10).is_empty());
    }
}
