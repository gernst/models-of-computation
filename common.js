"use strict";
// Shared infrastructure for all languages:
// tokenizer, parser helpers, step counting, tracing, ENSURES/REQUIRES checking.

/** All languages. Each lang-*.js file pushes one object, see README.md. */
const LANGUAGES = [];

/** An error in the user's program. `line` is shown and highlighted in the editor. */
class LangError extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
  }
}

/** Thrown when a program runs longer than the step limit. */
class StepLimitError extends LangError {}

// ---------------------------------------------------------------- execution

const MAX_TRACE = 5000;

/** Count one computation step; abort when the step limit is exceeded. */
function tick(ctx) {
  if (++ctx.steps > ctx.maxSteps)
    throw new StepLimitError(`no result after ${ctx.maxSteps} steps (step limit reached)`);
}

/** Add a line to the trace (only if tracing is on). `makeText` is a function so it costs nothing otherwise. */
function record(ctx, line, makeText) {
  if (ctx.trace && ctx.trace.length < MAX_TRACE) ctx.trace.push({ line, text: makeText() });
}

/** Sort variable names naturally: x2 before x10. */
function varOrder(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}

// ---------------------------------------------------------------- tokenizer

const SYMBOLS = ["<==>", "==>", ":=", "!=", "==", "<=", ">=", "&&", "||", "<>", "≠",
  "+", "-", "*", "/", "%", "^", "(", ")", "[", "]", "{", "}", ",", ";", "=", "<", ">", "!"];

/** Split source text into tokens {type: "id" | "num" | "sym", value, line}. Comments: // to end of line. */
function tokenize(src, line = 1) {
  const tokens = [];
  const ID = /[A-Za-z_][A-Za-z0-9_]*/y, NUM = /[0-9]+/y;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    ID.lastIndex = NUM.lastIndex = i;
    let m;
    if ((m = ID.exec(src))) tokens.push({ type: "id", value: m[0], line });
    else if ((m = NUM.exec(src))) tokens.push({ type: "num", value: m[0], line });
    else {
      const sym = SYMBOLS.find(s => src.startsWith(s, i));
      if (!sym) throw new LangError(`unexpected character '${c}'`, line);
      tokens.push({ type: "sym", value: sym, line });
      m = [sym];
    }
    i += m[0].length;
  }
  return tokens;
}

// ---------------------------------------------------------------- parser helper

/** A cursor over the token list with the usual helpers for recursive-descent parsing. */
class Parser {
  constructor(src, line = 1) {
    this.tokens = tokenize(src, line);
    this.pos = 0;
    this.firstLine = line;
  }
  done() { return this.pos >= this.tokens.length; }
  peek() { return this.tokens[this.pos]; }
  line() {
    const t = this.peek() ?? this.tokens[this.tokens.length - 1];
    return t ? t.line : this.firstLine;
  }
  error(message) { throw new LangError(message, this.line()); }

  next() {
    if (this.done()) this.error("unexpected end of program");
    return this.tokens[this.pos++];
  }
  at(value) {
    const t = this.peek();
    return t !== undefined && t.value === value;
  }
  atKeyword(kw) {
    const t = this.peek();
    return t !== undefined && t.type === "id" && t.value.toUpperCase() === kw;
  }
  expect(value) {
    const t = this.next();
    if (t.value !== value) throw new LangError(`expected '${value}' but found '${t.value}'`, t.line);
    return t;
  }
  expectKeyword(kw) {
    const t = this.next();
    if (t.type !== "id" || t.value.toUpperCase() !== kw)
      throw new LangError(`expected '${kw}' but found '${t.value}'`, t.line);
    return t;
  }
  /** Skip optional semicolons. */
  skipSemicolons() {
    while (this.at(";")) this.pos++;
  }
  number() {
    const t = this.next();
    if (t.type !== "num") throw new LangError(`expected a number but found '${t.value}'`, t.line);
    return BigInt(t.value);
  }
}

