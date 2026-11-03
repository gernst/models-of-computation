"use strict";
// The user's own programs, kept in this browser (localStorage), separately for each language.
//
// Every program the user writes or edits is an entry  { id, code, inputs, edited, permalink? }.
// Unchanged examples are not stored. Loading an example or another program never deletes
// anything. Shared programs (with a permalink) are never changed: editing one creates a new
// entry, so the shared version stays exactly as it was shared.

// Increase STORAGE_VERSION only if the stored data can no longer be read: it hides all saved programs.
const STORAGE_VERSION = 12;

const storageKey = key => `v${STORAGE_VERSION}:${key}`;
function load(key) { try { return localStorage.getItem(storageKey(key)); } catch { return null; } }
/** Returns false if the browser refused (storage full or disabled). */
function save(key, value) {
  try { localStorage.setItem(storageKey(key), value); return true; } catch { return false; }
}

const newProgramId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isExample = (lang, code) => lang.examples.some(ex => ex.code === code);

/** The stored programs of a language, most recently edited first. */
function loadPrograms(lang) {
  try {
    const list = JSON.parse(load("programs:" + lang.id));
    if (Array.isArray(list)) return list;
  } catch { /* fall through */ }
  // Earlier versions saved one program per language: take it over.
  const code = load("code:" + lang.id);
  if (code === null || isExample(lang, code)) return [];
  return [{ id: newProgramId(), code, inputs: load("inputs:" + lang.id) ?? "", edited: Date.now() }];
}

/** Returns false if the programs could not be saved. */
function savePrograms(lang, list) {
  list.sort((a, b) => b.edited - a.edited);
  return save("programs:" + lang.id, JSON.stringify(list));
}

/**
 * The editor changed. `currentId` is the entry shown in the editor, or null for an unchanged example.
 * Updates `list` and returns the id of the entry that now holds the editor content (or null).
 */
function recordEdit(lang, list, currentId, code, inputs) {
  const cur = list.find(p => p.id === currentId);
  if (cur && cur.code === code) { // only the inputs changed
    cur.inputs = inputs;
    return cur.id;
  }
  if (cur && !cur.permalink) {
    Object.assign(cur, { code, inputs, edited: Date.now() });
    return cur.id;
  }
  if (!cur && isExample(lang, code)) return null;
  // a new program: an edited example, or an edited copy of a shared program
  const p = { id: newProgramId(), code, inputs, edited: Date.now() };
  list.push(p);
  return p.id;
}

/** Add a program (e.g. one opened through a permalink) unless an entry with this permalink exists. */
function addProgram(list, code, inputs, permalink) {
  const old = permalink && list.find(p => p.permalink === permalink);
  if (old) return old.id;
  const p = { id: newProgramId(), code, inputs, edited: Date.now(), permalink };
  list.push(p);
  return p.id;
}

/** Text for the Example menu, e.g. "Addition · 16:42 · shared" or, without PROGRAM line, "16:42 · 23 lines". */
function programLabel(p, now = new Date()) {
  const d = new Date(p.edited);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  const when = sameDay ? time : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + time;
  const lines = p.code.split("\n").filter(l => l.trim() !== "").length;
  const name = programName(p.code);
  return (name ? `${name} · ${when}` : `${when} · ${lines} line${lines === 1 ? "" : "s"}`) + (p.permalink ? " · shared" : "");
}

/** Remove an entry; returns it (for undo) or null. */
function deleteProgram(list, id) {
  const i = list.findIndex(p => p.id === id);
  return i < 0 ? null : list.splice(i, 1)[0];
}

/** Remove programs without code (e.g. a New program that was never written), except `keepId`. */
function dropEmptyPrograms(list, keepId) {
  const before = list.length;
  for (const p of [...list]) if (p.id !== keepId && p.code.trim() === "") deleteProgram(list, p.id);
  return list.length !== before;
}

// ---------------------------------------------------------------- export and import

const EXPORT_FORMAT = "tcs-workbench-programs";

/** All programs of all languages, as an object to be saved as a JSON file. */
function exportPrograms(languages) {
  const programs = {};
  for (const lang of languages) {
    const list = loadPrograms(lang);
    if (list.length) programs[lang.id] = list.map(({ code, inputs, edited, permalink }) =>
      ({ code, inputs, edited, ...(permalink ? { permalink } : {}) }));
  }
  return { format: EXPORT_FORMAT, version: 1, exported: new Date().toISOString(), programs };
}

/**
 * Compare an exported file with the stored programs. Nothing is stored yet.
 * A program with the same name (PROGRAM line) and the same code or the same date is already
 * there: skipped. All others are items for the user to choose from; `existing` lists the stored
 * programs with the same name (empty if there is no clash). Programs without a name never clash.
 * Returns { items: [{ lang, imported, existing }], same, unknown }.
 */
function planImport(data, languages) {
  if (data?.format !== EXPORT_FORMAT || typeof data.programs !== "object" || data.programs === null)
    throw new Error("this is not a file exported from the workbench");
  const plan = { items: [], same: 0, unknown: 0 };
  for (const [langId, list] of Object.entries(data.programs)) {
    if (!Array.isArray(list)) continue;
    const lang = languages.find(l => l.id === langId);
    if (!lang) { plan.unknown += list.length; continue; }
    const stored = loadPrograms(lang);
    const seen = []; // programs of this file, to skip repetitions
    for (const raw of list) {
      if (typeof raw?.code !== "string") continue;
      const p = {
        id: newProgramId(), code: raw.code, inputs: typeof raw.inputs === "string" ? raw.inputs : "",
        edited: Number.isFinite(raw.edited) ? raw.edited : Date.now(),
        ...(typeof raw.permalink === "string" ? { permalink: raw.permalink } : {}),
      };
      const name = programName(p.code);
      const same = q => name !== null && programName(q.code) === name && (q.code === p.code || q.edited === p.edited);
      if (stored.some(same) || seen.some(same)) { plan.same++; continue; }
      seen.push(p);
      plan.items.push({ lang, imported: p, existing: name === null ? [] : stored.filter(q => programName(q.code) === name) });
    }
  }
  return plan;
}

/**
 * Store the chosen programs of a plan. choices[i] decides plan.items[i]:
 * "add" (default), "skip", or "replace" (the imported program replaces the only stored one of that name).
 * Returns { added, replaced, skipped, ok } (ok: false if saving failed).
 */
function applyImport(plan, choices = []) {
  const lists = new Map(); // lang -> stored programs
  const listOf = lang => {
    if (!lists.has(lang)) lists.set(lang, loadPrograms(lang));
    return lists.get(lang);
  };
  const r = { added: 0, replaced: 0, skipped: 0, ok: true };
  plan.items.forEach((item, i) => {
    const choice = choices[i] ?? "add";
    if (choice === "skip") { r.skipped++; return; }
    const list = listOf(item.lang);
    if (choice === "replace" && item.existing.length === 1) { deleteProgram(list, item.existing[0].id); r.replaced++; }
    else r.added++;
    list.push(item.imported);
  });
  for (const [lang, list] of lists) r.ok = savePrograms(lang, list) && r.ok;
  return r;
}
