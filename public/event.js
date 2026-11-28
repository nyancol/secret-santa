/* Event detail page: facts, edit, roster/invite, exclusions, draw, giftee,
 * profile, wishlist, directory. Full re-fetch after mutations; no optimistic state. */
"use strict";

const state = {
  eventId: null,
  me: null,
  event: null, // detail payload incl. roster
  directory: [],
  wishlist: [],
  profilePrefilled: false,
  // Exclusion pairs, loaded from GET .../exclusions on every refresh.
  exclusions: [],
};

document.addEventListener("DOMContentLoaded", async () => {
  state.eventId = new URLSearchParams(window.location.search).get("id");
  state.me = await SantaApp.initHeader();
  if (!state.me) {
    document.getElementById("login-prompt").hidden = false;
    return;
  }
  if (!state.eventId) {
    showFatal("Missing event id. Go back to the events list.");
    return;
  }
  wireForms();
  await refresh();
});

function showFatal(message) {
  const section = document.getElementById("event-section");
  section.hidden = false;
  SantaApp.setAlert(document.getElementById("event-error"), message);
}

function wireForms() {
  document.getElementById("edit-form").addEventListener("submit", onEditSubmit);
  document.getElementById("invite-search-form").addEventListener("submit", onInviteSearch);
  document.getElementById("exclusion-form").addEventListener("submit", onExclusionAdd);
  const drawBtn = document.getElementById("draw-btn");
  drawBtn.addEventListener("click", onDraw);
  document.getElementById("delete-btn").addEventListener("click", onDelete);
  document.getElementById("profile-form").addEventListener("submit", onProfileSave);
  document.getElementById("wishlist-form").addEventListener("submit", onWishlistAdd);
}

/** Re-fetch detail + directory + own wishlist, then re-render everything. */
async function refresh() {
  const err = document.getElementById("event-error");
  const detail = await SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}`);
  if (detail.status === 401) {
    showFatal(SantaApp.errorMessage("unauthorized"));
    return;
  }
  if (detail.status === 403 || detail.status === 404) {
    showFatal(SantaApp.errorMessage(SantaApp.apiError(detail)));
    return;
  }
  if (!detail.ok) {
    showFatal(SantaApp.errorMessage(SantaApp.apiError(detail)));
    return;
  }
  state.event = detail.data;
  SantaApp.setAlert(err, null);
  document.getElementById("event-section").hidden = false;

  // Directory + wishlist + exclusions load alongside; failures render inline, not fatal.
  const [dir, wish, excl] = await Promise.all([
    SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}/participants`),
    SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}/wishlist`),
    SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}/exclusions`),
  ]);
  state.directory = dir.ok ? dir.data || [] : [];
  if (!dir.ok) {
    SantaApp.setAlert(
      document.getElementById("directory-error"),
      SantaApp.errorMessage(SantaApp.apiError(dir)),
    );
  } else {
    SantaApp.setAlert(document.getElementById("directory-error"), null);
  }
  state.wishlist = wish.ok ? wish.data || [] : [];
  state.exclusions = excl.ok ? excl.data?.exclusions || [] : [];

  renderFacts();
  renderEdit();
  renderDelete();
  renderRoster();
  renderExclusions();
  renderDraw();
  await renderGiftee();
  renderProfile();
  renderWishlist();
  renderDirectory();
}

function renderDelete() {
  // Organiser-only, available in draft AND after the draw.
  const section = document.getElementById("delete-section");
  section.hidden = !isOrganiser();
}

async function onDelete() {
  const err = document.getElementById("delete-error");
  if (!window.confirm("Delete this event and all its data? This cannot be undone.")) return;
  const res = await SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
    return;
  }
  window.location.href = "/";
}

function isOrganiser() {
  // List endpoint reports role; detail does not — fall back to organiserId.
  return (
    state.event?.role === "organiser" ||
    (state.me && state.event && state.event.organiserId === state.me.id)
  );
}

function isDraft() {
  return state.event?.status === "draft";
}