// ---------------------------------------------------------------- helpers for imperative languages

/**
 * Parse the optional header   INPUT a, b   OUTPUT c   (in this order or the other).
 * `readVar(p)` reads one variable name. Returns { inputs: names or null, inputLine, output }.
 */
function parseHeader(p, readVar) {
  let inputs = null, output = null, inputLine = 1;
  while (p.atKeyword("INPUT") || p.atKeyword("OUTPUT")) {
    const kw = p.next();
    if (kw.value.toUpperCase() === "INPUT") {
      if (inputs) throw new LangError("INPUT is declared twice", kw.line);
      inputLine = kw.line;
      inputs = [readVar(p)];
      while (p.at(",")) { p.next(); inputs.push(readVar(p)); }
      const dup = inputs.find((x, i) => inputs.indexOf(x) !== i);
      if (dup) throw new LangError(`input '${dup}' is declared twice`, kw.line);
    } else {
      if (output) throw new LangError("OUTPUT is declared twice", kw.line);
      output = readVar(p);
    }
  }
  return { inputs, inputLine, output: output ?? "x0" };
}

/**
 * Create the variables of a program { inputs, inputLine, output, vars }:
 * the inputs first (default names x1, x2, …), then the output, then all others, starting at 0.
 * The map is also stored in ctx.vars so the UI can list all variables (also after an error).
 */
function initVars(program, inputs, ctx) {
  const names = program.inputs ?? inputs.map((_, i) => "x" + (i + 1));
  if (inputs.length !== names.length)
    throw new LangError(`the program has ${names.length} input(s) (${names.join(", ")}), but ${inputs.length} given`, program.inputLine);
  const env = new Map(); // insertion order = display order
  names.forEach((x, i) => env.set(x, inputs[i]));
  for (const x of [program.output, ...program.vars]) if (!env.has(x)) env.set(x, 0n);
  ctx.vars = env;
  return env;
}

/**
 * Static check for imperative languages: which variables certainly have a value at a point.
 * Inputs (without INPUT header: x1, x2, …) have one at the start, all others only after an
 * assignment. Loop bodies may run 0 times, so their assignments do not count after the loop.
 */
class InitState {
  constructor(defined, defaultInputs) {
    this.defined = new Set(defined);
    this.defaultInputs = defaultInputs;
  }
  has(x) { return this.defined.has(x) || (this.defaultInputs && /^x[1-9][0-9]*$/.test(x)); }
  add(x) { this.defined.add(x); }
  copy() { return new InitState(this.defined, this.defaultInputs); }
  /** After IF … ELSE: only what is assigned in both branches. */
  meet(other) { this.defined = new Set([...this.defined].filter(x => other.defined.has(x))); }
}

/** The state at the start of a program with header { inputs }. */
const startState = program => new InitState(program.inputs ?? [], program.inputs === null);

/** Warn (once per variable and line) that x is read before it has a value. */
function warnUninitialized(warnings, x, line) {
  if (warnings.some(w => w.x === x && w.line === line)) return;
  warnings.push({ x, line, message: `'${x}' is read before it has been assigned a value (it is 0 then)` });
  warnings.sort((a, b) => a.line - b.line);
}

/** For languages over ℕ: reject negative inputs. */
function requireNaturals(inputs) {
  const bad = inputs.find(v => v < 0n);
  if (bad !== undefined) throw new LangError(`inputs must be natural numbers, but got ${bad}`);
}

/** One-line rendering of all variables, for the trace. */
function showVars(env) {
  return [...env].map(([x, v]) => `${x}=${v}`).join("  ");
}

// ---------------------------------------------------------------- specifications

