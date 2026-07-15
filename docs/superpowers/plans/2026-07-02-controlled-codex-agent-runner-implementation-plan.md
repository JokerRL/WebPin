# Controlled Codex Agent Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a controlled `Send to Codex` automation path that turns generated annotation task packages into a fixed-shape `codex exec` run and records the result.

**Architecture:** Extend the bridge store to emit `.prompt.md` files and run records. Add a focused bridge runner module that reads a task prompt and invokes only `codex exec --sandbox workspace-write` with no shell interpolation. Add side panel controls that call the new endpoint after task generation.

**Tech Stack:** TypeScript, Node.js HTTP server, Node `child_process.spawn`, Zod, React side panel, Vitest.

---

## File Structure

- Modify `apps/bridge/src/store.ts`: create prompt files, run directory, and run record helpers.
- Modify `apps/bridge/src/store.test.ts`: verify prompt file output and run record persistence.
- Create `apps/bridge/src/agent-runner.ts`: validate task id, read prompt file, execute Codex with fixed args, persist result.
- Create `apps/bridge/src/agent-runner.test.ts`: verify Codex command shape and failed run capture with fake executors.
- Modify `apps/bridge/src/server.ts`: add `POST /agent-runs` endpoint.
- Modify `apps/bridge/src/server.test.ts`: verify endpoint rejects non-Codex agents and starts a Codex run.
- Modify `apps/extension/src/panel/App.tsx`: store generated task id and add `Send to Codex` button.
- Modify `README.md` and `docs/PROJECT_STATUS.md`: document controlled Codex automation.

## Tasks

### Task 1: Prompt File and Run Store

- [ ] Write failing store tests for `.prompt.md` creation and run record writes.
- [ ] Run `CI=true pnpm --filter @ui-annotations/bridge test` and verify failure.
- [ ] Implement prompt file creation in `createTaskFiles`.
- [ ] Implement `writeAgentRun` and `readAgentRun` helpers.
- [ ] Run bridge tests and verify pass.

### Task 2: Controlled Codex Runner

- [ ] Write failing runner tests with fake executor functions.
- [ ] Run bridge tests and verify failure.
- [ ] Implement `runCodexTask` with fixed `codex exec --sandbox workspace-write` args.
- [ ] Persist completed and failed run records.
- [ ] Run bridge tests and verify pass.

### Task 3: Agent Runs HTTP API

- [ ] Write failing server tests for `POST /agent-runs`.
- [ ] Run bridge tests and verify failure.
- [ ] Add request schema requiring `projectPath`, `taskId`, and `agent: "codex"`.
- [ ] Add the endpoint and preserve origin/project-root checks.
- [ ] Run bridge tests and verify pass.

### Task 4: Side Panel Send to Codex

- [ ] Add UI state for the last generated task id and run status.
- [ ] After task generation succeeds, remember the task id.
- [ ] Add a `Send to Codex` button disabled until a task id exists.
- [ ] Call `POST /agent-runs` and render success or failure text.
- [ ] Run extension typecheck and tests.

### Task 5: Documentation and Verification

- [ ] Update README workflow steps.
- [ ] Update project status and roadmap notes.
- [ ] Run `CI=true pnpm verify`.
- [ ] Report changed files, verification output, and remaining risks.
