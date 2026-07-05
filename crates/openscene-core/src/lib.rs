//! OpenScene core engine.
//!
//! Everything here is pure, offline, and file-based:
//! - `model`     : the screenplay document model (shared with the frontend as JSON)
//! - `fountain`  : parse / serialize the Fountain-superset native format
//! - `fdx`       : Final Draft XML import / export
//! - `paginate`  : the industry-standard pagination engine (single source of truth
//!                 for page breaks, used by both the editor and the PDF exporter)
//! - `pdf`       : hand-rolled PDF writer using the built-in Courier font
//! - `snapshots` : full-copy version history inside the project folder
//! - `backup`    : rolling zipped backups to a second location
//! - `stats`     : script statistics

pub mod backup;
pub mod crdt;
pub mod fdx;
pub mod fountain;
pub mod model;
pub mod paginate;
pub mod pdf;
pub mod safety;
pub mod snapshots;
pub mod spell;
pub mod stats;
