import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { signSession, verifySession } from "../src/auth/session.js";
import { loadConfig } from "../src/config.js";
import { openDb, runMigrations } from "../src/db/index.js";
import { isSameOrigin } from "../src/security.js";

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

async function devLoginCookie(app: any): Promise<string> {
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/dev-login",
    payload: { user: "alice" },
  });
  expect(login.statusCode).toBe(200);
  const setCookie = login.headers["set-cookie"];
  return (Array.isArray(setCookie) ? setCookie[0] : (setCookie as string)).split(";")[0];
}

describe("session", () => {
  it("round-trips a signed user id", async () => {
    const token = await signSession("test-only-secret-32-chars-minimum!!", "user-1");
    await expect(verifySession("test-only-secret-32-chars-minimum!!", token)).resolves.toBe(
      "user-1",
    );
  });

  it("rejects garbage tokens and wrong secrets", async () => {
    await expect(verifySession("test-only-secret-32-chars-minimum!!", "nope")).resolves.toBeNull();
    const token = await signSession("test-only-secret-32-chars-minimum!!", "user-1");
    await expect(verifySession("a-different-secret-32-chars-minimum!", token)).resolves.toBeNull();
  });
});

describe("auth routes without OIDC", () => {
  it("GET /api/auth/callback is 503 when OIDC is not configured", async () => {
    const { app } = await buildApp({ config: testConfig(), skipOidcDiscovery: true });
    try {
      const res = await app.inject({ method: "GET", url: "/api/auth/callback?code=x&state=y" });
      expect(res.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it("POST /api/auth/logout clears the session", async () => {
    const { app } = await buildApp({
      config: testConfig({ DEV_LOGIN: "true" }),
      skipOidcDiscovery: true,
    });
    try {
      const cookie = await devLoginCookie(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("GET /api/auth/me is 401 on a garbage cookie", async () => {
    const { app } = await buildApp({ config: testConfig(), skipOidcDiscovery: true });
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: "oyster_session=nope" },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("dev-login rejects invalid user names and exposes a probe", async () => {
    const { app } = await buildApp({
      config: testConfig({ DEV_LOGIN: "true" }),
      skipOidcDiscovery: true,
    });
    try {
      const probe = await app.inject({ method: "GET", url: "/api/auth/dev-login" });
      expect(probe.statusCode).toBe(200);
      const bad = await app.inject({
        method: "POST",
        url: "/api/auth/dev-login",
        payload: { user: "not a name!!!" },
      });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe("CSRF guard", () => {
  it("rejects cross-origin state-changing requests with cookies", async () => {
    const { app } = await buildApp({
      config: testConfig({ DEV_LOGIN: "true" }),
      skipOidcDiscovery: true,
    });
    try {
      const cookie = await devLoginCookie(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie, origin: "https://evil.example.com" },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("allows same-origin state-changing requests with cookies", async () => {
    const { app } = await buildApp({
      config: testConfig({ DEV_LOGIN: "true" }),
      skipOidcDiscovery: true,
    });
    try {
      const cookie = await devLoginCookie(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie, origin: "http://localhost:32299" },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe("isSameOrigin", () => {
  const origin = "http://localhost:32299";

  it("allows non-browser requests without origin/referer", () => {
    expect(isSameOrigin({ headers: {} }, origin)).toBe(true);
  });

  it("allows matching origin and referer", () => {
    expect(isSameOrigin({ headers: { origin } }, origin)).toBe(true);
    expect(isSameOrigin({ headers: { referer: `${origin}/x` } }, origin)).toBe(true);
  });

  it("rejects mismatched or unparsable origins", () => {
    expect(isSameOrigin({ headers: { origin: "https://evil.example.com" } }, origin)).toBe(false);
    expect(isSameOrigin({ headers: { origin: "::bad", host: "other:1" } }, origin)).toBe(false);
  });
});

describe("config validation", () => {
  it("rejects a malformed OIDC_ISSUER", () => {
    expect(() =>
      loadConfig({ ...process.env, OIDC_ISSUER: "not-a-url" } as NodeJS.ProcessEnv),
    ).toThrow(/OIDC_ISSUER/);
  });

  it("requires OIDC_CLIENT_SECRET when issuer+client are set", () => {
    expect(() =>
      loadConfig({
        ...process.env,
        OIDC_ISSUER: "https://id.example.com",
        OIDC_CLIENT_ID: "abc",
        OIDC_CLIENT_SECRET: "",
        DATABASE_PATH: ":memory:",
      } as NodeJS.ProcessEnv),
    ).toThrow(/OIDC_CLIENT_SECRET/);
  });

  it("rejects a malformed OIDC_REDIRECT_URI", () => {
    expect(() =>
      loadConfig({
        ...process.env,
        OIDC_ISSUER: "https://id.example.com",
        OIDC_CLIENT_ID: "abc",
        OIDC_CLIENT_SECRET: "s3cret",
        OIDC_REDIRECT_URI: "::bad",
        DATABASE_PATH: ":memory:",
      } as NodeJS.ProcessEnv),
    ).toThrow(/OIDC_REDIRECT_URI/);
  });

  it("rejects an invalid PORT", () => {
    expect(() =>
      loadConfig({
        ...process.env,
        PORT: "abc",
        APP_ORIGIN: "http://localhost:3222",
        DATABASE_PATH: ":memory:",
      } as NodeJS.ProcessEnv),
    ).toThrow(/PORT/);
  });

  it("defaults to secure cookies in production and disables dev login there", () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: "production",
      SESSION_SECRET: "prod-secret-32-chars-minimum!!!!",
      DEV_LOGIN: "true",
      DATABASE_PATH: ":memory:",
      APP_ORIGIN: "https://secret-santa.example.com",
    } as NodeJS.ProcessEnv);
    expect(config.cookieSecure).toBe(true);
    expect(config.devLoginEnabled).toBe(false);
  });
});

describe("db migrations", () => {
  it("creates nested data dirs and skips already-applied migrations", () => {
    const dir = mkdtempSync(join(tmpdir(), "santa-db-"));
    const { sqlite } = openDb(join(dir, "nested", "app.db"));
    try {
      runMigrations(sqlite);
      runMigrations(sqlite); // second run: all versions already applied
      const rows = sqlite.prepare(`SELECT version FROM __migrations`).all() as {
        version: number;
      }[];
      expect(rows.map((r) => r.version)).toEqual([1, 2]);
    } finally {
      sqlite.close();
    }
  });
});

describe("app without skipped discovery", () => {
  it("boots dark with an OIDC warning when nothing is configured", async () => {
    const { app, oidcFailed } = await buildApp({ config: testConfig() });
    try {
      expect(oidcFailed).toBeUndefined();
      const res = await app.inject({ method: "GET", url: "/api/auth/login" });
      expect(res.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it("answers 404 JSON on unknown /api/ routes, UI fallback on unknown pages", async () => {
    const { app } = await buildApp({ config: testConfig(), skipOidcDiscovery: true });
    try {
      const api = await app.inject({ method: "GET", url: "/api/nope" });
      expect(api.statusCode).toBe(404);
      expect(api.json()).toMatchObject({ error: "not_found" });
      const page = await app.inject({ method: "GET", url: "/nope" });
      expect(page.statusCode).toBe(200);
      expect(page.headers["content-type"]).toMatch(/html/);
    } finally {
      await app.close();
    }
  });
});
