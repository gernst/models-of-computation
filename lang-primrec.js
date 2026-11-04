"use strict";
// Primitive recursive functions, written with the combinators
// zero, succ, pi[n,i], COMP(f, g1, ..., gm) and REC(g, h);
// and MUREC: the same with the minimization operator mu(f) in addition.

const PR_RESERVED = ["zero", "succ", "pi", "COMP", "REC"];
const MU_RESERVED = [...PR_RESERVED, "mu"];

// ---------------------------------------------------------------- parser (also checks arities)

function parsePrimRec(code, withMu = false) {
  const p = new Parser(code);
  p.withMu = withMu;
  const reserved = withMu ? MU_RESERVED : PR_RESERVED;
  const defs = new Map();
  let last = null;
  while (!p.done()) {
    const t = p.next();
    if (t.type !== "id") throw new LangError(`expected a function name but found '${t.value}'`, t.line);
    if (reserved.includes(t.value)) throw new LangError(`'${t.value}' is built in and cannot be redefined`, t.line);
    if (defs.has(t.value)) throw new LangError(`'${t.value}' is already defined`, t.line);
    p.expect("=");
    const term = parsePRTerm(p, defs);
    last = { name: t.value, term, arity: term.arity, line: t.line };
    defs.set(t.value, last);
  }
  const main = defs.get("main") ?? last;
  if (!main) throw new LangError("the program defines no function", 1);
  return { main };
}

function smallNumber(p) {
  const line = p.line();
  const n = p.number();
  if (n > 1000n) throw new LangError("number too large", line);
  return Number(n);
}

function parsePRTerm(p, defs) {
  const t = p.next();
  const line = t.line;
  if (t.type !== "id") throw new LangError(`expected a function but found '${t.value}'`, line);
  switch (t.value) {
    case "succ":
      return { kind: "succ", arity: 1, line };
    case "zero": { // constant 0, or zero[n] with n arguments
      let n = 0;
      if (p.at("[")) { p.next(); n = smallNumber(p); p.expect("]"); }
      return { kind: "zero", arity: n, line };
    }
    case "pi": {
      p.expect("[");
      const n = smallNumber(p);
      p.expect(",");
      const i = smallNumber(p);
      p.expect("]");
      if (i < 1 || i > n) throw new LangError(`pi[${n},${i}]: need 1 ≤ ${i} ≤ ${n}`, line);
      return { kind: "proj", arity: n, i, line };
    }
    case "COMP": {
      p.expect("(");
      const f = parsePRTerm(p, defs);
      const gs = [];
      while (p.at(",")) { p.next(); gs.push(parsePRTerm(p, defs)); }
      p.expect(")");
      if (gs.length === 0) throw new LangError("COMP needs at least two functions: COMP(f, g1, …, gm)", line);
      if (gs.length !== f.arity)
        throw new LangError(`COMP: the first function has arity ${f.arity}, so it needs exactly ${f.arity} more function(s), but ${gs.length} given`, line);
      const n = gs[0].arity;
      gs.forEach((g, k) => {
        if (g.arity !== n)
          throw new LangError(`COMP: g1, …, gm must have the same arity, but g1 has arity ${n} and g${k + 1} has arity ${g.arity}`, line);
      });
      return { kind: "comp", f, gs, arity: n, line };
    }
    case "REC": {
      p.expect("(");
      const g = parsePRTerm(p, defs);
      p.expect(",");
      const h = parsePRTerm(p, defs);
      p.expect(")");
      if (h.arity !== g.arity + 2)
        throw new LangError(`REC(g, h): g has arity ${g.arity}, so h must have arity ${g.arity + 2}, but it has arity ${h.arity}`, line);
      return { kind: "pr", g, h, arity: g.arity + 1, line };
    }
    case "mu": {
      if (!p.withMu) break; // in PRIMREC, mu is an ordinary name
      p.expect("(");
      const f = parsePRTerm(p, defs);
      p.expect(")");
      if (f.arity < 1) throw new LangError("mu(f): f needs at least one argument (the one to search)", line);
      return { kind: "mu", f, arity: f.arity - 1, line };
    }
  }
  // a function defined earlier
  const def = defs.get(t.value);
  if (!def && t.value === "mu") throw new LangError("mu is not part of PRIMREC; use the language MUREC", line);
  if (!def) throw new LangError(`unknown function '${t.value}' (functions must be defined before they are used)`, line);
  return { kind: "call", def, arity: def.arity, line };
}

