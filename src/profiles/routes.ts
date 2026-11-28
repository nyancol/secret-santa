import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { getEvent, requireMember } from "../events/authz.js";

function sqliteOf(app: FastifyInstance): any {
  return (app as any).sqlite;
}

const profileBodySchema = {
  type: "object",
  properties: {
    recipientName: { type: "string", maxLength: 200 },
    addressLine1: { type: "string", maxLength: 300 },
    addressLine2: { type: "string", maxLength: 300 },
    city: { type: "string", maxLength: 150 },
    postalCode: { type: "string", maxLength: 30 },
    country: { type: "string", maxLength: 100 },
    phone: { type: "string", maxLength: 50 },
    notes: { type: "string", maxLength: 2000 },
  },
};

const wishlistPostSchema = {
  type: "object",
  required: ["label"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 300 },
    url: { type: "string", maxLength: 2000 },
    position: { type: "integer", minimum: 0 },
  },
};

const wishlistPatchSchema = {
  type: "object",
  properties: {
    label: { type: "string", minLength: 1, maxLength: 300 },
    url: { type: "string", maxLength: 2000 },
    position: { type: "integer", minimum: 0 },
  },
};

function toProfileJson(row: any): any {
  if (!row) return null;
  return {
    recipientName: row.recipient_name ?? null,
    addressLine1: row.address_line1 ?? null,
    addressLine2: row.address_line2 ?? null,
    city: row.city ?? null,
    postalCode: row.postal_code ?? null,
    country: row.country ?? null,
    phone: row.phone ?? null,
    notes: row.notes ?? null,
  };
}

function toItemJson(row: any): any {
  return {
    id: row.id,
    label: row.label,
    url: row.url ?? null,
    position: row.position,
  };
}

