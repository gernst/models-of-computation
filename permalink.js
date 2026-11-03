"use strict";
// Permalinks, stored by a permalink service with this interface:
//   POST save-perma.php              form field prog1 = program text   → HTML with a link  …?ex=<id>
//   GET  experiments/perma/<id>.prog                                    → the stored program text
// The stored text starts with a line  LANGUAGE <name>,  which is removed again when loading.
// Our own links look like  index.html#ex=<id>.
//
// PERMALINK_SERVER is where the service is, ending in "/":
//   "./"                    the directory of this page: the page must be installed next to
//                           save-perma.php, on the same web server (no CORS needed);
//                           permalinks are off when the page is opened as a file (e.g. the bundle)
//   "https://host/dir/"     another server: it must allow requests from this page (CORS header
//                           Access-Control-Allow-Origin)
//   null                    no permalinks: the Share button is hidden
// The Datenschutz section of impressum.html describes the service; keep it in line with this.

const PERMALINK_SERVER = "./";

/** Are permalinks available here? A relative PERMALINK_SERVER needs a web server, not a file. */
function permalinksAvailable(protocol) {
  if (PERMALINK_SERVER === null) return false;
  return /^https?:\/\//.test(PERMALINK_SERVER) || protocol === "http:" || protocol === "https:";
}

/** The text that is stored: a LANGUAGE line, then the program. */
function encodePermalinkProgram(langName, code) {
  return `LANGUAGE ${langName}\n${code}`;
}

/** Split stored text into { language, code }. Text without a LANGUAGE line was not stored by this page. */
function decodePermalinkProgram(text) {
  const m = /^LANGUAGE[ \t]+([^\r\n]*?)[ \t]*(\r?\n|$)/i.exec(text); // the name may contain spaces
  if (!m) throw new Error("this link does not belong to a program shared from this page");
  return { language: m[1], code: text.slice(m[0].length) };
}

/** The id in the answer of save-perma.php. */
function permalinkIdFrom(html) {
  const m = /[?&]ex=([A-Za-z0-9_-]+)/.exec(html);
  if (!m) throw new Error("the server's answer contains no permalink");
  return m[1];
}

async function fetchText(url, options) {
  let r;
  try {
    r = await fetch(url, options);
  } catch {
    throw new Error("the permalink server cannot be reached (or does not allow requests from this page)");
  }
  if (r.status === 404) throw new Error("there is no shared program with this link");
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
  return decodePermalinkProgram(await fetchText(PERMALINK_SERVER + "experiments/perma/" + encodeURIComponent(id) + ".prog"));
}