// ---------------------------------------------------------------- interpreter

function runPrimRec(program, inputs, ctx) {
  requireNaturals(inputs);
  const main = program.main;
  if (inputs.length !== main.arity)
    throw new LangError(`${main.name} has arity ${main.arity}, so it needs ${main.arity} input(s), but ${inputs.length} given`, main.line);
  return callPR(main, inputs, ctx);
}

function callPR(def, args, ctx) {
  const r = evalPR(def.term, args, ctx);
  record(ctx, def.line, () => `${def.name}(${args.join(", ")}) = ${r}`);
  return r;
}

function evalPR(t, args, ctx) {
  tick(ctx);
  switch (t.kind) {
    case "zero": return 0n;
    case "succ": return args[0] + 1n;
    case "proj": return args[t.i - 1];
    case "comp": return evalPR(t.f, t.gs.map(g => evalPR(g, args, ctx)), ctx);
    case "pr": {
      // f(x̄, 0) = g(x̄),  f(x̄, y+1) = h(x̄, y, f(x̄, y))
      const xs = args.slice(0, -1), y = args[args.length - 1];
      let r = evalPR(t.g, xs, ctx);
      for (let i = 0n; i < y; i++) r = evalPR(t.h, [...xs, i, r], ctx);
      return r;
    }
    case "call": return callPR(t.def, args, ctx);
    case "mu": // the least y with f(x̄, y) = 0; runs forever if there is none (step limit)
      for (let y = 0n; ; y++) if (evalPR(t.f, [...args, y], ctx) === 0n) return y;
  }
}

// ---------------------------------------------------------------- languages

const PRIMREC_HELP = `A program is a list of definitions   name = term,
optionally preceded by a line  PROGRAM name  (the name of the program).
The function named 'main' (otherwise the last one) is evaluated.

  zero                  the constant 0 (arity 0);  zero[n]: constant 0 with n arguments
  succ                  successor: succ(x) = x + 1
  pi[n,i]               projection: pi[n,i](x1, …, xn) = xi
  COMP(f, g1, …, gm)    composition: f(g1(x̄), …, gm(x̄))
                        (f has arity m, all gi have the same arity n)
  REC(g, h)             primitive recursion on the last argument:
                          f(x̄, 0)   = g(x̄)
                          f(x̄, y+1) = h(x̄, y, f(x̄, y))
  name                  a function defined earlier (no recursion by name)

Arities are checked before running. Comments: // until the end of the line.
In ENSURES / REQUIRES, x1, x2, … are the arguments and x0 is the result`;

const MUREC_HELP = PRIMREC_HELP.replace("  name                  a function defined earlier", `  mu(f)                 minimization on the last argument:
                          mu(f)(x̄) = the least y with f(x̄, y) = 0
                        (if there is none, the computation does not stop)
  name                  a function defined earlier`);

LANGUAGES.push({
  id: "primrec",
  name: "PRIMREC",
  help: PRIMREC_HELP,

  parse: parsePrimRec,
  run: runPrimRec,
  keywords: PR_RESERVED,
  signature: program => ({
    inputs: Array.from({ length: program.main.arity }, (_, i) => "x" + (i + 1)),
    output: "x0",
  }),
  examples: [
    {
      name: "Addition", inputs: "3, 4", code:
`PROGRAM Addition

// add(x, 0)   = x
// add(x, y+1) = succ(add(x, y))

add = REC(pi[1,1], COMP(succ, pi[3,3]))
` },
    {
      name: "Predecessor", inputs: "5", code:
`PROGRAM Predecessor

// pred(0)   = 0
// pred(y+1) = y

pred = REC(zero, pi[2,1])
` },
  ],
});

