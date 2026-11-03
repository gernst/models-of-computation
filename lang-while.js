"use strict";
// WHILE programs over the integers.

const WHILE_KEYWORDS = ["WHILE", "IF", "THEN", "ELSE", "AND", "OR", "NOT", "INPUT", "OUTPUT", "FUN", "RETURN"];
const MAX_DEPTH = 1000; // maximal nesting of function calls

// ---------------------------------------------------------------- parser

/** Program ::= [INPUT var, …, var] [OUTPUT var] (Stmt | Fun)* */
function parseWhile(code) {
  const p = new Parser(code);
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
  return { ...header, vars: [...p.vars], body, funs: p.funs };
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

/**
 * Condition ::= ( Or )      Or ::= And (OR And)*      And ::= Test (AND Test)*
 * Test ::= var != 0 | NOT Test | ( Or )
 * Returns { var }, { op: "NOT", left } or { op: "AND" | "OR", left, right }.
 */
function parseCondition(p) {
  p.expect("(");
  const c = parseOr(p);
  if (p.at("&&") || p.at("||")) p.error("write AND and OR instead of && and ||");
  p.expect(")");
  return c;
}

function parseOr(p) {
  let c = parseAnd(p);
  while (p.atKeyword("OR")) { p.next(); c = { op: "OR", left: c, right: parseAnd(p) }; }
  return c;
}

function parseAnd(p) {
  let c = parseTest(p);
  while (p.atKeyword("AND")) { p.next(); c = { op: "AND", left: c, right: parseTest(p) }; }
  return c;
}

function parseTest(p) {
  if (p.at("(")) return parseCondition(p);
  if (p.atKeyword("NOT")) { p.next(); return { op: "NOT", left: parseTest(p) }; }
  if (p.at("&&") || p.at("||") || p.at("!")) p.error("write AND, OR and NOT instead of &&, || and !");
  const line = p.line();
  const x = whileVar(p);
  const op = p.next();
  if (!["!=", "≠", "<>"].includes(op.value))
    throw new LangError(`expected '!=' after '${x}' but found '${op.value}'`, op.line);
  if (p.number() !== 0n) throw new LangError("only tests of the form 'x != 0' are allowed", line);
  return { var: x };
}

function evalCondition(c, env) {
  if (c.var !== undefined) return env.get(c.var) !== 0n;
  if (c.op === "NOT") return !evalCondition(c.left, env);
  return c.op === "AND" ? evalCondition(c.left, env) && evalCondition(c.right, env)
                       : evalCondition(c.left, env) || evalCondition(c.right, env);
}

/** For the trace: the condition as text, and the values of its variables. */
function showCondition(c, env, top = true) {
  const text = c.var !== undefined ? `${c.var} != 0`
    : c.op === "NOT" ? `NOT ${showCondition(c.left, env, false)}`
    : `${showCondition(c.left, env, false)} ${c.op} ${showCondition(c.right, env, false)}`;
  if (!top) return c.op === "AND" || c.op === "OR" ? `(${text})` : text;
  const vars = [];
  const walk = d => {
    if (!d) return;
    if (d.var !== undefined) { if (!vars.includes(d.var)) vars.push(d.var); }
    else { walk(d.left); walk(d.right); }
  };
  walk(c);
  return `(${text}): ` + vars.map(x => `${x} = ${env.get(x)}`).join(", ");
}

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
  if (t.type !== "id" || WHILE_KEYWORDS.includes(t.value.toUpperCase()))
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

  if (p.atKeyword("IF")) {
    p.next();
    const x = parseCondition(p);
    if (p.atKeyword("THEN")) p.next(); // optional
    const then = parseBraces(p);
    let otherwise = [];
    if (p.atKeyword("ELSE")) { p.next(); otherwise = parseBraces(p); }
    return { type: "if", x, then, otherwise, line };
  }
  if (p.atKeyword("ELSE") || p.atKeyword("THEN")) p.error(`${p.peek().value} without IF`);

  if (p.atKeyword("LOOP")) p.error("LOOP is not part of WHILE programs here; use WHILE");
  if (p.atKeyword("INPUT") || p.atKeyword("OUTPUT")) p.error("INPUT and OUTPUT must come before the first statement");
  if (p.atKeyword("FUN")) p.error("functions can only be defined at the top level, not inside a block or function");
  if (p.atKeyword("RETURN")) p.error("RETURN is only allowed as the last statement of a function");

  // assignment:  x = y + c  |  x = y - c  |  x = y  |  x = c  |  x = f(a, …)
  const x = whileVar(p);
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
  const y = whileVar(p);
  if (p.at("+") || p.at("-")) {
    const op = p.next().value;
    return { type: "assign", x, y, op, c: p.number(), line };
  }
  return { type: "assign", x, y, op: "+", c: 0n, line };
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
    } else if (s.type === "if") {
      tick(ctx);
      const b = evalCondition(s.x, env);
      record(ctx, s.line, () => `${where}IF ${showCondition(s.x, env)} → ${b ? "then" : s.otherwise.length ? "else" : "skip"}`);
      execWhile(b ? s.then : s.otherwise, env, ctx, frame);
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

// ---------------------------------------------------------------- language

LANGUAGES.push({
  id: "while",
  name: "WHILE",
  integers: true,
  help: `WHILE programs compute on integers …, -2, -1, 0, 1, 2, …

Header (optional):
  INPUT a, b            the inputs, in this order   (default: x1, x2, …)
  OUTPUT c              the result                  (default: x0)

Statements (keywords in any case; one per line, or separated by optional semicolons):
  x = y + c             x = y - c      (ordinary subtraction: may become negative)
  x = y                 x = c
  WHILE (x != 0) { P }  repeat P as long as x is not 0
  IF (x != 0) THEN { P } ELSE { Q }
                        if x is not 0 do P, else Q   (THEN and ELSE { Q } are optional)
  x = f(a, b)           call function f; arguments are variables or numbers

Conditions are tests  x != 0, combined with AND, OR, NOT and parentheses:
  WHILE (x != 0 AND (y != 0 OR NOT z != 0)) { P }

Functions (at the top level, before or after the main program; may be recursive):
  FUN f(a, b) {
    P
    RETURN r            must be the last line
  }
Parameters are passed by value; all other variables of a function are local and start at 0.

Variables can have any name; all non-input variables start at 0.
Comments: // until the end of the line.`,
  parse: parseWhile,
  run: runWhile,
  keywords: WHILE_KEYWORDS,
  keywordsAnyCase: true,
  signature: program => ({ inputs: program.inputs, output: program.output }),
  examples: [
    {
      name: "Addition", inputs: "3, 4", code:
`INPUT x, y
OUTPUT z
REQUIRES x >= 0 && y >= 0

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
`INPUT x, y
OUTPUT diff
REQUIRES y >= 0

diff = x
WHILE (y != 0) {
  diff = diff - 1
  y = y - 1
}
` },
    {
      name: "Absolute value", inputs: "-3", code:
`INPUT x
OUTPUT abs

// The only test is "!= 0", so count up and down at the same time:
// up reaches 0 if x < 0, down reaches 0 if x > 0.
abs = 0
up = x
down = x
WHILE (up != 0 AND down != 0) {
  abs = abs + 1
  up = up + 1
  down = down - 1
}
` },
    {
      name: "Multiplication (function)", inputs: "3, 4", code:
`INPUT x, y
OUTPUT p
REQUIRES x >= 0 && y >= 0

FUN add(a, b) {
  WHILE (b != 0) {
    a = a + 1
    b = b - 1
  }
  RETURN a
}

p = 0
WHILE (y != 0) {
  p = add(p, x)
  y = y - 1
}
` },
    {
      name: "Fibonacci (recursive)", inputs: "10", code:
`INPUT n
OUTPUT f
REQUIRES n >= 0

FUN add(a, b) {
  WHILE (b != 0) {
    a = a + 1
    b = b - 1
  }
  RETURN a
}

// fib(0) = 0, fib(1) = 1, fib(n) = fib(n-1) + fib(n-2)
FUN fib(n) {
  IF (n != 0) THEN {
    m = n - 1
    IF (m != 0) THEN {    // n >= 2
      a = fib(m)
      k = m - 1
      b = fib(k)
      r = add(a, b)
    } ELSE {              // n = 1
      r = 1
    }
  } ELSE {                // n = 0
    r = 0
  }
  RETURN r
}

f = fib(n)
` },
    {
      name: "Infinite loop", inputs: "1", code:
`// Terminates only for n = 0 (try the step limit).
INPUT n
OUTPUT n

WHILE (n != 0) {
  n = n + 1
}
` },
  ],
});
