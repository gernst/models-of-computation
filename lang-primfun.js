"use strict";
// PRIMFUN: primitive recursive functions written as equations, with variables instead of
// projections and ordinary function application instead of COMP:
//
//   FUN f(x̄) = e                    a definition without recursion
//   FUN f(x̄, 0)     = e0            primitive recursion on the last argument:
//   FUN f(x̄, y + 1) = e1            e1 may use f only as  f(x̄, y)
//
// Expressions: numbers, variables, succ(e), g(e1, …, en) for functions defined before.

const PF_RESERVED = ["FUN", "succ"];

// ---------------------------------------------------------------- parser

function parsePrimFun(code) {
  const p = new Parser(code);
  const defs = new Map();
  let last = null;
  while (!p.done()) {
    const eq = parseEquation(p, defs);
    if (eq.kind === "simple") {
      last = { name: eq.name, kind: "simple", arity: eq.params.length, params: eq.params, body: eq.body, line: eq.line };
    } else if (eq.kind === "base") {
      if (p.done() || !p.atKeyword("FUN"))
        throw new LangError(`after  FUN ${eq.name}(…, 0) = …  the equation  FUN ${eq.name}(…, y + 1) = …  must follow`, eq.line);
      const step = parseEquation(p, defs, eq);
      if (step.kind !== "step" || step.name !== eq.name)
        throw new LangError(`after  FUN ${eq.name}(…, 0) = …  the equation  FUN ${eq.name}(…, y + 1) = …  must follow`, step.line);
      last = { name: eq.name, kind: "rec", arity: eq.params.length + 1, base: eq, step, line: eq.line };
    } else {
      throw new LangError(`FUN ${eq.name}(…, ${eq.y} + 1) needs the equation  FUN ${eq.name}(…, 0) = …  right before it`, eq.line);
    }
    defs.set(last.name, last);
  }
  if (!last) throw new LangError("the program defines no function", 1);
  return { main: defs.get("main") ?? last };
}

/**
 * One equation  FUN name(params) = expr.  Returns { kind: "simple" | "base" | "step", name, params, … }.
 * `base` is the preceding equation for 0 when parsing the one for y + 1.
 */
function parseEquation(p, defs, base = null) {
  const line = p.expectKeyword("FUN").line;
  const nameTok = p.next();
  const name = nameTok.value;
  if (nameTok.type !== "id" || PF_RESERVED.includes(name)) throw new LangError(`expected a function name but found '${name}'`, nameTok.line);
  if (defs.has(name)) throw new LangError(`'${name}' is already defined`, nameTok.line);
  p.expect("(");
  const params = [];
  let kind = "simple", y = null;
  for (;;) {
    const t = p.next();
    if (t.type === "num") {
      if (t.value !== "0") throw new LangError("on the left, only 0 or y + 1 may be used, not other numbers", t.line);
      kind = "base";
    } else if (t.type === "id" && !PF_RESERVED.includes(t.value)) {
      if (params.includes(t.value) || t.value === y) throw new LangError(`variable '${t.value}' is used twice on the left`, t.line);
      if (p.at("+")) {
        p.next();
        const one = p.next();
        if (one.value !== "1") throw new LangError(`on the left, only  ${t.value} + 1  is allowed`, one.line);
        kind = "step";
        y = t.value;
      } else params.push(t.value);
    } else throw new LangError(`expected a variable, 0 or y + 1, but found '${t.value}'`, t.line);
    if (p.at(",")) {
      p.next();
      if (kind !== "simple") p.error("0 and y + 1 may only be the last argument: the recursion is on the last argument");
    } else break;
  }
  p.expect(")");
  p.expect("=");
  if (kind === "step" && (!base || base.name !== name))
    throw new LangError(`FUN ${name}(…, ${y} + 1) needs the equation  FUN ${name}(…, 0) = …  right before it`, line);
  if (kind === "step" && params.length !== base.params.length)
    throw new LangError(`the two equations of '${name}' must have the same number of arguments`, line);
  const vars = kind === "step" ? [...params, y] : params;
  const self = kind === "step" ? { name, args: vars } : null; // the only allowed use of the function itself
  const body = parsePFExpr(p, defs, vars, self, name);
  return { kind, name, params, y, body, line };
}

