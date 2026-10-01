const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAppDocument, buildManagementDocument, flush, loadScript } = require("./frontend_harness");

const key = "football-attendance:management-links";
const fallbackKey = `${key}:tab-fallback`;
const tokenA = "a".repeat(43);
const tokenB = "b".repeat(43);
const pathA = `/inscriere/${tokenA}`;
const pathB = `/inscriere/${tokenB}`;
const blocked = { get: true, set: true };

function player(id, active = true) {
  return { id, name: `Player ${id}`, createdAt: "2026-10-01 12:00:00", active, position: active ? id : null, status: active ? "confirmed" : "withdrawn" };
}

function dashboard(eventKey = "friday", overrides = {}) {
  return {
    eventKey, weekKey: "2026-W40", weekLabel: "02 Oct 2026",
    signupWindow: { isOpen: true, scheduleOpen: true, mode: "auto" },
    registrations: [player(1), player(2), player(3)],
    ...overrides,
  };
}

function managed(ids, eventKey = "friday") {
  return { eventKey, weekKey: "2026-W40", weekLabel: "02 Oct 2026", registrations: ids.map(id => player(id)) };
}

function bootResponses(eventKey = "friday") {
  return [{ body: { enabled: false } }, { body: dashboard(eventKey) }];
}

for (const eventKey of ["friday", "wednesday"]) {
  test(`all ${eventKey} players remain manageable after signup and a fresh browser page`, async () => {
    const app = loadScript("app.js", buildAppDocument(), [
      ...bootResponses(eventKey),
      { status: 201, body: dashboard(eventKey, { submittedRegistrationIds: [1], managementPath: pathA }) },
      { status: 201, body: dashboard(eventKey, { submittedRegistrationIds: [2, 3], managementPath: pathB }) },
    ], { pathname: eventKey === "wednesday" ? "/miercuri" : "/" });
    await flush();
    app.document.getElementById("person1").value = "Player 1";
    await app.context.submitRegistration({ preventDefault() {} });
    app.document.getElementById("person1").value = "Player 2";
    app.document.getElementById("person2").value = "Player 3";
    await app.context.submitRegistration({ preventDefault() {} });
    assert.equal(JSON.parse(app.storage.get(key)).length, 2);
    assert.match(app.document.getElementById("management-storage-note").textContent, /Wi-Fi/);
    const publicCache = JSON.parse(app.storage.get(`football-attendance:${eventKey}`));
    assert.equal("managementPath" in publicCache, false);

    const withdrawn = { ...managed([2, 3], eventKey), registrations: [player(2, false), player(3)] };
    const page = loadScript("manage.js", buildManagementDocument(), [
      { body: managed([2, 3], eventKey) }, { body: managed([1], eventKey) },
      { body: withdrawn }, { body: withdrawn }, { body: managed([1], eventKey) },
    ], { pathname: "/inscrierile-mele", search: `?event=${eventKey}`, storage: app.storage });
    await flush();
    assert.equal(page.document.getElementById("managed-registrations").children.length, 3);
    const button = page.document.getElementById("managed-registrations").children[1].querySelector("button");
    await button.listeners.click();
    await page.document.getElementById("confirm-withdrawal").listeners.click();
    assert.equal(page.requests[2].options.headers.Authorization, `Bearer ${tokenB}`);
    assert.deepEqual(JSON.parse(page.requests[2].options.body), { registrationId: 2, confirmed: true });
    assert.equal(page.document.getElementById("managed-registrations").children.filter(card => card.querySelector("button")).length, 2);
  });
}

