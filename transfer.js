"use strict";
// Export and import of the user's programs as a JSON file.
// DISABLED for now: index.html does not load this file, so it is also not part of the bundle.
// To enable it, add  <script src="transfer.js"></script>  after app.js in index.html;
// the file then adds the section "Your programs" and the import dialog to the page itself.
// The first part (no page access) is also used by test.js.

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

// ---------------------------------------------------------------- page (only in the browser)

const TRANSFER_HTML = `
  <details>
    <summary>Your programs</summary>
    <p>
      Every program you write or change is stored in this browser and listed under
      "Your programs" in the Example menu. It is not stored anywhere else.
      The browser may delete them, e.g. when you clear browsing data or use a private window.
      To keep a copy, or to move your programs to another browser or computer, export them to a file.
      When importing, you choose which programs to take over; programs you already have are
      only replaced if you say so.
    </p>
    <div class="row">
      <button id="export">Export all programs</button>
      <button id="import">Import programs …</button>
      <input type="file" id="importFile" accept=".json,application/json" hidden>
    </div>
  </details>

  <dialog id="importDialog">
    <h3>Import programs</h3>
    <p>Choose the programs to import. Programs you already have are only replaced if you say so.</p>
    <div class="row">
      <button id="importAll">All</button>
      <button id="importNone">None</button>
    </div>
    <div id="importList"></div>
    <p id="importNotes" class="muted"></p>
    <div class="row">
      <button id="importOk" class="primary">Import</button>
      <button id="importCancel">Cancel</button>
    </div>
  </dialog>
`;

function exportAll() {
  const data = exportPrograms(LANGUAGES);
  const n = Object.values(data.programs).reduce((sum, list) => sum + list.length, 0);
  if (n === 0) return show("You have no programs of your own to export yet.", "");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }));
  a.download = `tcs-workbench-programs-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  show(`Exported ${n} program${n === 1 ? "" : "s"} to the file ${a.download}.`, "ok");
}

async function importFile(file) {
  try {
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new Error("the file is not valid JSON"); }
    const plan = planImport(data, LANGUAGES);
    const notes = [];
    if (plan.same) notes.push(`${plan.same} already there`);
    if (plan.unknown) notes.push(`${plan.unknown} of unknown languages ignored`);
    if (plan.items.length === 0) return show(`Import: nothing new in this file (${notes.join(", ") || "it is empty"}).`, "ok");
    const choices = await askImport(plan, notes);
    if (!choices) return show("Import cancelled; nothing was changed.", "");
    const r = applyImport(plan, choices);
    programs = loadPrograms(lang);
    if (current && !programs.some(p => p.id === current)) showMostRecent(); // replaced by the import
    else updateMenu();
    const parts = [`${r.added} program${r.added === 1 ? "" : "s"} added`];
    if (r.replaced) parts.push(`${r.replaced} replaced`);
    if (r.skipped) parts.push(`${r.skipped} not imported`);
    show(`Import: ${[...parts, ...notes].join(", ")}.` + (r.ok ? "" : "\nWarning: saving failed (storage full or disabled)."),
         r.ok ? "ok" : "bad");
  } catch (e) {
    show("Import failed: " + e.message, "bad");
  }
}

/** Let the user choose which programs to import. Resolves to the choices (see applyImport), or null. */
function askImport(plan, notes) {
  const dialog = $("importDialog"), list = $("importList");
  const el = (tag, props = {}, ...children) => { const e = Object.assign(document.createElement(tag), props); e.append(...children); return e; };
  list.replaceChildren();
  $("importNotes").textContent = notes.length ? `Not listed: ${notes.join(", ")}.` : "";
  // in the dialog: the full date, to tell versions apart
  const describe = p => {
    const lines = p.code.split("\n").filter(l => l.trim() !== "").length;
    const date = new Date(p.edited).toLocaleString("en-GB",
      { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `${programName(p.code) ?? "(no name)"} · ${date} · ${lines} line${lines === 1 ? "" : "s"}`;
  };
  const rows = plan.items.map(({ lang, imported, existing }) => {
    const newest = Math.max(imported.edited, ...existing.map(p => p.edited));
    const tag = p => (existing.length && p.edited === newest ? " (newer)" : "");
    const box = el("input", { type: "checkbox", checked: true });
    const row = el("div", { className: "import-item" },
      el("label", {}, box, ` ${lang.name}: ${describe(imported)}${tag(imported)}`));
    let replace = null;
    if (existing.length) {
      row.append(el("div", { className: "muted" },
        "You already have: " + existing.map(p => describe(p) + tag(p)).join(";  ")));
      if (existing.length === 1) {
        replace = el("select", {}, el("option", { value: "add" }, "add next to yours"),
                                   el("option", { value: "replace" }, "replace yours"));
        row.append(el("div", {}, "If imported: ", replace));
      }
    }
    list.append(row);
    return { box, replace };
  });
  $("importAll").onclick = () => rows.forEach(r => { r.box.checked = true; });
  $("importNone").onclick = () => rows.forEach(r => { r.box.checked = false; });
  return new Promise(resolve => {
    const done = ok => {
      dialog.close();
      resolve(ok ? rows.map(r => (!r.box.checked ? "skip" : r.replace?.value ?? "add")) : null);
    };
    $("importOk").onclick = () => done(true);
    $("importCancel").onclick = () => done(false);
    dialog.oncancel = e => { e.preventDefault(); done(false); }; // Escape key
    dialog.showModal();
  });
}

if (typeof document !== "undefined") {
  document.querySelector("footer").insertAdjacentHTML("beforebegin", TRANSFER_HTML);
  $("export").addEventListener("click", exportAll);
  $("import").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", e => {
    if (e.target.files[0]) importFile(e.target.files[0]);
    e.target.value = ""; // allow importing the same file again
  });
}
