//! Screen geometry for the quick window and the input-box bubble. Everything is in logical
//! points with the origin at the top-left of the primary display (the space macOS
//! accessibility reports frames in), so these functions stay pure and testable.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { x, y, w, h }
    }
    pub fn right(&self) -> f64 {
        self.x + self.w
    }
    pub fn bottom(&self) -> f64 {
        self.y + self.h
    }
    pub fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }
    pub fn contains(&self, (px, py): (f64, f64)) -> bool {
        px >= self.x && px < self.right() && py >= self.y && py < self.bottom()
    }
    pub fn intersect(&self, o: &Rect) -> Option<Rect> {
        let x = self.x.max(o.x);
        let y = self.y.max(o.y);
        let r = self.right().min(o.right());
        let b = self.bottom().min(o.bottom());
        (r - x >= 1.0 && b - y >= 1.0).then(|| Rect::new(x, y, r - x, b - y))
    }
}

/// Which edge of the quick window stays put when its content grows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Top,
    Bottom,
}

/// Side of the square bubble window (22pt icon plus room for its shadow).
pub const BUBBLE: f64 = 28.0;
pub const MINI_W: f64 = 420.0;
pub const MINI_MIN_H: f64 = 132.0;
pub const MINI_MAX_H: f64 = 560.0;
/// Space between the quick window and the input box it belongs to.
const GAP: f64 = 8.0;
/// Minimum distance from the edges of the screen's work area.
const MARGIN: f64 = 8.0;
/// Inputs shorter than this are single-line: the bubble is centred vertically instead.
const TALL_INPUT: f64 = 36.0;

/// The screen containing `point`, else the one whose centre is nearest.
pub fn screen_for(point: (f64, f64), screens: &[Rect]) -> Rect {
    if let Some(s) = screens.iter().find(|s| s.contains(point)) {
        return *s;
    }
    let dist = |s: &Rect| {
        let (cx, cy) = s.center();
        (cx - point.0).powi(2) + (cy - point.1).powi(2)
    };
    screens
        .iter()
        .copied()
        .min_by(|a, b| dist(a).total_cmp(&dist(b)))
        .unwrap_or(Rect::new(0.0, 0.0, 1440.0, 900.0))
}

/// Top-left of the bubble: tucked into the bottom-right corner of the visible part of the input.
pub fn bubble_origin(visible: Rect) -> (f64, f64) {
    let x = visible.right() - BUBBLE - 2.0;
    let y = if visible.h >= TALL_INPUT { visible.bottom() - BUBBLE - 2.0 } else { visible.y + (visible.h - BUBBLE) / 2.0 };
    (x, y)
}

/// Tallest the quick window may get on `screen`.
pub fn max_height(screen: Rect) -> f64 {
    MINI_MAX_H.min(screen.h - 2.0 * MARGIN).max(MINI_MIN_H)
}

/// Moves `frame` (shrinking it first if it is taller than the screen) so it sits inside `screen`.
pub fn clamp(frame: Rect, screen: Rect) -> Rect {
    let w = frame.w.min(screen.w - 2.0 * MARGIN).max(1.0);
    let h = frame.h.min(screen.h - 2.0 * MARGIN).max(1.0);
    let x = frame.x.min(screen.right() - MARGIN - w).max(screen.x + MARGIN);
    let y = frame.y.min(screen.bottom() - MARGIN - h).max(screen.y + MARGIN);
    Rect::new(x, y, w, h)
}

/// Below the input and right-aligned with it; above it when there is no room below.
pub fn place_at_anchor(anchor: Rect, h: f64, screen: Rect) -> (Rect, Edge) {
    let x = anchor.right() - MINI_W;
    let below = Rect::new(x, anchor.bottom() + GAP, MINI_W, h);
    if below.bottom() <= screen.bottom() - MARGIN {
        return (clamp(below, screen), Edge::Top);
    }
    let above = Rect::new(x, anchor.y - GAP - h, MINI_W, h);
    if above.y >= screen.y + MARGIN {
        return (clamp(above, screen), Edge::Bottom);
    }
    (clamp(below, screen), Edge::Top)
}

