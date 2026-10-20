use serde::Deserialize;
use tauri::WebviewWindow;
use windows_sys::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_OR,
};

const VIEW_WIDTH: i32 = 340;
const VIEW_HEIGHT: i32 = 390;
const MAX_REGIONS: usize = 4096;

/// Rectangles in CSS client coordinates. None restores the full window; an
/// empty list produces an empty region, so an entirely blank pet blocks no input.
#[derive(Debug, Deserialize)]
pub struct InputRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, PartialEq)]
struct PhysicalRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// Keep physical pixels at both boundaries: rounding inward could crop a
/// visible canvas pixel and remove the corresponding native mouse hit target.
fn physical_regions(
    regions: Option<&[InputRect]>,
    scale: f64,
    client_offset: (i32, i32),
) -> Result<Option<Vec<PhysicalRect>>, String> {
    if !scale.is_finite() || scale <= 0.0 {
        return Err("Invalid window scale factor".into());
    }
    let Some(regions) = regions else {
        return Ok(None);
    };
    if regions.len() > MAX_REGIONS {
        return Err(format!("At most {MAX_REGIONS} input rectangles are allowed"));
    }
    let edge = |value: i32, offset: i32, start: bool| -> Result<i32, String> {
        let physical = f64::from(value) * scale + f64::from(offset);
        let rounded = if start { physical.floor() } else { physical.ceil() };
        if rounded < f64::from(i32::MIN) || rounded > f64::from(i32::MAX) {
            return Err("Physical input rectangle exceeds Windows coordinate bounds".into());
        }
        Ok(rounded as i32)
    };
    let mut output = Vec::with_capacity(regions.len());
    for rect in regions {
        let right = rect.x.checked_add(rect.width);
        let bottom = rect.y.checked_add(rect.height);
        if rect.x < 0
            || rect.y < 0
            || rect.width <= 0
            || rect.height <= 0
            || right.map_or(true, |right| right > VIEW_WIDTH)
            || bottom.map_or(true, |bottom| bottom > VIEW_HEIGHT)
        {
            return Err("Input rectangles must be positive and inside the 340x390 client area".into());
        }
        output.push(PhysicalRect {
            left: edge(rect.x, client_offset.0, true)?,
            top: edge(rect.y, client_offset.1, true)?,
            right: edge(right.unwrap(), client_offset.0, false)?,
            bottom: edge(bottom.unwrap(), client_offset.1, false)?,
        });
    }
    Ok(Some(output))
}

/// Delete only regions still owned by this process. SetWindowRgn transfers
/// ownership to Windows on success; failed construction/application stays local.
struct OwnedRegion(HRGN);

impl OwnedRegion {
    fn rectangle(rect: &PhysicalRect) -> Result<Self, String> {
        let handle = unsafe { CreateRectRgn(rect.left, rect.top, rect.right, rect.bottom) };
        if handle == 0 {
            Err(format!("CreateRectRgn failed: {}", std::io::Error::last_os_error()))
        } else {
            Ok(Self(handle))
        }
    }

    fn transfer_to_windows(mut self) {
        self.0 = 0;
    }
}

impl Drop for OwnedRegion {
    fn drop(&mut self) {
        if self.0 != 0 {
            unsafe { DeleteObject(self.0); }
        }
    }
}

