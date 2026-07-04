// Mirrors crates/openscene-core/src/model.rs (serde snake_case JSON).

export type ElementKind =
  | "scene_heading"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition"
  | "shot"
  | "page_break";

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
  notes?: Note[];
}

export type TitlePage = [string, string][];

export interface Script {
  title_page: TitlePage;
  elements: ScriptElement[];
}

export type SceneNumbering = "none" | "left" | "right" | "both";

export interface LayoutOptions {
  scene_numbering: SceneNumbering;
}

export interface PageMap {
  element_pages: number[];
  page_count: number;
}

export interface ProjectMeta {
  name: string;
  created?: string;
  backup_dir?: string | null;
  scene_numbering?: string | null;
}

export interface ProjectData {
  path: string;
  meta: ProjectMeta;
  script: Script;
  fountain_text: string;
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
}

export interface SceneInfo {
  /** Index into Script.elements of the scene_heading */
  elementIndex: number;
  heading: string;
  number: string;
  synopsis: string;
  color: string | null;
  page: number;
}
