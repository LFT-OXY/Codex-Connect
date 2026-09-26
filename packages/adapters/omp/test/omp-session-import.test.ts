import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OmpAdapter } from "../src/omp-adapter.js";

const roots: string[] = [];
const adapters: OmpAdapter[] = [];
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SESSION = "01a079a2-95f5-7054-a6c6-935a64cfc2a8";
const PRIVATE = "Private prompt";

function lines(...entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "codexhost-omp-import-")));
  roots.push(root);
  const cwd = path.join(root, "project");
  const project = path.join(root, "agent", "sessions", "-project");
  await mkdir(cwd);
  await mkdir(project, { recursive: true });
  const createTransport = vi.fn(() => {
    throw new Error("Discovery must not start OMP");
  });
  const adapter = new OmpAdapter(
    { environment: { PI_CODING_AGENT_DIR: path.join(root, "agent") } },
    { createTransport },
  );
  adapters.push(adapter);
  const session = (id: string, extra: Record<string, unknown> = {}, title = "") =>
    lines(
      { type: "title", v: 1, title, updatedAt: "2026-01-01T00:00:00.000Z", pad: "   " },
      { type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd, ...extra },
      {
        type: "message",
        id: "user-1",
        parentId: null,
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { role: "user", content: PRIVATE, timestamp: 1_767_225_601_000 },
      },
    );
  return { root, cwd, project, adapter, createTransport, session };
}

describe("Omp Session import", () => {
  it("lists main sessions with their title, skipping subagents, without starting OMP", async () => {
    const f = await fixture();
    const file = path.join(f.project, `2026-01-01T00-00-00-000Z_${SESSION}.jsonl`);
    await writeFile(file, f.session(SESSION, {}, "Slot title"));
    // Subagents are kept in a folder named after the parent's file.
    const agents = path.join(f.project, `2026-01-01T00-00-00-000Z_${SESSION}`);
    await mkdir(agents);
    await writeFile(path.join(agents, "Scout.jsonl"), f.session("subagent-id"));
    await writeFile(
      path.join(f.project, "untitled.jsonl"),
      f.session("untitled-id", { title: "Header title" }),
    );
    await writeFile(path.join(f.project, "first-message.jsonl"), f.session("first-id"));
    // No user message on the active branch: nothing to resume.
    await writeFile(
      path.join(f.project, "empty.jsonl"),
      lines({ type: "session", version: 3, id: "empty-id", timestamp: "x", cwd: f.cwd }),
    );
    const before = await readFile(file, "utf8");

    const listed = await f.adapter.sessionImport.listCandidates();
    if (!listed.ok) throw new Error(listed.error.message);
    expect(
      Object.fromEntries(
        listed.value.map(({ nativeSessionId, title }) => [nativeSessionId, title]),
      ),
    ).toEqual({ [SESSION]: "Slot title", "untitled-id": "Header title", "first-id": PRIVATE });
    expect(listed.value.every(({ running, cwd }) => running === null && cwd === f.cwd)).toBe(true);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(f.createTransport).not.toHaveBeenCalled();
  });

  it("revalidates the selected session and returns its session file for resume", async () => {
    const f = await fixture();
    const file = path.join(f.project, `${SESSION}.jsonl`);
    await writeFile(file, f.session(SESSION));
    const resolved = await f.adapter.sessionImport.resolveCandidate(SESSION);
    expect(resolved).toEqual({
      ok: true,
      value: {
        candidate: expect.objectContaining({ nativeSessionId: SESSION, cwd: f.cwd }),
        nativeRef: {
          harnessId: "omp",
          nativeSessionId: SESSION,
          locator: { sessionFile: file },
          formatVersion: 1,
        },
      },
    });

    await rm(file);
    expect(await f.adapter.sessionImport.resolveCandidate(SESSION)).toMatchObject({
      ok: false,
      error: { code: "sessionNotFound" },
    });
  });

  it("refuses an identity shared by two session files", async () => {
    const f = await fixture();
    await writeFile(path.join(f.project, "a.jsonl"), f.session(SESSION));
    await writeFile(path.join(f.project, "b.jsonl"), f.session(SESSION));
    expect(await f.adapter.sessionImport.resolveCandidate(SESSION)).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
    expect((await f.adapter.sessionImport.listCandidates()).ok).toBe(false);
  });

  it("stops discovery once the Adapter closes", async () => {
    const f = await fixture();
    await f.adapter.close();
    expect(await f.adapter.sessionImport.listCandidates()).toMatchObject({
      ok: false,
      error: { code: "invalidState" },
    });
  });
});
