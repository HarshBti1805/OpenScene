---
name: data-safety
description: OpenScene's never-lose-a-word rules. Use when touching saving, autosave, snapshots, backups, or any code path that writes to a user's project folder.
---

# Data Safety Rules

The product promise is "crash mid-keystroke and relaunch recovers the
document". Every change to write paths must preserve these mechanisms:

1. **Atomic writes only.** All file writes go through
   `snapshots::atomic_write` (temp file → fsync → rename). Never call
   `fs::write` directly on a user file.
2. **Autosave** lives in `src/App.tsx`: dirty-flag + 2 s interval + window
   blur + beforeunload. The dirty flag is set in the editor's
   `dispatchTransaction`. Do not add save paths that bypass the store's
   `saveNow()`.
3. **Snapshots before destructive operations.** Import-overwrite and
   snapshot-restore both take a safety snapshot first (`"before import"`,
   `"before restore"`). Any new destructive operation (mass replace, scene
   deletion tooling) must do the same.
4. **Automatic snapshots** are pruned to the last 100; named versions are
   never pruned. Snapshot ids are bare filenames — the reader rejects path
   separators (path-traversal guard). Keep that check.
5. **Backups** are plain zips of the whole folder; restore refuses non-empty
   target directories and zip-slip paths (`enclosed_name`). Keep both refusals.
6. **No format lock-in:** anything written into a project folder must remain
   openable by a text editor or standard unzip. No binary formats, no SQLite,
   no hidden state outside the folder (except the recents list in the app
   config dir).