test("blocked local storage falls back to tab storage across signup, reload, and navigation", async () => {
  const app = loadScript("app.js", buildAppDocument(), [
    ...bootResponses(),
    { status: 201, body: dashboard("friday", { submittedRegistrationIds: [1], managementPath: pathA }) },
  ], { localStorageErrors: blocked });
  await flush();
  assert.equal(app.document.body.classList.contains("app-booting"), false);
  app.document.getElementById("person1").value = "Player 1";
  await app.context.submitRegistration({ preventDefault() {} });
  assert.equal(app.storage.has(key), false);
  assert.equal(JSON.parse(app.tabStorage.get(fallbackKey)).links[0].path, pathA);
  assert.match(app.document.getElementById("management-storage-note").textContent, /doar în această filă/);

  const reloaded = loadScript("app.js", buildAppDocument(), bootResponses(), {
    localStorageErrors: blocked, tabStorage: app.tabStorage,
  });
  await flush();
  assert.equal(reloaded.document.getElementById("withdraw-shortcut").classList.contains("hidden"), false);
  const page = loadScript("manage.js", buildManagementDocument(), [{ body: managed([1]) }], {
    pathname: "/inscrierile-mele", localStorageErrors: blocked, tabStorage: app.tabStorage,
  });
  await flush();
  assert.equal(page.requests[0].options.headers.Authorization, `Bearer ${tokenA}`);
  assert.equal(page.document.getElementById("managed-registrations").children.length, 1);
});

test("quota failure preserves older links and the newest save in the tab fallback", async () => {
  const storage = new Map([[key, JSON.stringify([{ path: pathA, eventKey: "friday" }])]]);
  const app = loadScript("app.js", buildAppDocument(), bootResponses(), {
    storage, localStorageErrors: { set: true },
  });
  await flush();
  app.context.saveManagementLink(pathB);
  assert.equal(JSON.parse(storage.get(key)).length, 1);
  const page = loadScript("manage.js", buildManagementDocument(), [
    { body: managed([2]) }, { body: managed([1]) },
  ], { pathname: "/inscrierile-mele", storage, tabStorage: app.tabStorage });
  await flush();
  assert.deepEqual(page.requests.map(request => request.options.headers.Authorization), [`Bearer ${tokenB}`, `Bearer ${tokenA}`]);

  page.context.window.footballManagementStore.save(`/inscriere/${"c".repeat(43)}`, "friday");
  assert.equal(JSON.parse(storage.get(key)).length, 3);
  assert.equal(app.tabStorage.has(fallbackKey), false);
});

test("tab fallback merges submissions saved by another tab before promoting back to local storage", async () => {
  const storage = new Map([[key, JSON.stringify([{ path: pathA, eventKey: "friday" }])]]);
  const app = loadScript("app.js", buildAppDocument(), bootResponses(), {
    storage, localStorageErrors: { set: true },
  });
  await flush();
  app.context.saveManagementLink(pathB);
  const pathC = `/inscriere/${"c".repeat(43)}`;
  storage.set(key, JSON.stringify([{ path: pathC, eventKey: "wednesday" }, { path: pathA, eventKey: "friday" }]));
  const reloaded = loadScript("app.js", buildAppDocument(), bootResponses(), { storage, tabStorage: app.tabStorage });
  await flush();
  assert.deepEqual(new Set(Array.from(reloaded.context.readSavedManagementLinks(), entry => entry.path)), new Set([pathA, pathB, pathC]));
  reloaded.context.saveManagementLink(`/inscriere/${"d".repeat(43)}`);
  assert.equal(JSON.parse(storage.get(key)).length, 4);
  assert.equal(app.tabStorage.has(fallbackKey), false);
});

test("memory fallback keeps every current-page link and offers working private navigation", async () => {
  const app = loadScript("app.js", buildAppDocument(), bootResponses(), {
    localStorageErrors: blocked, sessionStorageErrors: blocked,
  });
  await flush();
  app.context.saveManagementLink(pathA);
  app.context.saveManagementLink(pathB);
  app.context.renderSavedManagementLinks();
  assert.equal(app.context.readSavedManagementLinks().length, 2);
  assert.deepEqual(app.document.getElementById("saved-management-links").children.map(link => link.getAttribute("href")), [pathB, pathA]);
  assert.equal(app.document.getElementById("saved-management-links").children[0].getAttribute("target"), "_blank");
  assert.equal(app.document.getElementById("saved-management-links").children[0].getAttribute("rel"), "noopener noreferrer");
  assert.equal(app.document.getElementById("withdraw-shortcut").getAttribute("href"), pathB);
  assert.match(app.document.getElementById("management-storage-note").textContent, /înainte de a părăsi sau reîncărca pagina/);
  assert.equal(app.storage.has(key), false);
  assert.equal(app.tabStorage.has(fallbackKey), false);
});

