import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

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

describe("minimal UI shell", () => {
  it("GET / serves the UI entry point (no longer hello JSON)", async () => {
    const { app } = await buildApp({ config: testConfig(), skipOidcDiscovery: true });
    try {
      const res = await app.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/html/);
      expect(res.body).toContain("Secret Santa");
      expect(res.body).not.toContain("hello");
    } finally {
      await app.close();
    }
  });

  it("GET /event.html serves the detail page", async () => {
    const { app } = await buildApp({ config: testConfig(), skipOidcDiscovery: true });
    try {
      const res = await app.inject({ method: "GET", url: "/event.html?id=abc" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/html/);
    } finally {
      await app.close();
    }
  });

  it("non-/api/ misses fall back to the UI; /api/* misses stay JSON 404", async () => {
    const { app } = await buildApp({
      config: testConfig({ DEV_LOGIN: "true" }),
      skipOidcDiscovery: true,
    });
    try {
      const page = await app.inject({ method: "GET", url: "/some-client-route" });
      expect(page.statusCode).toBe(200);
      expect(page.headers["content-type"]).toMatch(/html/);

      // /api/v1/* requires a session; mint one via dev-login first.
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/dev-login",
        payload: { user: "alice" },
      });
      expect(login.statusCode).toBe(200);
      const setCookie = login.headers["set-cookie"];
      const cookie = (Array.isArray(setCookie) ? setCookie[0] : (setCookie as string)).split(
        ";",
      )[0];
      const api = await app.inject({ method: "GET", url: "/api/v1/nope", headers: { cookie } });
      expect(api.statusCode).toBe(404);
      expect(api.json()).toMatchObject({ error: "not_found" });
    } finally {
      await app.close();
    }
  });

  it("GET /api/health returns ok with db status", async () => {
    const { app } = await buildApp({ config: testConfig(), skipOidcDiscovery: true });
    try {
      const res = await app.inject({ method: "GET", url: "/api/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "ok", service: "secret-santa", db: "ok" });
    } finally {
      await app.close();
    }
  });

  it("loadConfig rejects bad APP_ORIGIN", () => {
    expect(() =>
      loadConfig({ ...process.env, APP_ORIGIN: "not-a-url" } as NodeJS.ProcessEnv),
    ).toThrow(/APP_ORIGIN/);
  });

  it("loadConfig requires SESSION_SECRET in production", () => {
    expect(() =>
      loadConfig({
        ...process.env,
        NODE_ENV: "production",
        SESSION_SECRET: "",
        DATABASE_PATH: ":memory:",
      } as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_SECRET/);
  });
});

describe("auth gate", () => {
  it("GET /api/auth/me is 401 without a session", async () => {
    const { app } = await buildApp({ config: testConfig(), skipOidcDiscovery: true });
    try {
      const res = await app.inject({ method: "GET", url: "/api/auth/me" });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("GET /api/auth/login is 503 when OIDC is not configured", async () => {
    const { app } = await buildApp({ config: testConfig(), skipOidcDiscovery: true });
    try {
      const res = await app.inject({ method: "GET", url: "/api/auth/login" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: "auth_not_configured" });
    } finally {
      await app.close();
    }
  });

  it("dev-login mints a session cookie that /api/auth/me accepts", async () => {
    const { app } = await buildApp({
      config: testConfig({ DEV_LOGIN: "true" }),
      skipOidcDiscovery: true,
    });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/dev-login",
        payload: { user: "alice" },
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.headers["set-cookie"];
      expect(cookie).toBeDefined();
      const sessionCookie = (Array.isArray(cookie) ? cookie[0] : (cookie as string)).split(";")[0];

      const me = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: sessionCookie },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ displayName: "alice" });
    } finally {
      await app.close();
    }
  });

  it("dev-login route does not exist when DEV_LOGIN is off", async () => {
    const { app } = await buildApp({ config: testConfig(), skipOidcDiscovery: true });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/dev-login",
        payload: { user: "alice" },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
