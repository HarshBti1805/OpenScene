//! Rolling zipped backups of the whole project folder to a second location.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

/// Zip the project folder into `backup_dir/<project-name>-<stamp>.openscene.zip`,
/// keeping at most `keep` backups for that project (oldest deleted first).
pub fn create(project_dir: &Path, backup_dir: &Path, keep: usize) -> io::Result<String> {
    fs::create_dir_all(backup_dir)?;
    let project_name = project_dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project")
        .to_string();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let zip_name = format!("{}-{}.openscene.zip", project_name, stamp);
    let zip_path = backup_dir.join(&zip_name);

    let file = File::create(&zip_path)?;
    let mut zw = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    add_dir(&mut zw, project_dir, Path::new(""), opts)?;
    zw.finish().map_err(io::Error::other)?;

    prune(backup_dir, &project_name, keep)?;
    Ok(zip_name)
}

fn add_dir(
    zw: &mut ZipWriter<File>,
    dir: &Path,
    rel: &Path,
    opts: SimpleFileOptions,
) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_string();
        // Never back up temp files.
        if name_str.ends_with(".tmp~") {
            continue;
        }
        let path = entry.path();
        let rel_path = rel.join(&name_str);
        if path.is_dir() {
            add_dir(zw, &path, &rel_path, opts)?;
        } else {
            zw.start_file(rel_path.to_string_lossy().replace('\\', "/"), opts)
                .map_err(io::Error::other)?;
            let mut f = File::open(&path)?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)?;
            zw.write_all(&buf)?;
        }
    }
    Ok(())
}

fn prune(backup_dir: &Path, project_name: &str, keep: usize) -> io::Result<()> {
    let prefix = format!("{}-", project_name);
    let mut backups: Vec<String> = fs::read_dir(backup_dir)?
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|n| n.starts_with(&prefix) && n.ends_with(".openscene.zip"))
        .collect();
    backups.sort(); // timestamp order because of the stamp format
    while backups.len() > keep {
        let victim = backups.remove(0);
        let _ = fs::remove_file(backup_dir.join(victim));
    }
    Ok(())
}

/// List backups for a project (newest first).
pub fn list(backup_dir: &Path, project_name: &str) -> Vec<String> {
    let prefix = format!("{}-", project_name);
    let mut v: Vec<String> = match fs::read_dir(backup_dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().to_str().map(String::from))
            .filter(|n| n.starts_with(&prefix) && n.ends_with(".openscene.zip"))
            .collect(),
        Err(_) => Vec::new(),
    };
    v.sort();
    v.reverse();
    v
}

/// Restore a backup zip into `target_dir` (which must be empty or absent).
pub fn restore(zip_path: &Path, target_dir: &Path) -> io::Result<()> {
    if target_dir.exists() && fs::read_dir(target_dir)?.next().is_some() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "target directory is not empty",
        ));
    }
    fs::create_dir_all(target_dir)?;
    let file = File::open(zip_path)?;
    let mut za = ZipArchive::new(file).map_err(io::Error::other)?;
    for i in 0..za.len() {
        let mut entry = za.by_index(i).map_err(io::Error::other)?;
        let Some(rel) = entry.enclosed_name() else {
            continue; // refuse zip-slip paths
        };
        let out_path = target_dir.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out = File::create(&out_path)?;
            io::copy(&mut entry, &mut out)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_and_restore_roundtrip() {
        let base = std::env::temp_dir().join(format!("openscene-bk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let proj = base.join("MyScript");
        let bdir = base.join("backups");
        let out = base.join("restored");
        fs::create_dir_all(proj.join("snapshots")).unwrap();
        fs::write(proj.join("script.fountain"), "INT. A - DAY\n\nHello.\n").unwrap();
        fs::write(proj.join("project.json"), "{}").unwrap();
        fs::write(proj.join("snapshots").join("old.fountain"), "x").unwrap();

        let name = create(&proj, &bdir, 5).unwrap();
        assert!(name.ends_with(".openscene.zip"));
        assert_eq!(list(&bdir, "MyScript").len(), 1);

        restore(&bdir.join(&name), &out).unwrap();
        assert_eq!(
            fs::read_to_string(out.join("script.fountain")).unwrap(),
            "INT. A - DAY\n\nHello.\n"
        );
        assert_eq!(fs::read_to_string(out.join("snapshots/old.fountain")).unwrap(), "x");
        let _ = fs::remove_dir_all(&base);
    }
}
