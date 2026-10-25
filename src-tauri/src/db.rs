use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::Mutex;

use chrono::{Datelike, Duration, FixedOffset, NaiveDate, TimeZone};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::settings::Settings;
use crate::learning::{self, NewActivity};
use crate::srs::{self, Card};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  meaning TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  context_translation TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  interval_days REAL NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  UNIQUE(text, lang)
);
CREATE TABLE IF NOT EXISTS sentences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'write',
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  interval_days REAL NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  UNIQUE(target, target_lang)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  draft TEXT NOT NULL,
  result TEXT NOT NULL,
  mode TEXT NOT NULL,
  segments INTEGER NOT NULL,
  total_words INTEGER NOT NULL,
  correct_words INTEGER NOT NULL,
  hints INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_words_due ON words(due_at);
CREATE INDEX IF NOT EXISTS idx_sentences_due ON sentences(due_at);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub id: i64,
    pub text: String,
    pub meaning: String,
    pub lang: String,
    pub note: String,
    pub context: String,
    pub context_translation: String,
    pub created_at: i64,
    pub due_at: i64,
    pub interval_days: f64,
    pub ease: f64,
    pub reps: i64,
    pub lapses: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWord {
    pub text: String,
    #[serde(default)]
    pub meaning: String,
    pub lang: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub context_translation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sentence {
    pub id: i64,
    pub source: String,
    pub target: String,
    pub source_lang: String,
    pub target_lang: String,
    pub note: String,
    pub origin: String,
    pub created_at: i64,
    pub due_at: i64,
    pub interval_days: f64,
    pub ease: f64,
    pub reps: i64,
    pub lapses: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSentence {
    pub source: String,
    pub target: String,
    pub source_lang: String,
    pub target_lang: String,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_origin")]
    pub origin: String,
}

fn default_origin() -> String {
    "write".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: i64,
    pub created_at: i64,
    pub source_lang: String,
    pub target_lang: String,
    pub draft: String,
    pub result: String,
    pub mode: String,
    pub segments: i64,
    pub total_words: i64,
    pub correct_words: i64,
    pub hints: i64,
    pub duration_ms: i64,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    pub source_lang: String,
    pub target_lang: String,
    pub draft: String,
    pub result: String,
    pub mode: String,
    pub segments: i64,
    pub total_words: i64,
    pub correct_words: i64,
    pub hints: i64,
    pub duration_ms: i64,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeekBucket {
    pub start: String,
    pub words: i64,
    pub sentences: i64,
    pub sessions: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayBucket {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub words_total: i64,
    pub sentences_total: i64,
    pub words_week: i64,
    pub sentences_week: i64,
    pub sessions_total: i64,
    pub sessions_week: i64,
    pub practiced_words: i64,
    pub accuracy: f64,
    pub streak_days: i64,
    pub today_segments: i64,
    pub due_words: i64,
    pub due_sentences: i64,
    pub weeks: Vec<WeekBucket>,
    pub days: Vec<DayBucket>,
}

pub struct Db {
    conn: Mutex<Connection>,
}

fn word_from_row(r: &Row) -> rusqlite::Result<Word> {
    Ok(Word {
        id: r.get("id")?,
        text: r.get("text")?,
        meaning: r.get("meaning")?,
        lang: r.get("lang")?,
        note: r.get("note")?,
        context: r.get("context")?,
        context_translation: r.get("context_translation")?,
        created_at: r.get("created_at")?,
        due_at: r.get("due_at")?,
        interval_days: r.get("interval_days")?,
        ease: r.get("ease")?,
        reps: r.get("reps")?,
        lapses: r.get("lapses")?,
    })
}

fn sentence_from_row(r: &Row) -> rusqlite::Result<Sentence> {
    Ok(Sentence {
        id: r.get("id")?,
        source: r.get("source")?,
        target: r.get("target")?,
        source_lang: r.get("source_lang")?,
        target_lang: r.get("target_lang")?,
        note: r.get("note")?,
        origin: r.get("origin")?,
        created_at: r.get("created_at")?,
        due_at: r.get("due_at")?,
        interval_days: r.get("interval_days")?,
        ease: r.get("ease")?,
        reps: r.get("reps")?,
        lapses: r.get("lapses")?,
    })
}

fn session_from_row(r: &Row) -> rusqlite::Result<Session> {
    Ok(Session {
        id: r.get("id")?,
        created_at: r.get("created_at")?,
        source_lang: r.get("source_lang")?,
        target_lang: r.get("target_lang")?,
        draft: r.get("draft")?,
        result: r.get("result")?,
        mode: r.get("mode")?,
        segments: r.get("segments")?,
        total_words: r.get("total_words")?,
        correct_words: r.get("correct_words")?,
        hints: r.get("hints")?,
        duration_ms: r.get("duration_ms")?,
        detail: r.get("detail")?,
    })
}

fn table_for(kind: &str) -> AppResult<&'static str> {
    match kind {
        "word" => Ok("words"),
        "sentence" => Ok("sentences"),
        _ => Err(AppError::msg(format!("Unknown item type: {kind}"))),
    }
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> AppResult<Self> {
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA)?;
        crate::learning::migrate(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub(crate) fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A poisoned lock only means another command panicked; the connection is still usable.
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ---------- settings ----------

    pub fn settings(&self) -> AppResult<Settings> {
        let raw: Option<String> = self
            .conn()
            .query_row("SELECT value FROM kv WHERE key = 'settings'", [], |r| r.get(0))
            .optional()?;
        let mut settings: Settings = match raw {
            Some(s) => serde_json::from_str(&s).unwrap_or_default(),
            None => Settings::default(),
        };
        settings.normalize();
        Ok(settings)
    }

    pub fn save_settings(&self, s: &Settings) -> AppResult<()> {
        let json = serde_json::to_string(s)?;
        self.conn().execute(
            "INSERT INTO kv(key, value) VALUES('settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![json],
        )?;
        Ok(())
    }

    // ---------- words ----------

    pub fn add_word(&self, w: &NewWord, now: i64) -> AppResult<Word> {
        let text = w.text.trim();
        if text.is_empty() {
            return Err(AppError::user("emptyWord", ""));
        }
        let conn = self.conn();
        // Saving an existing word refreshes its meaning/context but keeps its review history.
        conn.execute(
            "INSERT INTO words(text, meaning, lang, note, context, context_translation, created_at, due_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(text, lang) DO UPDATE SET
               meaning = CASE WHEN excluded.meaning <> '' THEN excluded.meaning ELSE words.meaning END,
               context = CASE WHEN excluded.context <> '' THEN excluded.context ELSE words.context END,
               context_translation = CASE WHEN excluded.context_translation <> '' THEN excluded.context_translation ELSE words.context_translation END,
               note = CASE WHEN excluded.note <> '' THEN excluded.note ELSE words.note END",
            params![text, w.meaning.trim(), w.lang, w.note, w.context, w.context_translation, now],
        )?;
        Ok(conn.query_row(
            "SELECT * FROM words WHERE text = ?1 AND lang = ?2",
            params![text, w.lang],
            word_from_row,
        )?)
    }

    pub fn list_words(&self, query: &str) -> AppResult<Vec<Word>> {
        let conn = self.conn();
        let like = format!("%{}%", query.trim());
        let mut st = conn.prepare(
            "SELECT * FROM words WHERE text LIKE ?1 OR meaning LIKE ?1 OR context LIKE ?1 OR note LIKE ?1
             ORDER BY created_at DESC, id DESC",
        )?;
        let rows = st.query_map(params![like], word_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn update_word(&self, id: i64, meaning: &str, note: &str) -> AppResult<()> {
        self.conn().execute(
            "UPDATE words SET meaning = ?2, note = ?3 WHERE id = ?1",
            params![id, meaning, note],
        )?;
        Ok(())
    }

    // ---------- sentences ----------

    pub fn add_sentence(&self, s: &NewSentence, now: i64) -> AppResult<Sentence> {
        let target = s.target.trim();
        if target.is_empty() {
            return Err(AppError::user("emptySentence", ""));
        }
        let conn = self.conn();
        conn.execute(
            "INSERT INTO sentences(source, target, source_lang, target_lang, note, origin, created_at, due_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(target, target_lang) DO UPDATE SET
               source = CASE WHEN excluded.source <> '' THEN excluded.source ELSE sentences.source END,
               note = CASE WHEN excluded.note <> '' THEN excluded.note ELSE sentences.note END",
            params![s.source.trim(), target, s.source_lang, s.target_lang, s.note, s.origin, now],
        )?;
        Ok(conn.query_row(
            "SELECT * FROM sentences WHERE target = ?1 AND target_lang = ?2",
            params![target, s.target_lang],
            sentence_from_row,
        )?)
    }

    pub fn list_sentences(&self, query: &str) -> AppResult<Vec<Sentence>> {
        let conn = self.conn();
        let like = format!("%{}%", query.trim());
        let mut st = conn.prepare(
            "SELECT * FROM sentences WHERE source LIKE ?1 OR target LIKE ?1 OR note LIKE ?1
             ORDER BY created_at DESC, id DESC",
        )?;
        let rows = st.query_map(params![like], sentence_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn update_sentence_note(&self, id: i64, note: &str) -> AppResult<()> {
        self.conn()
            .execute("UPDATE sentences SET note = ?2 WHERE id = ?1", params![id, note])?;
        Ok(())
    }

    // ---------- shared review ----------

    pub fn delete_item(&self, kind: &str, id: i64) -> AppResult<()> {
        let table = table_for(kind)?;
        self.conn()
            .execute(&format!("DELETE FROM {table} WHERE id = ?1"), params![id])?;
        Ok(())
    }

    pub fn due_words(&self, now: i64, limit: i64) -> AppResult<Vec<Word>> {
        let conn = self.conn();
        let mut st = conn.prepare("SELECT * FROM words WHERE due_at <= ?1 ORDER BY due_at ASC LIMIT ?2")?;
        let rows = st.query_map(params![now, limit], word_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn due_sentences(&self, now: i64, limit: i64) -> AppResult<Vec<Sentence>> {
        let conn = self.conn();
        let mut st =
            conn.prepare("SELECT * FROM sentences WHERE due_at <= ?1 ORDER BY due_at ASC LIMIT ?2")?;
        let rows = st.query_map(params![now, limit], sentence_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Applies a review grade and returns the next due time.
    #[cfg(test)]
    pub fn review(&self, kind: &str, id: i64, grade: u8, now: i64) -> AppResult<i64> {
        self.review_with_event(kind, id, grade, now, None)
    }

    pub fn review_with_event(&self, kind: &str, id: i64, grade: u8, now: i64, event: Option<&str>) -> AppResult<i64> {
        if grade > 3 { return Err(AppError::msg("Invalid review grade")); }
        let table = table_for(kind)?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let event = event.map(str::to_owned).unwrap_or(learning::event_id(&tx)?);
        learning::validate_event(&event)?;
        if let Some(due) = learning::receipt(&tx,&event,"review")? { return Ok(due); }
        let card = tx.query_row(
            &format!("SELECT interval_days, ease, reps, lapses FROM {table} WHERE id = ?1"),
            params![id],
            |r| {
                Ok(Card { interval_days: r.get(0)?, ease: r.get(1)?, reps: r.get(2)?, lapses: r.get(3)? })
            },
        )?;
        let (next, due) = srs::schedule(card, grade, now);
        tx.execute(
            &format!(
                "UPDATE {table} SET interval_days = ?2, ease = ?3, reps = ?4, lapses = ?5, due_at = ?6 WHERE id = ?1"
            ),
            params![id, next.interval_days, next.ease, next.reps, next.lapses, due],
        )?;
        let (source, target, source_lang, target_lang): (String, String, String, String) = if kind == "word" {
            tx.query_row("SELECT text,meaning,lang FROM words WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, String::new()))
            })?
        } else {
            tx.query_row("SELECT source,target,source_lang,target_lang FROM sentences WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?
        };
        let detail = serde_json::json!({"itemKind":kind,"itemId":id,"dueAt":due}).to_string();
        learning::insert(&tx, &NewActivity {
            event_id:&event,kind:"review",origin:"main",source_lang:&source_lang,target_lang:&target_lang,
            source:&source,target:&target,segments:1,total_words:0,correct_words:0,duration_ms:0,
            grade:Some(grade),session_id:None,detail:&detail,
        }, now)?;
        tx.commit()?;
        Ok(due)
    }

    // ---------- sessions ----------

    #[cfg(test)]
    pub fn add_session(&self, s: &NewSession, now: i64) -> AppResult<i64> {
        self.add_session_with_event(s, now, None, "main")
    }

    pub fn add_session_with_event(&self, s: &NewSession, now: i64, event: Option<&str>, origin: &str) -> AppResult<i64> {
        if !matches!(origin, "main" | "mini") { return Err(AppError::msg("Invalid practice origin")); }
        if s.segments < 0 || s.total_words < 0 || s.correct_words < 0 || s.correct_words > s.total_words || s.duration_ms < 0 {
            return Err(AppError::msg("Invalid practice metrics"));
        }
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let event = event.map(str::to_owned).unwrap_or(learning::event_id(&tx)?);
        learning::validate_event(&event)?;
        if let Some(id) = learning::receipt(&tx,&event,"practice")? { return Ok(id); }
        tx.execute(
            "INSERT INTO sessions(created_at, source_lang, target_lang, draft, result, mode, segments,
               total_words, correct_words, hints, duration_ms, detail)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                now, s.source_lang, s.target_lang, s.draft, s.result, s.mode, s.segments,
                s.total_words, s.correct_words, s.hints, s.duration_ms,
                if s.detail.is_empty() { "[]" } else { &s.detail }
            ],
        )?;
        let id = tx.last_insert_rowid();
        learning::insert(&tx, &NewActivity {
            event_id:&event,kind:"practice",origin,source_lang:&s.source_lang,target_lang:&s.target_lang,
            source:&s.draft,target:&s.result,segments:s.segments,total_words:s.total_words,
            correct_words:s.correct_words,duration_ms:s.duration_ms,grade:None,session_id:Some(id),detail:&s.detail,
        }, now)?;
        tx.commit()?;
        Ok(id)
    }

    pub fn list_sessions(&self, limit: i64) -> AppResult<Vec<Session>> {
        let conn = self.conn();
        let mut st = conn.prepare("SELECT * FROM sessions ORDER BY created_at DESC, id DESC LIMIT ?1")?;
        let rows = st.query_map(params![limit], session_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn delete_session(&self, id: i64) -> AppResult<()> {
        self.conn().execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ---------- stats ----------

    /// `offset_minutes` is the local timezone offset east of UTC, used to bucket by local day.
    pub fn stats(&self, now: i64, offset_minutes: i32) -> AppResult<Stats> {
        let tz = FixedOffset::east_opt(offset_minutes * 60).ok_or_else(|| AppError::user("invalidTimezone", ""))?;
        let to_date = |ms: i64| -> NaiveDate {
            tz.timestamp_millis_opt(ms).single().map(|d| d.date_naive()).unwrap_or_default()
        };
        let today = to_date(now);
        let week_start = today - Duration::days(today.weekday().num_days_from_monday() as i64);

        let conn = self.conn();
        let times = |sql: &str| -> AppResult<Vec<(i64, i64)>> {
            let mut st = conn.prepare(sql)?;
            let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
            Ok(rows.collect::<Result<_, _>>()?)
        };
        let words = times("SELECT created_at, 1 FROM words")?;
        let sentences = times("SELECT created_at, 1 FROM sentences")?;
        let sessions = times("SELECT created_at, segments FROM sessions")?;
        let (practiced, correct): (i64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(total_words), 0), COALESCE(SUM(correct_words), 0) FROM sessions",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let due_words: i64 =
            conn.query_row("SELECT COUNT(*) FROM words WHERE due_at <= ?1", params![now], |r| r.get(0))?;
        let due_sentences: i64 =
            conn.query_row("SELECT COUNT(*) FROM sentences WHERE due_at <= ?1", params![now], |r| r.get(0))?;
        drop(conn);

        let in_week = |v: &[(i64, i64)]| v.iter().filter(|(t, _)| to_date(*t) >= week_start).count() as i64;

        // Weekly buckets for the last 8 weeks, oldest first.
        let mut weeks: Vec<WeekBucket> = (0..8)
            .rev()
            .map(|i| WeekBucket {
                start: (week_start - Duration::weeks(i)).format("%m/%d").to_string(),
                words: 0,
                sentences: 0,
                sessions: 0,
            })
            .collect();
        let week_index = |ms: i64| -> Option<usize> {
            let d = to_date(ms);
            if d > today {
                return None;
            }
            let diff = (week_start - (d - Duration::days(d.weekday().num_days_from_monday() as i64))).num_weeks();
            (0..8).contains(&diff).then(|| 7 - diff as usize)
        };
        for (t, _) in &words {
            if let Some(i) = week_index(*t) {
                weeks[i].words += 1;
            }
        }
        for (t, _) in &sentences {
            if let Some(i) = week_index(*t) {
                weeks[i].sentences += 1;
            }
        }
        for (t, _) in &sessions {
            if let Some(i) = week_index(*t) {
                weeks[i].sessions += 1;
            }
        }

        // Learning is independent of collecting favorites.
        let mut daily: BTreeMap<NaiveDate, i64> = BTreeMap::new();
        for a in self.activity_metrics(None)? {
            if a.created_at <= now { *daily.entry(to_date(a.created_at)).or_default() += 1; }
        }
        let days: Vec<DayBucket> = (0..112)
            .rev()
            .map(|i| {
                let d = today - Duration::days(i);
                DayBucket { date: d.format("%Y-%m-%d").to_string(), count: *daily.get(&d).unwrap_or(&0) }
            })
            .collect();

        // A streak survives until the end of today even if today has no activity yet.
        let active: HashSet<NaiveDate> = daily.keys().copied().collect();
        let mut cursor = if active.contains(&today) { today } else { today - Duration::days(1) };
        let mut streak = 0;
        while active.contains(&cursor) {
            streak += 1;
            cursor -= Duration::days(1);
        }

        let today_segments =
            sessions.iter().filter(|(t, _)| to_date(*t) == today).map(|(_, n)| *n).sum::<i64>();

        Ok(Stats {
            words_total: words.len() as i64,
            sentences_total: sentences.len() as i64,
            words_week: in_week(&words),
            sentences_week: in_week(&sentences),
            sessions_total: sessions.len() as i64,
            sessions_week: in_week(&sessions),
            practiced_words: practiced,
            accuracy: if practiced > 0 { correct as f64 / practiced as f64 } else { 0.0 },
            streak_days: streak,
            today_segments,
            due_words,
            due_sentences,
            weeks,
            days,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::srs::DAY_MS;

    fn word(text: &str) -> NewWord {
        NewWord {
            text: text.into(),
            meaning: "意思".into(),
            lang: "en".into(),
            note: String::new(),
            context: String::new(),
            context_translation: String::new(),
        }
    }

    fn session(segments: i64) -> NewSession {
        NewSession {
            source_lang: "zh-CN".into(),
            target_lang: "en".into(),
            draft: "你好".into(),
            result: "Hello".into(),
            mode: "recall".into(),
            segments,
            total_words: 10,
            correct_words: 8,
            hints: 1,
            duration_ms: 1000,
            detail: String::new(),
        }
    }

    // 2026-09-24 12:00 UTC is a Thursday.
    const NOW: i64 = 1_790_251_200_000;

    #[test]
    fn settings_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.settings().unwrap(), Settings::default());
        let mut s = Settings::default();
        s.target_lang = "ja".into();
        db.save_settings(&s).unwrap();
        assert_eq!(db.settings().unwrap().target_lang, "ja");
    }

    #[test]
    fn word_upsert_keeps_history() {
        let db = Db::open_in_memory().unwrap();
        let w = db.add_word(&word("curated"), NOW).unwrap();
        db.review("word", w.id, 2, NOW).unwrap();
        let mut again = word("curated");
        again.meaning = "精选的".into();
        let w2 = db.add_word(&again, NOW + 5).unwrap();
        assert_eq!(w2.id, w.id);
        assert_eq!(w2.meaning, "精选的");
        assert_eq!(w2.reps, 1);
        assert_eq!(db.list_words("").unwrap().len(), 1);
        assert_eq!(db.list_words("精选").unwrap().len(), 1);
        assert!(db.list_words("zzz").unwrap().is_empty());
    }

    #[test]
    fn empty_word_rejected() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.add_word(&word("  "), NOW).is_err());
    }

    #[test]
    fn review_moves_due_date() {
        let db = Db::open_in_memory().unwrap();
        let s = db
            .add_sentence(
                &NewSentence {
                    source: "谢谢".into(),
                    target: "Thanks.".into(),
                    source_lang: "zh-CN".into(),
                    target_lang: "en".into(),
                    note: String::new(),
                    origin: "write".into(),
                },
                NOW,
            )
            .unwrap();
        assert_eq!(db.due_sentences(NOW, 10).unwrap().len(), 1);
        let due = db.review("sentence", s.id, 2, NOW).unwrap();
        assert_eq!(due, NOW + DAY_MS);
        assert!(db.due_sentences(NOW, 10).unwrap().is_empty());
        assert!(db.review("bogus", s.id, 2, NOW).is_err());
    }

    #[test]
    fn stats_streak_and_buckets() {
        let db = Db::open_in_memory().unwrap();
        // Practice today and yesterday; collecting favorites does not extend the streak.
        db.add_session(&session(3), NOW).unwrap();
        db.add_session(&session(2), NOW - DAY_MS).unwrap();
        db.add_word(&word("a"), NOW - 2 * DAY_MS).unwrap();
        db.add_word(&word("b"), NOW - 5 * DAY_MS).unwrap();
        let st = db.stats(NOW, 480).unwrap();
        assert_eq!(st.streak_days, 2);
        assert_eq!(st.today_segments, 3);
        assert_eq!(st.sessions_total, 2);
        assert_eq!(st.words_total, 2);
        assert_eq!(st.practiced_words, 20);
        assert!((st.accuracy - 0.8).abs() < 1e-9);
        assert_eq!(st.weeks.len(), 8);
        assert_eq!(st.days.len(), 112);
        assert_eq!(st.days.last().unwrap().count, 1);
        // Current week is Monday 09/21, so the 5-days-ago word falls in the previous week.
        assert_eq!(st.weeks[7].start, "09/21");
        assert_eq!(st.weeks[7].words, 1);
        assert_eq!(st.weeks[6].words, 1);
        assert_eq!(st.words_week, 1);
        assert_eq!(st.due_words, 2);
    }

    #[test]
    fn streak_survives_until_today_ends() {
        let db = Db::open_in_memory().unwrap();
        db.add_session(&session(1), NOW - DAY_MS).unwrap();
        db.add_session(&session(1), NOW - 2 * DAY_MS).unwrap();
        assert_eq!(db.stats(NOW, 0).unwrap().streak_days, 2);
    }
}
