//! One private background asset, separate from the settings JSON and learning data.
use crate::{db::Db, error::{AppError, AppResult}};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, OptionalExtension};

pub const PREFIX: &str = "data:image/png;base64,";
pub const MAX_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_ENCODED: usize = PREFIX.len() + ((MAX_BYTES + 2) / 3) * 4;

pub fn validate(data: &str) -> AppResult<()> {
    if data.len() > MAX_ENCODED { return Err(AppError::user("backgroundSize", "")); }
    let encoded = data.strip_prefix(PREFIX).ok_or_else(|| AppError::user("backgroundType", ""))?;
    let bytes = STANDARD.decode(encoded).map_err(|_| AppError::user("backgroundDecode", ""))?;
    if bytes.len() > MAX_BYTES { return Err(AppError::user("backgroundSize", "")); }
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_limits(png::Limits { bytes: 32 * 1024 * 1024 });
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|_| AppError::user("backgroundDecode", ""))?;
    let info = reader.info();
    if info.width == 0 || info.height == 0 || info.width > 2560 || info.height > 2560 {
        return Err(AppError::user("backgroundDimensions", ""));
    }
    if info.animation_control.is_some() { return Err(AppError::user("backgroundAnimation", "")); }
    if reader.output_buffer_size() > 32 * 1024 * 1024 { return Err(AppError::user("backgroundDimensions", "")); }
    let mut pixels = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut pixels).map_err(|_| AppError::user("backgroundDecode", ""))?;
    reader.finish().map_err(|_| AppError::user("backgroundDecode", ""))?;
    Ok(())
}

impl Db {
    pub fn background_image(&self) -> AppResult<Option<String>> {
        let stored: Option<Option<String>> = self.conn().query_row(
            "SELECT CASE WHEN length(value) <= ?1 THEN value ELSE NULL END FROM kv WHERE key = 'background-image'",
            params![MAX_ENCODED as i64], |row| row.get(0),
        ).optional()?;
        let data = match stored {
            None => return Ok(None),
            Some(None) => return Err(AppError::user("backgroundSize", "")),
            Some(Some(data)) => data,
        };
        validate(&data)?;
        Ok(Some(data))
    }
    pub fn save_background_image(&self, data: &str) -> AppResult<()> {
        validate(data)?;
        self.conn().execute("INSERT INTO kv(key,value) VALUES('background-image',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![data])?;
        Ok(())
    }
    pub fn clear_background_image(&self) -> AppResult<()> {
        self.conn().execute("DELETE FROM kv WHERE key='background-image'", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    fn image() -> String {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 2, 2);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[120; 16]).unwrap();
        }
        format!("{PREFIX}{}", STANDARD.encode(bytes))
    }
    #[test]
    fn only_complete_bounded_pngs_are_accepted() {
        assert!(validate(&image()).is_ok());
        assert!(validate("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(validate(&format!("{PREFIX}bm90IGFuIGltYWdl")).is_err());
        assert!(validate(&format!("{PREFIX}{}", "A".repeat(MAX_ENCODED))).is_err());
        let mut bytes = STANDARD.decode(image().strip_prefix(PREFIX).unwrap()).unwrap();
        bytes.truncate(bytes.len() - 12);
        assert!(validate(&format!("{PREFIX}{}", STANDARD.encode(bytes))).is_err());
    }
    #[test]
    fn image_roundtrip_is_independent_of_settings_and_invalid_replacement_is_atomic() {
        let db = Db::open_in_memory().unwrap();
        let data = image();
        db.save_background_image(&data).unwrap();
        assert_eq!(db.background_image().unwrap(), Some(data.clone()));
        let mut settings = db.settings().unwrap();
        settings.theme = "dark".into();
        db.save_settings(&settings).unwrap();
        assert_eq!(db.background_image().unwrap(), Some(data.clone()));
        assert!(db.save_background_image("invalid").is_err());
        assert_eq!(db.background_image().unwrap(), Some(data));
        assert!(!serde_json::to_string(&settings).unwrap().contains("data:image"));
        db.clear_background_image().unwrap();
        db.clear_background_image().unwrap();
        assert_eq!(db.background_image().unwrap(), None);
    }
    #[test]
    fn corrupt_stored_data_is_reported_without_deleting_it() {
        let db = Db::open_in_memory().unwrap();
        db.conn().execute("INSERT INTO kv(key,value) VALUES('background-image','corrupt')", []).unwrap();
        assert!(db.background_image().is_err());
        let count: i64 = db.conn().query_row("SELECT count(*) FROM kv WHERE key='background-image'", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }
}
