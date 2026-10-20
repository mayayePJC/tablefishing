/// Convert Windows physical screen positions to CSS logical coordinates relative
/// to the client origin (pointer events) or gesture origin (window movement).
pub(crate) fn logical_offset(
    position: (i32, i32),
    origin: (i32, i32),
    scale_factor: f64,
) -> (f64, f64) {
    (
        (f64::from(position.0) - f64::from(origin.0)) / scale_factor,
        (f64::from(position.1) - f64::from(origin.1)) / scale_factor,
    )
}

#[cfg(test)]
mod tests {
    use super::logical_offset;

    #[test]
    fn pointer_at_100_percent_matches_dom_client_coordinates() {
        assert_eq!(logical_offset((1240, 2300), (1000, 2000), 1.0), (240.0, 300.0));
    }

    #[test]
    fn pointer_over_character_at_125_percent_stays_inside_character() {
        // This point is inside the character at CSS (240, 300); physical y=375
        // was previously compared with the body's CSS bottom=352 and ignored.
        assert_eq!(logical_offset((1300, 2375), (1000, 2000), 1.25), (240.0, 300.0));
    }

    #[test]
    fn pointer_at_150_percent_uses_client_origin_on_negative_monitor() {
        assert_eq!(logical_offset((-1563, 495), (-1920, 60), 1.5), (238.0, 290.0));
    }

    #[test]
    fn logical_pointer_preserves_subpixel_precision() {
        assert_eq!(logical_offset((1, -1), (0, 0), 1.25), (0.8, -0.8));
    }

    #[test]
    fn body_movement_threshold_has_same_css_units_as_pointer() {
        assert_eq!(logical_offset((115, 200), (100, 200), 1.25), (12.0, 0.0));
        assert_eq!(logical_offset((118, 200), (100, 200), 1.5), (12.0, 0.0));
        assert!(logical_offset((116, 200), (100, 200), 1.25).0 > 12.0);
    }
}
