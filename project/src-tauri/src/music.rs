//! Read the user's BGM folder directly, alongside the existing private import library.
//! IPC exposes catalogue IDs, never caller-provided filesystem paths.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_FILE_BYTES: usize = 50 * 1024 * 1024;
const MAX_BATCH_BYTES: usize = 150 * 1024 * 1024;
const MAX_BATCH_FILES: usize = 100;
const MAX_TRACKS: usize = 512;
const MAX_FOLDER_ENTRIES: usize = 4096;
const FOLDER_ID_PREFIX: &str = "folder-";
const MANIFEST: &str = "manifest.json";
static LIBRARY_LOCK: Mutex<()> = Mutex::new(());
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
static MUSIC_FOLDER: OnceLock<PathBuf> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct LocalTrack {
    pub id: String,
    pub name: String,
    pub mime: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Deserialize)]
pub struct MusicImport {
    pub name: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredTrack {
    #[serde(flatten)]
    track: LocalTrack,
    file: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct Manifest {
    version: u32,
    tracks: Vec<StoredTrack>,
}

impl Default for Manifest {
    fn default() -> Self {
        Self { version: 1, tracks: Vec::new() }
    }
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|path| path.join("music"))
        .map_err(|error| format!("无法打开本地音乐目录：{error}"))
}

#[tauri::command]
pub fn list_local_music(app: AppHandle) -> Result<Vec<LocalTrack>, String> {
    let _guard = LIBRARY_LOCK.lock().map_err(|_| "音乐库暂时不可用，请重启应用".to_string())?;
    list_with_folder(&library_dir(&app)?, music_folder())
}

#[tauri::command]
pub fn music_folder_info() -> Result<String, String> {
    Ok(music_folder().to_string_lossy().into_owned())
}

#[tauri::command]
pub fn import_local_music(app: AppHandle, files: Vec<MusicImport>) -> Result<Vec<LocalTrack>, String> {
    let _guard = LIBRARY_LOCK.lock().map_err(|_| "音乐库暂时不可用，请重启应用".to_string())?;
    import_into(&library_dir(&app)?, files)
}

#[tauri::command]
pub fn read_local_music(app: AppHandle, id: String) -> Result<Vec<u8>, String> {
    let _guard = LIBRARY_LOCK.lock().map_err(|_| "音乐库暂时不可用，请重启应用".to_string())?;
    if id.starts_with(FOLDER_ID_PREFIX) { read_from_folder(music_folder(), &id) }
    else { read_from(&library_dir(&app)?, &id) }
}

#[tauri::command]
pub fn remove_local_music(app: AppHandle, id: String) -> Result<(), String> {
    let _guard = LIBRARY_LOCK.lock().map_err(|_| "音乐库暂时不可用，请重启应用".to_string())?;
    remove_from(&library_dir(&app)?, &id)
}

fn fresh_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("track-{nanos:x}-{:x}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

fn directory_named(path: &Path, expected: &str) -> bool {
    path.file_name().and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(expected))
}

/// Pure path selection. The one filesystem observation is supplied by the caller
/// so overrides and portable layouts stay deterministic even before BGM exists.
fn choose_music_folder(
    override_folder: Option<&Path>,
    executable: Option<&Path>,
    manifest_dir: &Path,
    executable_bgm_is_dir: bool,
) -> PathBuf {
    // Never resolve relative environment values against whichever cwd launched us.
    if let Some(folder) = override_folder.filter(|folder| folder.is_absolute()) {
        return folder.to_path_buf();
    }
    let executable_dir = executable.filter(|path| path.is_absolute()).and_then(Path::parent);
    if executable_bgm_is_dir {
        if let Some(parent) = executable_dir { return parent.join("BGM"); }
    }
    // A copied portable release or direct runtime launch must follow its own
    // workspace, not the original absolute CARGO_MANIFEST_DIR baked into the exe.
    if let Some(project) = executable_dir.filter(|path| directory_named(path, "runtime"))
        .and_then(Path::parent).filter(|path| directory_named(path, "project"))
    {
        if let Some(workspace) = project.parent() { return workspace.join("BGM"); }
    }
    // Installed builds use the build workspace's BGM. Support both the new
    // workspace/project/src-tauri layout and the former workspace/src-tauri layout.
    let project = manifest_dir.parent().unwrap_or(manifest_dir);
    let workspace = if directory_named(project, "project") {
        project.parent().unwrap_or(project)
    } else { project };
    workspace.join("BGM")
}

fn music_folder() -> &'static Path {
    MUSIC_FOLDER.get_or_init(|| {
        let override_folder = std::env::var_os("FISHING_BGM_DIR").map(PathBuf::from);
        let executable = std::env::current_exe().ok();
        // Only the legacy adjacent-directory preference depends on existence.
        // In particular, an absolute launcher override remains selected if absent;
        // scan_folder then returns an empty library instead of switching folders.
        let executable_bgm_is_dir = executable.as_deref().and_then(Path::parent)
            .is_some_and(|parent| parent.join("BGM").is_dir());
        choose_music_folder(override_folder.as_deref(), executable.as_deref(),
            Path::new(env!("CARGO_MANIFEST_DIR")), executable_bgm_is_dir)
    }).as_path()
}

