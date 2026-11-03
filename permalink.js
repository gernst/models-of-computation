"use strict";
// Permalinks, stored by an external permalink service with this interface:
//   POST save-perma.php   form field prog1 = program text   → HTML with a link  …/?ex=<id>
//   GET  ?ex=<id>                                            → HTML page with the program in <textarea id="prog1">
// The stored text starts with a line  LANGUAGE <name>,  which is removed again when loading.
// Our own links look like  index.html#ex=<id>.
//
// The browser can only read the answers if the service allows requests from this page
// (HTTP header Access-Control-Allow-Origin). While PERMALINK_SERVER is null, the Share button
// is hidden. When setting it, also describe the service in the Datenschutz section of impressum.html.

const PERMALINK_SERVER = null; // URL of the service, ending in "/"

/** The text that is stored: a LANGUAGE line, then the program. */
function encodePermalinkProgram(langName, code) {
  return `LANGUAGE ${langName}\n${code}`;
}

/** Split stored text into { language, code }. Text without a LANGUAGE line was not stored by this page. */
function decodePermalinkProgram(text) {
  const m = /^LANGUAGE[ \t]+(\S+)[ \t]*(\r?\n|$)/i.exec(text);
  if (!m) throw new Error("this link does not belong to a program shared from this page");
  return { language: m[1], code: text.slice(m[0].length) };
}

/** The id in the answer of save-perma.php. */
function permalinkIdFrom(html) {
  const m = /[?&]ex=([A-Za-z0-9_-]+)/.exec(html);
  if (!m) throw new Error("the server's answer contains no permalink");
  return m[1];
}

const HTML_ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };

function decodeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return HTML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The program in the page returned for  ?ex=<id>. */
function programFromPage(html) {
  const m = /<textarea[^>]*\bid="prog1"[^>]*>([\s\S]*?)<\/textarea>/i.exec(html);
  if (!m) throw new Error("the server's answer contains no program");
  return decodeHtml(m[1]).replace(/^\r?\n/, ""); // HTML ignores a newline right after <textarea>
}

async function fetchText(url, options) {
  let r;
  try {
    r = await fetch(url, options);
  } catch {
    throw new Error("the permalink server cannot be reached (or does not allow requests from this page)");
  }
  if (!r.ok) throw new Error(`the permalink server answered ${r.status}`);
  return r.text();
}

/** Store a program; returns the id. */
async function savePermalink(langName, code) {
  const body = new URLSearchParams({ prog1: encodePermalinkProgram(langName, code) });
  return permalinkIdFrom(await fetchText(PERMALINK_SERVER + "save-perma.php", { method: "POST", body }));
}

/** Load a stored program; returns { language, code }. */
async function loadPermalink(id) {
  return decodePermalinkProgram(programFromPage(await fetchText(PERMALINK_SERVER + "?ex=" + encodeURIComponent(id))));
}
