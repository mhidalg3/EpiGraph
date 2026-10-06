# Workflow Assurance Lab

Browser demonstration of semantic, compositional workflow assurance over a **fictional** company (Northstar). A typed model is compiled into a finite transition system; deterministic state exploration runs in a Web Worker and reports policy violations (P01–P06), replayable witness executions, the eight-subset automation composition, verified finite-catalog repairs (C1–C6) and explicit synthetic economics.

This is a finite-model demonstration. It is not a workflow executor, banking integration, probabilistic risk predictor or compliance certification. See `docs/design.md` for the implementation notes and `Workflow_Assurance_Design.md` for the full specification.

## Requirements

Node 22.20.0 (`.nvmrc`), npm 11.11.1. No credentials, database or network service is needed.

## Commands

```sh
npm install
npm run dev          # development server (Vite is local tooling only)
npm run test         # Vitest: model, engine and mutation suites
npm run build        # tsc --noEmit (app + node configs) then vite build → dist/
npm run preview      # serve dist/ locally
npx playwright install chromium
npm run test:e2e     # Playwright flows (starts `npm run dev` on 127.0.0.1:5173)
```

`dist/` is a static site (relative `base: './'`); serve it from any static host.

## Layout

- `src/model` schemas (Zod), types, ontology, semantic validation
- `src/fixtures` Northstar model, cases and assumptions (JSON)
- `src/engine` pure TypeScript engine: compile, transitions, evidence, policies, BFS exploration, witness replay, differential, composition, synthesis, value, report
- `src/workers` native Web Worker + message protocol
- `src/ui` React workspace (React Flow canvas, inspector, findings/composition/repairs/assumptions)
- `tests` Vitest (`model`, `engine`, `mutations`) and Playwright (`e2e`)