function renderFacts() {
  const e = state.event;
  const name = document.getElementById("event-name");
  SantaApp.clear(name);
  name.appendChild(document.createTextNode(e.name || "(unnamed)"));
  const facts = document.getElementById("event-facts");
  SantaApp.clear(facts);
  const rows = [
    ["Status", e.status],
    ["Budget", e.budgetAmount != null ? `${e.budgetAmount} ${e.budgetCurrency || ""}`.trim() : "—"],
    ["Description", e.description || "—"],
  ];
  for (const [k, v] of rows) {
    facts.appendChild(SantaApp.el("dt", k));
    facts.appendChild(SantaApp.el("dd", String(v)));
  }
}

function renderEdit() {
  const section = document.getElementById("edit-section");
  const show = isOrganiser() && isDraft();
  section.hidden = !show;
  if (!show) return;
  const e = state.event;
  const form = document.getElementById("edit-form");
  if (form.dataset.loaded !== e.id) {
    form.elements.name.value = e.name || "";
    form.elements.description.value = e.description || "";
    form.elements.budgetAmount.value = e.budgetAmount ?? "";
    form.elements.budgetCurrency.value = e.budgetCurrency || "";
    form.dataset.loaded = e.id;
  }
}

async function onEditSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;
  const err = document.getElementById("edit-error");
  const payload = {};
  const str = (f) => form.elements[f].value.trim();
  // Send all editable fields; blanks become null-cleared via empty string.
  payload.name = str("name");
  payload.description = str("description");
  if (form.elements.budgetAmount.value !== "")
    payload.budgetAmount = Number(form.elements.budgetAmount.value);
  if (str("budgetCurrency")) payload.budgetCurrency = str("budgetCurrency");
  const res = await SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    SantaApp.setAlert(err, null);
    form.dataset.loaded = "";
    await refresh(); // re-render updated facts
    return;
  }
  const code = SantaApp.apiError(res);
  if (code === "event_locked" || code === "already_drawn") {
    await refresh(); // refresh to the drawn state
    return;
  }
  // 422 validation_error: keep entered values, show inline error.
  SantaApp.setAlert(err, SantaApp.errorMessage(code));
}

function rosterName(id) {
  const m = (state.event.roster || []).find((r) => r.id === id);
  return m?.displayName || id;
}

function renderRoster() {
  const list = document.getElementById("roster-list");
  SantaApp.clear(list);
  for (const m of state.event.roster || []) {
    const li = SantaApp.el("li", m.displayName || m.id);
    if (isOrganiser() && isDraft()) {
      li.appendChild(document.createTextNode(" "));
      const btn = SantaApp.el("button", "Remove", { type: "button", "data-user": m.id });
      btn.addEventListener("click", () => onRosterRemove(m.id));
      li.appendChild(btn);
    }
    list.appendChild(li);
  }
  document.getElementById("invite-block").hidden = !(isOrganiser() && isDraft());
  document.getElementById("exclusions-section").hidden = !(isOrganiser() && isDraft());
  if (isOrganiser() && isDraft()) void loadInviteList("");
}

