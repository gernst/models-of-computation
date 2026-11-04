"use strict";
// WHILE programs over the integers, and WHILE + LOOP: the same with LOOP (x) { P } in addition.

const WHILE_KEYWORDS = ["WHILE", "INPUT", "OUTPUT", "FUN", "RETURN"];
const WHILE_LOOP_KEYWORDS = [...WHILE_KEYWORDS, "LOOP"];
const MAX_DEPTH = 1000; // maximal nesting of function calls

// ---------------------------------------------------------------- parser

/** Program ::= [INPUT var, …, var] [OUTPUT var] (Stmt | Fun)*   (withLoop: LOOP is a statement, too) */
function parseWhile(code, withLoop = false) {
  const p = new Parser(code);
  p.withLoop = withLoop;
  p.keywords = withLoop ? WHILE_LOOP_KEYWORDS : WHILE_KEYWORDS;
  p.vars = new Set();  // variables of the part being parsed (main program or one function)
  p.funs = new Map();  // name -> function
  p.calls = [];        // all calls, checked at the end (functions may be used before their definition)
  const header = parseHeader(p, whileVar);
  const body = parseWhileBlock(p, true);
  if (!p.done()) p.error("'}' without matching '{'");
  for (const c of p.calls) {
    const f = p.funs.get(c.f);
    if (!f) throw new LangError(`unknown function '${c.f}'`, c.line);
    if (f.params.length !== c.args.length)
      throw new LangError(`function '${c.f}' has ${f.params.length} parameter(s), but is called with ${c.args.length}`, c.line);
  }
  const warnings = [];
  checkWhileInit(body, startState(header), warnings);
  for (const f of p.funs.values()) {
    const st = new InitState(f.params, false);
    checkWhileInit(f.body, st, warnings);
    if (!st.has(f.result)) warnUninitialized(warnings, f.result, f.returnLine);
  }
  return { ...header, vars: [...p.vars], body, funs: p.funs, warnings };
}

/** Warn about reading variables before they have a value (see InitState in common.js). */
function checkWhileInit(stmts, st, warnings) {
  const read = (x, line) => { if (!st.has(x)) warnUninitialized(warnings, x, line); };
  const readCondition = (c, line) => read(c.var, line);
  for (const s of stmts) {
    if (s.type === "assign") {
      if (s.y !== null) read(s.y, s.line);
      st.add(s.x);
    } else if (s.type === "call") {
      for (const a of s.args) if (a.var !== undefined) read(a.var, s.line);
      st.add(s.x);
    } else if (s.type === "loop") { // as in LOOP programs: an error, not only a warning
      if (!st.has(s.x))
        throw new LangError(`LOOP (${s.x}): '${s.x}' has no value yet; assign one first (e.g. ${s.x} = 0) or make it an INPUT`, s.line);
      checkWhileInit(s.body, st.copy(), warnings);
    } else { // while
      readCondition(s.x, s.line);
      checkWhileInit(s.body, st.copy(), warnings);
    }
  }
}

/** A sequence of statements, optionally separated by semicolons. Function definitions only at the top level. */
function parseWhileBlock(p, top = false) {
  const stmts = [];
  for (p.skipSemicolons(); !p.done() && !p.at("}"); p.skipSemicolons()) {
    if (top && p.atKeyword("FUN")) parseFun(p);
    else stmts.push(parseWhileStmt(p));
  }
  return stmts;
}

/** Condition ::= ( var != 0 )   Returns { var }. */
function parseCondition(p) {
  p.expect("(");
  const line = p.line();
  if (p.at("(") || p.atKeyword("NOT") || p.at("!")) p.error("a condition is a single test  (x != 0);  AND, OR and NOT are not part of WHILE");
  const x = whileVar(p);
  const op = p.next();
  if (!["!=", "≠", "<>"].includes(op.value))
    throw new LangError(`expected '!=' after '${x}' but found '${op.value}'`, op.line);
  if (p.number() !== 0n) throw new LangError("only tests of the form 'x != 0' are allowed", line);
  if (!p.at(")")) p.error("a condition is a single test  (x != 0);  AND, OR and NOT are not part of WHILE");
  p.expect(")");
  return { var: x };
}