fn folder_id(name: &str) -> String {
    let mut id = String::with_capacity(FOLDER_ID_PREFIX.len() + name.len() * 2);
    id.push_str(FOLDER_ID_PREFIX);
    for byte in name.as_bytes() { id.push_str(&format!("{byte:02x}")); }
    id
}

fn folder_name(id: &str) -> Result<String, String> {
    let hex = id.strip_prefix(FOLDER_ID_PREFIX).ok_or("无效的 BGM 曲目编号")?;
    if hex.is_empty() || hex.len() > 2048 || hex.len() % 2 != 0 || !hex.is_ascii() {
        return Err("无效的 BGM 曲目编号".into());
    }
    let bytes = (0..hex.len()).step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16))
        .collect::<Result<Vec<_>, _>>().map_err(|_| "无效的 BGM 曲目编号")?;
    let name = String::from_utf8(bytes).map_err(|_| "无效的 BGM 文件名")?;
    let (basename, _, _) = import_name(&name)?;
    if basename != name || name.contains(['/', '\\', ':']) || Path::new(&name).components().count() != 1 {
        return Err("BGM 曲目必须位于默认音乐文件夹内".into());
    }
    Ok(name)
}

fn folder_file(root: &Path, name: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|_| "BGM 文件夹不存在或暂时无法读取")?;
    let candidate = fs::canonicalize(root.join(name)).map_err(|_| "BGM 音乐已移走或暂时无法读取")?;
    if candidate.parent() != Some(root.as_path()) {
        return Err("BGM 曲目必须位于默认音乐文件夹内".into());
    }
    let metadata = fs::metadata(&candidate).map_err(|_| "无法读取 BGM 文件信息")?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_FILE_BYTES as u64 {
        return Err("BGM 音乐为空、不是文件或超过 50 MB".into());
    }
    Ok(candidate)
}

fn scan_folder(dir: &Path) -> Result<Vec<LocalTrack>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("无法读取 BGM 文件夹，请检查目录权限后重试：{error}")),
    };
    let mut names: Vec<String> = entries.take(MAX_FOLDER_ENTRIES).filter_map(Result::ok)
        .filter_map(|entry| {
            // A linked file can leave the fixed folder; folder_file rechecks the
            // canonical path as well, including if a file changes after scanning.
            if !entry.file_type().ok()?.is_file() { return None; }
            entry.file_name().to_str().map(str::to_owned)
        }).collect();
    names.sort_by_cached_key(|name| (name.to_lowercase(), name.clone()));
    let mut tracks = Vec::new();
    for name in names {
        let (basename, extension, mime) = match import_name(&name) { Ok(info) => info, Err(_) => continue };
        if basename != name { continue; }
        let path = match folder_file(dir, &name) { Ok(path) => path, Err(_) => continue };
        let mut header = Vec::with_capacity(64);
        let read = fs::File::open(path).and_then(|file| file.take(64).read_to_end(&mut header));
        if read.is_err() || !audio_header_matches(&extension, &header) { continue; }
        tracks.push(LocalTrack { id: folder_id(&name), name, mime: mime.into(), source: Some("folder".into()) });
        if tracks.len() >= MAX_TRACKS { break; }
    }
    Ok(tracks)
}

fn list_with_folder(library: &Path, folder: &Path) -> Result<Vec<LocalTrack>, String> {
    let mut tracks = scan_folder(folder)?;
    tracks.extend(list_from(library)?);
    Ok(tracks)
}

fn read_from_folder(dir: &Path, id: &str) -> Result<Vec<u8>, String> {
    let name = folder_name(id)?;
    let path = folder_file(dir, &name)?;
    let mut bytes = Vec::new();
    fs::File::open(path).and_then(|file| file.take(MAX_FILE_BYTES as u64 + 1).read_to_end(&mut bytes))
        .map_err(|error| format!("无法读取 BGM 音乐：{error}"))?;
    if bytes.len() > MAX_FILE_BYTES { return Err("BGM 音乐超过 50 MB".into()); }
    let (_, extension, _) = import_name(&name)?;
    if !audio_header_matches(&extension, &bytes) { return Err("BGM 音乐文件已损坏，请检查原文件".into()); }
    Ok(bytes)
}

