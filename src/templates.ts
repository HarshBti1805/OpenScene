// Template registry: a template bundles a format (FormatSpec preset), a
// title page, boilerplate structure, and a timing profile. Built-ins cover
// thoroughness-pass Waves 1 and 2; user templates are saved locally.

import { defaultFormatSpec, type FormatSpec, type SceneNumbering, type Script, type TitlePage } from "./types";
import { t } from "./i18n";

export interface UserTemplate {
  id: string;
  name: string;
  description: string;
  sceneNumbering: SceneNumbering;
  titlePage: TitlePage;
  elements: Script["elements"];
  format?: FormatSpec | null;
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

export function saveUserTemplate(tpl: Omit<UserTemplate, "id" | "savedAt">): UserTemplate {
  const all = listUserTemplates();
  const saved: UserTemplate = { ...tpl, id: `tpl-${Date.now()}`, savedAt: Date.now() };
  all.push(saved);
  localStorage.setItem(KEY, JSON.stringify(all));
  return saved;
}

export function deleteUserTemplate(id: string) {
  localStorage.setItem(KEY, JSON.stringify(listUserTemplates().filter((x) => x.id !== id)));
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

export type TemplateCategory = "film" | "tv" | "stage" | "audio" | "planning";

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Fountain boilerplate; `{TITLE}` is replaced with the project name. */
  boilerplate: string;
  format?: FormatSpec;
  minutesPerPage?: number;
}

function multicamFormat(): FormatSpec {
  const f = defaultFormatSpec();
  f.dialogue.line_spacing = 2;
  f.scene_heading.underline = true;
  f.scene_per_page = true;
  f.lettered_scenes = true;
  f.minutes_per_page = 0.5;
  return f;
}

function stagePlayFormat(): FormatSpec {
  const f = defaultFormatSpec();
  // Dramatists Guild-style: centered cues, wider dialogue block.
  f.character = { ...f.character, align: "center", indent_cols: 0, width_cols: 85 };
  f.dialogue = { ...f.dialogue, indent_cols: 15, width_cols: 55 };
  f.parenthetical = { ...f.parenthetical, indent_cols: 25, width_cols: 35 };
  f.scene_heading.underline = true;
  return f;
}

function musicalFormat(): FormatSpec {
  const f = stagePlayFormat();
  f.lyrics = { ...f.lyrics, indent_cols: 20, width_cols: 45, uppercase: true };
  return f;
}

const ACT = (n: string) => `# ACT ${n}\n`;
const END_ACT = (n: string) => `# END OF ACT ${n}\n\n===\n`;

function beatSheet(beats: [string, string][]): string {
  return beats
    .map(([heading, synopsis]) => `.${heading}\n\n= ${synopsis}\n`)
    .join("\n");
}

export function builtinTemplates(): BuiltinTemplate[] {
  return [
    // --- Film -----------------------------------------------------------
    {
      id: "feature",
      name: t("template.feature"),
      description: t("template.featureDesc"),
      category: "film",
      boilerplate:
        "Title: {TITLE}\nCredit: written by\nAuthor: Your Name\nDraft date: DRAFT\nContact: your@email\n\nINT. LOCATION - DAY\n\nDescribe the opening image.\n",
    },
    {
      id: "short",
      name: t("template.short"),
      description: t("template.shortDesc"),
      category: "film",
      boilerplate:
        "Title: {TITLE}\nCredit: written by\nAuthor: Your Name\nDraft date: DRAFT\n\nINT. LOCATION - DAY\n\nA short film begins.\n",
    },
    {
      id: "limited-series",
      name: t("template.limited"),
      description: t("template.limitedDesc"),
      category: "tv",
      boilerplate:
        "Title: {TITLE}\nCredit: written by\nAuthor: Your Name\nDraft date: DRAFT\n\nINT. LOCATION - DAY\n\nEpisode one, scene one. No act breaks; feature-style flow.\n",
    },
    {
      id: "web-series",
      name: t("template.web"),
      description: t("template.webDesc"),
      category: "film",
      minutesPerPage: 1.0,
      boilerplate:
        "Title: {TITLE}\nAuthor: Your Name\nDraft date: DRAFT\n\nINT. LOCATION - DAY\n\nShort-form opening. Hook the viewer in the first line.\n",
    },
    // --- TV --------------------------------------------------------------
    {
      id: "one-hour-drama",
      name: t("template.oneHour"),
      description: t("template.oneHourDesc"),
      category: "tv",
      boilerplate:
        `Title: {TITLE}\nCredit: written by\nAuthor: Your Name\nDraft date: DRAFT\n\n# TEASER\n\nINT. LOCATION - DAY\n\nCold open.\n\n${END_ACT("TEASER")}\n${ACT("ONE")}\nINT. LOCATION - DAY\n\nAct one begins.\n\n${END_ACT("ONE")}\n${ACT("TWO")}\nINT. LOCATION - NIGHT\n\nAct two begins.\n\n${END_ACT("TWO")}\n${ACT("THREE")}\nINT. LOCATION - NIGHT\n\nAct three begins.\n\n${END_ACT("THREE")}\n${ACT("FOUR")}\nEXT. LOCATION - NIGHT\n\nAct four begins.\n\n${END_ACT("FOUR")}\n${ACT("FIVE")}\nINT. LOCATION - NIGHT\n\nThe closer.\n\n# END OF EPISODE\n`,
    },
    {
      id: "half-hour-single",
      name: t("template.halfHour"),
      description: t("template.halfHourDesc"),
      category: "tv",
      boilerplate:
        `Title: {TITLE}\nAuthor: Your Name\nDraft date: DRAFT\n\n# COLD OPEN\n\nINT. LOCATION - DAY\n\nThe cold open.\n\n${END_ACT("COLD OPEN")}\n${ACT("ONE")}\nINT. LOCATION - DAY\n\nAct one.\n\n${END_ACT("ONE")}\n${ACT("TWO")}\nINT. LOCATION - DAY\n\nAct two.\n\n${END_ACT("TWO")}\n${ACT("THREE")}\nINT. LOCATION - DAY\n\nAct three and the button.\n\n# END OF EPISODE\n`,
    },
    {
      id: "multicam",
      name: t("template.multicam"),
      description: t("template.multicamDesc"),
      category: "tv",
      format: multicamFormat(),
      boilerplate:
        `Title: {TITLE}\nAuthor: Your Name\nDraft date: DRAFT\n\n${ACT("ONE")}\nINT. MAIN SET - DAY\n\n(AUDIENCE APPLAUSE)\n\nCHARACTER\nEvery scene starts on its own page, dialogue is double-spaced, and scenes letter A, B, C.\n\n${END_ACT("ONE")}\n${ACT("TWO")}\nINT. MAIN SET - NIGHT\n\n(MORE HIJINKS)\n\n# END OF EPISODE\n`,
    },
    {
      id: "animation",
      name: t("template.animation"),
      description: t("template.animationDesc"),
      category: "tv",
      minutesPerPage: 0.75,
      boilerplate:
        "Title: {TITLE}\nAuthor: Your Name\nDraft date: DRAFT\n\nINT. LOCATION - DAY\n\nANIMATION CONVENTION: action lines carry more CAPS for POSES, PROPS and SOUNDS.\n",
    },
    // --- Stage -----------------------------------------------------------
    {
      id: "stage-play",
      name: t("template.stage"),
      description: t("template.stageDesc"),
      category: "stage",
      format: stagePlayFormat(),
      boilerplate:
        `Title: {TITLE}\nAuthor: Your Name\nDraft date: DRAFT\n\n${ACT("ONE")}\n.SCENE 1\n\nAT RISE: The stage is dark. A single lamp glows.\n\nCHARACTER\nCentered cues, wide dialogue: the Dramatists Guild layout.\n\n${END_ACT("ONE")}\n`,
    },
    {
      id: "musical",
      name: t("template.musical"),
      description: t("template.musicalDesc"),
      category: "stage",
      format: musicalFormat(),
      boilerplate:
        `Title: {TITLE}\nAuthor: Your Name\nDraft date: DRAFT\n\n${ACT("ONE")}\n.SCENE 1\n\nAT RISE: The company assembles.\n\nCHARACTER\nDialogue leads into song.\n\n~THE OPENING NUMBER STARTS\n~AND EVERY LYRIC LINE IS SUNG\n\n${END_ACT("ONE")}\n`,
    },
    // --- Audio -----------------------------------------------------------
    {
      id: "radio-drama",
      name: t("template.radio"),
      description: t("template.radioDesc"),
      category: "audio",
      boilerplate:
        "Title: {TITLE}\nAuthor: Your Name\nDraft date: DRAFT\n\n.SCENE 1\n\n!SOUND CUE 1: RAIN AGAINST A TIN ROOF.\n\nNARRATOR (V.O.)\nVoice-only: every sound is written, numbered and capitalized.\n\n!MUSIC CUE 2: LOW STRINGS, RISING.\n",
    },
    {
      id: "podcast",
      name: t("template.podcast"),
      description: t("template.podcastDesc"),
      category: "audio",
      boilerplate:
        "Title: {TITLE}\nAuthor: Your Name\nDraft date: DRAFT\n\n.SEGMENT 1 - COLD OPEN\n\n!CUE: THEME MUSIC UNDER.\n\nHOST\nWelcome back. Segment headers, cue lines, host and guest labels.\n\nGUEST\nGlad to be here.\n",
    },
    // --- Planning --------------------------------------------------------
    {
      id: "treatment",
      name: t("template.treatment"),
      description: t("template.treatmentDesc"),
      category: "planning",
      boilerplate:
        "Title: {TITLE}\nAuthor: Your Name\nDraft date: DRAFT\n\nLOGLINE: One sentence that sells the story.\n\nACT ONE. Prose paragraphs, present tense. Introduce the world and the want.\n\nACT TWO. Complication and reversal.\n\nACT THREE. The cost of the win.\n",
    },
    {
      id: "save-the-cat",
      name: t("template.saveTheCat"),
      description: t("template.saveTheCatDesc"),
      category: "planning",
      boilerplate:
        `Title: {TITLE}\nAuthor: Your Name\n\n${beatSheet([
          ["OPENING IMAGE", "A visual that sets tone, mood and stakes."],
          ["THEME STATED", "Someone states what the story is about."],
          ["SET-UP", "The hero's world, flaws and needs."],
          ["CATALYST", "The telegram, the firing, the diagnosis."],
          ["DEBATE", "Should I go? The last chance to back out."],
          ["BREAK INTO TWO", "The hero chooses act two."],
          ["B STORY", "The love story / helper story carrying the theme."],
          ["FUN AND GAMES", "The promise of the premise."],
          ["MIDPOINT", "False victory or false defeat; stakes raised."],
          ["BAD GUYS CLOSE IN", "External and internal pressure mounts."],
          ["ALL IS LOST", "The opposite of the midpoint; whiff of death."],
          ["DARK NIGHT OF THE SOUL", "The wallow before the insight."],
          ["BREAK INTO THREE", "The A and B stories combine into the answer."],
          ["FINALE", "Dig deep, storm the castle, execute the plan."],
          ["FINAL IMAGE", "The opening image, transformed."],
        ])}`,
    },
    {
      id: "story-circle",
      name: t("template.storyCircle"),
      description: t("template.storyCircleDesc"),
      category: "planning",
      boilerplate:
        `Title: {TITLE}\nAuthor: Your Name\n\n${beatSheet([
          ["1. YOU", "A character in a zone of comfort."],
          ["2. NEED", "But they want something."],
          ["3. GO", "They enter an unfamiliar situation."],
          ["4. SEARCH", "They adapt to it."],
          ["5. FIND", "They get what they wanted."],
          ["6. TAKE", "They pay a heavy price for it."],
          ["7. RETURN", "They go back to their familiar situation."],
          ["8. CHANGE", "Having changed."],
        ])}`,
    },
    {
      id: "three-act",
      name: t("template.threeAct"),
      description: t("template.threeActDesc"),
      category: "planning",
      boilerplate:
        `Title: {TITLE}\nAuthor: Your Name\n\n${beatSheet([
          ["ACT I - SETUP", "World, protagonist, want. Ends at the first turning point."],
          ["ACT II - CONFRONTATION", "Rising obstacles; midpoint reversal; ends at the low point."],
          ["ACT III - RESOLUTION", "Climax and consequence."],
        ])}`,
    },
    {
      id: "heros-journey",
      name: t("template.herosJourney"),
      description: t("template.herosJourneyDesc"),
      category: "planning",
      boilerplate:
        `Title: {TITLE}\nAuthor: Your Name\n\n${beatSheet([
          ["ORDINARY WORLD", "The hero at home."],
          ["CALL TO ADVENTURE", "The challenge arrives."],
          ["REFUSAL OF THE CALL", "Fear wins, briefly."],
          ["MEETING THE MENTOR", "Wisdom, gifts, a push."],
          ["CROSSING THE THRESHOLD", "Commitment to the journey."],
          ["TESTS, ALLIES, ENEMIES", "The rules of the new world."],
          ["APPROACH TO THE INMOST CAVE", "Preparing for the ordeal."],
          ["THE ORDEAL", "Death and rebirth."],
          ["THE REWARD", "Seizing the sword."],
          ["THE ROAD BACK", "Recommitment to return."],
          ["THE RESURRECTION", "The final, deepest test."],
          ["RETURN WITH THE ELIXIR", "The boon shared."],
        ])}`,
    },
  ];
}

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; labelKey: string }[] = [
  { id: "film", labelKey: "template.catFilm" },
  { id: "tv", labelKey: "template.catTv" },
  { id: "stage", labelKey: "template.catStage" },
  { id: "audio", labelKey: "template.catAudio" },
  { id: "planning", labelKey: "template.catPlanning" },
];
