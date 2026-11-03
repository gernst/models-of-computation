// Run with:  node test.js
// Loads the same scripts as index.html and tests every example of every language.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(f => f !== "app.js");
const storage = new Map(); // stands in for the browser's localStorage
const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
const ctx = vm.createContext({ console, localStorage });
for (const f of scripts) vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), ctx, { filename: f });
const { LANGUAGES, LangError, checkProgram, splitDirectives,
        encodePermalinkProgram, decodePermalinkProgram, permalinkIdFrom, programFromPage,
        loadPrograms, savePrograms, recordEdit, addProgram, deleteProgram, dropEmptyPrograms, programLabel, STORAGE_VERSION } =
  vm.runInContext(`({ LANGUAGES, LangError, checkProgram, splitDirectives,
    encodePermalinkProgram, decodePermalinkProgram, permalinkIdFrom, programFromPage,
    loadPrograms, savePrograms, recordEdit, addProgram, deleteProgram, dropEmptyPrograms, programLabel, STORAGE_VERSION })`, ctx);

let failures = 0;
function test(name, fn) {
  try { fn(); console.log("ok    " + name); }
  catch (e) { failures++; console.log("FAIL  " + name + ": " + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const byId = id => LANGUAGES.find(l => l.id === id);
function run(langId, code, inputs, maxSteps = 1e6) {
  const lang = byId(langId);
  return lang.run(lang.parse(splitDirectives(code).code), inputs.map(BigInt), { steps: 0, maxSteps, trace: null });
}
function parseError(langId, code) {
  try { byId(langId).parse(code); } catch (e) { if (e instanceof LangError) return e; throw e; }
  throw new Error("expected a parse error");
}

// What each example computes (the examples themselves carry no ENSURES line).
const SPECS = {
  "loop/Addition": "z == x + y",
  "loop/Predecessor": "pred == IF n == 0 THEN 0 ELSE n - 1",
  "loop/Subtraction": "d == IF x >= y THEN x - y ELSE 0",
  "while/Addition": "z == x + y",
  "while/Subtraction": "diff == x - y",
  "while/Absolute value": "(x >= 0 ==> abs == x) AND (x < 0 ==> abs == -x)",
  "while/Multiplication (function)": "p == x * y",
  "while/Fibonacci (recursive)": "", // not expressible in ENSURES; see the test below
  "primrec/Addition": "x0 == x1 + x2",
  "primrec/Predecessor": "x0 == IF x1 == 0 THEN 0 ELSE x1 - 1",
};

// Every example parses and runs, and satisfies its specification.
for (const lang of LANGUAGES) {
  for (const ex of lang.examples) {
    test(`${lang.name} / ${ex.name}`, () => {
      const warnings = lang.parse(splitDirectives(ex.code).code).warnings ?? [];
      assert(warnings.length === 0, "warnings: " + warnings.map(w => `line ${w.line}: ${w.message}`).join("; "));
      if (ex.name === "Infinite loop") return;
      const inputs = (ex.inputs ?? "").split(/[\s,]+/).filter(Boolean);
      run(lang.id, ex.code, inputs);
      const spec = SPECS[`${lang.id}/${ex.name}`];
      assert(spec !== undefined, "no entry in SPECS");
      if (spec) {
        const r = checkProgram(lang, ex.code + "\nENSURES " + spec, 4, 1e6);
        assert(r.ok, `check failed for inputs ${r.inputs}`);
      }
    });
  }
}

// A few targeted tests.
test("LOOP reads the counter only once", () =>
  assert(run("loop", "LOOP (x1) { x1 = x1 + 1  x0 = x0 + 1 }", [3]) === 3n, "wrong result"));
test("LOOP reset", () =>
  assert(run("loop", "x0 = 7\nLOOP (x1) { x0 = 0  x0 = x0 + 1 }", [3]) === 1n, "wrong result"));
test("unbalanced braces are rejected", () => parseError("loop", "LOOP (x1) { x0 := x0 + 1"));
test("parentheses are required", () => parseError("loop", "LOOP x1 { x0 := x0 + 1 }"));
test("semicolons are optional", () => {
  assert(run("loop", "x1 = x1 + 1; x0 = x0 + 2;; LOOP (x1) { x0 = x0 + 1; };", []) === 3n, "LOOP");
  assert(run("while", "FUN f(a) { a = a + 1; RETURN a; }\nx0 = f(2); IF (x0 != 0) { x0 = x0 + 1; };", []) === 4n, "WHILE");
});
test("':=' is still accepted", () => assert(run("while", "x0 := 5", []) === 5n, "wrong result"));
test("LOOP has only reset and increment", () => {
  for (const code of ["x = y", "x = y + 1", "x = x", "x = x + y", "x = x - 1"])
    assert(/only has/.test(parseError("loop", code).message), code);
});
test("semicolon inside an assignment is an error", () => parseError("loop", "x0 = ; 1"));
test("WHILE is rejected in LOOP", () => parseError("loop", "WHILE (x1 != 0) { x1 = x1 - 1 }"));
test("LOOP is rejected in WHILE", () => parseError("while", "LOOP (x1) { x0 := x0 + 1 }"));
test("WHILE subtraction goes below 0", () =>
  assert(run("while", "x0 := x1 - 5", [2]) === -3n, "wrong result"));
test("WHILE accepts negative inputs", () =>
  assert(run("while", "INPUT a\nOUTPUT b\nb := a + 1", [-4]) === -3n, "wrong result"));
test("LOOP rejects negative inputs", () => {
  try { run("loop", "x0 = x0 + 1", [-1]); } catch (e) { assert(e instanceof LangError, e.message); return; }
  throw new Error("no error");
});
test("WHILE check covers negative inputs", () => {
  const r = checkProgram(byId("while"), "INPUT x\nOUTPUT y\nENSURES y >= x\ny := x + 0", 3, 100);
  assert(r.ok && r.tested === 7, "tested " + r.tested);
  const bad = checkProgram(byId("while"), "INPUT x\nOUTPUT y\nENSURES y >= 0\ny := x", 3, 100);
  assert(!bad.ok && bad.inputs[0] < 0n, "no negative counterexample");
});
test("step limit stops infinite loops", () => {
  try { run("while", "x1 := 1  WHILE (x1 != 0) { x1 := x1 + 1 }", [], 1000); }
  catch (e) { assert(/step limit/.test(e.message), e.message); return; }
  throw new Error("did not stop");
});
test("WHILE: recursive Fibonacci", () => {
  const ex = byId("while").examples.find(e => e.name.startsWith("Fibonacci"));
  const fib = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
  fib.forEach((v, n) => assert(run("while", ex.code, [n]) === BigInt(v), `fib(${n})`));
});
test("WHILE: function variables are local", () =>
  assert(run("while", "FUN f(a) { x := 7  RETURN a }\nx := 1\ny := f(x)\nx0 := x", []) === 1n, "x changed"));
test("WHILE: unknown function", () => parseError("while", "x := g(1)"));
test("WHILE: wrong number of arguments", () => parseError("while", "FUN f(a) { RETURN a }\nx := f(1, 2)"));
test("WHILE: RETURN required at the end", () => parseError("while", "FUN f(a) { a := 1 }"));
test("WHILE: no nested FUN", () => parseError("while", "WHILE (x != 0) { FUN f(a) { RETURN a } }"));
test("WHILE: recursion depth limit", () => {
  try { run("while", "FUN f(a) { a := f(a)  RETURN a }\nx := f(1)", []); }
  catch (e) { assert(e instanceof LangError && /nested/.test(e.message), e.message); return; }
  throw new Error("no error");
});
test("WHILE: IF and ELSE", () => {
  const code = "IF (x1 != 0) { x0 := 1 } ELSE { x0 := 2 }";
  assert(run("while", code, [5]) === 1n && run("while", code, [0]) === 2n, "wrong result");
  assert(run("while", "IF (x1 != 0) THEN { x0 := 1 } ELSE { x0 := 2 }", [0]) === 2n, "with THEN");
  assert(run("while", "x0 := 3\nIF (x1 != 0) { x0 := 1 }", [0]) === 3n, "IF without ELSE");
});
test("WHILE: AND, OR, NOT in conditions", () => {
  const code = "IF (x1 != 0 AND (x2 != 0 OR x3 != 0)) THEN { x0 := 1 }";
  const cases = [[[1, 1, 0], 1n], [[1, 0, 1], 1n], [[1, 0, 0], 0n], [[0, 1, 1], 0n]];
  for (const [inp, out] of cases) assert(run("while", code, inp) === out, "inputs " + inp);
  assert(run("while", "x1 := 3\nWHILE (x1 != 0 OR x2 != 0) { x1 := x1 - 1  x0 := x0 + 1 }", []) === 3n, "WHILE with ||");
});
test("WHILE: NOT", () => {
  const code = "IF (NOT x1 != 0 AND NOT (x2 != 0)) THEN { x0 := 1 }";
  assert(run("while", code, [0, 0]) === 1n && run("while", code, [0, 1]) === 0n && run("while", code, [1, 0]) === 0n, "wrong result");
});
test("WHILE: && is rejected with a hint", () => {
  const e = parseError("while", "IF (x != 0 && y != 0) { x := 0 }");
  assert(/AND/.test(e.message), e.message);
});
test("WHILE: only != 0 tests", () => parseError("while", "IF (x != 1) { x := 0 }"));
test("WHILE: ELSE without IF", () => parseError("while", "ELSE { x0 := 1 }"));
test("PR arity error is reported with line", () => {
  const e = parseError("primrec", "\nadd = REC(pi[1,1], pi[2,1])");
  assert(e.line === 2 && /arity/.test(e.message), e.message);
});
test("PR: zero[n] and succ", () =>
  assert(run("primrec", "three = COMP(succ, COMP(succ, COMP(succ, zero[2])))", [7, 8]) === 3n, "wrong result"));
test("PR: numbers are not functions", () => parseError("primrec", "f = COMP(succ, 0)"));
test("PR: built-in names cannot be redefined", () => parseError("primrec", "succ = pi[1,1]"));
test("PR: no recursion by name", () => parseError("primrec", "f = REC(zero, COMP(f, pi[2,1]))"));
test("named inputs and output", () =>
  assert(run("while", "INPUT a, b\nOUTPUT s\ns := a\nWHILE (b != 0) { s := s + 1  b := b - 1 }", [2, 5]) === 7n, "wrong result"));
test("wrong number of inputs is an error", () => {
  try { run("loop", "INPUT a, b\nOUTPUT a", [1]); } catch (e) { assert(e instanceof LangError, e.message); return; }
  throw new Error("no error");
});
test("all variables are reported in order", () => {
  const lang = byId("loop"), ctx = { steps: 0, maxSteps: 100, trace: null };
  lang.run(lang.parse("INPUT n\nOUTPUT r\ntmp = tmp + 1\nr = r + 5"), [4n], ctx);
  assert([...ctx.vars].map(([x, v]) => x + "=" + v).join(" ") === "n=4 r=5 tmp=1", "got " + [...ctx.vars]);
});
test("check uses named variables", () => {
  const r = checkProgram(byId("loop"), "ENSURES r == n + 2\nINPUT n\nOUTPUT r\nLOOP (n) { r = r + 1 }\nr = r + 1", 3, 100);
  assert(!r.ok && r.names[0] === "n" && r.output === "r", JSON.stringify(r, (k, v) => typeof v === "bigint" ? String(v) : v));
});
test("check finds counterexample", () => {
  const r = checkProgram(byId("loop"), "ENSURES x0 == x1 + x2\nLOOP (x1) { x0 = x0 + 1 }", 3, 1000);
  assert(!r.ok && r.line === 1, "no counterexample");
});

// The assertion language.
const evalSpec = (text, env = {}) => vm.runInContext("(t, env) => evalExpr(parseExpr(t, 1), env)", ctx)(text, env);
test("spec: AND, OR, NOT", () => {
  assert(evalSpec("1 < 2 AND NOT 2 < 1 or 1 > 2") === 1n, "AND/NOT/or");
  assert(evalSpec("NOT (1 < 2 OR 2 < 1)") === 0n, "NOT ( … )");
  assert(evalSpec("NOT x < 1 AND NOT NOT x == 2", { x: 2n }) === 1n, "NOT applies to the whole comparison");
});
test("spec: ==> and <==>", () => {
  const T = "1 < 2", F = "2 < 1";
  const cases = [[`${F} ==> ${F}`, 1n], [`${F} ==> ${T}`, 1n], [`${T} ==> ${F}`, 0n], [`${T} ==> ${T}`, 1n],
                 [`${T} <==> ${T}`, 1n], [`${F} <==> ${F}`, 1n], [`${T} <==> ${F}`, 0n],
                 [`${T} ==> ${T} ==> ${F}`, 0n], [`${F} ==> ${T} ==> ${F}`, 1n], // right-associative
                 ["x > 0 ==> x / x == 1", 1n]];                                  // no division by zero for x = 0
  for (const [t, v] of cases) assert(evalSpec(t, { x: 0n }) === v, t);
});
test("spec: IF THEN ELSE", () => {
  assert(evalSpec("(IF x > 0 THEN x ELSE -x) == 3", { x: -3n }) === 1n, "abs");
  assert(evalSpec("(IF x == 0 THEN 0 ELSE 10 / x) == 0", { x: 0n }) === 1n, "only one branch is evaluated");
  assert(evalSpec("6 == 1 + IF 1 > 2 THEN 1 ELSE 2 + 3") === 1n, "ELSE extends to the right");
  assert(evalSpec("IF 1 < 2 THEN x > 0 ELSE x < 0", { x: 1n }) === 1n, "branches can be conditions");
});
test("spec: conditions must be conditions", () => {
  for (const t of ["x", "IF x THEN 1 ELSE 2", "x AND x > 0", "NOT x", "x ==> x > 0", "(x > 0) + 1",
                   "(x > 0) == (x > 1)", "IF x > 0 THEN 1 ELSE x > 0", "x + 1"]) {
    let msg = null;
    try { evalSpec(t, { x: 1n }); } catch (e) { msg = e.message; }
    assert(msg !== null, "accepted: " + t);
  }
});
test("spec: number compared with a condition: helpful message", () => {
  try { evalSpec("r == (x == 1 OR y == 1)", { r: 1n, x: 1n, y: 0n }); }
  catch (e) { assert(/IF b THEN 1 ELSE 0/.test(e.message), e.message); return; }
  throw new Error("accepted");
});
test("spec: 1/0 results via IF", () =>
  assert(evalSpec("r == IF x == 1 OR y == 1 THEN 1 ELSE 0", { r: 1n, x: 0n, y: 1n }) === 1n, "wrong"));
test("spec: && is rejected with a hint", () => {
  try { evalSpec("1 < 2 && 1 < 2"); } catch (e) { assert(/AND/.test(e.message), e.message); return; }
  throw new Error("no error");
});

// Permalinks: answers as returned by the permalink service (shortened).
test("permalink: LANGUAGE line round trip", () => {
  const code = "INPUT x\nOUTPUT y\ny = x + 1\n";
  const d = decodePermalinkProgram(encodePermalinkProgram("WHILE", code));
  assert(d.language === "WHILE" && d.code === code, JSON.stringify(d));
  let rejected = false;
  try { decodePermalinkProgram("x0 = 0;\n"); } catch { rejected = true; }
  assert(rejected, "a program without LANGUAGE line must be rejected");
});
test("permalink: id from save-perma.php", () => {
  const html = `<p>\nPermalink:\n<a href="https://example.org/service/?ex=1700000000-1234567890">https://example.org/service/?ex=1700000000-1234567890</a></p>`;
  assert(permalinkIdFrom(html) === "1700000000-1234567890", "wrong id");
});
test("permalink: program from the loaded page", () => {
  const html = `<form><textarea name="prog1" id="prog1" spellcheck="false" style="width: 80%">\nLANGUAGE LOOP\nx = x + 1 // a &lt; b &amp;&amp; c\n</textarea>`;
  const d = decodePermalinkProgram(programFromPage(html));
  assert(d.language === "LOOP" && d.code === "x = x + 1 // a < b && c\n", JSON.stringify(d));
});

// The user's programs (programs.js).
test("programs: unchanged examples are not stored", () => {
  const lang = byId("loop"), list = [];
  assert(recordEdit(lang, list, null, lang.examples[0].code, "1, 2") === null && list.length === 0, "stored");
});
test("programs: editing an example creates one program, further edits update it", () => {
  const lang = byId("loop"), list = [];
  const id = recordEdit(lang, list, null, "x = 1", "");
  assert(id && list.length === 1, "not created");
  assert(recordEdit(lang, list, id, "x = 2", "5") === id && list.length === 1 && list[0].code === "x = 2" && list[0].inputs === "5", "not updated");
});
test("programs: shared programs are never changed", () => {
  const lang = byId("while"), list = [];
  const id = addProgram(list, "x = 1", "", "123-456");
  assert(addProgram(list, "x = 1", "", "123-456") === id && list.length === 1, "duplicate for the same permalink");
  assert(recordEdit(lang, list, id, "x = 1", "7") === id, "changing the inputs keeps the program");
  const copy = recordEdit(lang, list, id, "x = 2", "7");
  assert(copy !== id && list.length === 2 && list.find(p => p.id === id).code === "x = 1", "shared program was changed");
});
test("programs: stored, sorted, deleted", () => {
  const lang = byId("primrec"), list = [];
  recordEdit(lang, list, null, "a = zero", "");
  list[0].edited = 1;
  const b = recordEdit(lang, list, null, "b = succ", "");
  savePrograms(lang, list);
  const back = loadPrograms(lang);
  assert(back.length === 2 && back[0].id === b, "wrong order");
  assert(deleteProgram(back, b).code === "b = succ" && back.length === 1, "not deleted");
});
test("programs: the single saved program of earlier versions is taken over", () => {
  const lang = byId("while");
  storage.set(`v${STORAGE_VERSION}:code:while`, "x = 42");
  storage.set(`v${STORAGE_VERSION}:inputs:while`, "3");
  const list = loadPrograms(lang);
  assert(list.length === 1 && list[0].code === "x = 42" && list[0].inputs === "3", JSON.stringify(list));
});
test("programs: empty programs are dropped, except the current one", () => {
  const list = [];
  const a = addProgram(list, "", ""), b = addProgram(list, "  \n", ""), c = addProgram(list, "x = 1", "");
  assert(dropEmptyPrograms(list, a) && list.length === 2 && list.some(p => p.id === a) && !list.some(p => p.id === b), "wrong programs dropped");
});
// Static checks: variables without a value.
const warningsOf = (langId, code) => byId(langId).parse(code).warnings.map(w => w.x + "@" + w.line).join(" ");
test("LOOP over a variable without a value is an error", () => {
  const e = parseError("loop", "INPUT n\nOUTPUT r\nLOOP (k) { r = r + 1 }");
  assert(e.line === 3 && /no value/.test(e.message), e.message);
  parseError("loop", "INPUT n\nLOOP (n) { k = 0 }\nLOOP (k) { n = n + 1 }"); // assigned only inside a loop
  byId("loop").parse("INPUT n\nk = 0\nLOOP (n) { LOOP (k) { k = k + 1 } }");  // fine
  byId("loop").parse("LOOP (x1) { x0 = 0 }");                                    // x1: default input
});
test("LOOP: reading a variable without a value is a warning", () => {
  assert(warningsOf("loop", "INPUT n\nOUTPUT r\nr = r + 1\nr = r + 1") === "r@3", warningsOf("loop", "INPUT n\nOUTPUT r\nr = r + 1\nr = r + 1"));
  assert(warningsOf("loop", "INPUT n\nLOOP (n) { r = 0 }\nr = r + 1") === "r@3", "assigned only in a loop");
});
test("WHILE: reading a variable without a value is a warning", () => {
  const w = c => warningsOf("while", c);
  assert(w("INPUT x\ny = z + 1\nWHILE (q != 0 AND x != 0) { x = x - 1 }") === "z@2 q@3", w("INPUT x\ny = z + 1\nWHILE (q != 0 AND x != 0) { x = x - 1 }"));
  assert(w("INPUT x\nIF (x != 0) THEN { y = 1 } ELSE { y = 2 }\nz = y") === "", "both branches assign y");
  assert(w("INPUT x\nIF (x != 0) THEN { y = 1 }\nz = y") === "y@3", "only one branch");
  assert(w("FUN f(a) { b = c + 1\nRETURN r }\nx0 = f(1)") === "c@1 r@2", w("FUN f(a) { b = c + 1\nRETURN r }\nx0 = f(1)"));
  assert(w("x0 = f(u)\nFUN f(a) { RETURN a }") === "u@1", "call arguments");
});

test("PROGRAM: optional name before everything else", () => {
  assert(splitDirectives("// comment\nPROGRAM Add  // the name\nINPUT x\n").name === "Add", "name");
  assert(splitDirectives("INPUT x\n").name === null, "no name");
  for (const code of ["INPUT x\nPROGRAM Add", "PROGRAM Add\nPROGRAM Sub", "PROGRAM my program", "PROGRAM", "ENSURES x0 == 0\nPROGRAM A"])
    try { splitDirectives(code); throw new Error("accepted: " + code); } catch (e) { assert(e instanceof LangError, e.message); }
  assert(run("loop", "PROGRAM Inc\nINPUT x\nOUTPUT y\nLOOP (x) { y = y + 1 }\ny = y + 1", [2]) === 3n, "run with PROGRAM");
  assert(run("primrec", "PROGRAM S\nf = succ", [4]) === 5n, "PRIMREC with PROGRAM");
  assert(run("loop", "program = program + 2\nx0 = x0 + 1", []) === 1n, "a variable called program");
});
test("programs: menu label", () => {
  const now = new Date(2026, 10, 3, 17, 0);
  const label = programLabel({ code: "x = 1\n\ny = 2\n", edited: new Date(2026, 10, 3, 16, 42).getTime(), permalink: "1-2" }, now);
  assert(label === "16:42 · 2 lines · shared", label);
  const named = programLabel({ code: "PROGRAM Fib\nx = 1\n", edited: new Date(2026, 10, 3, 16, 42).getTime() }, now);
  assert(named === "Fib · 16:42", named);
});

console.log(failures ? `\n${failures} test(s) failed` : "\nall tests passed");
process.exit(failures ? 1 : 0);