fn valid_id(id: &str) -> bool {
    id.starts_with("track-") && id.len() <= 80 && id.len() > 6
        && id[6..].bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

fn audio_type(extension: &str) -> Option<&'static str> {
    match extension {
        "mp3" => Some("audio/mpeg"),
        "ogg" => Some("audio/ogg"),
        "wav" => Some("audio/wav"),
        "flac" => Some("audio/flac"),
        _ => None,
    }
}

fn audio_header_matches(extension: &str, data: &[u8]) -> bool {
    match extension {
        "mp3" => (data.len() >= 10 && data.starts_with(b"ID3") && (2..=4).contains(&data[3]))
            || (data.len() >= 4 && data[0] == 0xff && data[1] & 0xe0 == 0xe0
                && data[1] & 0x18 != 0x08 && data[1] & 0x06 != 0
                && data[2] & 0xf0 != 0xf0 && data[2] & 0xf0 != 0 && data[2] & 0x0c != 0x0c),
        "ogg" => data.len() >= 27 && data.starts_with(b"OggS") && data[4] == 0,
        "wav" => data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WAVE",
        "flac" => data.len() >= 8 && data.starts_with(b"fLaC"),
        _ => false,
    }
}

fn import_name(name: &str) -> Result<(String, String, &'static str), String> {
    // Some webviews return C:\fakepath\name.mp3. Only the display basename survives.
    let basename = name.rsplit(['/', '\\']).next().unwrap_or("");
    let basename: String = basename.chars().filter(|c| !c.is_control()).collect();
    let basename = basename.trim();
    if basename.is_empty() || basename.chars().count() > 200 {
        return Err("音频文件名为空或过长".into());
    }
    let extension = basename.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase())
        .ok_or_else(|| format!("{basename}：请选择 MP3、OGG、WAV 或 FLAC 文件"))?;
    let mime = audio_type(&extension)
        .ok_or_else(|| format!("{basename}：请选择 MP3、OGG、WAV 或 FLAC 文件"))?;
    Ok((basename.into(), extension, mime))
}

fn load_manifest(dir: &Path) -> Result<Manifest, String> {
    let path = dir.join(MANIFEST);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Manifest::default()),
        Err(error) => return Err(format!("无法读取本地音乐列表：{error}")),
    };
    let manifest: Manifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("本地音乐列表损坏，现有音频已保留：{error}"))?;
    let mut ids = HashSet::new();
    if manifest.version != 1 || manifest.tracks.len() > MAX_TRACKS {
        return Err("本地音乐列表版本或曲目数量无效，现有音频已保留".into());
    }
    for stored in &manifest.tracks {
        let extension = stored.file.rsplit_once('.').map(|(_, extension)| extension).unwrap_or("");
        if !valid_id(&stored.track.id) || !ids.insert(stored.track.id.clone())
            || stored.file != format!("{}.{}", stored.track.id, extension)
            || audio_type(extension) != Some(stored.track.mime.as_str())
        {
            return Err("本地音乐列表包含无效曲目，现有音频已保留".into());
        }
    }
    Ok(manifest)
}

fn list_from(dir: &Path) -> Result<Vec<LocalTrack>, String> {
    Ok(load_manifest(dir)?.tracks.into_iter().map(|stored| stored.track).collect())
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)
        .map_err(|error| format!("无法保存本地音乐：{error}"))?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(format!("无法保存本地音乐：{error}"));
    }
    Ok(())
}

// std::fs::rename does not replace an existing file on Windows. ReplaceFileW keeps
// the old catalogue intact until the complete, flushed replacement is committed.
#[cfg(windows)]
fn replace_manifest(temp: &Path, destination: &Path) -> std::io::Result<()> {
    if !destination.exists() {
        return fs::rename(temp, destination);
    }
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(replaced: *const u16, replacement: *const u16, backup: *const u16,
            flags: u32, exclude: *mut std::ffi::c_void, reserved: *mut std::ffi::c_void) -> i32;
    }
    let replaced: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
    let replacement: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe { ReplaceFileW(replaced.as_ptr(), replacement.as_ptr(), std::ptr::null(),
        0, std::ptr::null_mut(), std::ptr::null_mut()) };
    if result != 0 { Ok(()) } else { Err(std::io::Error::last_os_error()) }
}

#[cfg(not(windows))]
fn replace_manifest(temp: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temp, destination)
}