async function onRosterRemove(userId) {
  // Path-param form, no body (per spec).
  await SantaApp.api(
    `/api/v1/events/${encodeURIComponent(state.eventId)}/participants/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
  await refresh();
}

async function onInviteSearch(ev) {
  ev.preventDefault();
  await loadInviteList(ev.target.elements.q.value.trim());
}

/** List users available to invite (empty query = recent users); roster members are flagged. */
async function loadInviteList(q) {
  const err = document.getElementById("invite-error");
  const res = await SantaApp.api(`/api/v1/users${q ? `?search=${encodeURIComponent(q)}` : ""}`);
  const box = document.getElementById("invite-results");
  SantaApp.clear(box);
  if (!res.ok) {
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
    return;
  }
  SantaApp.setAlert(err, null);
  const onRoster = new Set((state.event.roster || []).map((r) => r.id));
  for (const u of res.data || []) {
    const li = SantaApp.el("li", u.displayName || u.id);
    if (!onRoster.has(u.id)) {
      li.appendChild(document.createTextNode(" "));
      const btn = SantaApp.el("button", "Add", { type: "button", "data-user": u.id });
      btn.addEventListener("click", () => onInviteAdd(u.id));
      li.appendChild(btn);
    } else {
      li.appendChild(document.createTextNode(" (already in roster)"));
    }
    box.appendChild(li);
  }
  if ((res.data || []).length === 0) box.appendChild(SantaApp.el("li", "No users found."));
}

async function onInviteAdd(userId) {
  const err = document.getElementById("invite-error");
  const res = await SantaApp.api(
    `/api/v1/events/${encodeURIComponent(state.eventId)}/participants`,
    { method: "POST", body: JSON.stringify({ userId }) },
  );
  if (!res.ok && res.status !== 201) {
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
    return;
  }
  SantaApp.setAlert(err, null);
  await refresh();
}

function renderExclusions() {
  const section = document.getElementById("exclusions-section");
  if (section.hidden) return;
  const list = document.getElementById("exclusions-list");
  SantaApp.clear(list);
  for (const x of state.exclusions) {
    const giver = x.giverDisplayName || rosterName(x.giverId);
    const recipient = x.recipientDisplayName || rosterName(x.recipientId);
    // De-dupe the mirror row of a mutual pair (backend returns both directions).
    if (x.mutual && String(x.giverId) > String(x.recipientId)) continue;
    const li = SantaApp.el("li", `${giver} cannot gift ${recipient}${x.mutual ? " (mutual)" : ""}`);
    li.appendChild(document.createTextNode(" "));
    const btn = SantaApp.el("button", "Remove", { type: "button" });
    btn.addEventListener("click", () => onExclusionRemove(x));
    li.appendChild(btn);
    list.appendChild(li);
  }
  // Populate selects from the roster.
  const form = document.getElementById("exclusion-form");
  for (const name of ["giver", "recipient"]) {
    const sel = form.elements[name];
    SantaApp.clear(sel);
    for (const m of state.event.roster || []) {
      sel.appendChild(SantaApp.el("option", m.displayName || m.id));
      sel.lastChild.value = m.id;
    }
  }
}

async function onExclusionAdd(ev) {
  ev.preventDefault();
  const form = ev.target;
  const err = document.getElementById("exclusion-error");
  const giverId = form.elements.giver.value;
  const recipientId = form.elements.recipient.value;
  const mutual = form.elements.mutual.checked;
  if (!giverId || !recipientId) {
    SantaApp.setAlert(err, "Pick two participants for the exclusion.");
    return;
  }
  if (giverId === recipientId) {
    // Self-gifts are already impossible (every draw is a derangement).
    SantaApp.setAlert(
      err,
      "Someone cannot be excluded with themselves — nobody ever gifts themselves.",
    );
    return;
  }
  const res = await SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}/exclusions`, {
    method: "POST",
    body: JSON.stringify({ giverId, recipientId, mutual }),
  });
  if (res.status !== 201) {
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
    return;
  }
  SantaApp.setAlert(err, null);
  await reloadExclusions();
}

async function reloadExclusions() {
  const res = await SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}/exclusions`);
  if (res.ok) state.exclusions = res.data?.exclusions || [];
  renderExclusions();
}

async function onExclusionRemove(x) {
  const err = document.getElementById("exclusion-error");
  const res = await SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}/exclusions`, {
    method: "DELETE",
    body: JSON.stringify({
      giverId: x.giverId,
      recipientId: x.recipientId,
      mutual: x.mutual !== false,
    }),
  });
  if (!res.ok) {
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
    return;
  }
  SantaApp.setAlert(err, null);
  await reloadExclusions();
}

function renderDraw() {
  const section = document.getElementById("draw-section");
  section.hidden = !(isOrganiser() && isDraft());
}

