// Mirrors crates/openscene-core/src/model.rs (serde snake_case JSON).

export type ElementKind =
  | "scene_heading"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition"
  | "shot"
  | "page_break"
  | "omitted"
  | "act_header"
  | "lyrics";

export type DualSide = "left" | "right";

export interface Note {
  offset: number;
  category: string;
  text: string;
}

export interface ScriptElement {
  kind: ElementKind;
  text: string;
  dual?: DualSide | null;
  scene_number?: string | null;
  synopsis?: string | null;
  color?: string | null;
  /** Revision-set id this element was last edited under. */
  revision?: string | null;
  notes?: Note[];
}

export interface RevisionSet {
  id: string;
  color: string;
  label: string;
  date: string;
}

/** The industry-standard revision color ladder (mirrors model.rs). */
export const REVISION_COLORS = [
  "White",
  "Blue",
  "Pink",
  "Yellow",
  "Green",
  "Goldenrod",
  "Buff",
  "Salmon",
  "Cherry",
  "Double Blue",
  "Double Pink",
  "Double Yellow",
  "Double Green",
] as const;

/** Screen swatches for the revision paper colors (fixed, not theme tokens). */
export const REVISION_SWATCHES: Record<string, string> = {
  White: "#f5f2e9",
  Blue: "#7fa8d0",
  Pink: "#d98fa6",
  Yellow: "#d9c34f",
  Green: "#84b077",
  Goldenrod: "#cf9f3f",
  Buff: "#cbb586",
  Salmon: "#d08d70",
  Cherry: "#b8544e",
  "Double Blue": "#4f7fae",
  "Double Pink": "#b65e7f",
  "Double Yellow": "#b39a1e",
  "Double Green": "#5b8a4e",
};

export type TitlePage = [string, string][];

export interface Script {
  title_page: TitlePage;
  elements: ScriptElement[];
}

export type SceneNumbering = "none" | "left" | "right" | "both";

export interface LayoutOptions {
  scene_numbering: SceneNumbering;
  revision_label?: string | null;
  show_revision_marks?: boolean;
  locked?: LockedState | null;
  format?: FormatSpec | null;
}

export interface DialogueSplit {
  element: number;
  /** Non-whitespace chars of the element's text on the earlier page. */
  nonws_chars: number;
  next_page: number;
  cont_cue: string;
  next_label?: string;
}

export interface LockedPageAnchor {
  label: string;
  scene: string;
  el_offset: number;
  nonws_offset?: number;
}

export interface LockedState {
  pages: LockedPageAnchor[];
  scenes: string[];
  date?: string;
}

export type Align = "left" | "center" | "right";

export interface ElementFormat {
  indent_cols: number;
  width_cols: number;
  uppercase: boolean;
  space_before: number;
  align: Align;
  line_spacing: number;
  underline: boolean;
}

export interface FormatSpec {
  scene_heading: ElementFormat;
  action: ElementFormat;
  character: ElementFormat;
  parenthetical: ElementFormat;
  dialogue: ElementFormat;
  transition: ElementFormat;
  shot: ElementFormat;
  act_header: ElementFormat;
  lyrics: ElementFormat;
  scene_per_page: boolean;
  lettered_scenes: boolean;
  minutes_per_page: number;
}

function ef(
  indent: number,
  width: number,
  uppercase: boolean,
  space: number,
  overrides: Partial<ElementFormat> = {},
): ElementFormat {
  return {
    indent_cols: indent,
    width_cols: width,
    uppercase,
    space_before: space,
    align: "left",
    line_spacing: 1,
    underline: false,
    ...overrides,
  };
}

/** Mirrors FormatSpec::default() in model.rs (US Feature standard). */
export function defaultFormatSpec(): FormatSpec {
  return {
    scene_heading: ef(15, 60, true, 2),
    action: ef(15, 60, false, 1),
    character: ef(37, 33, true, 1),
    parenthetical: ef(30, 25, false, 0),
    dialogue: ef(25, 35, false, 0),
    transition: ef(45, 30, true, 1, { align: "right" }),
    shot: ef(15, 60, true, 1),
    act_header: ef(15, 60, true, 2, { align: "center", underline: true }),
    lyrics: ef(25, 35, false, 0),
    scene_per_page: false,
    lettered_scenes: false,
    minutes_per_page: 1.0,
  };
}

export interface PageMap {
  element_pages: number[];
  page_count: number;
  dialogue_splits: DialogueSplit[];
  /** Printed label per physical page (locked scripts: "12A" etc). */
  page_labels?: string[];
  /** Display scene number per element (headings/OMITTED only). */
  scene_numbers?: (string | null)[];
}

export interface ProjectMeta {
  name: string;
  created?: string;
  backup_dir?: string | null;
  scene_numbering?: string | null;
  /** Per-project custom spelling dictionary (lowercased words). */
  dictionary?: string[];
  revisions?: RevisionSet[];
  active_revision?: string | null;
  locked?: LockedState | null;
  format?: FormatSpec | null;
  /** Table-read voice per character (cue base -> voice URI). */
  voices?: Record<string, string>;
  /** Gender metadata per character (inclusivity analysis). */
  genders?: Record<string, string>;
  /** Pinned quick-access items ("scene:12", "note:name"). */
  pins?: string[];
}

export interface ProjectData {
  path: string;
  meta: ProjectMeta;
  script: Script;
  fountain_text: string;
}

export interface Heartbeat {
  host: string;
  pid: number;
  timestamp: number;
}

/** Verify-on-open result: exactly one of `data` / `corrupt` is set. */
export interface OpenResult {
  data: ProjectData | null;
  corrupt: string | null;
  snapshots: SnapshotMeta[];
  read_only: boolean;
  other_writer: Heartbeat | null;
  conflicts: string[];
}

export interface SnapshotMeta {
  file: string;
  timestamp: string;
  name?: string | null;
  automatic?: boolean;
}

export interface CharacterStats {
  name: string;
  speeches: number;
  words: number;
  scenes: number;
}

export interface ScriptStats {
  page_count: number;
  scene_count: number;
  int_count: number;
  ext_count: number;
  day_count: number;
  night_count: number;
  other_time_count: number;
  dialogue_words: number;
  action_words: number;
  characters: CharacterStats[];
  locations: string[];
  estimated_minutes?: number;
}

export interface Misspelling {
  start: number;
  end: number;
  word: string;
}

export interface SceneInfo {
  /** Index into Script.elements of the scene_heading */
  elementIndex: number;
  heading: string;
  number: string;
  synopsis: string;
  color: string | null;
  /** Physical page ordinal. */
  page: number;
  /** Printed page label ("12A" on locked scripts). */
  pageLabel: string;
  omitted: boolean;
}