LANGUAGES.push({
  id: "murec",
  name: "MUREC",
  help: MUREC_HELP,
  parse: code => parsePrimRec(code, true),
  run: runPrimRec,
  keywords: MU_RESERVED,
  signature: program => ({
    inputs: Array.from({ length: program.main.arity }, (_, i) => "x" + (i + 1)),
    output: "x0",
  }),
  examples: [
    {
      name: "Count up", inputs: "5", code:
`PROGRAM CountUp

// mu tries y = 0, 1, 2, … until f(x, y) = 0.
// With f(x, y) = x - y (at least 0), that happens first for y = x:
// mu counts up from 0 to x.

pred  = REC(zero, pi[2,1])                 // pred(y)   = y - 1 (at least 0)
sub   = REC(pi[1,1], COMP(pred, pi[3,3]))  // sub(x, y) = x - y (at least 0)
count = mu(sub)
` },
    {
      name: "Square root", inputs: "10", code:
`PROGRAM SquareRoot

// sqrt(x) = the least y with (y+1) * (y+1) > x,
//         = mu of  f(x, y) = (x+1) - (y+1) * (y+1)   (subtraction stops at 0)

add    = REC(pi[1,1], COMP(succ, pi[3,3]))         // add(x, y)  = x + y
mul    = REC(zero[1], COMP(add, pi[3,1], pi[3,3])) // mul(x, y)  = x * y
pred   = REC(zero, pi[2,1])                        // pred(y)    = y - 1
sub    = REC(pi[1,1], COMP(pred, pi[3,3]))         // sub(x, y)  = x - y, at least 0
square = COMP(mul, succ, succ)                     // square(y)  = (y+1) * (y+1)
f      = COMP(sub, COMP(succ, pi[2,1]), COMP(square, pi[2,2]))
sqrt   = mu(f)
` },
    {
      name: "Collatz", inputs: "6", code:
`PROGRAM Collatz

// steps(n) = how many steps of  n -> n/2 (n even), 3n+1 (n odd)  lead to 1.
// mu searches for the first such step count. Nobody knows a bound for it:
// whether steps is total is the open Collatz conjecture, so LOOP cannot do it.

add     = REC(pi[1,1], COMP(succ, pi[3,3]))            // x + y
pred    = REC(zero, pi[2,1])                           // y - 1 (at least 0)
sub     = REC(pi[1,1], COMP(pred, pi[3,3]))            // x - y (at least 0)
odd     = REC(zero, COMP(sub, COMP(succ, zero[2]), pi[2,2]))  // 1 if y is odd, else 0
half    = REC(zero, COMP(add, pi[2,2], COMP(odd, pi[2,1])))   // y / 2, rounded down
triple1 = COMP(succ, COMP(add, pi[1,1], COMP(add, pi[1,1], pi[1,1])))  // 3n + 1
cond    = REC(pi[2,2], pi[4,1])                        // cond(a, b, p) = a if p > 0, else b
collatz = COMP(cond, triple1, half, odd)               // one step
iter    = REC(pi[1,1], COMP(collatz, pi[3,3]))         // iter(n, y) = y steps from n
f       = COMP(pred, iter)                             // 0 once iter(n, y) <= 1
steps   = mu(f)
` },
    {
      name: "Undefined", inputs: "3", code:
`PROGRAM Undefined

// mu searches forever if there is no y with f(x, y) = 0:
// here f(x, y) = y + 1 is never 0 (try the step limit).
f = COMP(succ, pi[2,2])
g = mu(f)
` },
  ],
});
