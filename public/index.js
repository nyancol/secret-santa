/* Event list + create form (index page). */
"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const me = await SantaApp.initHeader();
  if (!me) {
    document.getElementById("login-prompt").hidden = false;
    return;
  }
  const section = document.getElementById("events-section");
  section.hidden = false;
  await loadEvents();

  document.getElementById("create-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const err = document.getElementById("create-error");
    const payload = {
      name: form.elements.name.value.trim(),
      budgetAmount: Number(form.elements.budgetAmount.value),
      budgetCurrency: form.elements.budgetCurrency.value.trim(),
    };
    if (form.elements.description.value.trim())
      payload.description = form.elements.description.value.trim();
    const res = await SantaApp.api("/api/v1/events", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.status === 201) {
      window.location.href = `/event.html?id=${encodeURIComponent(res.data.id)}`;
      return;
    }
    // 422 validation_error: keep entered values, show inline error.
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
  });
});

async function loadEvents() {
  const err = document.getElementById("events-error");
  const list = document.getElementById("event-list");
  const empty = document.getElementById("empty-state");
  const res = await SantaApp.api("/api/v1/events");
  SantaApp.clear(list);
  if (res.status === 401) {
    SantaApp.setAlert(err, SantaApp.errorMessage("unauthorized"));
    return;
  }
  if (!res.ok) {
    SantaApp.setAlert(err, SantaApp.errorMessage(SantaApp.apiError(res)));
    return;
  }
  SantaApp.setAlert(err, null);
  const events = res.data || [];
  empty.hidden = events.length !== 0;
  for (const e of events) {
    const li = SantaApp.el("li");
    const link = SantaApp.el("a", e.name || "(unnamed)", {
      href: `/event.html?id=${encodeURIComponent(e.id)}`,
    });
    li.appendChild(link);
    li.appendChild(document.createTextNode(` — ${e.status || "draft"} `));
    li.appendChild(SantaApp.el("span", e.role || "member", { class: "badge" }));
    list.appendChild(li);
  }
}
