// User templates: a saved format (scene numbering) + title page + boilerplate
// script, stored locally in the webview's app data (localStorage). No new
// Tauri commands needed; creating a project from a user template goes through
// the existing create_project + save_script commands.

import type { SceneNumbering, Script, TitlePage } from "./types";

export interface UserTemplate {
  id: string;
  name: string;
  description: string;
  sceneNumbering: SceneNumbering;
  titlePage: TitlePage;
  /** Boilerplate script elements (the project's content at save time). */
  elements: Script["elements"];
  savedAt: number;
}

const KEY = "openscene.userTemplates";

export function listUserTemplates(): UserTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as UserTemplate[];
  } catch {
    return [];
  }
}

export function saveUserTemplate(t: Omit<UserTemplate, "id" | "savedAt">): UserTemplate {
  const all = listUserTemplates();
  const tpl: UserTemplate = { ...t, id: `tpl-${Date.now()}`, savedAt: Date.now() };
  all.push(tpl);
  localStorage.setItem(KEY, JSON.stringify(all));
  return tpl;
}

export function deleteUserTemplate(id: string) {
  localStorage.setItem(KEY, JSON.stringify(listUserTemplates().filter((t) => t.id !== id)));
}

export interface BuiltinTemplate {
  id: "feature" | "short";
  name: string;
  description: string;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  { id: "feature", name: "Feature Film", description: "US industry standard, 90–120 pages" },
  { id: "short", name: "Short Film", description: "Lean title page, straight to scene one" },
];
