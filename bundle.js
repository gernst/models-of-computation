// Run with:  node bundle.js
// Writes tcs-workbench-<version>.html: index.html with style.css, all scripts and the
// Impressum inlined, so that the whole tool is a single file.
"use strict";
const fs = require("fs"), path = require("path");
const read = f => fs.readFileSync(path.join(__dirname, f), "utf8");

let html = read("index.html");
const version = /<span class="version"[^>]*>version ([^<]+)<\/span>/.exec(html)?.[1];
if (!version) throw new Error("no version found in index.html");

// a "</script>" or "</style>" inside the inlined code would end the element early
const safe = (code, tag) => code.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g,
  (m, f) => `<style>\n${safe(read(f), "style")}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g,
  (m, f) => `<script>\n// ---- ${f}\n${safe(read(f), "script")}</script>`);

// The Impressum becomes a section at the end of the page.
const impressum = /<main class="text">([\s\S]*?)<\/main>/.exec(read("impressum.html"))[1]
  .replace(/\s*<p><a href="index.html">[^<]*<\/a><\/p>/, "");
html = html.replace('<a href="impressum.html">', '<a href="#impressum">');
html = html.replace("</main>", `</main>\n<main class="text" id="impressum" lang="de">${impressum}</main>`);

if (/<(script|link)[^>]+(src|href)="(?!#|https?:)/.test(html)) throw new Error("a local file is still referenced");
const out = `tcs-workbench-${version}.html`;
fs.writeFileSync(path.join(__dirname, out), html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
