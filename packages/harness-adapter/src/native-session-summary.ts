/** Gaps between consecutive native records longer than this are idle, not active time. */
export const NATIVE_SESSION_IDLE_GAP_MS = 30 * 60_000;

/** Tool names, lowercased, whose calls edit files; a turn with one of them counts as an edit. */
const FILE_EDIT_TOOLS = new Set([
  "apply_patch",
  "edit",
  "write",
  "multiedit",
  "notebookedit",
  "str_replace",
  "search_replace",
  "create_file",
  "write_file",
]);

export function isFileEditTool(name: string): boolean {
  return FILE_EDIT_TOOLS.has(name.toLowerCase());
}

/**
 * Activity counted so far from one Session's records. Plain JSON, so Adapters can keep it in their
 * usage cursor and continue from it on the next incremental read. A type alias rather than an
 * interface so it stays assignable to JSON cursor values.
 */
export type NativeSessionActivity = {
  firstActivityAt: number | null;
  lastActivityAt: number | null;
  activeMs: number;
  turns: number;
  /** Closed turns that edited files. */
  edits: number;
  /** The open turn has called a file-editing tool. */
  editing: boolean;
};

export function emptyNativeSessionActivity(): NativeSessionActivity {
  return {
    firstActivityAt: null,
    lastActivityAt: null,
    activeMs: 0,
    turns: 0,
    edits: 0,
    editing: false,
  };
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validates activity read back from a cursor; anything else is null. */
export function parseNativeSessionActivity(value: unknown): NativeSessionActivity | null {
  if (typeof value !== "object" || value === null) return null;
  const activity = value as Record<string, unknown>;
  const time = (field: unknown) => field === null || count(field);
  return time(activity.firstActivityAt) &&
    time(activity.lastActivityAt) &&
    count(activity.activeMs) &&
    count(activity.turns) &&
    count(activity.edits) &&
    typeof activity.editing === "boolean"
    ? {
        firstActivityAt: activity.firstActivityAt as number | null,
        lastActivityAt: activity.lastActivityAt as number | null,
        activeMs: activity.activeMs,
        turns: activity.turns,
        edits: activity.edits,
        editing: activity.editing,
      }
    : null;
}

/** Adds a record's timestamp; out-of-order records extend the span but add no active time. */
export function recordNativeSessionActivity(activity: NativeSessionActivity, time: number): void {
  if (activity.firstActivityAt === null || time < activity.firstActivityAt) {
    activity.firstActivityAt = time;
  }
  if (activity.lastActivityAt !== null) {
    const gap = time - activity.lastActivityAt;
    if (gap > 0 && gap <= NATIVE_SESSION_IDLE_GAP_MS) activity.activeMs += gap;
    if (gap <= 0) return;
  }
  activity.lastActivityAt = time;
}

/** A new user turn closes the previous one. */
export function startNativeSessionTurn(activity: NativeSessionActivity): void {
  if (activity.editing) activity.edits += 1;
  activity.editing = false;
  activity.turns += 1;
}

export function recordNativeSessionEdit(activity: NativeSessionActivity): void {
  activity.editing = true;
}

/** Edited turns including the open one. */
export function nativeSessionEdits(activity: NativeSessionActivity): number {
  return activity.edits + (activity.editing ? 1 : 0);
}
