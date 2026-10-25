//! Local learning history. Favorites are a collection; these rows describe actual activity.
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::Db;
use crate::error::{AppError, AppResult};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS learning_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('translate','read','lookup','practice','review')),
  origin TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  segments INTEGER NOT NULL DEFAULT 0,
  total_words INTEGER NOT NULL DEFAULT 0,
  correct_words INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  grade INTEGER,
  session_id INTEGER UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS learning_receipts (
  event_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  activity_id INTEGER NOT NULL,
  result INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_created ON learning_activities(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_learning_kind ON learning_activities(kind, created_at DESC);
"#;

pub(crate) fn migrate(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(SCHEMA)?;
    // The marker prevents deleted history from being resurrected on the next launch.
    let done: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM kv WHERE key = 'learning_migration_v1')", [], |r| r.get(0),
    )?;
    if !done {
        tx.execute(
            "INSERT OR IGNORE INTO learning_activities
             (event_id,created_at,kind,origin,source_lang,target_lang,source,target,
              segments,total_words,correct_words,duration_ms,session_id,detail)
             SELECT 'legacy-session:' || id, created_at, 'practice', 'legacy',
                    source_lang,target_lang,draft,result,segments,total_words,correct_words,
                    duration_ms,id,detail FROM sessions",
            [],
        )?;
        tx.execute("INSERT INTO kv(key,value) VALUES('learning_migration_v1','1')", [])?;
    }
    // Content-free receipts survive history deletion, preventing a retried score from applying twice.
    tx.execute("INSERT OR IGNORE INTO learning_receipts(event_id,kind,activity_id,result)
        SELECT event_id,kind,id,CASE WHEN kind='practice' THEN session_id
        WHEN kind='review' THEN json_extract(detail,'$.dueAt') ELSE id END
        FROM learning_activities", [])?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityContext {
    pub event_id: String,
    pub kind: String,
    pub origin: String,
}

impl ActivityContext {
    pub fn validate(&self, allowed: &[&str]) -> AppResult<()> {
        if self.event_id.trim().is_empty() || self.event_id.len() > 160
            || !allowed.contains(&self.kind.as_str())
            || !matches!(self.origin.as_str(), "main" | "mini")
        {
            return Err(AppError::msg("Invalid learning activity"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningActivity {
    pub id: i64,
    pub event_id: String,
    pub created_at: i64,
    pub kind: String,
    pub origin: String,
    pub source_lang: String,
    pub target_lang: String,
    pub source: String,
    pub target: String,
    pub segments: i64,
    pub total_words: i64,
    pub correct_words: i64,
    pub duration_ms: i64,
    pub grade: Option<u8>,
    pub session_id: Option<i64>,
    pub detail: String,
}

/// Small records for charts: avoid transferring all historical texts to compute aggregates.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityMetric {
    pub created_at: i64,
    pub kind: String,
    pub source_lang: String,
    pub target_lang: String,
    pub segments: i64,
    pub total_words: i64,
    pub correct_words: i64,
    pub duration_ms: i64,
}

pub(crate) struct NewActivity<'a> {
    pub event_id: &'a str,
    pub kind: &'a str,
    pub origin: &'a str,
    pub source_lang: &'a str,
    pub target_lang: &'a str,
    pub source: &'a str,
    pub target: &'a str,
    pub segments: i64,
    pub total_words: i64,
    pub correct_words: i64,
    pub duration_ms: i64,
    pub grade: Option<u8>,
    pub session_id: Option<i64>,
    pub detail: &'a str,
}

pub(crate) fn validate_event(id: &str) -> AppResult<()> {
    if id.trim().is_empty() || id.len() > 160 { return Err(AppError::msg("Invalid activity identifier")); }
    Ok(())
}

pub(crate) fn event_id(conn: &Connection) -> AppResult<String> {
    Ok(conn.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?)
}

pub(crate) fn receipt(conn: &Connection, id: &str, kind: &str) -> AppResult<Option<i64>> {
    let found: Option<(String,i64)> = conn.query_row("SELECT kind,result FROM learning_receipts WHERE event_id=?1", [id],
        |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
    match found {
        Some((old_kind, result)) if old_kind == kind => Ok(Some(result)),
        Some(_) => Err(AppError::msg("Activity identifier already used")),
        None => Ok(None),
    }
}

pub(crate) fn insert(conn: &Connection, a: &NewActivity<'_>, now: i64) -> AppResult<i64> {
    if receipt(conn,a.event_id,a.kind)?.is_some() {
        return Ok(conn.query_row("SELECT activity_id FROM learning_receipts WHERE event_id=?1",[a.event_id],|r|r.get(0))?);
    }
    conn.execute(
        "INSERT INTO learning_activities
        (event_id,created_at,kind,origin,source_lang,target_lang,source,target,segments,
         total_words,correct_words,duration_ms,grade,session_id,detail)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
        ON CONFLICT(event_id) DO NOTHING",
        params![a.event_id,now,a.kind,a.origin,a.source_lang,a.target_lang,a.source,a.target,
                a.segments,a.total_words,a.correct_words,a.duration_ms,a.grade,a.session_id,a.detail],
    )?;
    let (id, kind, session_id): (i64, String, Option<i64>) = conn.query_row(
        "SELECT id,kind,session_id FROM learning_activities WHERE event_id=?1", [a.event_id],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
    )?;
    if kind != a.kind || session_id != a.session_id { return Err(AppError::msg("Activity identifier already used")); }
    let result = match a.kind {
        "practice" => a.session_id.ok_or_else(|| AppError::msg("Missing practice session"))?,
        "review" => serde_json::from_str::<serde_json::Value>(a.detail)?["dueAt"].as_i64()
            .ok_or_else(|| AppError::msg("Missing review schedule"))?,
        _ => id,
    };
    conn.execute("INSERT INTO learning_receipts(event_id,kind,activity_id,result) VALUES(?1,?2,?3,?4)",
        params![a.event_id,a.kind,id,result])?;
    Ok(id)
}

fn from_row(r: &Row<'_>) -> rusqlite::Result<LearningActivity> {
    Ok(LearningActivity {
        id:r.get("id")?, event_id:r.get("event_id")?, created_at:r.get("created_at")?,
        kind:r.get("kind")?, origin:r.get("origin")?, source_lang:r.get("source_lang")?,
        target_lang:r.get("target_lang")?, source:r.get("source")?, target:r.get("target")?,
        segments:r.get("segments")?, total_words:r.get("total_words")?,
        correct_words:r.get("correct_words")?, duration_ms:r.get("duration_ms")?,
        grade:r.get("grade")?, session_id:r.get("session_id")?, detail:r.get("detail")?,
    })
}

impl Db {
    pub fn record_activity(&self, ctx: &ActivityContext, source_lang: &str, target_lang: &str,
                           source: &str, target: &str, segments: i64, now: i64) -> AppResult<i64> {
        ctx.validate(&["translate", "read", "lookup"])?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let id = insert(&tx, &NewActivity {
            event_id:&ctx.event_id, kind:&ctx.kind, origin:&ctx.origin,
            source_lang,target_lang,source,target,segments,total_words:0,correct_words:0,
            duration_ms:0,grade:None,session_id:None,detail:"{}",
        }, now)?;
        tx.commit()?;
        Ok(id)
    }

    pub fn list_activities(&self, limit: i64, offset: i64, kind: Option<&str>, since: Option<i64>) -> AppResult<Vec<LearningActivity>> {
        let conn = self.conn();
        let mut st = conn.prepare(
            "SELECT * FROM learning_activities WHERE (?1 IS NULL OR kind=?1)
             AND (?2 IS NULL OR created_at>=?2) ORDER BY created_at DESC,id DESC LIMIT ?3 OFFSET ?4",
        )?;
        let rows = st.query_map(params![kind,since,limit.clamp(1,200),offset.max(0)], from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn activity_metrics(&self, since: Option<i64>) -> AppResult<Vec<ActivityMetric>> {
        let conn = self.conn();
        let mut st = conn.prepare(
            "SELECT created_at,kind,source_lang,target_lang,segments,total_words,correct_words,duration_ms
             FROM learning_activities WHERE (?1 IS NULL OR created_at>=?1) ORDER BY created_at",
        )?;
        let rows = st.query_map([since], |r| Ok(ActivityMetric {
            created_at:r.get(0)?,kind:r.get(1)?,source_lang:r.get(2)?,target_lang:r.get(3)?,
            segments:r.get(4)?,total_words:r.get(5)?,correct_words:r.get(6)?,duration_ms:r.get(7)?,
        }))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn delete_activity(&self, id: i64) -> AppResult<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let session_id: Option<Option<i64>> = tx.query_row(
            "SELECT session_id FROM learning_activities WHERE id=?1", [id], |r| r.get(0),
        ).optional()?;
        if let Some(Some(session_id)) = session_id {
            tx.execute("DELETE FROM sessions WHERE id=?1", [session_id])?;
        }
        tx.execute("DELETE FROM learning_activities WHERE id=?1", [id])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{NewSession, NewWord};
    fn session() -> NewSession {
        NewSession { source_lang:"zh-CN".into(),target_lang:"en".into(),draft:"你好".into(),
            result:"Hello".into(),mode:"recall".into(),segments:1,total_words:1,
            correct_words:1,hints:0,duration_ms:1000,detail:"[]".into() }
    }
    #[test]
    fn practice_retries_are_one_session_and_history_deletion_is_consistent() {
        let db=Db::open_in_memory().unwrap();
        let id=db.add_session_with_event(&session(),100,Some("practice-one"),"mini").unwrap();
        assert_eq!(id,db.add_session_with_event(&session(),101,Some("practice-one"),"mini").unwrap());
        assert_eq!(db.list_sessions(30).unwrap().len(),1);
        let activity=db.list_activities(10,0,None,None).unwrap().remove(0);
        assert_eq!(activity.session_id,Some(id));
        db.delete_activity(activity.id).unwrap();
        assert!(db.list_sessions(30).unwrap().is_empty());
        assert_eq!(id,db.add_session_with_event(&session(),102,Some("practice-one"),"mini").unwrap());
        assert!(db.list_sessions(30).unwrap().is_empty());
        migrate(&mut db.conn()).unwrap();
        assert!(db.list_activities(10,0,None,None).unwrap().is_empty());
    }
    #[test]
    fn review_retries_do_not_reschedule_and_failed_history_rolls_back_srs() {
        let db=Db::open_in_memory().unwrap();
        let word=db.add_word(&NewWord {text:"hello".into(),meaning:"你好".into(),lang:"en".into(),
            note:String::new(),context:String::new(),context_translation:String::new()},0).unwrap();
        let due=db.review_with_event("word",word.id,2,100,Some("review-one")).unwrap();
        assert_eq!(due,db.review_with_event("word",word.id,2,200,Some("review-one")).unwrap());
        assert_eq!(db.list_words("").unwrap()[0].reps,1);
        db.conn().execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON learning_activities BEGIN SELECT RAISE(ABORT,'disk full'); END;").unwrap();
        assert!(db.review_with_event("word",word.id,2,300,Some("review-two")).is_err());
        assert_eq!(db.list_words("").unwrap()[0].reps,1);
        db.conn().execute_batch("DROP TRIGGER fail_history").unwrap();
        let activity = db.list_activities(10,0,None,None).unwrap()[0].id;
        db.delete_activity(activity).unwrap();
        assert_eq!(due,db.review_with_event("word",word.id,2,400,Some("review-one")).unwrap());
        assert_eq!(db.list_words("").unwrap()[0].reps,1);
        assert!(db.list_activities(10,0,None,None).unwrap().is_empty());
        db.review_with_event("word",word.id,2,500,Some("review-new")).unwrap();
        db.delete_item("word",word.id).unwrap();
        assert_eq!(db.list_activities(10,0,None,None).unwrap()[0].source,"hello");
    }
    #[test]
    fn failed_practice_history_rolls_back_and_can_retry() {
        let db=Db::open_in_memory().unwrap();
        db.conn().execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON learning_activities BEGIN SELECT RAISE(ABORT,'disk full'); END;").unwrap();
        assert!(db.add_session_with_event(&session(),100,Some("retry-practice"),"main").is_err());
        assert!(db.list_sessions(10).unwrap().is_empty());
        assert!(db.activity_metrics(None).unwrap().is_empty());
        db.conn().execute_batch("DROP TRIGGER fail_history").unwrap();
        db.add_session_with_event(&session(),101,Some("retry-practice"),"main").unwrap();
        db.add_session_with_event(&session(),102,Some("retry-practice"),"main").unwrap();
        assert_eq!(db.list_sessions(10).unwrap().len(),1);
    }
    #[test]
    fn legacy_sessions_migrate_once() {
        let db=Db::open_in_memory().unwrap();
        db.add_session(&session(),100).unwrap();
        let mut conn=db.conn();
        conn.execute_batch("DELETE FROM learning_activities; DELETE FROM kv WHERE key='learning_migration_v1';").unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        drop(conn);
        let activities=db.list_activities(10,0,None,None).unwrap();
        assert_eq!(activities.len(),1);
        assert!(activities[0].event_id.starts_with("legacy-session:"));
    }
    fn context(id: &str) -> ActivityContext {
        ActivityContext { event_id:id.into(),kind:"translate".into(),origin:"mini".into() }
    }
    #[test]
    fn history_without_favorites_is_idempotent_and_filterable() {
        let db = Db::open_in_memory().unwrap();
        let first = db.record_activity(&context("one"),"zh-CN","en","你好","Hello",1,100).unwrap();
        assert_eq!(first,db.record_activity(&context("one"),"zh-CN","en","你好","Hello",1,101).unwrap());
        db.record_activity(&context("two"),"zh-CN","en","谢谢","Thanks",1,200).unwrap();
        assert_eq!(db.list_activities(10,0,None,None).unwrap().len(),2);
        assert_eq!(db.list_activities(10,0,Some("read"),None).unwrap().len(),0);
        assert_eq!(db.list_activities(1,1,None,None).unwrap()[0].id,first);
        assert_eq!(db.activity_metrics(Some(150)).unwrap().len(),1);
        assert!(db.list_words("").unwrap().is_empty());
        db.delete_activity(first).unwrap();
        assert_eq!(db.activity_metrics(None).unwrap().len(),1);
    }
    #[test]
    fn rejects_non_learning_context() {
        let db=Db::open_in_memory().unwrap();
        let mut ctx=context("x");ctx.kind="favorite".into();
        assert!(db.record_activity(&ctx,"en","zh-CN","x","x",1,0).is_err());
    }
}