test("storage property access errors retain private links in memory", () => {
  const { context } = loadScript("management-store.js", buildAppDocument(), []);
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(context.window, name, { get() { throw new Error("SecurityError"); } });
  }
  context.window.footballManagementStore.save(pathA, "friday");
  assert.equal(context.window.footballManagementStore.read()[0].path, pathA);
  assert.equal(context.window.footballManagementStore.mode, "memory");
});

test("expired fallback links stay removed even if local storage contains an older copy", async () => {
  const storage = new Map([[key, JSON.stringify([{ path: pathA, eventKey: "friday" }])]]);
  const app = loadScript("app.js", buildAppDocument(), bootResponses(), { storage, localStorageErrors: { set: true } });
  await flush();
  app.context.saveManagementLink(pathB);
  const page = loadScript("manage.js", buildManagementDocument(), [
    { body: managed([2]) }, { status: 404, ok: false },
  ], { pathname: "/inscrierile-mele", storage, tabStorage: app.tabStorage, localStorageErrors: { set: true } });
  await flush();
  const reloaded = loadScript("manage.js", buildManagementDocument(), [{ body: managed([2]) }], {
    pathname: "/inscrierile-mele", storage, tabStorage: app.tabStorage,
  });
  await flush();
  assert.equal(reloaded.requests.length, 1);
  assert.equal(reloaded.requests[0].options.headers.Authorization, `Bearer ${tokenB}`);
});

test("management retries saved links after reconnecting and keeps access after a network error", async () => {
  const storage = { [key]: JSON.stringify([{ path: pathA, eventKey: "friday" }]) };
  const page = loadScript("manage.js", buildManagementDocument(), [
    { error: new Error("Network changed") }, { body: managed([1]) },
  ], { pathname: "/inscrierile-mele", storage });
  await flush();
  assert.equal(JSON.parse(page.storage.get(key)).length, 1);
  assert.match(page.document.getElementById("management-message").textContent, /reîncerca/);
  await page.context.window.listeners.online();
  assert.equal(page.document.getElementById("managed-registrations").children.length, 1);
  assert.equal(page.requests[1].options.headers.Authorization, `Bearer ${tokenA}`);
});

test("saved-player navigation updates when another tab saves or clears browser storage", async () => {
  const app = loadScript("app.js", buildAppDocument(), bootResponses());
  await flush();
  app.storage.set(key, JSON.stringify([{ path: pathA, eventKey: "friday" }]));
  app.context.window.listeners.storage({ key });
  assert.equal(app.document.getElementById("withdraw-shortcut").classList.contains("hidden"), false);
  app.storage.delete(key);
  app.context.window.listeners.storage({ key: null });
  assert.equal(app.document.getElementById("withdraw-shortcut").classList.contains("hidden"), true);
});

test("a shared private link is saved through the fallback and later appears in the combined page", async () => {
  const page = loadScript("manage.js", buildManagementDocument(), [{ body: managed([1, 2]) }], {
    pathname: pathA, localStorageErrors: blocked,
  });
  await flush();
  const combined = loadScript("manage.js", buildManagementDocument(), [{ body: managed([1, 2]) }], {
    pathname: "/inscrierile-mele", localStorageErrors: blocked, tabStorage: page.tabStorage,
  });
  await flush();
  assert.equal(combined.document.getElementById("managed-registrations").children.length, 2);
});