async function onDraw() {
  const err = document.getElementById("draw-error");
  const res = await SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}/draw`, {
    method: "POST",
  });
  if (res.ok) {
    SantaApp.setAlert(err, null);
    await refresh(); // status flips to drawn; editing controls hide
    return;
  }
  const code = SantaApp.apiError(res);
  if (code === "already_drawn") {
    await refresh(); // refresh to drawn state instead of crashing
    return;
  }
  if (code === "draw_impossible") {
    SantaApp.setAlert(err, describeImpossibleDraw(res.data));
    return;
  }
  // Other errors: banner, stay on draft.
  SantaApp.setAlert(err, SantaApp.errorMessage(code));
}

/** Human-readable explanation of a 422 draw_impossible payload. */
function describeImpossibleDraw(data) {
  const n = data?.participantCount;
  const pairs = data?.exclusions || state.exclusions;
  const names = (pairs || []).map((x) => {
    const g = x.giverDisplayName || rosterName(x.giverId);
    const r = x.recipientDisplayName || rosterName(x.recipientId);
    const bothWays =
      x.mutual ||
      (pairs || []).some((y) => y.giverId === x.recipientId && y.recipientId === x.giverId);
    return bothWays && String(x.giverId) > String(x.recipientId)
      ? null
      : `${g} ${bothWays ? "↔" : "↛"} ${r}`;
  });
  const unique = [...new Set(names.filter(Boolean))];
  let msg = `No valid draw${typeof n === "number" ? ` with ${n} participant${n === 1 ? "" : "s"}` : ""}`;
  if (unique.length) msg += ` given these exclusions: ${unique.join("; ")}`;
  msg +=
    ". Nobody can gift themselves, so tight exclusions in a small group can block every combination — remove or loosen a pair and try again.";
  return msg;
}

async function renderGiftee() {
  const text = document.getElementById("giftee-text");
  SantaApp.clear(text);
  const res = await SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}/my-giftee`);
  if (res.ok) {
    text.appendChild(
      document.createTextNode(
        `Your giftee: ${res.data.giftee?.displayName || res.data.giftee?.id || "?"}`,
      ),
    );
    return;
  }
  const code = SantaApp.apiError(res);
  if (code === "not_drawn") {
    text.appendChild(document.createTextNode(SantaApp.errorMessage("not_drawn")));
    return;
  }
  text.appendChild(document.createTextNode(SantaApp.errorMessage(code)));
}

function renderProfile() {
  if (state.profilePrefilled) return;
  const self = (state.directory || []).find((d) => d.userId === state.me.id);
  if (!self?.profile) return;
  const form = document.getElementById("profile-form");
  const p = self.profile;
  for (const f of [
    "recipientName",
    "addressLine1",
    "addressLine2",
    "city",
    "postalCode",
    "country",
    "phone",
    "notes",
  ]) {
    if (p[f] != null) form.elements[f].value = p[f];
  }
  state.profilePrefilled = true;
}

