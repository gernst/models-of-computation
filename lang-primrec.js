"use strict";
// Primitive recursive functions, written with the combinators
// zero, succ, pi[n,i], COMP(f, g1, ..., gm) and REC(g, h).

const PR_RESERVED = ["zero", "succ", "pi", "COMP", "REC"];

// ---------------------------------------------------------------- parser (also checks arities)

function parsePrimRec(code) {
  const p = new Parser(code);
  const defs = new Map();
  let last = null;
  while (!p.done()) {
    const t = p.next();
    if (t.type !== "id") throw new LangError(`expected a function name but found '${t.value}'`, t.line);
    if (PR_RESERVED.includes(t.value)) throw new LangError(`'${t.value}' is built in and cannot be redefined`, t.line);
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
    default: {
      const def = defs.get(t.value);
      if (!def) throw new LangError(`unknown function '${t.value}' (functions must be defined before they are used)`, line);
      return { kind: "call", def, arity: def.arity, line };
    }
  }
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
  }
}

// ---------------------------------------------------------------- language

LANGUAGES.push({
  id: "primrec",
  name: "PRIMREC",
  help: `A program is a list of definitions   name = term
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
In ENSURES / REQUIRES, x1, x2, … are the arguments and x0 is the result.`,
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
`// add(x, 0)   = x
// add(x, y+1) = succ(add(x, y))

add = REC(pi[1,1], COMP(succ, pi[3,3]))
` },
    {
      name: "Predecessor", inputs: "5", code:
`// pred(0)   = 0
// pred(y+1) = y

pred = REC(zero, pi[2,1])
` },
  ],
});