function parsePFExpr(p, defs, vars, self, current) {
  const t = p.next();
  if (t.type === "num") return { kind: "num", value: BigInt(t.value) };
  if (t.type !== "id") throw new LangError(`expected an expression but found '${t.value}'`, t.line);
  if (!p.at("(")) {
    if (!vars.includes(t.value)) throw new LangError(`unknown variable '${t.value}' (only the variables on the left can be used)`, t.line);
    return { kind: "var", name: t.value };
  }
  p.next();
  const args = [parsePFExpr(p, defs, vars, self, current)];
  while (p.at(",")) { p.next(); args.push(parsePFExpr(p, defs, vars, self, current)); }
  p.expect(")");
  if (t.value === "succ") {
    if (args.length !== 1) throw new LangError("succ has one argument", t.line);
    return { kind: "succ", arg: args[0] };
  }
  if (t.value === current) {
    const ok = self && args.length === self.args.length && args.every((a, i) => a.kind === "var" && a.name === self.args[i]);
    if (!ok) throw new LangError(self
      ? `the only recursive call allowed here is  ${current}(${self.args.join(", ")})`
      : `'${current}' cannot call itself here (recursion only in the equation for y + 1)`, t.line);
    return { kind: "self" };
  }
  const def = defs.get(t.value);
  if (!def) throw new LangError(`unknown function '${t.value}' (functions must be defined before they are used)`, t.line);
  if (def.arity !== args.length)
    throw new LangError(`'${t.value}' has ${def.arity} argument(s), but ${args.length} are given`, t.line);
  return { kind: "call", def, args, line: t.line };
}

// ---------------------------------------------------------------- interpreter

function runPrimFun(program, inputs, ctx) {
  requireNaturals(inputs);
  const main = program.main;
  if (inputs.length !== main.arity)
    throw new LangError(`${main.name} has ${main.arity} argument(s), but ${inputs.length} input(s) are given`, main.line);
  return callPF(main, inputs, ctx);
}

function callPF(def, args, ctx) {
  tick(ctx);
  let r;
  if (def.kind === "simple") {
    r = evalPF(def.body, bind(def.params, args), null, ctx);
  } else {
    // f(x̄, 0) = e0;  f(x̄, y + 1) = e1, where f(x̄, y) is the previous result
    const xs = args.slice(0, -1), n = args[args.length - 1];
    r = evalPF(def.base.body, bind(def.base.params, xs), null, ctx);
    for (let i = 0n; i < n; i++) {
      tick(ctx);
      const env = bind(def.step.params, xs);
      env.set(def.step.y, i);
      r = evalPF(def.step.body, env, r, ctx);
    }
  }
  record(ctx, def.line, () => `${def.name}(${args.join(", ")}) = ${r}`);
  return r;
}

function bind(names, values) {
  const env = new Map();
  names.forEach((x, i) => env.set(x, values[i]));
  return env;
}

function evalPF(e, env, previous, ctx) {
  switch (e.kind) {
    case "num": return e.value;
    case "var": return env.get(e.name);
    case "succ": return evalPF(e.arg, env, previous, ctx) + 1n;
    case "self": return previous;
    case "call": return callPF(e.def, e.args.map(a => evalPF(a, env, previous, ctx)), ctx);
  }
}

// ---------------------------------------------------------------- language

/** Inputs are named like the parameters of the main function, the result like the function. */
function primFunSignature(program) {
  const m = program.main;
  return { inputs: m.kind === "simple" ? m.params : [...m.step.params, m.step.y], output: m.name };
}

// right after PRIMREC in the language menu
LANGUAGES.splice(LANGUAGES.findIndex(l => l.id === "primrec") + 1, 0, {
  id: "primfun",
  name: "PRIMFUN",
  help: `Primitive recursive functions, written as equations.
A program is a list of function definitions, optionally preceded by  PROGRAM name.
The function named 'main' (otherwise the last one) is evaluated.

  FUN f(x, y) = e           a function without recursion
  FUN f(x, 0)     = e0      primitive recursion on the last argument:
  FUN f(x, y + 1) = e1        the two equations follow each other, and e1 may
                              use f only as  f(x, y)  (the result for y)

Expressions e:
  0, 1, 2, …                numbers
  x                         a variable from the left side
  succ(e)                   e + 1
  g(e1, …, en)              a function defined before (no other recursion)

Functions can have any number of arguments (x stands for all but the last).
Functions and variables can have any name; keywords are case-sensitive.
Comments: // until the end of the line.
In ENSURES / REQUIRES, the inputs are named like the parameters of the main function,
and the result like the function itself (e.g.  ENSURES add == x + y).`,
  parse: parsePrimFun,
  run: runPrimFun,
  keywords: PF_RESERVED,
  signature: primFunSignature,
  examples: [
    {
      name: "Addition", inputs: "3, 4", code:
`PROGRAM Addition

FUN add(x, 0)     = x
FUN add(x, y + 1) = succ(add(x, y))
` },
    {
      name: "Predecessor", inputs: "5", code:
`PROGRAM Predecessor

FUN pred(0)     = 0
FUN pred(y + 1) = y
` },
    {
      name: "Factorial", inputs: "5", code:
`PROGRAM Factorial

FUN add(x, 0)     = x
FUN add(x, y + 1) = succ(add(x, y))

FUN mul(x, 0)     = 0
FUN mul(x, y + 1) = add(mul(x, y), x)

FUN fac(0)     = 1
FUN fac(y + 1) = mul(fac(y), succ(y))
` },
  ],
});