/// Use the native window shape for synchronous mouse hit testing. No polling
/// or WS_EX_TRANSPARENT transition is needed when the cursor enters the pet.
#[tauri::command]
pub fn set_input_regions(
    win: WebviewWindow,
    regions: Option<Vec<InputRect>>,
) -> Result<(), String> {
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    // The pet is always frameless (decorations=false, shadow=false), so its
    // client and window origins coincide. Separate position getters can span
    // startup show/move messages and freeze a transient frame offset into the
    // region, even after the final client origin has returned to (0, 0).
    let physical = physical_regions(regions.as_deref(), scale, (0, 0))?;
    win.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
    let hwnd = win.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let Some(rectangles) = physical else {
        if unsafe { SetWindowRgn(hwnd, 0, 1) } == 0 {
            return Err(format!("Clearing window region failed: {}", std::io::Error::last_os_error()));
        }
        return Ok(());
    };

    let combined = OwnedRegion::rectangle(&PhysicalRect { left: 0, top: 0, right: 0, bottom: 0 })?;
    for rectangle in rectangles {
        let piece = OwnedRegion::rectangle(&rectangle)?;
        if unsafe { CombineRgn(combined.0, combined.0, piece.0, RGN_OR) } == 0 {
            return Err(format!("CombineRgn failed: {}", std::io::Error::last_os_error()));
        }
    }
    if unsafe { SetWindowRgn(hwnd, combined.0, 1) } == 0 {
        return Err(format!("Applying window region failed: {}", std::io::Error::last_os_error()));
    }
    combined.transfer_to_windows();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: i32, height: i32) -> InputRect {
        InputRect { x, y, width, height }
    }

    #[test]
    fn full_window_restoration_and_empty_shape_are_distinct() {
        assert_eq!(physical_regions(None, 1.5, (0, 0)).unwrap(), None);
        assert_eq!(physical_regions(Some(&[]), 1.5, (0, 0)).unwrap(), Some(vec![]));
    }

    #[test]
    fn fractional_dpi_keeps_every_edge_pixel_and_client_offset() {
        let regions = [rect(1, 3, 1, 2)];
        assert_eq!(physical_regions(Some(&regions), 1.25, (7, 9)).unwrap(), Some(vec![
            PhysicalRect { left: 8, top: 12, right: 10, bottom: 16 },
        ]));
    }

    #[test]
    fn full_canvas_and_bottom_right_pixel_survive_150_percent_dpi() {
        let regions = [rect(0, 0, 340, 390), rect(339, 389, 1, 1)];
        assert_eq!(physical_regions(Some(&regions), 1.5, (0, 0)).unwrap(), Some(vec![
            PhysicalRect { left: 0, top: 0, right: 510, bottom: 585 },
            PhysicalRect { left: 508, top: 583, right: 510, bottom: 585 },
        ]));
    }

    #[test]
    fn frameless_body_and_tools_keep_their_client_boundaries() {
        let regions = [rect(201, 232, 138, 119), rect(302, 352, 32, 32)];
        let physical = physical_regions(Some(&regions), 1.0, (0, 0)).unwrap().unwrap();
        assert_eq!(physical[0], PhysicalRect { left: 201, top: 232, right: 339, bottom: 351 });
        assert_eq!(physical[1], PhysicalRect { left: 302, top: 352, right: 334, bottom: 384 });
        // GDI regions exclude the right and bottom boundaries; the body ends
        // before the menu, and the menu must not extend to the window bottom.
        let contains = |x, y| physical.iter().any(|r|
            x >= r.left && x < r.right && y >= r.top && y < r.bottom);
        assert!(contains(302, 352));
        assert!(contains(333, 383));
        assert!(!contains(334, 384));
        assert!(!contains(318, 389));
        assert!(!contains(290, 368));
    }

    #[test]
    fn invalid_shape_is_rejected_before_native_state_changes() {
        for invalid in [
            rect(-1, 0, 1, 1), rect(0, -1, 1, 1), rect(340, 0, 1, 1),
            rect(0, 390, 1, 1), rect(0, 0, -1, 1), rect(0, 0, 1, 0),
            rect(i32::MAX, 0, i32::MAX, 1),
        ] {
            assert!(physical_regions(Some(&[invalid]), 1.0, (0, 0)).is_err());
        }
        let too_many: Vec<_> = (0..=MAX_REGIONS).map(|_| rect(0, 0, 1, 1)).collect();
        assert!(physical_regions(Some(&too_many), 1.0, (0, 0)).is_err());
    }

    #[test]
    fn invalid_scale_or_physical_overflow_never_reaches_gdi() {
        let regions = [rect(0, 0, 340, 390)];
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::MAX] {
            assert!(physical_regions(Some(&regions), scale, (0, 0)).is_err());
        }
        assert!(physical_regions(Some(&regions), 1.0, (i32::MAX, 0)).is_err());
    }
}
