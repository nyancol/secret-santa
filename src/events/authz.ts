/** AuthZ helpers for santa-events: member / organiser checks + draft guard. */

export interface SantaDb {
  prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
}

export function getEvent(sqlite: any, eventId: string): any | null {
  const row = sqlite.prepare(`SELECT * FROM events WHERE id = ?`).get(eventId) as any;
  return row ?? null;
}

export function isOrganiser(sqlite: any, eventId: string, userId: string): boolean {
  const ev = getEvent(sqlite, eventId);
  return !!ev && ev.organiser_id === userId;
}

export function isMember(sqlite: any, eventId: string, userId: string): boolean {
  const row = sqlite
    .prepare(`SELECT 1 FROM event_participants WHERE event_id = ? AND user_id = ?`)
    .get(eventId, userId) as unknown;
  return !!row;
}

/** 403 unless member (organiser counts if on roster; organiser row auto-joined so usually member too). */
export function requireMember(
  sqlite: any,
  eventId: string,
  userId: string,
): { ok: true } | { ok: false; status: 403 | 404; error: string } {
  const ev = getEvent(sqlite, eventId);
  if (!ev) return { ok: false, status: 404, error: "not_found" };
  // Organiser can always read even if somehow off-roster.
  if (ev.organiser_id === userId) return { ok: true };
  if (!isMember(sqlite, eventId, userId)) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true };
}

export function requireOrganiser(
  sqlite: any,
  eventId: string,
  userId: string,
): { ok: true } | { ok: false; status: 403 | 404; error: string } {
  const ev = getEvent(sqlite, eventId);
  if (!ev) return { ok: false, status: 404, error: "not_found" };
  if (ev.organiser_id !== userId) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true };
}

/** 409 when event is not in draft. Returns the event row on success. */
export function requireDraft(
  sqlite: any,
  eventId: string,
): { ok: true; event: any } | { ok: false; status: 404 | 409; error: string } {
  const ev = getEvent(sqlite, eventId);
  if (!ev) return { ok: false, status: 404, error: "not_found" };
  if (ev.status !== "draft") return { ok: false, status: 409, error: "event_locked" };
  return { ok: true, event: ev };
}