const evalCondition = (c, env) => env.get(c.var) !== 0n;

/** For the trace: the condition and the value of its variable. */
const showCondition = (c, env) => `(${c.var} != 0): ${c.var} = ${env.get(c.var)}`;

/** { Stmt* } */
function parseBraces(p) {
  p.expect("{");
  const body = parseWhileBlock(p);
  p.expect("}");
  return body;
}

/** Fun ::= FUN name(var, …, var) { Stmt* RETURN var } */
function parseFun(p) {
  const line = p.next().line;
  const t = p.next();
  if (t.type !== "id" || WHILE_KEYWORDS.includes(t.value.toUpperCase()))
    throw new LangError(`expected a function name but found '${t.value}'`, t.line);
  const name = t.value;
  if (p.funs.has(name)) throw new LangError(`function '${name}' is defined twice`, t.line);
  const outer = p.vars;
  p.vars = new Set(); // functions have their own, local variables
  p.expect("(");
  const params = [];
  if (!p.at(")")) {
    params.push(whileVar(p));
    while (p.at(",")) { p.next(); params.push(whileVar(p)); }
  }
  p.expect(")");
  const dup = params.find((x, i) => params.indexOf(x) !== i);
  if (dup) throw new LangError(`parameter '${dup}' is declared twice`, line);
  p.expect("{");
  const body = [];
  for (p.skipSemicolons(); !p.atKeyword("RETURN"); p.skipSemicolons()) {
    if (p.done() || p.at("}")) p.error(`function '${name}' must end with 'RETURN <variable>'`);
    body.push(parseWhileStmt(p));
  }
  const returnLine = p.next().line;
  const result = whileVar(p);
  p.skipSemicolons();
  p.expect("}");
  p.funs.set(name, { name, params, result, vars: [...p.vars], body, line, returnLine });
  p.vars = outer;
}

function whileVar(p) {
  const t = p.next();
  if (t.type !== "id" || p.keywords.includes(t.value.toUpperCase()))
    throw new LangError(`expected a variable but found '${t.value}'`, t.line);
  p.vars.add(t.value);
  return t.value;
}

function parseWhileStmt(p) {
  const line = p.line();

  if (p.atKeyword("WHILE")) {
    p.next();
    const x = parseCondition(p);
    return { type: "while", x, body: parseBraces(p), line };
  }

  if (p.atKeyword("IF") || p.atKeyword("THEN") || p.atKeyword("ELSE"))
    p.error("IF is not part of WHILE programs; use WHILE, e.g. a loop that runs at most once");

  if (p.atKeyword("LOOP")) {
    if (!p.withLoop) p.error("LOOP is not part of WHILE programs; use WHILE, or the language WHILE + LOOP");
    p.next();
    p.expect("(");
    const x = whileVar(p);
    p.expect(")");
    return { type: "loop", x, body: parseBraces(p), line };
  }
  if (p.atKeyword("INPUT") || p.atKeyword("OUTPUT")) p.error("INPUT and OUTPUT must come before the first statement");
  if (p.atKeyword("FUN")) p.error("functions can only be defined at the top level, not inside a block or function");
  if (p.atKeyword("RETURN")) p.error("RETURN is only allowed as the last statement of a function");

  // reset, increment, decrement, call:  x = c  |  x = x + c  |  x = x - c  |  x = f(a, …)
  const x = whileVar(p);
  const only = `WHILE only has  ${x} = c,  ${x} = ${x} + c  and  ${x} = ${x} - c  (c a number), and calls  ${x} = f(…)`;
  if (p.at("=") || p.at(":=")) p.next(); // := is accepted, too
  else p.error(`expected '=' after '${x}'`);
  if (p.peek()?.type === "id" && p.tokens[p.pos + 1]?.value === "(") {
    const f = p.next().value;
    p.expect("(");
    const args = [];
    const arg = () => args.push(p.peek()?.type === "num" ? { num: p.number() } : { var: whileVar(p) });
    if (!p.at(")")) {
      arg();
      while (p.at(",")) { p.next(); arg(); }
    }
    p.expect(")");
    p.calls.push({ f, args, line });
    return { type: "call", x, f, args, line };
  }
  if (p.peek()?.type === "num") return { type: "assign", x, y: null, op: "+", c: p.number(), line };
  const t = p.peek();
  if (t?.type !== "id" || t.value !== x) p.error(only);
  const y = whileVar(p);
  if (!(p.at("+") || p.at("-"))) p.error(only);
  const op = p.next().value;
  if (p.peek()?.type !== "num") p.error(only);
  return { type: "assign", x, y, op, c: p.number(), line };
}

