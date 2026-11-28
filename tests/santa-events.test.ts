import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createSeededRng, DrawImpossibleError, solveDraw } from "../src/events/draw.js";

function testConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    ...process.env,
    NODE_ENV: "test",
    PORT: "32299",
    APP_ORIGIN: "http://localhost:32299",
    DATABASE_PATH: ":memory:",
    SESSION_SECRET: "test-only-secret-32-chars-minimum!!",
    ...extra,
  } as NodeJS.ProcessEnv);
}

async function boot() {
  const { app } = await buildApp({
    config: testConfig({ DEV_LOGIN: "true" }),
    skipOidcDiscovery: true,
  });
  return app;
}

async function loginAs(app: any, name: string): Promise<{ cookie: string; id: string }> {
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/dev-login",
    payload: { user: name },
  });
  expect(login.statusCode).toBe(200);
  const setCookie = login.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : (setCookie as string)).split(";")[0];
  const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
  return { cookie, id: me.json().id as string };
}

async function createEvent(app: any, cookie: string, body: any = {}) {
  return app.inject({
    method: "POST",
    url: "/api/v1/events",
    headers: { cookie },
    payload: {
      name: "Friends 2026",
      budgetAmount: 25,
      budgetCurrency: "EUR",
      ...body,
    },
  });
}

describe("draw solver (pure unit)", () => {
  it("produces a derangement", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const m = solveDraw(ids, new Set(), createSeededRng(42));
    expect(m.size).toBe(5);
    for (const [g, r] of m) expect(g).not.toBe(r);
    expect(new Set(m.values()).size).toBe(5); // bijection
  });

  it("respects exclusions", () => {
    const ids = ["a", "b", "c", "d"];
    const m = solveDraw(ids, new Set(["a>b", "c>d"]), createSeededRng(7));
    expect(m.get("a")).not.toBe("b");
    expect(m.get("c")).not.toBe("d");
  });

  it("detects impossible sets", () => {
    expect(() => solveDraw(["a", "b"], new Set(["a>b", "b>a"]), createSeededRng(1))).toThrow(
      DrawImpossibleError,
    );
    expect(() => solveDraw(["solo"], new Set(), createSeededRng(1))).toThrow(DrawImpossibleError);
  });

  it("is deterministic under seed", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const excl = new Set(["a>b"]);
    const m1 = solveDraw(ids, excl, createSeededRng(123));
    const m2 = solveDraw(ids, excl, createSeededRng(123));
    expect([...m1.entries()]).toEqual([...m2.entries()]);
  });
});

