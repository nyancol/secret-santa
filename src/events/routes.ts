import type { FastifyInstance } from "fastify";
import { randomUUID, randomInt } from "node:crypto";
import { DrawImpossibleError, solveDraw } from "./draw.js";
import { getEvent, requireDraft, requireMember, requireOrganiser } from "./authz.js";
import { withSpan } from "../observability/trace.js";

function sqliteOf(app: FastifyInstance): any {
  return (app as any).sqlite;
}

function toEventJson(row: any): any {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    budgetAmount: row.budget_amount,
    budgetCurrency: row.budget_currency,
    organiserId: row.organiser_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const eventBodySchema = {
  type: "object",
  required: ["name", "budgetAmount", "budgetCurrency"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 2000 },
    budgetAmount: { type: "number", exclusiveMinimum: 0 },
    budgetCurrency: { type: "string", minLength: 1, maxLength: 16 },
  },
};

const eventPatchSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 2000 },
    budgetAmount: { type: "number", exclusiveMinimum: 0 },
    budgetCurrency: { type: "string", minLength: 1, maxLength: 16 },
  },
};

export function registerEventRoutes(app: FastifyInstance): void {
  // ── User directory for invite picker ──
  app.get(
    "/api/v1/users",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { search: { type: "string", maxLength: 100 } },
        },
      },
    },
    async (req, reply) => {
      const sqlite = sqliteOf(app);
      const q = ((req.query as any)?.search ?? "").trim();
      let rows: any[];
      if (!q) {
        rows = sqlite
          .prepare(`SELECT id, display_name FROM users ORDER BY created_at DESC LIMIT 50`)
          .all();
      } else {
        rows = sqlite
          .prepare(
            `SELECT id, display_name FROM users WHERE display_name LIKE ? ESCAPE '\\' ORDER BY display_name LIMIT 50`,
          )
          .all(`%${q.replace(/[\\%_]/g, (c: string) => `\\${c}`)}%`);
      }
      return rows.map((r: any) => ({ id: r.id, displayName: r.display_name ?? null }));
    },
  );

  // ── Create event ──
  app.post("/api/v1/events", { schema: { body: eventBodySchema } }, async (req, reply) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const b = req.body as any;
    const id = randomUUID();
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO events (id, name, description, signup_deadline, draw_date, gift_date, budget_amount, budget_currency, organiser_id, status, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, 'draft', ?, ?)`,
      )
      .run(id, b.name, b.description ?? null, b.budgetAmount, b.budgetCurrency, userId, now, now);
    // Organiser auto-joins.
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO event_participants (event_id, user_id, created_at) VALUES (?, ?, ?)`,
      )
      .run(id, userId, now);
    const row = getEvent(sqlite, id);
    return reply.code(201).send(toEventJson(row));
  });

  // ── List my events ──
  app.get("/api/v1/events", async (req) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const rows = sqlite
      .prepare(
        `SELECT e.*, CASE WHEN e.organiser_id = ? THEN 'organiser' ELSE 'member' END AS role
         FROM events e WHERE e.organiser_id = ?
            OR EXISTS (SELECT 1 FROM event_participants p WHERE p.event_id = e.id AND p.user_id = ?)
         ORDER BY e.created_at DESC`,
      )
      .all(userId, userId, userId) as any[];
    return rows.map((r: any) => ({ ...toEventJson(r), role: r.role }));
  });

  // ── Event details (+ roster) ──
  app.get("/api/v1/events/:id", async (req, reply) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const { id } = req.params as any;
    const check = requireMember(sqlite, id, userId);
    if (!check.ok) return reply.code(check.status).send({ error: check.error });
    const row = getEvent(sqlite, id);
    const roster = sqlite
      .prepare(
        `SELECT p.user_id AS id, u.display_name AS displayName FROM event_participants p
         LEFT JOIN users u ON u.id = p.user_id WHERE p.event_id = ? ORDER BY p.created_at`,
      )
      .all(id);
    return { ...toEventJson(row), roster };
  });

  // ── Update draft event ──
  app.patch("/api/v1/events/:id", { schema: { body: eventPatchSchema } }, async (req, reply) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const { id } = req.params as any;
    const org = requireOrganiser(sqlite, id, userId);
    if (!org.ok) return reply.code(org.status).send({ error: org.error });
    const draft = requireDraft(sqlite, id);
    if (!draft.ok) return reply.code(draft.status).send({ error: draft.error });
    const b = req.body as any;
    const map: Record<string, string> = {
      name: "name",
      description: "description",
      budgetAmount: "budget_amount",
      budgetCurrency: "budget_currency",
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [json, col] of Object.entries(map)) {
      if (b[json] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(b[json]);
      }
    }
    if (sets.length > 0) {
      sets.push(`updated_at = ?`);
      vals.push(Date.now());
      sqlite.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    }
    return toEventJson(getEvent(sqlite, id));
  });

  // ── Delete event (organiser only, draft or drawn) ──
  app.delete("/api/v1/events/:id", async (req, reply) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const { id } = req.params as any;
    const ev = getEvent(sqlite, id);
    if (!ev) return reply.code(404).send({ error: "not_found" });
    const org = requireOrganiser(sqlite, id, userId);
    if (!org.ok) return reply.code(org.status).send({ error: org.error });
    // Child rows (participants, exclusions, assignments, profiles, wishlist)
    // cascade via ON DELETE CASCADE (foreign_keys pragma is ON).
    sqlite.prepare(`DELETE FROM events WHERE id = ?`).run(id);
    return { eventId: id, removed: true };
  });

  // ── Participants ──
  app.post(
    "/api/v1/events/:id/participants",
    {
      schema: {
        body: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string", minLength: 1 } },
        },
      },
    },
    async (req, reply) => {
      const sqlite = sqliteOf(app);
      const userId = (req as any).userId as string;
      const { id } = req.params as any;
      const org = requireOrganiser(sqlite, id, userId);
      if (!org.ok) return reply.code(org.status).send({ error: org.error });
      const draft = requireDraft(sqlite, id);
      if (!draft.ok) return reply.code(draft.status).send({ error: draft.error });
      const target = (req.body as any).userId as string;
      const exists = sqlite.prepare(`SELECT id FROM users WHERE id = ?`).get(target) as unknown;
      if (!exists) return reply.code(404).send({ error: "not_found" });
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO event_participants (event_id, user_id, created_at) VALUES (?, ?, ?)`,
        )
        .run(id, target, Date.now());
      return reply.code(201).send({ eventId: id, userId: target });
    },
  );

  const removeParticipant = async (req: any, reply: any) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const { id } = req.params as any;
    const target = (req.params as any)?.userId ?? (req.body as any)?.userId;
    if (!target || typeof target !== "string") {
      return reply.code(422).send({ error: "validation_error" });
    }
    const org = requireOrganiser(sqlite, id, userId);
    if (!org.ok) return reply.code(org.status).send({ error: org.error });
    const draft = requireDraft(sqlite, id);
    if (!draft.ok) return reply.code(draft.status).send({ error: draft.error });
    const del = sqlite
      .prepare(`DELETE FROM event_participants WHERE event_id = ? AND user_id = ?`)
      .run(id, target);
    if (del.changes === 0) return reply.code(404).send({ error: "not_found" });
    return { eventId: id, userId: target, removed: true };
  };
  app.delete(
    "/api/v1/events/:id/participants",
    {
      schema: {
        body: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string", minLength: 1 } },
        },
      },
    },
    removeParticipant,
  );
  app.delete("/api/v1/events/:id/participants/:userId", removeParticipant);

  // ── Exclusions: list (organiser + participants) ──
  function listExclusions(sqlite: any, eventId: string): any[] {
    const rows = sqlite
      .prepare(
        `SELECT x.giver_id AS giverId, u1.display_name AS giverDisplayName,
                x.recipient_id AS recipientId, u2.display_name AS recipientDisplayName
         FROM event_exclusions x
         LEFT JOIN users u1 ON u1.id = x.giver_id
         LEFT JOIN users u2 ON u2.id = x.recipient_id
         WHERE x.event_id = ? ORDER BY x.created_at`,
      )
      .all(eventId) as any[];
    const pairSet = new Set(rows.map((r: any) => `${r.giverId}>${r.recipientId}`));
    return rows.map((r: any) => ({
      ...r,
      mutual: pairSet.has(`${r.recipientId}>${r.giverId}`),
    }));
  }

  app.get("/api/v1/events/:id/exclusions", async (req, reply) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const { id } = req.params as any;
    const check = requireMember(sqlite, id, userId);
    if (!check.ok) return reply.code(check.status).send({ error: check.error });
    return { eventId: id, exclusions: listExclusions(sqlite, id) };
  });

  // ── Exclusions ──
  const exclusionSchema = {
    type: "object",
    required: ["giverId", "recipientId"],
    properties: {
      giverId: { type: "string", minLength: 1 },
      recipientId: { type: "string", minLength: 1 },
      mutual: { type: "boolean" },
    },
  };
  const checkExclusionPair = (
    sqlite: any,
    eventId: string,
    giverId: string,
    recipientId: string,
  ) => {
    if (giverId === recipientId) return false;
    const g = sqlite
      .prepare(`SELECT 1 FROM event_participants WHERE event_id = ? AND user_id = ?`)
      .get(eventId, giverId) as unknown;
    const r = sqlite
      .prepare(`SELECT 1 FROM event_participants WHERE event_id = ? AND user_id = ?`)
      .get(eventId, recipientId) as unknown;
    return !!(g && r);
  };

  app.post(
    "/api/v1/events/:id/exclusions",
    { schema: { body: exclusionSchema } },
    async (req, reply) => {
      const sqlite = sqliteOf(app);
      const userId = (req as any).userId as string;
      const { id } = req.params as any;
      const org = requireOrganiser(sqlite, id, userId);
      if (!org.ok) return reply.code(org.status).send({ error: org.error });
      const draft = requireDraft(sqlite, id);
      if (!draft.ok) return reply.code(draft.status).send({ error: draft.error });
      const { giverId, recipientId, mutual = true } = req.body as any;
      if (!checkExclusionPair(sqlite, id, giverId, recipientId)) {
        return reply.code(422).send({ error: "validation_error" });
      }
      const now = Date.now();
      const ins = sqlite.prepare(
        `INSERT OR IGNORE INTO event_exclusions (event_id, giver_id, recipient_id, created_at) VALUES (?, ?, ?, ?)`,
      );
      ins.run(id, giverId, recipientId, now);
      const stored = [{ giverId, recipientId }];
      if (mutual) {
        ins.run(id, recipientId, giverId, now);
        stored.push({ giverId: recipientId, recipientId: giverId });
      }
      return reply.code(201).send({ eventId: id, exclusions: stored });
    },
  );

  app.delete(
    "/api/v1/events/:id/exclusions",
    { schema: { body: exclusionSchema } },
    async (req, reply) => {
      const sqlite = sqliteOf(app);
      const userId = (req as any).userId as string;
      const { id } = req.params as any;
      const org = requireOrganiser(sqlite, id, userId);
      if (!org.ok) return reply.code(org.status).send({ error: org.error });
      const draft = requireDraft(sqlite, id);
      if (!draft.ok) return reply.code(draft.status).send({ error: draft.error });
      const { giverId, recipientId, mutual = true } = (req.body ?? {}) as any;
      if (!giverId || !recipientId) return reply.code(422).send({ error: "validation_error" });
      let removed = 0;
      removed += sqlite
        .prepare(
          `DELETE FROM event_exclusions WHERE event_id = ? AND giver_id = ? AND recipient_id = ?`,
        )
        .run(id, giverId, recipientId).changes as number;
      if (mutual) {
        removed += sqlite
          .prepare(
            `DELETE FROM event_exclusions WHERE event_id = ? AND giver_id = ? AND recipient_id = ?`,
          )
          .run(id, recipientId, giverId).changes as number;
      }
      return { eventId: id, removed };
    },
  );

  // ── Draw ──
  app.post("/api/v1/events/:id/draw", async (req, reply) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const { id } = req.params as any;
    const org = requireOrganiser(sqlite, id, userId);
    if (!org.ok) return reply.code(org.status).send({ error: org.error });
    const ev = getEvent(sqlite, id);
    if (!ev) return reply.code(404).send({ error: "not_found" });
    if (ev.status !== "draft") return reply.code(409).send({ error: "already_drawn" });

    const participantRows = sqlite
      .prepare(`SELECT user_id FROM event_participants WHERE event_id = ?`)
      .all(id) as any[];
    const ids = participantRows.map((r: any) => r.user_id);
    if (ids.length < 2)
      return reply.code(422).send({
        error: "draw_impossible",
        participantCount: ids.length,
        exclusions: listExclusions(sqlite, id),
      });
    const exclRows = sqlite
      .prepare(`SELECT giver_id, recipient_id FROM event_exclusions WHERE event_id = ?`)
      .all(id) as any[];
    const excluded = new Set(exclRows.map((r: any) => `${r.giver_id}>${r.recipient_id}`));

    let assignment: Map<string, string>;
    try {
      assignment = await withSpan(
        "santa.draw",
        { "event.id": id, "event.participant_count": ids.length },
        async () => solveDraw(ids, excluded, () => randomInt(1 << 30) / (1 << 30)),
      );
    } catch (err) {
      if (err instanceof DrawImpossibleError) {
        return reply.code(422).send({
          error: "draw_impossible",
          participantCount: ids.length,
          exclusions: listExclusions(sqlite, id),
        });
      }
      throw err;
    }

    const now = Date.now();
    const txn = sqlite.transaction(() => {
      const upd = sqlite
        .prepare(
          `UPDATE events SET status = 'drawn', updated_at = ? WHERE id = ? AND status = 'draft'`,
        )
        .run(now, id);
      if (upd.changes === 0) throw new Error("already_drawn");
      const ins = sqlite.prepare(
        `INSERT INTO event_assignments (event_id, giver_id, recipient_id, created_at) VALUES (?, ?, ?, ?)`,
      );
      for (const [giver, recipient] of assignment) ins.run(id, giver, recipient, now);
    });
    try {
      txn();
    } catch {
      return reply.code(409).send({ error: "already_drawn" });
    }
    return { eventId: id, status: "drawn", participantCount: ids.length };
  });

  // ── My giftee ──
  app.get("/api/v1/events/:id/my-giftee", async (req, reply) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const { id } = req.params as any;
    const ev = getEvent(sqlite, id);
    if (!ev) return reply.code(404).send({ error: "not_found" });
    if (!requireMember(sqlite, id, userId).ok) {
      // Must be a participant; organiser auto-joins so covered by member check.
      const isOrg = ev.organiser_id === userId;
      if (!isOrg) return reply.code(403).send({ error: "forbidden" });
      if (
        !sqlite
          .prepare(`SELECT 1 FROM event_participants WHERE event_id=? AND user_id=?`)
          .get(id, userId)
      ) {
        return reply.code(403).send({ error: "forbidden" });
      }
    }
    if (ev.status !== "drawn") return reply.code(404).send({ error: "not_drawn" });
    const row = sqlite
      .prepare(
        `SELECT a.recipient_id AS gifteeId, u.display_name AS displayName
         FROM event_assignments a LEFT JOIN users u ON u.id = a.recipient_id
         WHERE a.event_id = ? AND a.giver_id = ?`,
      )
      .get(id, userId) as any;
    if (!row) return reply.code(404).send({ error: "not_drawn" });
    return { eventId: id, giftee: { id: row.gifteeId, displayName: row.displayName ?? null } };
  });
}