async function onProfileSave(ev) {
  ev.preventDefault();
  const form = ev.target;
  const err = document.getElementById("profile-error");
  const status = document.getElementById("profile-status");
  const payload = {};
  for (const f of [
    "recipientName",
    "addressLine1",
    "addressLine2",
    "city",
    "postalCode",
    "country",
    "phone",
    "notes",
  ]) {
    payload[f] = form.elements[f].value.trim() || null;
  }
  const res = await SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}/profile`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // 422: keep typed values, show inline error.
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
    SantaApp.setAlert(status, null);
    return;
  }
  SantaApp.setAlert(err, null);
  SantaApp.setAlert(status, "Profile saved.");
  await refresh();
  state.profilePrefilled = true;
}

function renderWishlist() {
  const list = document.getElementById("wishlist-list");
  SantaApp.clear(list);
  state.wishlist.forEach((item, idx) => {
    const li = SantaApp.el("li");
    const head = SantaApp.el("span", item.label);
    if (item.url) head.textContent += ` (${item.url})`;
    li.appendChild(head);

    const up = SantaApp.el("button", "↑", {
      type: "button",
      "aria-label": `move ${item.label} up`,
    });
    up.disabled = idx === 0;
    up.addEventListener("click", () => onWishlistMove(item, idx - 1));
    const down = SantaApp.el("button", "↓", {
      type: "button",
      "aria-label": `move ${item.label} down`,
    });
    down.disabled = idx === state.wishlist.length - 1;
    down.addEventListener("click", () => onWishlistMove(item, idx + 1));
    const editBtn = SantaApp.el("button", "Edit", { type: "button" });
    const delBtn = SantaApp.el("button", "Delete", { type: "button" });
    delBtn.addEventListener("click", () => onWishlistDelete(item));
    li.appendChild(document.createTextNode(" "));
    li.appendChild(up);
    li.appendChild(document.createTextNode(" "));
    li.appendChild(down);
    li.appendChild(document.createTextNode(" "));
    li.appendChild(editBtn);
    li.appendChild(document.createTextNode(" "));
    li.appendChild(delBtn);

    const editForm = buildWishlistEditForm(item);
    editForm.hidden = true;
    editBtn.addEventListener("click", () => {
      editForm.hidden = !editForm.hidden;
    });
    li.appendChild(editForm);
    list.appendChild(li);
  });
}

function buildWishlistEditForm(item) {
  const form = SantaApp.el("form");
  const label = SantaApp.el("input", null, { name: "label", value: item.label, maxlength: "300" });
  label.setAttribute("aria-label", "label");
  const url = SantaApp.el("input", null, { name: "url", maxlength: "2000" });
  url.value = item.url || "";
  url.setAttribute("aria-label", "url");
  const save = SantaApp.el("button", "Save", { type: "submit" });
  form.appendChild(label);
  form.appendChild(document.createTextNode(" "));
  form.appendChild(url);
  form.appendChild(document.createTextNode(" "));
  form.appendChild(save);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = document.getElementById("wishlist-error");
    const payload = { label: label.value.trim() };
    payload.url = url.value.trim() || null;
    const res = await SantaApp.api(
      `/api/v1/events/${encodeURIComponent(state.eventId)}/wishlist/${encodeURIComponent(item.id)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
    if (!res.ok) {
      SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
      return;
    }
    SantaApp.setAlert(err, null);
    await refresh();
  });
  return form;
}

async function onWishlistAdd(ev) {
  ev.preventDefault();
  const form = ev.target;
  const err = document.getElementById("wishlist-error");
  const payload = { label: form.elements.label.value.trim() };
  if (form.elements.url.value.trim()) payload.url = form.elements.url.value.trim();
  const res = await SantaApp.api(`/api/v1/events/${encodeURIComponent(state.eventId)}/wishlist`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (res.status !== 201) {
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
    return;
  }
  SantaApp.setAlert(err, null);
  form.reset();
  await refresh();
}

async function onWishlistMove(item, to) {
  const err = document.getElementById("wishlist-error");
  const res = await SantaApp.api(
    `/api/v1/events/${encodeURIComponent(state.eventId)}/wishlist/${encodeURIComponent(item.id)}`,
    { method: "PATCH", body: JSON.stringify({ position: to }) },
  );
  if (!res.ok) {
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
    return;
  }
  SantaApp.setAlert(err, null);
  await refresh();
}

async function onWishlistDelete(item) {
  const err = document.getElementById("wishlist-error");
  const res = await SantaApp.api(
    `/api/v1/events/${encodeURIComponent(state.eventId)}/wishlist/${encodeURIComponent(item.id)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
    return;
  }
  SantaApp.setAlert(err, null);
  await refresh();
}

function renderDirectory() {
  const list = document.getElementById("directory-list");
  SantaApp.clear(list);
  // Privacy: directory payload carries names, profiles, wishlists only — never assignments.
  for (const m of state.directory) {
    const li = SantaApp.el("li");
    li.appendChild(SantaApp.el("strong", m.displayName || m.userId));
    const bits = [];
    const p = m.profile || {};
    for (const f of ["recipientName", "city", "country"]) {
      if (p[f]) bits.push(p[f]);
    }
    if (bits.length) li.appendChild(SantaApp.el("span", ` — ${bits.join(", ")}`));
    const wishes = m.wishlist || [];
    if (wishes.length) {
      const sub = SantaApp.el("ul");
      for (const w of wishes) sub.appendChild(SantaApp.el("li", w.label));
      li.appendChild(sub);
    }
    list.appendChild(li);
  }
  if (state.directory.length === 0) list.appendChild(SantaApp.el("li", "No participants yet."));
}