fn save_manifest(dir: &Path, manifest: &Manifest) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|error| format!("无法保存音乐列表：{error}"))?;
    let temp = dir.join(format!("{}.tmp", fresh_id()));
    if let Err(error) = write_new_file(&temp, &bytes) {
        return Err(error);
    }
    if let Err(error) = replace_manifest(&temp, &dir.join(MANIFEST)) {
        let _ = fs::remove_file(&temp);
        return Err(format!("无法更新音乐列表，已有曲目已保留：{error}"));
    }
    Ok(())
}

fn import_into(dir: &Path, files: Vec<MusicImport>) -> Result<Vec<LocalTrack>, String> {
    import_with_manifest_writer(dir, files, save_manifest)
}

fn import_with_manifest_writer(
    dir: &Path,
    files: Vec<MusicImport>,
    commit: impl FnOnce(&Path, &Manifest) -> Result<(), String>,
) -> Result<Vec<LocalTrack>, String> {
    if files.len() > MAX_BATCH_FILES {
        return Err(format!("每次最多导入 {MAX_BATCH_FILES} 首音乐"));
    }
    let mut total = 0usize;
    let mut prepared = Vec::new();
    // Validate the whole batch before any filesystem mutation.
    for file in &files {
        let (name, extension, mime) = import_name(&file.name)?;
        if file.data.len() > MAX_FILE_BYTES {
            return Err(format!("{name}：单曲不能超过 50 MB"));
        }
        total = total.checked_add(file.data.len()).ok_or("导入文件过大")?;
        if total > MAX_BATCH_BYTES {
            return Err("一次导入总量不能超过 150 MB".into());
        }
        if !audio_header_matches(&extension, &file.data) {
            return Err(format!("{name}：文件内容不是有效的 {} 音频", extension.to_ascii_uppercase()));
        }
        prepared.push((name, extension, mime, &file.data));
    }
    if prepared.is_empty() { return Ok(Vec::new()); }
    let mut manifest = load_manifest(dir)?;
    fs::create_dir_all(dir).map_err(|error| format!("无法创建本地音乐目录：{error}"))?;
    let mut added_paths: Vec<PathBuf> = Vec::new();
    let mut result = Vec::new();
    let operation = (|| -> Result<(), String> {
        for (name, extension, mime, data) in prepared {
            let mut duplicate = None;
            for stored in manifest.tracks.iter().filter(|stored| stored.track.name == name) {
                // An incomplete old item must not prevent reimporting its missing source.
                if fs::read(dir.join(&stored.file)).ok().as_deref() == Some(data.as_slice()) {
                    duplicate = Some(stored.track.clone());
                    break;
                }
            }
            if let Some(track) = duplicate {
                if !result.iter().any(|existing: &LocalTrack| existing.id == track.id) { result.push(track); }
                continue;
            }
            if manifest.tracks.len() >= MAX_TRACKS {
                return Err(format!("本地音乐库最多保存 {MAX_TRACKS} 首，请先移除部分曲目"));
            }
            let track = LocalTrack { id: fresh_id(), name, mime: mime.into(), source: None };
            let file = format!("{}.{}", track.id, extension);
            let path = dir.join(&file);
            write_new_file(&path, data)?;
            added_paths.push(path);
            manifest.tracks.push(StoredTrack { track: track.clone(), file });
            result.push(track);
        }
        if !added_paths.is_empty() { commit(dir, &manifest)?; }
        Ok(())
    })();
    if let Err(error) = operation {
        for path in added_paths { let _ = fs::remove_file(path); }
        return Err(error);
    }
    Ok(result)
}

fn read_from(dir: &Path, id: &str) -> Result<Vec<u8>, String> {
    let manifest = load_manifest(dir)?;
    let stored = manifest.tracks.iter().find(|stored| stored.track.id == id)
        .ok_or("这首本地音乐不存在，请重新选择")?;
    let path = dir.join(&stored.file);
    let metadata = fs::metadata(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "音轨文件已丢失，请移除后重新导入".into()
        } else { format!("无法读取本地音乐：{error}") }
    })?;
    if metadata.len() > MAX_FILE_BYTES as u64 { return Err("音轨文件超过 50 MB，请重新导入".into()); }
    let bytes = fs::read(&path).map_err(|error| format!("无法读取本地音乐：{error}"))?;
    let extension = stored.file.rsplit_once('.').map(|(_, extension)| extension).unwrap_or("");
    if !audio_header_matches(extension, &bytes) { return Err("音轨文件已损坏，请移除后重新导入".into()); }
    Ok(bytes)
}

