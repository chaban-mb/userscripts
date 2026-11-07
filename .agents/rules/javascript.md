---
trigger: glob
globs: *.js
description: Modern JavaScript standards, asynchronous error handling, declarative data structures, and code hygiene.
---

# JavaScript Standards & Patterns

## 1. Modern Syntax & Style

- Use `const` and `let` instead of `var`.
- Prefer arrow functions for callbacks and short utility functions.
- Use template literals for string interpolation instead of concatenation.
- Use destructuring for objects and arrays to improve readability.
- Use the spread operator (`...`) for array and object cloning/merging.
- Prefer ES modules (`import`/`export`) or standard Userscript header requirements over CommonJS `require`.
- Use keyed collections (`Map`, `Set`) when unique element sets or non-string keys are required.
- Prefer functional array methods (`map`, `filter`, `find`, `some`, `every`, `includes`) over imperative loops.

---

## 2. Asynchronous Flows, Control Structures & Error Boundaries

- **Async/Await**: Use `async`/`await` instead of raw Promise chaining (`.then()`).
- **Declarative Lookup Tables**: Represent classifications, allowed values, exceptions, and dispatch logic declaratively (using `Set`, `Map`, or static lookup objects) rather than scattering ad-hoc inline conditionals (`if (val === 'a' || val === 'b')`).
- **Selective Nullish/Optional Chaining**: Use optional chaining (`?.`) and nullish coalescing (`??`) only when inputs cannot be controlled or known (e.g., external API payloads, dynamic 3rd-party DOM). Avoid defensive chaining or redundant `typeof` checks on internal contracts or known DOM APIs.
- **Error Boundaries**: Wrap `async`/`await` calls in `try`/`catch` at logical boundaries. Never catch errors blindly to mask failures; either recover cleanly at the local boundary or propagate descriptive errors with diagnostic context.
- **Standard Error Types**: Throw standard `Error` instances with clear operational messages.

---

## 3. Code Hygiene & Baseline Isolation

- **Clean Baseline Principle**: Never write production code to compensate for dirty or contaminated browser DOM state (e.g., elements injected by previous script runs or cancelled tests). Reload the target tab to restore a clean baseline rather than introducing defensive workarounds into production code.
- **Zero Transient Artifacts**: Production code must never contain temporary inspection helpers or scratch hacks.