// ---------------------------------------------------------------- interpreter

function runWhile(program, inputs, ctx) {
  const env = initVars(program, inputs, ctx);
  execWhile(program.body, env, ctx, { funs: program.funs, depth: 0, name: "" });
  return env.get(program.output);
}

/** `frame` = { funs, depth, name }: name is "" in the main program, else the current function. */
function execWhile(stmts, env, ctx, frame) {
  const where = frame.name ? `[${frame.name}]  ` : "";
  for (const s of stmts) {
    if (s.type === "assign") {
      tick(ctx);
      const v = s.y === null ? 0n : env.get(s.y);
      env.set(s.x, s.op === "+" ? v + s.c : v - s.c); // integers: may become negative
      record(ctx, s.line, () => where + showVars(env));
    } else if (s.type === "call") {
      tick(ctx);
      const f = frame.funs.get(s.f);
      const args = s.args.map(a => a.var === undefined ? a.num : env.get(a.var)); // call by value
      if (frame.depth >= MAX_DEPTH) throw new LangError(`more than ${MAX_DEPTH} nested function calls`, s.line);
      const call = `${s.f}(${args.join(", ")})`;
      record(ctx, s.line, () => `${where}call ${call}`);
      const local = new Map(); // parameters, then the result, then all other local variables (0)
      f.params.forEach((x, i) => local.set(x, args[i]));
      for (const x of [f.result, ...f.vars]) if (!local.has(x)) local.set(x, 0n);
      execWhile(f.body, local, ctx, { funs: frame.funs, depth: frame.depth + 1, name: f.name });
      const v = local.get(f.result);
      record(ctx, f.returnLine, () => `[${f.name}]  ${call} returns ${v}`);
      env.set(s.x, v);
      record(ctx, s.line, () => where + showVars(env));
    } else if (s.type === "loop") {
      const n = env.get(s.x); // read once, at the start; n <= 0: no iterations
      record(ctx, s.line, () => `${where}LOOP (${s.x}): ${n > 0n ? n : 0n} iteration(s)`);
      for (let i = 0n; i < n; i++) {
        tick(ctx);
        execWhile(s.body, env, ctx, frame);
      }
    } else { // while
      for (;;) {
        tick(ctx);
        const b = evalCondition(s.x, env);
        record(ctx, s.line, () => `${where}WHILE ${showCondition(s.x, env)} → ${b ? "enter body" : "exit"}`);
        if (!b) break;
        execWhile(s.body, env, ctx, frame);
      }
    }
  }
}

// ---------------------------------------------------------------- languages

const WHILE_HELP = `WHILE programs compute on integers …, -2, -1, 0, 1, 2, …

Header (optional):
  PROGRAM name          the name of the program
  INPUT a, b            the inputs, in this order   (default: x1, x2, …)
  OUTPUT c              the result                  (default: x0)

Statements (keywords in any case; one per line, or separated by optional semicolons):
  x = c                 set x to the number c        (usually x = 0)
  x = x + c             increment x by c             (usually x = x + 1)
  x = x - c             decrement x by c             (may become negative)
  P; P                  execute the two programs in sequence   (the ; may be a line break)
  WHILE (x != 0) { P }  repeat P as long as x is not 0
                        (the condition is always a single test  x != 0)

There are no other statements: x = y, x = y + 1, IF, or conditions with AND, OR, NOT
must be programmed with WHILE loops.
Variables can have any name; all non-input variables start at 0, but reading one
before assigning it gives a warning.
Comments: // until the end of the line`;