describe("santa events API", () => {
  it("GET /api/v1/users: match, empty, anon, no leak", async () => {
    const app = await boot();
    try {
      const alice = await loginAs(app, "alice");
      await loginAs(app, "bob");
      const hit = await app.inject({
        method: "GET",
        url: "/api/v1/users?search=ali",
        headers: { cookie: alice.cookie },
      });
      expect(hit.statusCode).toBe(200);
      expect(hit.json().length).toBeGreaterThanOrEqual(1);
      expect(hit.json()[0]).toHaveProperty("id");
      expect(hit.json()[0]).toHaveProperty("displayName");
      expect(hit.json()[0]).not.toHaveProperty("sub");
      const all = await app.inject({
        method: "GET",
        url: "/api/v1/users",
        headers: { cookie: alice.cookie },
      });
      expect(all.statusCode).toBe(200);
      const anon = await app.inject({ method: "GET", url: "/api/v1/users?search=a" });
      expect(anon.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("events CRUD: create/list/get/patch + authZ + validation", async () => {
    const app = await boot();
    try {
      const alice = await loginAs(app, "alice");
      const bob = await loginAs(app, "bob");
      // anon create -> 401
      expect((await createEvent(app, "")).statusCode).toBe(401);
      // missing budget -> 422
      const noBudget = await app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { cookie: alice.cookie },
        payload: { name: "No budget" },
      });
      expect(noBudget.statusCode).toBe(422);
      // empty name -> 422
      const badName = await createEvent(app, alice.cookie, { name: "" });
      expect(badName.statusCode).toBe(422);
      const created = await createEvent(app, alice.cookie);
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ status: "draft", organiserId: alice.id });
      const eventId = created.json().id as string;
      // organiser auto-joins
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/events/${eventId}`,
        headers: { cookie: alice.cookie },
      });
      expect(detail.json().roster.map((r: any) => r.id)).toContain(alice.id);
      // non-organiser patch -> 403
      const forbidden = await app.inject({
        method: "PATCH",
        url: `/api/v1/events/${eventId}`,
        headers: { cookie: bob.cookie },
        payload: { name: "Hijack" },
      });
      expect(forbidden.statusCode).toBe(403);
      // organiser patch -> 200
      const patched = await app.inject({
        method: "PATCH",
        url: `/api/v1/events/${eventId}`,
        headers: { cookie: alice.cookie },
        payload: { name: "Friends 2026!" },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().name).toBe("Friends 2026!");
      // list with roles
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${eventId}/participants`,
        headers: { cookie: alice.cookie },
        payload: { userId: bob.id },
      });
      const bobList = await app.inject({
        method: "GET",
        url: "/api/v1/events",
        headers: { cookie: bob.cookie },
      });
      expect(bobList.statusCode).toBe(200);
      expect(bobList.json().find((e: any) => e.id === eventId)?.role).toBe("member");
      const aliceList = await app.inject({
        method: "GET",
        url: "/api/v1/events",
        headers: { cookie: alice.cookie },
      });
      expect(aliceList.json().find((e: any) => e.id === eventId)?.role).toBe("organiser");
      // outsider read -> 403, anon -> 401
      const carol = await loginAs(app, "carol");
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/events/${eventId}`,
            headers: { cookie: carol.cookie },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: "GET", url: `/api/v1/events/${eventId}` })).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("participants: invite/remove, unknown user, locked after draw", async () => {
    const app = await boot();
    try {
      const alice = await loginAs(app, "alice");
      const bob = await loginAs(app, "bob");
      const ev = (await createEvent(app, alice.cookie)).json();
      const invite = await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/participants`,
        headers: { cookie: alice.cookie },
        payload: { userId: bob.id },
      });
      expect(invite.statusCode).toBe(201);
      const unknown = await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/participants`,
        headers: { cookie: alice.cookie },
        payload: { userId: "nope" },
      });
      expect(unknown.statusCode).toBe(404);
      // draw then roster locked
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/draw`,
        headers: { cookie: alice.cookie },
      });
      const lockedAdd = await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/participants`,
        headers: { cookie: alice.cookie },
        payload: { userId: bob.id },
      });
      expect(lockedAdd.statusCode).toBe(409);
      const lockedDel = await app.inject({
        method: "DELETE",
        url: `/api/v1/events/${ev.id}/participants/${bob.id}`,
        headers: { cookie: alice.cookie },
      });
      expect(lockedDel.statusCode).toBe(409);
      // patch after draw -> 409 event_locked
      const lockedPatch = await app.inject({
        method: "PATCH",
        url: `/api/v1/events/${ev.id}`,
        headers: { cookie: alice.cookie },
        payload: { name: "late" },
      });
      expect(lockedPatch.statusCode).toBe(409);
      expect(lockedPatch.json()).toMatchObject({ error: "event_locked" });
    } finally {
      await app.close();
    }
  });

  it("exclusions: mutual default, directed, validation, authZ", async () => {
    const app = await boot();
    try {
      const alice = await loginAs(app, "alice");
      const bob = await loginAs(app, "bob");
      const carol = await loginAs(app, "carol");
      const dave = await loginAs(app, "dave");
      const ev = (await createEvent(app, alice.cookie)).json();
      for (const u of [bob, carol]) {
        await app.inject({
          method: "POST",
          url: `/api/v1/events/${ev.id}/participants`,
          headers: { cookie: alice.cookie },
          payload: { userId: u.id },
        });
      }
      // mutual default
      const mutual = await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/exclusions`,
        headers: { cookie: alice.cookie },
        payload: { giverId: alice.id, recipientId: bob.id },
      });
      expect(mutual.statusCode).toBe(201);
      expect(mutual.json().exclusions).toHaveLength(2);
      // directed
      const directed = await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/exclusions`,
        headers: { cookie: alice.cookie },
        payload: { giverId: carol.id, recipientId: alice.id, mutual: false },
      });
      expect(directed.statusCode).toBe(201);
      expect(directed.json().exclusions).toHaveLength(1);
      // non-participant -> 422, self -> 422
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/events/${ev.id}/exclusions`,
            headers: { cookie: alice.cookie },
            payload: { giverId: alice.id, recipientId: dave.id },
          })
        ).statusCode,
      ).toBe(422);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/events/${ev.id}/exclusions`,
            headers: { cookie: alice.cookie },
            payload: { giverId: alice.id, recipientId: alice.id },
          })
        ).statusCode,
      ).toBe(422);
      // non-organiser -> 403
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/events/${ev.id}/exclusions`,
            headers: { cookie: bob.cookie },
            payload: { giverId: alice.id, recipientId: carol.id },
          })
        ).statusCode,
      ).toBe(403);
      // delete mutual removes both
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/events/${ev.id}/exclusions`,
        headers: { cookie: alice.cookie },
        payload: { giverId: alice.id, recipientId: bob.id },
      });
      expect(del.statusCode).toBe(200);
      expect(del.json().removed).toBe(2);
      // list reflects server state (member-only)
      const listed = await app.inject({
        method: "GET",
        url: `/api/v1/events/${ev.id}/exclusions`,
        headers: { cookie: alice.cookie },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().exclusions).toHaveLength(1); // only carol→alice remains
      expect(listed.json().exclusions[0]).toMatchObject({ mutual: false });
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/events/${ev.id}/exclusions`,
            headers: { cookie: dave.cookie },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("draw_impossible explains the conflict", async () => {
    const app = await boot();
    try {
      const alice = await loginAs(app, "alice");
      const bob = await loginAs(app, "bob");
      const carol = await loginAs(app, "carol");
      const ev = (await createEvent(app, alice.cookie)).json();
      for (const u of [bob, carol]) {
        await app.inject({
          method: "POST",
          url: `/api/v1/events/${ev.id}/participants`,
          headers: { cookie: alice.cookie },
          payload: { userId: u.id },
        });
      }
      // Mutual alice<->carol leaves no valid derangement for 3 people.
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/exclusions`,
        headers: { cookie: alice.cookie },
        payload: { giverId: alice.id, recipientId: carol.id },
      });
      const draw = await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/draw`,
        headers: { cookie: alice.cookie },
      });
      expect(draw.statusCode).toBe(422);
      expect(draw.json()).toMatchObject({ error: "draw_impossible", participantCount: 3 });
      expect(draw.json().exclusions).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("draw + my-giftee: success, privacy, impossible, double-draw", async () => {
    const app = await boot();
    try {
      const alice = await loginAs(app, "alice");
      const bob = await loginAs(app, "bob");
      const carol = await loginAs(app, "carol");
      const ev = (await createEvent(app, alice.cookie)).json();
      for (const u of [bob, carol]) {
        await app.inject({
          method: "POST",
          url: `/api/v1/events/${ev.id}/participants`,
          headers: { cookie: alice.cookie },
          payload: { userId: u.id },
        });
      }
      // pre-draw giftee -> 404 not_drawn
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/events/${ev.id}/my-giftee`,
            headers: { cookie: alice.cookie },
          })
        ).statusCode,
      ).toBe(404);
      // non-organiser draw -> 403
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/events/${ev.id}/draw`,
            headers: { cookie: bob.cookie },
          })
        ).statusCode,
      ).toBe(403);
      const draw = await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/draw`,
        headers: { cookie: alice.cookie },
      });
      expect(draw.statusCode).toBe(200);
      // double draw -> 409
      const again = await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/draw`,
        headers: { cookie: alice.cookie },
      });
      expect(again.statusCode).toBe(409);
      // each participant sees only own giftee, no bulk read
      const seen = new Set<string>();
      for (const u of [alice, bob, carol]) {
        const g = await app.inject({
          method: "GET",
          url: `/api/v1/events/${ev.id}/my-giftee`,
          headers: { cookie: u.cookie },
        });
        expect(g.statusCode).toBe(200);
        const body = g.json();
        expect(body.giftee.id).not.toBe(u.id);
        expect(body).not.toHaveProperty("assignments");
        seen.add(body.giftee.id);
      }
      expect(seen.size).toBe(3); // bijection
      // outsider -> 403
      const dave = await loginAs(app, "dave");
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/events/${ev.id}/my-giftee`,
            headers: { cookie: dave.cookie },
          })
        ).statusCode,
      ).toBe(403);
      // impossible draw stays draft
      const ev2 = (await createEvent(app, alice.cookie, { name: "Impossible" })).json();
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev2.id}/participants`,
        headers: { cookie: alice.cookie },
        payload: { userId: bob.id },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev2.id}/exclusions`,
        headers: { cookie: alice.cookie },
        payload: { giverId: alice.id, recipientId: bob.id },
      });
      const imp = await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev2.id}/draw`,
        headers: { cookie: alice.cookie },
      });
      expect(imp.statusCode).toBe(422);
      expect(imp.json()).toMatchObject({ error: "draw_impossible" });
    } finally {
      await app.close();
    }
  });

  it("profiles + wishlist + directory with privacy", async () => {
    const app = await boot();
    try {
      const alice = await loginAs(app, "alice");
      const bob = await loginAs(app, "bob");
      const carol = await loginAs(app, "carol");
      const ev = (await createEvent(app, alice.cookie)).json();
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/participants`,
        headers: { cookie: alice.cookie },
        payload: { userId: bob.id },
      });
      // profile upsert own -> 200
      const prof = await app.inject({
        method: "PUT",
        url: `/api/v1/events/${ev.id}/profile`,
        headers: { cookie: bob.cookie },
        payload: { city: "Lyon", country: "FR" },
      });
      expect(prof.statusCode).toBe(200);
      // outsider profile -> 403
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/api/v1/events/${ev.id}/profile`,
            headers: { cookie: carol.cookie },
            payload: { city: "X" },
          })
        ).statusCode,
      ).toBe(403);
      // wishlist add/list/update/delete
      const add = await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/wishlist`,
        headers: { cookie: bob.cookie },
        payload: { label: "Book" },
      });
      expect(add.statusCode).toBe(201);
      expect(add.json()).not.toHaveProperty("priceHint");
      expect(add.json()).not.toHaveProperty("priority");
      const itemId = add.json().id as string;
      const list = await app.inject({
        method: "GET",
        url: `/api/v1/events/${ev.id}/wishlist`,
        headers: { cookie: bob.cookie },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toHaveLength(1);
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/events/${ev.id}/wishlist/${itemId}`,
        headers: { cookie: bob.cookie },
        payload: { label: "Book (hardcover)", position: 0 },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().label).toContain("hardcover");
      // cross-user write -> 403
      const aliceItem = (
        await app.inject({
          method: "POST",
          url: `/api/v1/events/${ev.id}/wishlist`,
          headers: { cookie: alice.cookie },
          payload: { label: "Alice gift" },
        })
      ).json();
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/api/v1/events/${ev.id}/wishlist/${aliceItem.id}`,
            headers: { cookie: bob.cookie },
            payload: { label: "steal" },
          })
        ).statusCode,
      ).toBe(403);
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/events/${ev.id}/wishlist/${itemId}`,
        headers: { cookie: bob.cookie },
      });
      expect(del.statusCode).toBe(200);
      // directory member 200, outsider 403, anon 401, no assignment fields
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${ev.id}/draw`,
        headers: { cookie: alice.cookie },
      });
      const dir = await app.inject({
        method: "GET",
        url: `/api/v1/events/${ev.id}/participants`,
        headers: { cookie: bob.cookie },
      });
      expect(dir.statusCode).toBe(200);
      expect(JSON.stringify(dir.json())).not.toMatch(/giftee|giver|assignment/);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/events/${ev.id}/participants`,
            headers: { cookie: carol.cookie },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: "GET", url: `/api/v1/events/${ev.id}/participants` }))
          .statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("organiser can delete an event before and after the draw", async () => {
    const app = await boot();
    try {
      const alice = await loginAs(app, "alice");
      const bob = await loginAs(app, "bob");
      // draft delete with roster + exclusions + wishlist cascading
      const draft = (await createEvent(app, alice.cookie)).json();
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${draft.id}/participants`,
        headers: { cookie: alice.cookie },
        payload: { userId: bob.id },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${draft.id}/exclusions`,
        headers: { cookie: alice.cookie },
        payload: { giverId: alice.id, recipientId: bob.id, mutual: false },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${draft.id}/wishlist`,
        headers: { cookie: bob.cookie },
        payload: { label: "Book" },
      });
      // non-organiser -> 403, anon -> 401
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/api/v1/events/${draft.id}`,
            headers: { cookie: bob.cookie },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: "DELETE", url: `/api/v1/events/${draft.id}` })).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/api/v1/events/${draft.id}`,
            headers: { cookie: alice.cookie },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/events/${draft.id}`,
            headers: { cookie: alice.cookie },
          })
        ).statusCode,
      ).toBe(404); // event is gone
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/events/${draft.id}/exclusions`,
            headers: { cookie: alice.cookie },
          })
        ).statusCode,
      ).toBe(404);
      // drawn delete cascades assignments too
      const drawn = (await createEvent(app, alice.cookie)).json();
      await app.inject({
        method: "POST",
        url: `/api/v1/events/${drawn.id}/participants`,
        headers: { cookie: alice.cookie },
        payload: { userId: bob.id },
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/events/${drawn.id}/draw`,
            headers: { cookie: alice.cookie },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/api/v1/events/${drawn.id}`,
            headers: { cookie: alice.cookie },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/events/${drawn.id}/my-giftee`,
            headers: { cookie: alice.cookie },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: "/api/v1/events/does-not-exist",
            headers: { cookie: alice.cookie },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("openapi lists new paths", async () => {
    const app = await boot();
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
      expect(res.statusCode).toBe(200);
      const paths = Object.keys(res.json().paths ?? {});
      for (const p of [
        "/api/v1/users",
        "/api/v1/events",
        "/api/v1/events/{id}",
        "/api/v1/events/{id}/participants",
        "/api/v1/events/{id}/exclusions",
        "/api/v1/events/{id}/draw",
        "/api/v1/events/{id}/my-giftee",
        "/api/v1/events/{id}/profile",
        "/api/v1/events/{id}/wishlist",
      ]) {
        expect(paths).toContain(p);
      }
    } finally {
      await app.close();
    }
  });
});