// Lines "ENSURES <expr>" and "REQUIRES <expr>" (usually at the top of the program).
// In expressions, x1, x2, ... are the inputs and x0 is the result (or the names from INPUT/OUTPUT).
// From loosest to tightest:  <==>   ==> (right-assoc.)   OR   AND   NOT   == != < <= > >=   + -
//   * / %   unary -   ^ (right-assoc.)   numbers, names, ( … ),  IF c THEN a ELSE b.
// Keywords in any case. Numbers and conditions are different types, checked when parsing
// (see specType); the whole line must be a condition. When evaluated, conditions are 1n / 0n.

const SPEC_LEVELS = [["<==>"], ["==>"], ["OR"], ["AND"],
  ["==", "=", "!=", "≠", "<>", "<", "<=", ">", ">="], ["+", "-"], ["*", "/", "%"]];
const SPEC_KEYWORDS = ["AND", "OR", "NOT", "IF", "THEN", "ELSE"];

function parseExpr(text, line) {
  const p = new Parser(text, line);
  if (p.done()) p.error("empty condition");
  const e = parseLevel(p, 0);
  if (!p.done()) p.error(`unexpected '${p.peek().value}' in condition`);
  if (specType(e, line) !== "bool")
    throw new LangError("this is a number, but a condition is needed here, e.g.  x0 == x1 + 1", line);
  return e;
}

const NUMBER_OPS = ["+", "-", "*", "/", "%", "^", "neg"];
const COMPARISONS = ["==", "=", "!=", "≠", "<>", "<", "<=", ">", ">="];

/** "int" or "bool"; throws if numbers and conditions are mixed up. */
function specType(e, line) {
  if (e.num !== undefined || e.var !== undefined) return "int";
  const sym = e.op === "neg" ? "-" : e.op;
  const need = (sub, type, what) => {
    if (sub && specType(sub, line) !== type)
      throw new LangError(type === "bool"
        ? `${what} needs a condition (e.g. x > 0), not a number`
        : `'${sym}' needs numbers, not conditions` + (COMPARISONS.includes(sym) ? "; to compare conditions use <==>" : ""), line);
  };
  if (e.op === "IF") {
    need(e.cond, "bool", "the IF part of IF … THEN … ELSE");
    const t = specType(e.left, line);
    if (specType(e.right, line) !== t)
      throw new LangError("THEN and ELSE must both be numbers or both be conditions", line);
    return t;
  }
  if (COMPARISONS.includes(e.op) && specType(e.left, line) !== specType(e.right, line)) {
    const n = specType(e.left, line) === "int" ? "a" : "b", c = n === "a" ? "b" : "a";
    throw new LangError(`'${sym}' compares two numbers, but ${c} is a condition here (in  ${n} ${sym} ${c}). ` +
      `For a result that is 1 or 0, write  ${n} ${sym} IF ${c} THEN 1 ELSE 0`, line);
  }
  if (NUMBER_OPS.includes(e.op) || COMPARISONS.includes(e.op)) {
    need(e.left, "int"); need(e.right, "int");
    return NUMBER_OPS.includes(e.op) ? "int" : "bool";
  }
  need(e.left, "bool", sym); need(e.right, "bool", sym); // NOT AND OR ==> <==>
  return "bool";
}

/** The operator of level k at the current position (keywords upper-cased), or null. */
function specOperator(p, k) {
  const t = p.peek();
  if (!t) return null;
  if (t.value === "&&" || t.value === "||") p.error("write AND and OR instead of && and ||");
  const op = t.type === "id" ? t.value.toUpperCase() : t.type === "sym" ? t.value : null;
  return SPEC_LEVELS[k].includes(op) ? op : null;
}

const NOT_LEVEL = 4; // NOT applies to a whole comparison:  NOT x < 1  =  NOT (x < 1)

