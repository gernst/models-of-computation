"use strict";
// User interface. Knows nothing about specific languages; everything comes from LANGUAGES.
// The user's own programs are kept by programs.js, permalinks are handled by permalink.js.

const $ = id => document.getElementById(id);
const editor = $("code"), gutter = $("gutter"), highlight = $("highlight"), output = $("output");
const LINE_HEIGHT = 20; // must match style.css
let lang = LANGUAGES[0];
let programs = []; // the stored programs of `lang`
let current = null; // id of the program in the editor, or null for an unchanged example

function option(parent, value, text) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  parent.append(o);
}

/** Switch the language and show its most recently edited program (or its first example). */
function selectLanguage(id) {
  lang = LANGUAGES.find(l => l.id === id) ?? LANGUAGES[0];
  $("language").value = lang.id;
  save("language", lang.id);
  $("help").textContent = lang.name + "\n\n" + lang.help;
  updateMinValue();
  programs = loadPrograms(lang);
  showMostRecent();
  show("", "");
}

function showMostRecent() {
  const recent = programs.reduce((a, p) => (!a || p.edited > a.edited ? p : a), null);
  if (recent) showProgram(recent);
  else showExample(0);
}

function setEditor(code, inputs) {
  editor.value = code;
  $("inputs").value = inputs ?? "";
  editor.scrollTop = 0;
  updateGutter();
}

function showExample(i) {
  const ex = lang.examples[i];
  current = null;
  setEditor(ex.code, ex.inputs);
  updateMenu();
  setPermalink(null);
}

function showProgram(p) {
  current = p.id;
  setEditor(p.code, p.inputs);
  updateMenu();
  setPermalink(p.permalink);
}

const currentProgram = () => programs.find(p => p.id === current);

/** Rebuild the Example menu: the examples, then the user's programs (newest first). */
function updateMenu() {
  if (dropEmptyPrograms(programs, current)) store();
  const menu = $("example");
  menu.replaceChildren();
  const examples = document.createElement("optgroup");
  examples.label = "Examples";
  lang.examples.forEach((ex, i) => option(examples, "e" + i, ex.name));
  menu.append(examples);
  if (programs.length) {
    const own = document.createElement("optgroup");
    own.label = "Your programs";
    [...programs].sort((a, b) => b.edited - a.edited).forEach(p => option(own, "p" + p.id, programLabel(p)));
    menu.append(own);
  }
  menu.value = current ? "p" + current : "e" + Math.max(0, lang.examples.findIndex(ex => ex.code === editor.value));
  $("delete").disabled = !current;
}

// ---------------------------------------------------------------- keeping the user's programs

let storageWarned = false;

/** Save the programs of the current language; warn once if the browser refuses. */
function store() {
  if (!savePrograms(lang, programs) && !storageWarned) {
    storageWarned = true;
    show("Warning: your programs could not be saved in this browser (storage full or disabled).", "bad");
  }
}

/** The user changed the code or the inputs: store it (see recordEdit in programs.js). */
function edited() {
  const before = current;
  current = recordEdit(lang, programs, current, editor.value, $("inputs").value);
  store();
  updateMenu();
  if (current !== before) setPermalink(null); // a new program has no link (yet)
}

/** A line in the output with a button, e.g. "Program deleted. [Undo]". */
function notice(text, buttonText, onClick) {
  show(text + "  ", "ok");
  const b = document.createElement("button");
  b.textContent = buttonText;
  b.addEventListener("click", onClick);
  output.append(b);
}

function onMenuChange(value) {
  const prev = currentProgram();
  if (value[0] === "e") showExample(Number(value.slice(1)));
  else showProgram(programs.find(p => "p" + p.id === value));
  if (prev && prev.id !== current && prev.code.trim() !== "")
    notice(`Your previous program (${programLabel(prev)}) is kept under "Your programs" in the Example menu.`,
           "Open it again", () => { showProgram(prev); show("", ""); });
  else show("", "");
}

function newProgram() {
  const prev = currentProgram();
  const id = addProgram(programs, "", "");
  store();
  showProgram(programs.find(p => p.id === id));
  editor.focus();
  if (prev && prev.code.trim() !== "")
    notice(`Your previous program (${programLabel(prev)}) is kept under "Your programs" in the Example menu.`,
           "Open it again", () => { showProgram(prev); show("", ""); });
  else show("", "");
}

function duplicateProgram() {
  const prev = currentProgram(), example = lang.examples.findIndex(ex => ex.code === editor.value);
  const id = addProgram(programs, editor.value, $("inputs").value);
  store();
  showProgram(programs.find(p => p.id === id));
  notice("This is a copy, which you can change. The original is kept.", "Open the original", () => {
    if (prev) showProgram(prev); else showExample(Math.max(0, example));
    show("", "");
  });
}

