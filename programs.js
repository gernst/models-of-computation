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
