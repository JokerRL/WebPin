# Controlled Codex Agent Runner Design

## Summary

This design adds a controlled automation path after annotation capture. A user can confirm a saved annotation group, generate a task package and prompt file, then send that task to Codex from the side panel. The Local File Bridge remains narrow: it may start only a whitelisted Codex run for a repo-local task package and must not become a general shell executor.

## User Flow

1. User selects one or more saved annotations in the side panel.
2. User drafts or accepts task package fields.
3. User clicks `Generate task files`.
4. Bridge writes:
   - `.ui-annotations/tasks/<task-id>.json`
   - `.ui-annotations/tasks/<task-id>.md`
   - `.ui-annotations/tasks/<task-id>.prompt.md`
5. User clicks `Send to Codex`.
6. Bridge validates the project path and task id, reads the prompt file, runs Codex with a fixed argument list, and writes a run record.
7. Side panel reports whether Codex completed or failed.

## Safety Model

- The browser cannot provide arbitrary shell commands.
- The only supported agent is `codex`.
- The only command shape is equivalent to:

```bash
codex exec --sandbox workspace-write "<prompt file contents>"
```

- The command is executed with `cwd` set to the bound project path.
- The task id must pass the existing filename-safe slug validation.
- The prompt file must live under `.ui-annotations/tasks/`.
- Run records are written under `.ui-annotations/runs/`.
- The Local File Bridge continues to bind to `127.0.0.1` and enforce allowed origins and allowed project roots.

## File Layout

```text
.ui-annotations/
  tasks/
    task-001.json
    task-001.md
    task-001.prompt.md
  runs/
    run-task-001-20260702T120000000Z.json
```

## Run Record

```json
{
  "runId": "run_task_001_20260702T120000000Z",
  "taskId": "task_001",
  "agent": "codex",
  "status": "completed",
  "command": ["codex", "exec", "--sandbox", "workspace-write", "<prompt>"],
  "startedAt": "2026-07-02T12:00:00.000Z",
  "finishedAt": "2026-07-02T12:03:00.000Z",
  "exitCode": 0,
  "stdout": "Final Codex response...",
  "stderr": "Progress logs...",
  "promptPath": ".ui-annotations/tasks/task_001.prompt.md"
}
```

## Prompt File

The prompt file is a human-readable Codex instruction generated from the task package. It must tell Codex to read the task JSON/Markdown, keep changes scoped, run verification, and summarize changed files and verification results.

## Non-Goals

- No arbitrary command execution.
- No Cursor or Claude Code launchers in this slice.
- No background queue in this first implementation.
- No automatic run immediately on annotation save; the user must click `Send to Codex`.
- No direct web-to-iOS mapping.