const WHILE_LOOP_HELP = WHILE_HELP
  .replace("WHILE programs compute on integers", "WHILE + LOOP programs: WHILE programs with LOOP in addition, on integers")
  .replace("  WHILE (x != 0) { P }", `  LOOP (x) { P }        repeat P exactly n times, n = value of x at the start
                        (n <= 0: not at all; x must have a value: an input, or assigned before)
  WHILE (x != 0) { P }`);

LANGUAGES.push({
  id: "while",
  name: "WHILE",
  integers: true,
  help: WHILE_HELP,

  parse: parseWhile,
  run: runWhile,
  keywords: WHILE_KEYWORDS,
  keywordsAnyCase: true,
  signature: program => ({ inputs: program.inputs, output: program.output }),
  examples: [
    {
      name: "Addition", inputs: "3, 4", code:
`PROGRAM Addition
INPUT x, y
OUTPUT z
REQUIRES x >= 0 AND y >= 0

z = 0
WHILE (x != 0) {
  z = z + 1
  x = x - 1
}
WHILE (y != 0) {
  z = z + 1
  y = y - 1
}
` },
    {
      name: "Subtraction", inputs: "3, 5", code:
`PROGRAM Subtraction
INPUT x, y
OUTPUT diff
REQUIRES x >= 0 AND y >= 0

diff = 0
WHILE (x != 0) {        // diff = x
  diff = diff + 1
  x = x - 1
}
WHILE (y != 0) {        // diff = diff - y, may become negative
  diff = diff - 1
  y = y - 1
}
` },
    {
      name: "Multiplication", inputs: "3, 4", code:
`PROGRAM Multiplication
INPUT x, y
OUTPUT p
REQUIRES x >= 0 AND y >= 0

p = 0
WHILE (y != 0) {
  t = 0
  WHILE (x != 0) {      // p = p + x, and x is moved to t
    p = p + 1
    t = t + 1
    x = x - 1
  }
  WHILE (t != 0) {      // move t back to x
    x = x + 1
    t = t - 1
  }
  y = y - 1
}
` },
    {
      name: "Fibonacci", inputs: "10", code:
`PROGRAM Fibonacci
INPUT n
OUTPUT f
REQUIRES n >= 0

// fib(0) = 0, fib(1) = 1, fib(i+2) = fib(i) + fib(i+1)
f = 0                   // fib(i)
g = 1                   // fib(i+1)
WHILE (n != 0) {
  // (f, g) = (g, f + g), with h as temporary
  h = 0
  WHILE (f != 0) {      // h = f, f = 0
    h = h + 1
    f = f - 1
  }
  WHILE (g != 0) {      // f = g, h = h + g, g = 0
    f = f + 1
    h = h + 1
    g = g - 1
  }
  WHILE (h != 0) {      // g = h
    g = g + 1
    h = h - 1
  }
  n = n - 1
}
` },
    {
      name: "Infinite loop", inputs: "1", code:
`PROGRAM InfiniteLoop
// Terminates only for n = 0 (try the step limit).
INPUT n
OUTPUT n

WHILE (n != 0) {
  n = n + 1
}
` },
    {
      name: "Ackermann", inputs: "2, 2", code:
`PROGRAM Ackermann
INPUT m, n
OUTPUT a
REQUIRES m >= 0 AND n >= 0

// a(0, n)         = n + 1
// a(m + 1, 0)     = a(m, 1)
// a(m + 1, n + 1) = a(m, a(m + 1, n))
//
// Without recursion: a stack of the pending values of m, stored in the
// single number s, with digits m + 1 in base B = m + 2 (the top of the stack
// is the last digit; s = 0 is the empty stack). Only x = c, x = x ± c and
// WHILE (x != 0) are used: an "IF" is a WHILE loop on a flag (0 or 1) that
// runs at most once, and a value is copied by moving it to a helper and back.

t = 0
c = 0
r = 0
q = 0
k = 0
z = 0
v = 0
caseA = 0
caseB = 0
caseC = 0
other = 0
vnz = 0

// B = m + 2, and the stack holds m: s = m + 1
B = 2
s = 1
WHILE (m != 0) { m = m - 1; B = B + 1; s = s + 1 }

WHILE (s != 0) {
  // ---- pop the top: v = (s mod B) - 1,  s = s div B
  q = 0
  v = 0
  k = 0                                   // k = B
  WHILE (B != 0) { B = B - 1; k = k + 1; c = c + 1 }
  WHILE (c != 0) { c = c - 1; B = B + 1 }
  WHILE (s != 0) {                        // walk s down; every B steps: q = q + 1
    s = s - 1
    v = v + 1
    k = k - 1
    z = 1                                 // z = 1 if k = 0
    WHILE (k != 0) { k = k - 1; t = t + 1; z = 0 }
    WHILE (t != 0) { t = t - 1; k = k + 1 }
    WHILE (z != 0) {                      // IF k = 0: a whole block of B
      z = 0
      q = q + 1
      v = 0
      WHILE (B != 0) { B = B - 1; k = k + 1; c = c + 1 }
      WHILE (c != 0) { c = c - 1; B = B + 1 }
    }
  }
  WHILE (q != 0) { q = q - 1; s = s + 1 } // s = q
  v = v - 1                               // the digit was v + 1

  // ---- which case?  A: v = 0   B: v > 0, n = 0   C: v > 0, n > 0
  caseA = 1
  other = 0
  WHILE (v != 0) { v = v - 1; t = t + 1; caseA = 0; other = 1 }
  WHILE (t != 0) { t = t - 1; v = v + 1 }
  caseB = 0
  caseC = 0
  vnz = 0
  WHILE (other != 0) {                    // IF v > 0: test n
    other = 0
    vnz = 1
    caseB = 1
    WHILE (n != 0) { n = n - 1; t = t + 1; caseB = 0; caseC = 1 }
    WHILE (t != 0) { t = t - 1; n = n + 1 }
  }

  WHILE (caseA != 0) {                    // a(0, n) = n + 1
    caseA = 0
    n = n + 1
  }
  WHILE (vnz != 0) {                      // v > 0: push v - 1, i.e. s = s * B + v
    vnz = 0
    r = 0
    WHILE (s != 0) {
      s = s - 1
      WHILE (B != 0) { B = B - 1; r = r + 1; c = c + 1 }
      WHILE (c != 0) { c = c - 1; B = B + 1 }
    }
    WHILE (v != 0) { v = v - 1; r = r + 1; t = t + 1 }
    WHILE (t != 0) { t = t - 1; v = v + 1 }
    WHILE (r != 0) { r = r - 1; s = s + 1 }
  }
  WHILE (caseB != 0) {                    // a(v, 0) = a(v - 1, 1)
    caseB = 0
    n = 1
  }
  WHILE (caseC != 0) {                    // a(v, n) = a(v - 1, a(v, n - 1)):
    caseC = 0                             // also push v, i.e. s = s * B + v + 1
    r = 0
    WHILE (s != 0) {
      s = s - 1
      WHILE (B != 0) { B = B - 1; r = r + 1; c = c + 1 }
      WHILE (c != 0) { c = c - 1; B = B + 1 }
    }
    WHILE (v != 0) { v = v - 1; r = r + 1; t = t + 1 }
    WHILE (t != 0) { t = t - 1; v = v + 1 }
    r = r + 1
    WHILE (r != 0) { r = r - 1; s = s + 1 }
    n = n - 1
  }
}

a = 0                                     // the result
WHILE (n != 0) { n = n - 1; a = a + 1 }
` },
  ],
});

LANGUAGES.push({
  id: "whileloop",
  name: "WHILE + LOOP",
  integers: true,
  help: WHILE_LOOP_HELP,
  parse: code => parseWhile(code, true),
  run: runWhile,
  keywords: WHILE_LOOP_KEYWORDS,
  keywordsAnyCase: true,
  signature: program => ({ inputs: program.inputs, output: program.output }),
  examples: [
    {
      name: "Sum 1 + … + n", inputs: "4", code:
`PROGRAM Sum
INPUT n
OUTPUT s
REQUIRES n >= 0

// s = n + (n - 1) + … + 1: WHILE counts n down, LOOP adds n to s
s = 0
WHILE (n != 0) {
  LOOP (n) {
    s = s + 1
  }
  n = n - 1
}
` },
  ],
});