function parseLevel(p, k) {
  if (k === SPEC_LEVELS.length) return parseUnary(p);
  if (k === NOT_LEVEL && p.atKeyword("NOT")) { p.next(); return { op: "NOT", left: parseLevel(p, k) }; }
  let left = parseLevel(p, k + 1);
  for (let op; (op = specOperator(p, k)); ) {
    p.next();
    if (op === "==>") return { op, left, right: parseLevel(p, k) }; // a ==> b ==> c  =  a ==> (b ==> c)
    left = { op, left, right: parseLevel(p, k + 1) };
  }
  return left;
}

function parseUnary(p) {
  if (p.at("!")) p.error("write NOT instead of !");
  if (p.at("-")) { p.next(); return { op: "neg", left: parseUnary(p) }; }
  if (p.atKeyword("IF")) { // IF c THEN a ELSE b; the ELSE part extends as far as possible
    p.next();
    const cond = parseLevel(p, 0);
    p.expectKeyword("THEN");
    const left = parseLevel(p, 0);
    p.expectKeyword("ELSE");
    return { op: "IF", cond, left, right: parseLevel(p, 0) };
  }
  const t = p.next();
  let base;
  if (t.type === "num") base = { num: BigInt(t.value) };
  else if (t.type === "id" && !SPEC_KEYWORDS.includes(t.value.toUpperCase())) base = { var: t.value, line: t.line };
  else if (t.value === "(") { base = parseLevel(p, 0); p.expect(")"); }
  else throw new LangError(`unexpected '${t.value}' in condition`, t.line);
  if (p.at("^")) { p.next(); return { op: "^", left: base, right: parseUnary(p) }; }
  return base;
}

/** Evaluate a condition. Booleans are 1n / 0n. */
function evalExpr(e, env) {
  if (e.num !== undefined) return e.num;
  if (e.var !== undefined) {
    if (!(e.var in env)) throw new LangError(`unknown variable '${e.var}' in condition`, e.line);
    return env[e.var];
  }
  const bool = b => (b ? 1n : 0n);
  const truth = x => evalExpr(x, env) === 1n; // conditions evaluate to 1n or 0n (checked by specType)
  switch (e.op) { // operators that do not always evaluate all parts
    case "IF": return truth(e.cond) ? evalExpr(e.left, env) : evalExpr(e.right, env);
    case "NOT": return bool(!truth(e.left));
    case "neg": return -evalExpr(e.left, env);
    case "OR": return bool(truth(e.left) || truth(e.right));
    case "AND": return bool(truth(e.left) && truth(e.right));
    case "==>": return bool(!truth(e.left) || truth(e.right));
    case "<==>": return bool(truth(e.left) === truth(e.right));
  }
  const a = evalExpr(e.left, env), b = evalExpr(e.right, env);
  switch (e.op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": case "%":
      if (b === 0n) throw new LangError("division by zero in condition (add a REQUIRES line?)");
      return e.op === "/" ? a / b : a % b;
    case "^":
      if (b < 0n) throw new LangError("negative exponent in condition");
      return a ** b;
    case "==": case "=": return bool(a === b);
    case "!=": case "≠": case "<>": return bool(a !== b);
    case "<": return bool(a < b);
    case "<=": return bool(a <= b);
    case ">": return bool(a > b);
    case ">=": return bool(a >= b);
  }
}

/** Largest i >= 1 such that xi occurs in one of the expressions. */
function maxInputIndex(exprs) {
  let max = 0;
  const walk = e => {
    if (!e) return;
    const m = e.var !== undefined && /^x(\d+)$/.exec(e.var);
    if (m) max = Math.max(max, Number(m[1]));
    walk(e.cond);
    walk(e.left);
    walk(e.right);
  };
  exprs.forEach(walk);
  return max;
}

/** A line  PROGRAM <name>  (but not an assignment to a variable called "program"). */
const PROGRAM_LINE = /^\s*PROGRAM\b(?!\s*:?=)(.*)$/i;

/** The name from the PROGRAM line, or null. Does not check anything (see splitDirectives). */
function programName(src) {
  for (const line of src.split("\n")) {
    const m = PROGRAM_LINE.exec(line);
    if (m) return /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(m[1])?.[1] ?? null;
  }
  return null;
}

