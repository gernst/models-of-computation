# Computability Workbench

A web page where you write and run LOOP and WHILE programs and primitive recursive functions, and test them against a specification.
It is plain HTML and JavaScript: no build step, no dependencies, no server.

## Use

Open `index.html` in a browser (double-click works).

- **Run** (Ctrl+Enter) executes the program on the given inputs and lists all variables, one per line.
- The **step limit** stops non-terminating programs.
- **Trace** shows the variable values after each step (or each function call, for primitive recursion).
- **Check** runs the program on all inputs from 0 to N and tests the specification:
  ```
  INPUT x, y
  OUTPUT quotient
  REQUIRES y > 0
  ENSURES  quotient == x / y
  ```
  This is testing, not a proof.
- Every program the user writes or edits is kept in the browser (`localStorage`, no limit) and listed under "Your programs" in the Example menu; unchanged examples are not stored. Loading an example never deletes anything, and Delete can be undone. Shared programs are never changed: editing one creates a copy. On page load (and when switching languages), the example or program that was open last is shown again; if there is none, the most recently edited program, else the first example. Export and import of programs (`transfer.js`) is implemented but disabled: `index.html` does not load it, so it is not part of the page or the bundle. Increasing `STORAGE_VERSION` in `programs.js` deletes all saved programs, so only do that if the stored format changes; changed examples need no new version.

## Files

| File | Contents |
|---|---|
| `index.html`, `style.css` | the page |
| `impressum.html` | legal notice and privacy note (fill in the server privacy-policy link before publishing) |
| `app.js` | UI glue; it knows nothing about specific languages |
| `common.js` | tokenizer, `Parser` helper, step counting, INPUT/OUTPUT header and variables, `ENSURES`/`REQUIRES` checker |
| `lang-loop.js` | LOOP over the natural numbers |
| `lang-while.js` | WHILE over the integers |
| `lang-primrec.js` | PRIMREC, primitive recursion: `zero`, `succ`, `pi[n,i]`, `COMP(…)`, `REC(g,h)` |
| `lang-primfun.js` | PRIMFUN: primitive recursion as equations, `FUN f(x, y + 1) = …` |
| `programs.js` | the user's programs in the browser (history, Delete) |
| `transfer.js` | export and import of programs as a file; **disabled** (not loaded by `index.html`) |
| `permalink.js` | permalinks: stored with `save-perma.php`, loaded from `experiments/perma/<id>.prog`; `PERMALINK_SERVER = "./"`: next to the page (off when opened as a file) |
| `test.js` | `node test.js` runs every example and some unit tests |

## Adding a language

1. Create `lang-foo.js` that pushes one object:

   ```js
   LANGUAGES.push({
     id: "foo",                     // used for saving code in the browser
     name: "FOO",                   // shown in the dropdown
     help: "syntax summary …",      // shown under "Syntax help"
     examples: [{ name: "Addition", inputs: "3, 4", code: "…" }],
     parse(code) { … return program; },          // throw new LangError(msg, line) on errors
     run(program, inputs, ctx) { … return result; }, // inputs: BigInt[]; call tick(ctx) once per step;
                                                     // optionally set ctx.vars = Map(name → value) to list variables
     keywords: ["FOO", "BAR"],      // highlighted in the editor (add keywordsAnyCase: true if case does not matter)
     signature: program => ({ inputs: ["x", "y"], output: "sum" }), // optional; default x1, x2, … and x0
   });
   ```

2. Add `<script src="lang-foo.js"></script>` to `index.html`, before `app.js`.
3. Run `node test.js`. Every example is run; add its specification to `SPECS` in `test.js` to have it checked as well.

Helpers from `common.js`:
- `new Parser(code)` with `peek`, `next`, `at`, `atKeyword`, `expect`, `expectKeyword`, `number` and `error`.
- `tick(ctx)` enforces the step limit.
- `record(ctx, line, () => text)` adds a line to the trace.

`lang-loop.js` or `lang-while.js` (about 100 lines each) are good templates.
A GOTO language, for example, needs only a new parser and a loop over a program counter.

## Single file

`node bundle.js` writes `tcs-workbench-<version>.html`: the whole tool (HTML, CSS, all JavaScript and the Impressum) in one file that works offline and can be sent around or opened directly.

## Version

The version number is shown at the top right of the page (`<span class="version">` in `index.html`). It is updated when a major change is committed.

## Deploy

Copy these files to any web server, for example:

```bash
rsync -av *.html style.css *.js user@server:public_html/workbench/
```

You can also push to GitHub or GitLab and enable Pages for the repository root.

## Conventions (adjust to match the lecture)

- **LOOP** computes on natural numbers, and the number of `LOOP (x)` iterations is fixed when the loop starts.
- **WHILE** computes on integers. Like LOOP it has no general assignment: only `x = c`, `x = x + c` and `x = x - c` (ordinary subtraction, may become negative); inputs may be negative, and `Check` tests inputs from -N to N. WHILE programs contain no LOOP and no IF; conditions are single tests `(x != 0)`. (Functions with `FUN … RETURN` are still implemented in `lang-while.js` but no longer documented or used in the examples.)
- **WHILE + LOOP** is WHILE with `LOOP (x) { … }` in addition (defined in `lang-while.js`, same parser with a flag): the number of iterations is the value of x at the start, none if it is 0 or negative; LOOP over a variable without a value is an error, as in LOOP.
- **LOOP** has no general assignment: the only statements are `x = c` (reset), `x = x + c` (increment) and `LOOP (x) { … }`. Copying and subtraction are programmed with loops.
- **Static checks (LOOP/WHILE):** a variable has a value if it is an input or certainly assigned before (assignments in loop bodies do not count after the loop). `LOOP (x)` over a variable without a value is an error; reading one is a warning, shown above the result.
- **All languages:** an optional first line `PROGRAM <name>` names the program (only comments may come before it); the name is shown in the Example menu under "Your programs".
- **LOOP/WHILE:** variables can have any name. The optional header `INPUT a, b` / `OUTPUT c` names the inputs and the result (default `x1, x2, …` and `x0`); all other variables start at 0. Loop bodies use braces: `LOOP (x1) { … }` and `WHILE (x1 != 0) { … }`. Keywords can be in any case. Assignments are written `x = y + 1` (`:=` is accepted too). Semicolons between statements are optional (one statement per line by convention).
- **PRIMREC:** natural numbers; recursion is on the *last* argument: `f(x̄,0) = g(x̄)`, `f(x̄,y+1) = h(x̄, y, f(x̄,y))`.
- **PRIMFUN** (`lang-primfun.js`) is primitive recursion written as equations: `FUN f(x, 0) = e0` followed by `FUN f(x, y + 1) = e1`, where `e1` may use `f` only as `f(x, y)`; also `FUN f(x, y) = e` without recursion. Expressions are numbers, variables, `succ(e)` and calls of functions defined before; no projections. In ENSURES, inputs are named like the parameters of the main function and the result like the function.
- **MUREC** is PRIMREC with the minimization operator `mu(f)` in addition (same parser with a flag, in `lang-primrec.js`): `mu(f)(x̄)` is the least y with `f(x̄, y) = 0`; if there is none, the search does not stop (step limit).
- **Steps:** a step is one executed assignment, loop iteration or WHILE test, or one function application or call.

## License

Copyright 2026 Gidon Ernst. Licensed under the Apache License, Version 2.0; see [LICENSE](LICENSE).
