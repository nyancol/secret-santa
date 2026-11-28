/* Shared same-origin API client + session header for the Secret Santa minimal UI.
 * Rules: same-origin relative fetch with credentials:include only; no external
 * scripts; all DOM wiring via addEventListener (CSP scriptSrc 'self'). */
"use strict";

const SantaApp = (() => {
  /** Same-origin JSON fetch. Returns { status, ok, data }. */
  async function api(path, options = {}) {
    const init = { credentials: "include", method: "GET", ...options };
    if (
      init.body !== undefined &&
      !init.headers?.["Content-Type"] &&
      !init.headers?.["content-type"]
    ) {
      init.headers = { ...(init.headers || {}), "Content-Type": "application/json" };
    }
    const res = await fetch(path, init);
    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { status: res.status, ok: res.ok, data };
  }

  function apiError(resp) {
    return resp?.data?.error || `http_${resp?.status ?? "error"}`;
  }

  const ERROR_MESSAGES = {
    validation_error: "Invalid input — please check the highlighted fields.",
    draw_impossible:
      "No valid draw with the current roster/exclusions. Adjust the roster or exclusions and try again.",
    already_drawn: "This event was already drawn. Refreshing…",
    event_locked: "This event is locked (already drawn). Refreshing…",
    not_drawn: "The draw has not happened yet — come back after the organiser draws.",
    not_found: "Not found. It may have been removed.",
    forbidden: "You do not have access to this.",
    unauthorized: "Your session expired. Please log in again.",
    auth_not_configured: "Login is not configured on this server.",
  };

  function errorMessage(code, fallback) {
    if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    return fallback || "Something went wrong. Please try again.";
  }

  /** Create an element with optional text content (safe: uses textContent). */
  function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setAlert(node, message) {
    clear(node);
    if (!message) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    node.appendChild(document.createTextNode(message));
  }

  function loginLink() {
    // Full-page navigation: /api/auth/login 302s to the IdP; fetch would not complete the flow.
    return el("a", "Login", { href: "/api/auth/login" });
  }

  async function initHeader() {
    const slot = document.getElementById("session");
    if (!slot) return null;
    clear(slot);
    slot.appendChild(el("span", "Checking session…"));

    const me = await api("/api/auth/me");
    clear(slot);
    if (me.status === 401 || me.status === 403) {
      slot.appendChild(loginLink());
      await maybeDevLogin(slot);
      return null;
    }
    if (!me.ok) {
      slot.appendChild(el("span", `Session check failed (${apiError(me)})`));
      slot.appendChild(document.createTextNode(" "));
      slot.appendChild(loginLink());
      return null;
    }
    const who = me.data.displayName || me.data.id || "you";
    slot.appendChild(el("span", `Signed in as ${who} `));
    const btn = el("button", "Logout", { type: "button", id: "logout-btn" });
    btn.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" });
      window.location.reload();
    });
    slot.appendChild(btn);
    return me.data;
  }

  /** Dev-only login form; the probe 404s when DEV_LOGIN is off (incl. prod). */
  async function maybeDevLogin(slot) {
    let probe;
    try {
      probe = await api("/api/auth/dev-login");
    } catch {
      return;
    }
    if (!probe.ok) return;
    const form = el("form", null, { id: "dev-login-form" });
    form.appendChild(el("span", " Dev login: "));
    const input = el("input", null, { name: "user", placeholder: "username", maxlength: "32" });
    input.setAttribute("aria-label", "dev username");
    form.appendChild(input);
    form.appendChild(document.createTextNode(" "));
    const btn = el("button", "Dev login", { type: "submit" });
    form.appendChild(btn);
    const err = el("p", null, { id: "dev-login-error", role: "alert" });
    err.hidden = true;
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const name = input.value.trim() || "dev";
      const res = await api("/api/auth/dev-login", {
        method: "POST",
        body: JSON.stringify({ user: name }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setAlert(err, errorMessage(apiError(res)));
      slot.appendChild(err);
    });
    slot.appendChild(document.createTextNode(" "));
    slot.appendChild(form);
  }

  return { api, apiError, errorMessage, el, clear, setAlert, initHeader, loginLink };
})();