/**
 * Remove the PROGRAM, ENSURES and REQUIRES lines from the source (keeping line numbers intact).
 * Returns { code, name, requires: [{expr, line}], ensures: [{expr, line}] }.
 * PROGRAM <name> is optional; only comments may come before it.
 */
function splitDirectives(src) {
  const directives = { name: null, requires: [], ensures: [] };
  let started = false; // a line other than comments has been seen
  const lines = src.split("\n").map((text, idx) => {
    const line = idx + 1;
    const p = PROGRAM_LINE.exec(text);
    if (p) {
      if (directives.name !== null) throw new LangError("PROGRAM is declared twice", line);
      if (started) throw new LangError("PROGRAM must be the first line (only comments may come before it)", line);
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\/\/.*)?$/.exec(p[1]);
      if (!m) throw new LangError("expected  PROGRAM <name>  (a name of letters, digits and _)", line);
      directives.name = m[1];
      started = true;
      return "";
    }
    if (text.trim() !== "" && !text.trim().startsWith("//")) started = true;
    const m = /^\s*(ENSURES|REQUIRES)\b(.*)$/i.exec(text);
    if (!m) return text;
    directives[m[1].toLowerCase()].push({ expr: parseExpr(m[2], line), line });
    return "";
  });
  return { code: lines.join("\n"), ...directives };
}

/**
 * The names of the inputs and of the result. Languages may provide `signature(program)`
 * returning { inputs: names or null, output: name or null }; the defaults are x1, x2, … and x0.
 */
function signatureOf(lang, program, exprs = []) {
  const sig = lang.signature ? lang.signature(program) : {};
  const inputs = sig.inputs ?? Array.from({ length: maxInputIndex(exprs) }, (_, i) => "x" + (i + 1));
  return { inputs, output: sig.output ?? "x0" };
}

/**
 * Run the program on all inputs 0..maxValue (or -maxValue..maxValue for languages
 * with `integers: true`) that satisfy REQUIRES, and test ENSURES.
 * Returns { ok: true, names, tested, skipped } or
 *         { ok: false, names, output, inputs, result?, line?, message?, tested, skipped }.
 */
function checkProgram(lang, source, maxValue, maxSteps) {
  const { code, requires, ensures } = splitDirectives(source);
  if (ensures.length === 0)
    throw new LangError("nothing to check: add a line such as   ENSURES x0 == x1 + x2");
  const program = lang.parse(code);
  const { inputs: names, output } = signatureOf(lang, program, [...requires, ...ensures].map(d => d.expr));
  const arity = names.length;
  const min = lang.integers ? -maxValue : 0;
  const base = maxValue - min + 1;
  const total = base ** arity;
  if (total > 100000) throw new LangError(`too many test cases (${total}); lower the maximum test value`);

  let tested = 0, skipped = 0;
  for (let n = 0; n < total; n++) {
    const inputs = [];
    for (let i = 0, k = n; i < arity; i++, k = Math.floor(k / base)) inputs.push(BigInt(k % base + min));
    const env = {};
    inputs.forEach((v, i) => { env[names[i]] = v; });
    const info = { names, output, inputs, tested, skipped };
    if (!requires.every(d => evalExpr(d.expr, env) !== 0n)) { skipped++; continue; }

    tested++;
    let result;
    try {
      result = lang.run(program, inputs, { steps: 0, maxSteps, trace: null });
    } catch (e) {
      if (e instanceof StepLimitError) return { ok: false, ...info, tested, message: e.message };
      throw e;
    }
    env[output] = result; // the inputs keep their initial values
    const failed = ensures.find(d => evalExpr(d.expr, env) === 0n);
    if (failed) return { ok: false, ...info, tested, result, line: failed.line };
  }
  return { ok: true, names, tested, skipped };
}