fn remove_from(dir: &Path, id: &str) -> Result<(), String> {
    if id.starts_with(FOLDER_ID_PREFIX) {
        return Err("BGM 文件夹中的音乐由你管理，应用不会删除原文件".into());
    }
    let mut manifest = load_manifest(dir)?;
    let index = manifest.tracks.iter().position(|stored| stored.track.id == id)
        .ok_or("这首本地音乐不存在，无法移除")?;
    let stored = manifest.tracks.remove(index);
    let source = dir.join(&stored.file);
    let pending = dir.join(format!("{}.remove", fresh_id()));
    let moved = match fs::rename(&source, &pending) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("无法移除本地音乐：{error}")),
    };
    if let Err(error) = save_manifest(dir, &manifest) {
        if moved { let _ = fs::rename(&pending, &source); }
        return Err(error);
    }
    if moved {
        fs::remove_file(&pending).map_err(|error| format!("曲目已从音乐库移除，但缓存文件未能删除：{error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Library(PathBuf);
    impl Library {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("fishing-music-{}", fresh_id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Library { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn mp3(name: &str) -> MusicImport {
        MusicImport { name: name.into(), data: b"ID3\x04\0\0\0\0\0\0original music".to_vec() }
    }

    #[test]
    fn import_persists_bytes_and_metadata_and_uses_only_internal_paths() {
        let dir = Library::new();
        let source = mp3("C:\\OST\\spring.MP3");
        let bytes = source.data.clone();
        let imported = import_into(&dir.0, vec![source]).unwrap();
        assert_eq!(imported[0].name, "spring.MP3");
        assert_eq!(imported[0].mime, "audio/mpeg");
        assert_eq!(list_from(&dir.0).unwrap(), imported);
        assert_eq!(read_from(&dir.0, &imported[0].id).unwrap(), bytes);
        assert!(read_from(&dir.0, "../../manifest.json").is_err());
        assert!(remove_from(&dir.0, "../../manifest.json").is_err());
        assert!(dir.0.join(MANIFEST).exists());
    }

    #[test]
    fn any_invalid_file_rejects_whole_batch_and_preserves_existing_music() {
        let dir = Library::new();
        let existing = import_into(&dir.0, vec![mp3("old.mp3")]).unwrap();
        let previous = fs::read(dir.0.join(MANIFEST)).unwrap();
        let bad = MusicImport { name: "fake.mp3".into(), data: b"not music".to_vec() };
        assert!(import_into(&dir.0, vec![mp3("new.mp3"), bad]).is_err());
        assert_eq!(fs::read(dir.0.join(MANIFEST)).unwrap(), previous);
        assert_eq!(list_from(&dir.0).unwrap(), existing);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 2);
    }

    #[test]
    fn duplicate_batch_reuses_track_but_same_name_new_content_is_distinct() {
        let dir = Library::new();
        let first = import_into(&dir.0, vec![mp3("song.mp3"), mp3("song.mp3")]).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(import_into(&dir.0, vec![mp3("song.mp3")]).unwrap(), first);
        let mut changed = mp3("song.mp3");
        changed.data.extend_from_slice(b"new recording");
        let second = import_into(&dir.0, vec![changed]).unwrap();
        assert_ne!(first[0].id, second[0].id);
        assert_eq!(list_from(&dir.0).unwrap().len(), 2);
    }

    #[test]
    fn metadata_commit_failure_rolls_back_new_audio_files() {
        let dir = Library::new();
        let old = import_into(&dir.0, vec![mp3("old.mp3")]).unwrap();
        let previous = fs::read(dir.0.join(MANIFEST)).unwrap();
        let failure = import_with_manifest_writer(&dir.0, vec![mp3("song.mp3")], |_, _| {
            Err("模拟磁盘写入失败".into())
        });
        assert!(failure.is_err());
        assert_eq!(fs::read(dir.0.join(MANIFEST)).unwrap(), previous);
        assert_eq!(list_from(&dir.0).unwrap(), old);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 2);
    }

    #[test]
    fn missing_audio_has_clear_error_and_its_stale_entry_can_be_removed() {
        let dir = Library::new();
        let tracks = import_into(&dir.0, vec![mp3("song.mp3")]).unwrap();
        let manifest = load_manifest(&dir.0).unwrap();
        fs::remove_file(dir.0.join(&manifest.tracks[0].file)).unwrap();
        assert!(read_from(&dir.0, &tracks[0].id).unwrap_err().contains("丢失"));
        remove_from(&dir.0, &tracks[0].id).unwrap();
        assert!(list_from(&dir.0).unwrap().is_empty());
        assert!(remove_from(&dir.0, &tracks[0].id).unwrap_err().contains("不存在"));
    }

    #[test]
    fn removing_track_preserves_other_tracks_and_deletes_its_audio() {
        let dir = Library::new();
        let tracks = import_into(&dir.0, vec![mp3("spring.mp3"), mp3("summer.mp3")]).unwrap();
        remove_from(&dir.0, &tracks[0].id).unwrap();
        assert_eq!(list_from(&dir.0).unwrap(), vec![tracks[1].clone()]);
        assert_eq!(read_from(&dir.0, &tracks[1].id).unwrap(), mp3("summer.mp3").data);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 2);
    }

    #[test]
    fn corrupted_or_path_traversal_manifest_is_never_overwritten() {
        let dir = Library::new();
        let original = br#"{"version":1,"tracks":[{"id":"track-a","name":"bad.mp3","mime":"audio/mpeg","file":"../outside.mp3"}]}"#;
        fs::write(dir.0.join(MANIFEST), original).unwrap();
        assert!(list_from(&dir.0).is_err());
        assert!(import_into(&dir.0, vec![mp3("new.mp3")]).is_err());
        assert_eq!(fs::read(dir.0.join(MANIFEST)).unwrap(), original);
    }

    #[test]
    fn file_format_must_match_extension_and_headers() {
        assert!(audio_header_matches("mp3", &[0xff, 0xfb, 0x90, 0x00]));
        assert!(!audio_header_matches("mp3", b"ID3"));
        assert!(!audio_header_matches("mp3", &[0xff, 0xff, 0xff, 0xff]));
        assert!(audio_header_matches("wav", b"RIFF1234WAVE"));
        assert!(!audio_header_matches("wav", b"RIFF1234AVI "));
        assert!(audio_header_matches("flac", b"fLaC1234"));
        assert!(!audio_header_matches("ogg", b"not a recording"));
        assert!(import_name("song.exe").is_err());
    }

    #[test]
    fn import_limits_reject_before_creating_any_files() {
        let dir = Library::new();
        let too_many = (0..=MAX_BATCH_FILES).map(|_| mp3("song.mp3")).collect();
        assert!(import_into(&dir.0, too_many).unwrap_err().contains("最多导入"));
        let oversized = MusicImport { name: "large.mp3".into(), data: vec![0; MAX_FILE_BYTES + 1] };
        assert!(import_into(&dir.0, vec![oversized]).unwrap_err().contains("50 MB"));
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
    }

    #[test]
    fn nested_portable_runtime_finds_workspace_bgm_without_environment() {
        let root = Library::new();
        let project = root.0.join("project");
        let executable = project.join("runtime").join("fishing-codex.exe");
        let original_manifest = root.0.join("original-build").join("project").join("src-tauri");
        assert_eq!(choose_music_folder(None, Some(&executable), &original_manifest, false), root.0.join("BGM"));
        assert!(!root.0.join("BGM").exists(), "portable path selection must work before the folder is created");
    }

    #[test]
    fn absolute_launcher_override_wins_even_if_missing_and_returns_an_empty_folder_library() {
        let root = Library::new();
        let executable = root.0.join("project").join("runtime").join("fishing-codex.exe");
        let adjacent = executable.parent().unwrap().join("BGM");
        fs::create_dir_all(&adjacent).unwrap();
        fs::write(adjacent.join("unrelated.mp3"), mp3("unrelated.mp3").data).unwrap();
        let missing_override = root.0.join("launcher-selected").join("BGM");
        let selected = choose_music_folder(Some(&missing_override), Some(&executable),
            &root.0.join("project").join("src-tauri"), true);
        assert_eq!(selected, missing_override);
        assert!(scan_folder(&selected).unwrap().is_empty());
        assert_eq!(scan_folder(&adjacent).unwrap().len(), 1);
        assert!(!selected.exists(), "selection and scanning must not create the user's folder");
    }

    #[test]
    fn existing_executable_adjacent_bgm_is_second_priority() {
        let root = Library::new();
        let executable = root.0.join("project").join("runtime").join("fishing-codex.exe");
        let manifest = root.0.join("build-workspace").join("project").join("src-tauri");
        assert_eq!(choose_music_folder(None, Some(&executable), &manifest, true),
            executable.parent().unwrap().join("BGM"));
        assert_eq!(choose_music_folder(None, Some(&executable), &manifest, false), root.0.join("BGM"));
    }

    #[test]
    fn relocated_portable_runtime_follows_its_new_workspace_including_unicode_and_spaces() {
        let root = Library::new();
        let manifest = root.0.join("original-build").join("project").join("src-tauri");
        for copy_name in ["portable-copy", "异地副本 空格", "second-destination"] {
            let destination = root.0.join(copy_name);
            let executable = destination.join("project").join("runtime").join("fishing-codex.exe");
            assert_eq!(choose_music_folder(None, Some(&executable), &manifest, false), destination.join("BGM"));
        }
        let executable = root.0.join("PROJECT").join("Runtime").join("fishing-codex.exe");
        assert_eq!(choose_music_folder(None, Some(&executable), &manifest, false), root.0.join("BGM"));
    }

    #[test]
    fn installed_runtime_falls_back_to_compiled_workspace_for_new_and_legacy_layouts() {
        let root = Library::new();
        let workspace = root.0.join("build-workspace");
        let installed = root.0.join("Program Files").join("Fishing Codex").join("fishing-codex.exe");
        for manifest in [workspace.join("project").join("src-tauri"), workspace.join("src-tauri")] {
            assert_eq!(choose_music_folder(None, Some(&installed), &manifest, false), workspace.join("BGM"));
            assert_eq!(choose_music_folder(None, None, &manifest, false), workspace.join("BGM"));
        }
        assert_eq!(choose_music_folder(None, Some(&installed),
            &workspace.join("project").join("src-tauri"), true), installed.parent().unwrap().join("BGM"));
    }

    #[test]
    fn relative_environment_or_executable_paths_never_resolve_against_the_working_directory() {
        let root = Library::new();
        let manifest = root.0.join("project").join("src-tauri");
        let executable = root.0.join("project").join("runtime").join("fishing-codex.exe");
        for override_value in ["", "BGM", "../BGM", "./BGM", "C:BGM", "\\BGM"] {
            assert_eq!(choose_music_folder(Some(Path::new(override_value)), Some(&executable), &manifest, false),
                root.0.join("BGM"), "relative override was not ignored: {override_value}");
            assert_eq!(choose_music_folder(Some(Path::new(override_value)), Some(&executable), &manifest, true),
                executable.parent().unwrap().join("BGM"));
        }
        // Even an invalid relative executable with a supplied 'exists' observation
        // cannot turn the process cwd into a music source. No global cwd mutation
        // is needed, so this regression is safe under parallel Rust tests.
        assert_eq!(choose_music_folder(None, Some(Path::new("project/runtime/fishing-codex.exe")), &manifest, true),
            root.0.join("BGM"));
    }

    #[test]
    fn folder_scan_is_stable_read_only_and_skips_bad_files_individually() {
        let dir = Library::new();
        let mp3_bytes = mp3("unused.mp3").data;
        fs::write(dir.0.join("春 - Spring.MP3"), &mp3_bytes).unwrap();
        fs::write(dir.0.join("fall.ogg"), [b"OggS\0".as_slice(), &[0; 22]].concat()).unwrap();
        fs::write(dir.0.join("summer.WAV"), b"RIFF1234WAVE").unwrap();
        fs::write(dir.0.join("winter.flac"), b"fLaC1234").unwrap();
        fs::write(dir.0.join("broken.mp3"), b"not an audio file").unwrap();
        fs::write(dir.0.join("empty.ogg"), b"").unwrap();
        fs::write(dir.0.join("readme.txt"), &mp3_bytes).unwrap();
        fs::create_dir(dir.0.join("album.mp3")).unwrap();
        let oversized = fs::File::create(dir.0.join("large.mp3")).unwrap();
        oversized.set_len(MAX_FILE_BYTES as u64 + 1).unwrap();
        drop(oversized);
        let tracks = scan_folder(&dir.0).unwrap();
        assert_eq!(tracks.len(), 4);
        assert_eq!(tracks.iter().map(|track| track.name.as_str()).collect::<Vec<_>>(),
            vec!["fall.ogg", "summer.WAV", "winter.flac", "春 - Spring.MP3"]);
        assert!(tracks.iter().all(|track| track.source.as_deref() == Some("folder")));
        assert_eq!(scan_folder(&dir.0).unwrap(), tracks);
        let spring = tracks.iter().find(|track| track.name == "春 - Spring.MP3").unwrap();
        assert_eq!(read_from_folder(&dir.0, &spring.id).unwrap(), mp3_bytes);
        assert_eq!(fs::read(dir.0.join("春 - Spring.MP3")).unwrap(), mp3_bytes);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 9, "scanning must not create manifests or copies");
        assert!(!dir.0.join(MANIFEST).exists());
        fs::write(dir.0.join("another.mp3"), &mp3_bytes).unwrap();
        assert!(scan_folder(&dir.0).unwrap().iter().any(|track| track.id == spring.id));
    }

    #[test]
    fn folder_tracks_merge_with_legacy_imports_and_cannot_delete_source_files() {
        let root = Library::new();
        let folder = root.0.join("BGM");
        let library = root.0.join("private-library");
        fs::create_dir(&folder).unwrap();
        let source = mp3("spring.mp3").data;
        fs::write(folder.join("spring.mp3"), &source).unwrap();
        let first = list_with_folder(&library, &folder).unwrap();
        assert_eq!(first.len(), 1);
        assert!(!library.exists(), "folder scans must not create a private import library");
        let imported = import_into(&library, vec![mp3("legacy.mp3")]).unwrap();
        let manifest = fs::read(library.join(MANIFEST)).unwrap();
        let merged = list_with_folder(&library, &folder).unwrap();
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0], first[0]);
        assert_eq!(merged[1], imported[0]);
        assert!(merged[1].source.is_none());
        assert!(remove_from(&library, &merged[0].id).unwrap_err().contains("不会删除原文件"));
        assert_eq!(fs::read(folder.join("spring.mp3")).unwrap(), source);
        assert_eq!(fs::read(library.join(MANIFEST)).unwrap(), manifest);
        assert_eq!(read_from(&library, &imported[0].id).unwrap(), mp3("legacy.mp3").data);
        remove_from(&library, &imported[0].id).unwrap();
        assert_eq!(scan_folder(&folder).unwrap(), first);
    }

    #[test]
    fn folder_reads_reject_paths_forged_ids_and_files_changed_after_scan() {
        let root = Library::new();
        let folder = root.0.join("BGM");
        fs::create_dir(&folder).unwrap();
        fs::write(root.0.join("outside.mp3"), mp3("outside.mp3").data).unwrap();
        for name in ["../outside.mp3", "..\\outside.mp3", "C:\\outside.mp3", "/outside.mp3"] {
            assert!(read_from_folder(&folder, &folder_id(name)).is_err(), "accepted path {name}");
        }
        for id in ["folder-", "folder-gz", "folder-f", "folder-ff", "track-123"] {
            assert!(read_from_folder(&folder, id).is_err(), "accepted ID {id}");
        }
        fs::write(folder.join("spring.mp3"), mp3("spring.mp3").data).unwrap();
        let track = scan_folder(&folder).unwrap().remove(0);
        fs::write(folder.join("spring.mp3"), b"corrupt replacement").unwrap();
        assert!(read_from_folder(&folder, &track.id).unwrap_err().contains("损坏"));
        assert!(scan_folder(&folder).unwrap().is_empty());
        fs::remove_file(folder.join("spring.mp3")).unwrap();
        assert!(read_from_folder(&folder, &track.id).unwrap_err().contains("移走"));
        assert_eq!(scan_folder(&root.0.join("absent")).unwrap(), Vec::<LocalTrack>::new());
    }

    #[test]
    fn folder_scan_has_a_track_limit_and_keeps_filename_ids_stable() {
        let dir = Library::new();
        let bytes = mp3("unused.mp3").data;
        for index in 0..MAX_TRACKS + 3 {
            fs::write(dir.0.join(format!("{index:04}.mp3")), &bytes).unwrap();
        }
        let tracks = scan_folder(&dir.0).unwrap();
        assert_eq!(tracks.len(), MAX_TRACKS);
        assert_eq!(tracks[0].name, "0000.mp3");
        assert_eq!(tracks[MAX_TRACKS - 1].name, format!("{:04}.mp3", MAX_TRACKS - 1));
        assert_eq!(tracks, scan_folder(&dir.0).unwrap());
    }

    #[test]
    fn directory_failure_is_not_mistaken_for_removing_all_folder_tracks() {
        let dir = Library::new();
        let folder = dir.0.join("BGM");
        fs::write(&folder, b"not a directory").unwrap();
        let library = dir.0.join("private-library");
        let imported = import_into(&library, vec![mp3("legacy.mp3")]).unwrap();
        let manifest = fs::read(library.join(MANIFEST)).unwrap();
        assert!(scan_folder(&folder).unwrap_err().contains("无法读取 BGM 文件夹"));
        assert!(list_with_folder(&library, &folder).is_err());
        assert_eq!(fs::read(library.join(MANIFEST)).unwrap(), manifest);
        assert_eq!(list_from(&library).unwrap(), imported);
    }

    #[test]
    fn optional_folder_source_preserves_legacy_catalogue_shape() {
        let imported: LocalTrack = serde_json::from_str(r#"{"id":"track-a","name":"old.mp3","mime":"audio/mpeg"}"#).unwrap();
        assert!(imported.source.is_none());
        assert!(serde_json::to_value(&imported).unwrap().get("source").is_none());
        let folder = LocalTrack { source: Some("folder".into()), ..imported };
        assert_eq!(serde_json::to_value(folder).unwrap()["source"], "folder");
    }
}