function deleteCurrent() {
  const l = lang, p = deleteProgram(programs, current);
  if (!p) return;
  store();
  showMostRecent();
  notice(`Program deleted (${programLabel(p)}).`, "Undo", () => {
    if (lang !== l) selectLanguage(l.id);
    programs.push(p);
    store();
    showProgram(p);
    show("", "");
  });
}

/** Redraw line numbers and syntax highlighting after the code changed. */
function updateGutter() {
  const n = editor.value.split("\n").length;
  gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
  highlight.innerHTML = highlightCode(editor.value, lang.keywords ?? []) + "\n";
  syncScroll();
}

function syncScroll() {
  gutter.scrollTop = highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;
}

const HEADER_WORDS = ["PROGRAM", "INPUT", "OUTPUT", "REQUIRES", "ENSURES"]; // purple at the start of a line
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeHtml = s => s.replace(/[&<>]/g, c => HTML_ESCAPES[c]);

/**
 * Colour comments, numbers, the language's keywords and the header words. Returns HTML.
 * In REQUIRES/ENSURES lines, the keywords of the condition language (AND, IF, …) are coloured instead,
 * the same in every language.
 */
function highlightCode(src, keywords) {
  return src.split("\n").map(line => /^\s*(REQUIRES|ENSURES)\b/i.test(line)
    ? highlightLine(line, SPEC_KEYWORDS, true)
    : highlightLine(line, keywords, lang.keywordsAnyCase)).join("\n");
}

function highlightLine(line, keywords, anyCase) {
  const span = (cls, text) => `<span class="${cls}">${escapeHtml(text)}</span>`;
  const lineStart = /^\s*/.exec(line)[0].length;
  return line.replace(/(\/\/.*)|([A-Za-z_][A-Za-z0-9_]*)|([0-9]+)|([&<>])/g, (m, comment, word, num, esc, offset) => {
    if (comment) return span("hl-comment", comment);
    if (num) return span("hl-number", num);
    if (esc) return HTML_ESCAPES[esc];
    const upper = word.toUpperCase();
    if (offset === lineStart && HEADER_WORDS.includes(upper) && !/^\s*:?=/.test(line.slice(offset + word.length)))
      return span("hl-spec", word);
    if (keywords.includes(word) || (anyCase && keywords.includes(upper))) return span("hl-keyword", word);
    return word;
  });
}

function show(text, cls) {
  output.textContent = text;
  output.className = cls;
}

function showError(e, prefix = "") {
  if (e instanceof LangError) {
    show(prefix + (e.line ? `Error in line ${e.line}: ` : "Error: ") + e.message, "bad");
    if (e.line) selectLine(e.line);
  } else {
    show(prefix + "Internal error: " + e.message, "bad"); // e.g. stack overflow
    console.error(e);
  }
}

function selectLine(line) {
  const lines = editor.value.split("\n");
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  editor.focus();
  editor.setSelectionRange(start, start + (lines[line - 1] ?? "").length);
  editor.scrollTop = Math.max(0, (line - 4) * LINE_HEIGHT);
}

function parseInputs(text) {
  const parts = text.split(/[\s,;]+/).filter(s => s !== "");
  const pattern = lang.integers ? /^-?\d+$/ : /^\d+$/;
  for (const s of parts)
    if (!pattern.test(s))
      throw new LangError(`inputs must be ${lang.integers ? "integers" : "natural numbers"}, but got '${s}'`);
  return parts.map(BigInt);
}

/** The warnings of the static checks (e.g. reading a variable before it has a value), as text. */
function warningsText(program) {
  const ws = program?.warnings ?? [];
  return ws.length ? ws.map(w => `Warning in line ${w.line}: ${w.message}`).join("\n") + "\n\n" : "";
}

function run() {
  const ctx = { steps: 0, maxSteps: Number($("maxSteps").value) || 1000000, trace: $("trace").checked ? [] : null };
  const traceText = () => !ctx.trace ? "" :
    "\n\nTrace:\n" + ctx.trace.map(t => `line ${String(t.line).padStart(3)}:  ${t.text}`).join("\n") +
    (ctx.trace.length >= MAX_TRACE ? `\n… (only the first ${MAX_TRACE} entries are shown)` : "");
  // all variables, one per line (only for languages that set ctx.vars)
  const varsText = () => !ctx.vars ? "" :
    "\n\nVariables:\n" + [...ctx.vars].map(([x, v]) => `  ${x} = ${v}`).join("\n");
  let program = null;
  try {
    program = lang.parse(splitDirectives(editor.value).code);
    const inputs = parseInputs($("inputs").value);
    const t0 = performance.now();
    const result = lang.run(program, inputs, ctx);
    const ms = (performance.now() - t0).toFixed(1);
    const { output: name } = signatureOf(lang, program);
    show(warningsText(program) + `Result: ${name} = ${result}\nSteps: ${ctx.steps}   (${ms} ms)` + varsText() + traceText(), "ok");
  } catch (e) {
    showError(e);
    output.textContent = warningsText(program) + output.textContent + varsText() + traceText();
  }
}