/// Centred horizontally just below the pointer.
pub fn place_at_cursor(cursor: (f64, f64), h: f64, screen: Rect) -> Rect {
    clamp(Rect::new(cursor.0 - MINI_W / 2.0, cursor.1 + 16.0, MINI_W, h), screen)
}

/// New frame for a content height of `h`, keeping `edge` fixed.
pub fn refit(frame: Rect, edge: Edge, h: f64, screen: Rect) -> Rect {
    let h = h.clamp(MINI_MIN_H, max_height(screen));
    let y = match edge {
        Edge::Top => frame.y,
        Edge::Bottom => frame.bottom() - h,
    };
    clamp(Rect::new(frame.x, y, frame.w, h), screen)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { x: 0.0, y: 25.0, w: 1440.0, h: 875.0 };

    #[test]
    fn bubble_sits_in_the_corner_of_tall_inputs() {
        let input = Rect::new(100.0, 600.0, 500.0, 80.0);
        assert_eq!(bubble_origin(input), (600.0 - BUBBLE - 2.0, 680.0 - BUBBLE - 2.0));
    }

    #[test]
    fn bubble_is_centred_in_single_line_inputs() {
        let input = Rect::new(100.0, 100.0, 300.0, 24.0);
        let (x, y) = bubble_origin(input);
        assert_eq!(x, 400.0 - BUBBLE - 2.0);
        assert_eq!(y, 100.0 + (24.0 - BUBBLE) / 2.0);
    }

    #[test]
    fn opens_below_when_there_is_room() {
        let input = Rect::new(600.0, 200.0, 500.0, 40.0);
        let (f, edge) = place_at_anchor(input, 200.0, SCREEN);
        assert_eq!(edge, Edge::Top);
        assert_eq!(f.y, 248.0);
        assert_eq!(f.right(), 1100.0);
    }

    #[test]
    fn opens_above_near_the_bottom_of_the_screen() {
        let input = Rect::new(600.0, 800.0, 500.0, 60.0);
        let (f, edge) = place_at_anchor(input, 200.0, SCREEN);
        assert_eq!(edge, Edge::Bottom);
        assert_eq!(f.bottom(), 792.0);
    }

    #[test]
    fn clamp_keeps_the_window_on_screen() {
        let f = clamp(Rect::new(1300.0, -50.0, MINI_W, 200.0), SCREEN);
        assert_eq!(f.right(), 1432.0);
        assert_eq!(f.y, 33.0);
    }

    #[test]
    fn refit_keeps_the_fixed_edge() {
        let top = refit(Rect::new(100.0, 100.0, MINI_W, 150.0), Edge::Top, 300.0, SCREEN);
        assert_eq!((top.y, top.h), (100.0, 300.0));
        let bottom = refit(Rect::new(100.0, 500.0, MINI_W, 150.0), Edge::Bottom, 300.0, SCREEN);
        assert_eq!((bottom.bottom(), bottom.h), (650.0, 300.0));
        let capped = refit(Rect::new(100.0, 100.0, MINI_W, 150.0), Edge::Top, 5000.0, SCREEN);
        assert_eq!(capped.h, MINI_MAX_H);
        let floor = refit(Rect::new(100.0, 100.0, MINI_W, 150.0), Edge::Top, 10.0, SCREEN);
        assert_eq!(floor.h, MINI_MIN_H);
    }

    #[test]
    fn screen_for_picks_the_containing_screen() {
        let second = Rect::new(1440.0, 0.0, 1920.0, 1080.0);
        assert_eq!(screen_for((2000.0, 500.0), &[SCREEN, second]), second);
        assert_eq!(screen_for((10.0, 500.0), &[SCREEN, second]), SCREEN);
        assert_eq!(screen_for((-500.0, 500.0), &[SCREEN, second]), SCREEN);
    }

    #[test]
    fn intersect_needs_overlap() {
        let a = Rect::new(0.0, 0.0, 100.0, 100.0);
        assert_eq!(a.intersect(&Rect::new(50.0, 50.0, 100.0, 100.0)), Some(Rect::new(50.0, 50.0, 50.0, 50.0)));
        assert_eq!(a.intersect(&Rect::new(200.0, 0.0, 10.0, 10.0)), None);
    }
}
