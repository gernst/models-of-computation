"use strict";
// LOOP programs over the natural numbers.

const LOOP_KEYWORDS = ["LOOP", "INPUT", "OUTPUT"];

// ---------------------------------------------------------------- parser

/** Program ::= [INPUT var, …, var] [OUTPUT var] Stmt* */
function parseLoop(code) {
  const p = new Parser(code);
  p.vars = new Set();
  const header = parseHeader(p, loopVar);
  const body = parseLoopBlock(p);
  if (!p.done()) p.error("'}' without matching '{'");
  return { ...header, vars: [...p.vars], body };
}

/** A sequence of statements, optionally separated by semicolons. */
function parseLoopBlock(p) {
  const stmts = [];
  for (p.skipSemicolons(); !p.done() && !p.at("}"); p.skipSemicolons()) stmts.push(parseLoopStmt(p));
  return stmts;
}

function loopVar(p) {
  const t = p.next();
  if (t.type !== "id" || LOOP_KEYWORDS.includes(t.value.toUpperCase()))
    throw new LangError(`expected a variable but found '${t.value}'`, t.line);
  p.vars.add(t.value);
  return t.value;
}

function parseLoopStmt(p) {
  const line = p.line();

  if (p.atKeyword("LOOP")) {
    p.next();
    p.expect("(");
    const x = loopVar(p);
    p.expect(")");
    p.expect("{");
    const body = parseLoopBlock(p);
    p.expect("}");
    return { type: "loop", x, body, line };
  }

  if (p.atKeyword("WHILE")) p.error("WHILE is not allowed in LOOP programs");
  if (p.atKeyword("FUN")) p.error("functions (FUN) are not part of LOOP programs");
  if (p.atKeyword("INPUT") || p.atKeyword("OUTPUT")) p.error("INPUT and OUTPUT must come before the first statement");

  // only reset and increment:  x = c  |  x = x + c
  const x = loopVar(p);
  const only = `LOOP only has  ${x} = c  and  ${x} = ${x} + c  (c a number)`;
  if (p.at("=") || p.at(":=")) p.next(); // := is accepted, too
  else p.error(`expected '=' after '${x}'`);
  if (p.peek()?.type === "num") return { type: "assign", x, reset: true, c: p.number(), line };
  const t = p.peek();
  if (t?.type !== "id" || t.value !== x) p.error(only);
  p.next();
  if (!p.at("+")) p.error(only);
  p.next();
  if (p.peek()?.type !== "num") p.error(only);
  return { type: "assign", x, reset: false, c: p.number(), line };
}

// ---------------------------------------------------------------- interpreter

function runLoop(program, inputs, ctx) {
  requireNaturals(inputs);
  const env = initVars(program, inputs, ctx);
  execLoop(program.body, env, ctx);
  return env.get(program.output);
}

function execLoop(stmts, env, ctx) {
  for (const s of stmts) {
    if (s.type === "assign") {
      tick(ctx);
      env.set(s.x, s.reset ? s.c : env.get(s.x) + s.c);
      record(ctx, s.line, () => showVars(env));
    } else { // loop
      const n = env.get(s.x); // read once, at the start
      record(ctx, s.line, () => `LOOP (${s.x}): ${n} iteration(s)`);
      for (let i = 0n; i < n; i++) {
        tick(ctx);
        execLoop(s.body, env, ctx);
      }
    }
  }
}

// ---------------------------------------------------------------- language

LANGUAGES.push({
  id: "loop",
  name: "LOOP",
  help: `LOOP programs compute on natural numbers 0, 1, 2, …

Header (optional):
  INPUT a, b            the inputs, in this order   (default: x1, x2, …)
  OUTPUT c              the result                  (default: x0)

Statements (keywords in any case; one per line, or separated by optional semicolons):
  x = c                 set x to the number c        (usually x = 0)
  x = x + c             increment x by c             (usually x = x + 1)
  LOOP (x) { P }        repeat P exactly n times, n = value of x at the start

There are no other assignments: x = y, x = y + 1 or subtraction must be programmed with loops.
Variables can have any name; all non-input variables start at 0.
Comments: // until the end of the line.`,
  parse: parseLoop,
  run: runLoop,
  keywords: LOOP_KEYWORDS,
  keywordsAnyCase: true,
  signature: program => ({ inputs: program.inputs, output: program.output }),
  examples: [
    {
      name: "Addition", inputs: "3, 4", code:
`INPUT x, y
OUTPUT z

z = 0
LOOP (x) {
  z = z + 1
}
LOOP (y) {
  z = z + 1
}
` },
    {
      name: "Predecessor", inputs: "5", code:
`INPUT n
OUTPUT pred

// next counts the rounds; in each round, pred is set to the old value of next
pred = 0
next = 0
LOOP (n) {
  pred = 0                // pred = next, by counting up from 0
  LOOP (next) {
    pred = pred + 1
  }
  next = next + 1
}
` },
    {
      name: "Subtraction", inputs: "5, 2", code:
`INPUT x, y
OUTPUT d

// modified subtraction: x - y, but never below 0

// d = x  (copy by counting)
d = 0
LOOP (x) {
  d = d + 1
}

// y times: d = pred(d)
LOOP (y) {
  // p = pred(d), as in the Predecessor example
  p = 0
  n = 0
  LOOP (d) {
    p = 0
    LOOP (n) {
      p = p + 1
    }
    n = n + 1
  }
  // d = p  (copy by counting)
  d = 0
  LOOP (p) {
    d = d + 1
  }
}
` },
  ],
});