function check() {
  const maxValue = Math.max(0, Number($("maxValue").value) || 0);
  try {
    const r = checkProgram(lang, editor.value, maxValue, Number($("maxSteps").value) || 1000000);
    const warnings = warningsText(lang.parse(splitDirectives(editor.value).code));
    const skipped = r.skipped ? `, ${r.skipped} skipped by REQUIRES` : "";
    if (r.ok) {
      show(warnings + `✓ All ${r.tested} test case(s) passed (inputs from ${lang.integers ? -maxValue : 0} to ${maxValue}${skipped}).\n` +
           "This is testing, not a proof.", "ok");
      return;
    }
    const args = r.inputs.map((v, i) => `${r.names[i]} = ${v}`).join(", ") || "no inputs";
    if (r.message) show(warnings + `✗ Counterexample: ${args}: ${r.message}`, "bad");
    else {
      show(warnings + `✗ Counterexample: ${args}  →  ${r.output} = ${r.result}\nENSURES in line ${r.line} is false.`, "bad");
      selectLine(r.line);
    }
  } catch (e) {
    showError(e);
  }
}

/** The lower bound shown next to "Check": 0, or -max for languages over the integers. */
function updateMinValue() {
  $("minValue").textContent = lang.integers ? String(-Math.max(0, Number($("maxValue").value) || 0)) : "0";
}

// ---------------------------------------------------------------- permalinks (see permalink.js)

const permalinkUrl = id => location.href.split("#")[0] + "#ex=" + id;

/** Show the link of the program in the address bar, or remove it (id = null). */
function setPermalink(id) {
  $("copyLink").hidden = !(id && PERMALINK_SERVER);
  const url = id ? permalinkUrl(id) : location.href.split("#")[0];
  if (url !== location.href) history.replaceState(null, "", url);
}

/** Show the link at once; mention the clipboard only when copying worked. */
function showLink(id, text) {
  const url = permalinkUrl(id);
  show(`${text}:\n${url}`, "ok");
  navigator.clipboard?.writeText(url).then(() => {
    if (output.textContent.endsWith(url)) show(`${text} (copied to the clipboard):\n${url}`, "ok");
  }, () => { /* not allowed */ });
}

async function share() {
  const p = currentProgram();
  if (p?.permalink) return showLink(p.permalink, "This program was already shared, its permalink is");
  const l = lang, code = editor.value, inputs = $("inputs").value;
  show("Saving …", "");
  try {
    const id = await savePermalink(l.name, code);
    if (lang === l && editor.value === code) { // still the same program in the editor
      if (p && p.code === code) p.permalink = id;
      else current = addProgram(programs, code, inputs, id);
      store();
      updateMenu();
      setPermalink(id);
    }
    showLink(id, "Permalink");
  } catch (e) {
    show("Sharing failed: " + e.message, "bad");
  }
}

/** Open the program of a link  …#ex=<id>  and keep it under "Your programs". */
async function loadShared() {
  const m = /^#ex=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m || !PERMALINK_SERVER) return;
  try {
    const { language, code } = await loadPermalink(m[1]);
    const l = LANGUAGES.find(l => l.name.toUpperCase() === language.toUpperCase());
    if (!l) throw new Error(`unknown language '${language}'`);
    if (l !== lang) selectLanguage(l.id);
    const id = addProgram(programs, code, "", m[1]);
    store();
    showProgram(programs.find(p => p.id === id));
    show("Shared program loaded.", "ok");
  } catch (e) {
    show("Could not load the shared program: " + e.message, "bad");
  }
}

// ---------------------------------------------------------------- wiring
$("maxValue").addEventListener("input", updateMinValue);

LANGUAGES.forEach(l => option($("language"), l.id, l.name));
$("language").addEventListener("change", e => selectLanguage(e.target.value));
$("example").addEventListener("change", e => onMenuChange(e.target.value));
$("new").addEventListener("click", newProgram);
$("duplicate").addEventListener("click", duplicateProgram);
$("copyLink").addEventListener("click", () => showLink(currentProgram().permalink, "Permalink"));
$("delete").addEventListener("click", deleteCurrent);
$("run").addEventListener("click", run);
$("check").addEventListener("click", check);
$("share").hidden = !PERMALINK_SERVER;
$("share").addEventListener("click", share);
window.addEventListener("hashchange", loadShared);
$("inputs").addEventListener("input", edited);
editor.addEventListener("input", () => { updateGutter(); edited(); });
editor.addEventListener("scroll", syncScroll);
editor.addEventListener("keydown", e => {
  if (e.key === "Tab" && !e.shiftKey) { // insert two spaces instead of leaving the editor
    e.preventDefault();
    editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
    updateGutter();
    edited();
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
});

const startHash = location.hash; // selectLanguage below resets the address bar
selectLanguage(load("language"));
if (startHash) { history.replaceState(null, "", location.href.split("#")[0] + startHash); loadShared(); }
