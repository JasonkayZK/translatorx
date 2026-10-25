//! A compact SM-2 style scheduler. Grades: 0 again, 1 hard, 2 good, 3 easy.

pub const DAY_MS: i64 = 86_400_000;
const MIN_EASE: f64 = 1.3;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Card {
    pub interval_days: f64,
    pub ease: f64,
    pub reps: i64,
    pub lapses: i64,
}

impl Default for Card {
    fn default() -> Self {
        Self { interval_days: 0.0, ease: 2.5, reps: 0, lapses: 0 }
    }
}

/// Returns the updated card and the next due timestamp in ms.
pub fn schedule(card: Card, grade: u8, now_ms: i64) -> (Card, i64) {
    let mut c = card;
    match grade {
        0 => {
            c.reps = 0;
            c.lapses += 1;
            c.ease = (c.ease - 0.2).max(MIN_EASE);
            c.interval_days = 0.0;
            // Relearn in ten minutes.
            return (c, now_ms + 10 * 60 * 1000);
        }
        1 => {
            c.ease = (c.ease - 0.15).max(MIN_EASE);
            c.interval_days = (c.interval_days * 1.2).max(1.0);
        }
        2 => {
            c.interval_days = match c.reps {
                0 => 1.0,
                1 => 3.0,
                _ => (c.interval_days * c.ease).max(c.interval_days + 1.0),
            };
        }
        _ => {
            c.ease += 0.15;
            c.interval_days = match c.reps {
                0 => 3.0,
                1 => 6.0,
                _ => (c.interval_days * c.ease * 1.3).max(c.interval_days + 2.0),
            };
        }
    }
    c.reps += 1;
    c.interval_days = c.interval_days.min(3650.0);
    let due = now_ms + (c.interval_days * DAY_MS as f64).round() as i64;
    (c, due)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn again_resets_and_relearns_soon() {
        let c = Card { interval_days: 10.0, ease: 2.5, reps: 4, lapses: 0 };
        let (n, due) = schedule(c, 0, 0);
        assert_eq!(n.reps, 0);
        assert_eq!(n.lapses, 1);
        assert!((n.ease - 2.3).abs() < 1e-9);
        assert_eq!(due, 600_000);
    }

    #[test]
    fn good_progression_grows() {
        let (c1, d1) = schedule(Card::default(), 2, 0);
        assert_eq!(c1.interval_days, 1.0);
        assert_eq!(d1, DAY_MS);
        let (c2, _) = schedule(c1, 2, 0);
        assert_eq!(c2.interval_days, 3.0);
        let (c3, _) = schedule(c2, 2, 0);
        assert!((c3.interval_days - 7.5).abs() < 1e-9);
    }

    #[test]
    fn ease_has_floor() {
        let mut c = Card { ease: 1.35, ..Card::default() };
        for _ in 0..5 {
            c = schedule(c, 1, 0).0;
        }
        assert!((c.ease - MIN_EASE).abs() < 1e-9);
    }

    #[test]
    fn easy_beats_good() {
        let base = Card { interval_days: 5.0, ease: 2.5, reps: 3, lapses: 0 };
        assert!(schedule(base, 3, 0).0.interval_days > schedule(base, 2, 0).0.interval_days);
    }
}
