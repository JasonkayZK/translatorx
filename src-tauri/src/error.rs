use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Network request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Data parsing failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Msg(String),
    #[error("{code}: {detail}")]
    User { code: &'static str, detail: String },
}

impl AppError {
    pub fn user(code: &'static str, detail: impl Into<String>) -> Self {
        Self::User { code, detail: detail.into() }
    }
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

// Stable categories let every frontend present errors in its selected UI language.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let code = match self { Self::Db(_) => "database", Self::Http(_) => "network", Self::Json(_) => "data", Self::Msg(_) => "message", Self::User {code,..} => code };
        let mut out = s.serialize_struct("AppError", 2)?;
        out.serialize_field("code", code)?;
        let message = match self { Self::User {detail,..} => detail.clone(), _ => self.to_string() };
        out.serialize_field("message", &message)?;
        out.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