export function registerProfileRoutes(app: FastifyInstance): void {
  // ── Own shipping profile (upsert) ──
  app.put(
    "/api/v1/events/:id/profile",
    { schema: { body: profileBodySchema } },
    async (req, reply) => {
      const sqlite = sqliteOf(app);
      const userId = (req as any).userId as string;
      const { id } = req.params as any;
      const ev = getEvent(sqlite, id);
      if (!ev) return reply.code(404).send({ error: "not_found" });
      const check = requireMember(sqlite, id, userId);
      if (!check.ok) return reply.code(check.status).send({ error: check.error });
      const b = (req.body ?? {}) as any;
      const now = Date.now();
      sqlite
        .prepare(
          `INSERT INTO participant_profiles
         (event_id, user_id, recipient_name, address_line1, address_line2, city, postal_code, country, phone, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (event_id, user_id) DO UPDATE SET
           recipient_name = excluded.recipient_name, address_line1 = excluded.address_line1,
           address_line2 = excluded.address_line2, city = excluded.city, postal_code = excluded.postal_code,
           country = excluded.country, phone = excluded.phone, notes = excluded.notes, updated_at = excluded.updated_at`,
        )
        .run(
          id,
          userId,
          b.recipientName ?? null,
          b.addressLine1 ?? null,
          b.addressLine2 ?? null,
          b.city ?? null,
          b.postalCode ?? null,
          b.country ?? null,
          b.phone ?? null,
          b.notes ?? null,
          now,
        );
      const row = sqlite
        .prepare(`SELECT * FROM participant_profiles WHERE event_id = ? AND user_id = ?`)
        .get(id, userId);
      return { eventId: id, userId, profile: toProfileJson(row) };
    },
  );

  // ── Wishlist: list own ──
  app.get("/api/v1/events/:id/wishlist", async (req, reply) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const { id } = req.params as any;
    const ev = getEvent(sqlite, id);
    if (!ev) return reply.code(404).send({ error: "not_found" });
    const check = requireMember(sqlite, id, userId);
    if (!check.ok) return reply.code(check.status).send({ error: check.error });
    const rows = sqlite
      .prepare(
        `SELECT * FROM wishlist_items WHERE event_id = ? AND user_id = ? ORDER BY position, created_at`,
      )
      .all(id, userId) as any[];
    return rows.map(toItemJson);
  });

  // ── Wishlist: add own ──
  app.post(
    "/api/v1/events/:id/wishlist",
    { schema: { body: wishlistPostSchema } },
    async (req, reply) => {
      const sqlite = sqliteOf(app);
      const userId = (req as any).userId as string;
      const { id } = req.params as any;
      const ev = getEvent(sqlite, id);
      if (!ev) return reply.code(404).send({ error: "not_found" });
      const check = requireMember(sqlite, id, userId);
      if (!check.ok) return reply.code(check.status).send({ error: check.error });
      const b = req.body as any;
      const now = Date.now();
      const itemId = randomUUID();
      let position: number;
      if (typeof b.position === "number") {
        position = Math.max(0, b.position);
        sqlite
          .prepare(
            `UPDATE wishlist_items SET position = position + 1 WHERE event_id = ? AND user_id = ? AND position >= ?`,
          )
          .run(id, userId, position);
      } else {
        const mx = sqlite
          .prepare(
            `SELECT COALESCE(MAX(position), -1) AS mx FROM wishlist_items WHERE event_id = ? AND user_id = ?`,
          )
          .get(id, userId) as any;
        position = (mx?.mx ?? -1) + 1;
      }
      sqlite
        .prepare(
          `INSERT INTO wishlist_items (id, event_id, user_id, label, url, price_hint, priority, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
        )
        .run(itemId, id, userId, b.label, b.url ?? null, position, now, now);
      const row = sqlite.prepare(`SELECT * FROM wishlist_items WHERE id = ?`).get(itemId);
      return reply.code(201).send(toItemJson(row));
    },
  );

  // ── Wishlist: update own ──
  app.patch(
    "/api/v1/events/:id/wishlist/:itemId",
    { schema: { body: wishlistPatchSchema } },
    async (req, reply) => {
      const sqlite = sqliteOf(app);
      const userId = (req as any).userId as string;
      const { id, itemId } = req.params as any;
      const ev = getEvent(sqlite, id);
      if (!ev) return reply.code(404).send({ error: "not_found" });
      const check = requireMember(sqlite, id, userId);
      if (!check.ok) return reply.code(check.status).send({ error: check.error });
      const row = sqlite
        .prepare(`SELECT * FROM wishlist_items WHERE id = ? AND event_id = ?`)
        .get(itemId, id) as any;
      if (!row) return reply.code(404).send({ error: "not_found" });
      if (row.user_id !== userId) return reply.code(403).send({ error: "forbidden" });
      const b = (req.body ?? {}) as any;
      if (typeof b.position === "number" && b.position !== row.position) {
        const items = sqlite
          .prepare(
            `SELECT id FROM wishlist_items WHERE event_id = ? AND user_id = ? AND id != ? ORDER BY position, created_at`,
          )
          .all(id, userId, itemId) as any[];
        const ids = items.map((r: any) => r.id);
        const target = Math.min(Math.max(0, b.position), ids.length);
        ids.splice(target, 0, itemId);
        const upd = sqlite.prepare(
          `UPDATE wishlist_items SET position = ?, updated_at = ? WHERE id = ?`,
        );
        ids.forEach((wid: string, idx: number) => upd.run(idx, Date.now(), wid));
      }
      const sets: string[] = [];
      const vals: unknown[] = [];
      const map: Record<string, string> = {
        label: "label",
        url: "url",
      };
      for (const [json, col] of Object.entries(map)) {
        if (b[json] !== undefined) {
          sets.push(`${col} = ?`);
          vals.push(b[json]);
        }
      }
      sets.push(`updated_at = ?`);
      vals.push(Date.now());
      sqlite
        .prepare(`UPDATE wishlist_items SET ${sets.join(", ")} WHERE id = ?`)
        .run(...vals, itemId);
      const updated = sqlite.prepare(`SELECT * FROM wishlist_items WHERE id = ?`).get(itemId);
      return toItemJson(updated);
    },
  );

  // ── Wishlist: delete own ──
  app.delete("/api/v1/events/:id/wishlist/:itemId", async (req, reply) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const { id, itemId } = req.params as any;
    const ev = getEvent(sqlite, id);
    if (!ev) return reply.code(404).send({ error: "not_found" });
    const check = requireMember(sqlite, id, userId);
    if (!check.ok) return reply.code(check.status).send({ error: check.error });
    const row = sqlite
      .prepare(`SELECT * FROM wishlist_items WHERE id = ? AND event_id = ?`)
      .get(itemId, id) as any;
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.user_id !== userId) return reply.code(403).send({ error: "forbidden" });
    sqlite.prepare(`DELETE FROM wishlist_items WHERE id = ?`).run(itemId);
    // Compact sibling positions.
    const sibs = sqlite
      .prepare(
        `SELECT id FROM wishlist_items WHERE event_id = ? AND user_id = ? ORDER BY position, created_at`,
      )
      .all(id, userId) as any[];
    const upd = sqlite.prepare(`UPDATE wishlist_items SET position = ? WHERE id = ?`);
    sibs.forEach((s: any, idx: number) => upd.run(idx, s.id));
    return { eventId: id, itemId, removed: true };
  });

  // ── Participant directory (profiles + wishlists, NEVER assignments) ──
  app.get("/api/v1/events/:id/participants", async (req, reply) => {
    const sqlite = sqliteOf(app);
    const userId = (req as any).userId as string;
    const { id } = req.params as any;
    const ev = getEvent(sqlite, id);
    if (!ev) return reply.code(404).send({ error: "not_found" });
    const check = requireMember(sqlite, id, userId);
    if (!check.ok) return reply.code(check.status).send({ error: check.error });
    // Privacy by construction: query touches users + profiles + wishlist only.
    const members = sqlite
      .prepare(
        `SELECT p.user_id AS userId, u.display_name AS displayName,
                pr.recipient_name, pr.address_line1, pr.address_line2, pr.city,
                pr.postal_code, pr.country, pr.phone, pr.notes
         FROM event_participants p LEFT JOIN users u ON u.id = p.user_id
         LEFT JOIN participant_profiles pr ON pr.event_id = p.event_id AND pr.user_id = p.user_id
         WHERE p.event_id = ? ORDER BY p.created_at`,
      )
      .all(id) as any[];
    const items = sqlite
      .prepare(
        `SELECT * FROM wishlist_items WHERE event_id = ? ORDER BY user_id, position, created_at`,
      )
      .all(id) as any[];
    const byUser = new Map<string, any[]>();
    for (const it of items) {
      const arr = byUser.get(it.user_id) ?? [];
      arr.push(toItemJson(it));
      byUser.set(it.user_id, arr);
    }
    return members.map((m: any) => ({
      userId: m.userId,
      displayName: m.displayName ?? null,
      profile: toProfileJson({
        recipient_name: m.recipient_name,
        address_line1: m.address_line1,
        address_line2: m.address_line2,
        city: m.city,
        postal_code: m.postal_code,
        country: m.country,
        phone: m.phone,
        notes: m.notes,
      }),
      wishlist: byUser.get(m.userId) ?? [],
    }));
  });
}
