const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAppDocument,
  buildTeamsDocument,
  flush,
  loadScript,
} = require("./frontend_harness");

function appPayload(overrides = {}) {
  return {
    weekLabel: "20 Mar 2026",
    signupWindow: {
      isOpen: true,
      scheduleOpen: true,
      mode: "auto",
      message: "Înscrierile sunt deschise acum.",
    },
    registrations: [
      {
        id: 1,
        position: 1,
        name: "Ion",
        createdAt: "2026-03-19 12:00:00",
        status: "confirmed",
      },
    ],
    ...overrides,
  };
}

function teamsPayload(overrides = {}) {
  return {
    weekLabel: "20 Mar 2026",
    registrations: [
      {
        id: 1,
        position: 1,
        name: "Ion",
        status: "confirmed",
        role: "forward",
        roleLabel: "Atac",
        team: 1,
      },
      {
        id: 2,
        position: 2,
        name: "Vlad",
        status: "waiting",
        role: "middle",
        roleLabel: "Mijloc",
        team: null,
      },
    ],
    teams: [
      {
        id: 1,
        label: "Echipa 1",
        counts: { forward: 1, middle: 0, back: 0 },
        players: [{ id: 1, name: "Ion", roleLabel: "Atac" }],
      },
    ],
    roleOptions: [
      { value: "forward", label: "Atac" },
      { value: "middle", label: "Mijloc" },
      { value: "back", label: "Apărare" },
      { value: "any", label: "Oriunde" },
    ],
    ...overrides,
  };
}

test("app.js bootstraps dashboard and clears boot state after initial fetches", async () => {
  const document = buildAppDocument();
  const { document: loaded } = loadScript("app.js", document, [
    { body: { enabled: true, authenticated: false } },
    { body: appPayload() },
  ]);

  await flush();

  assert.equal(loaded.body.classList.contains("app-booting"), false);
  assert.equal(loaded.getElementById("week-label").textContent, "20 Mar 2026");
  assert.equal(loaded.getElementById("match-date-display").textContent, "20 Mar 2026");
  assert.equal(loaded.getElementById("confirmed-counter").textContent, "1 / 18");
  assert.equal(loaded.getElementById("signup-state-title").textContent, "Deschis acum");
  assert.equal(loaded.getElementById("content-grid").classList.contains("is-closed"), false);
  assert.equal(loaded.getElementById("match-location-name").textContent, "Magic Stadium - Tudor");
  assert.equal(
    loaded.getElementById("backup-week-link").getAttribute("href"),
    "/api/admin/backup-week?event=friday",
  );
  assert.match(
    loaded.getElementById("match-location-link").getAttribute("href"),
    /Magic\+Stadium/,
  );
  assert.equal(loaded.getElementById("attendance-table-body").children.length, 1);
  const renderedRow = loaded.getElementById("attendance-table-body").children[0];
  const renderedTime = renderedRow.children[1];
  assert.equal(renderedTime.getAttribute("aria-label"), "19.03 12:00:00");
  assert.equal(renderedTime.children[0].classList.contains("time-date"), true);
  assert.equal(renderedTime.children[0].textContent, "19.03");
  assert.equal(renderedTime.children[1].classList.contains("time-clock"), true);
  assert.equal(renderedTime.children[1].textContent, "12:00:00");
  assert.equal(
    renderedRow.children[2].classList.contains("name-cell"),
    true,
  );
});

test("app.js shows a full state when all 18 confirmed places are occupied", async () => {
  const document = buildAppDocument();
  const registrations = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    position: index + 1,
    name: `Jucator ${index + 1}`,
    createdAt: "2026-08-24 19:30:00",
    status: "confirmed",
  }));

  loadScript("app.js", document, [
    { body: { enabled: true, authenticated: false } },
    { body: appPayload({ registrations }) },
  ]);

  await flush();

  assert.equal(document.getElementById("confirmed-counter").textContent, "18 / 18");
  assert.equal(document.getElementById("spots-left-counter").textContent, "0");
  assert.equal(document.getElementById("signup-state-title").textContent, "Plin");
  assert.equal(document.getElementById("signup-state-badge").textContent, "Plin");
});

test("app.js submitRegistration updates message and resets form on success", async () => {
  const document = buildAppDocument();
  const { context, requests } = loadScript("app.js", document, [
    { body: { enabled: true, authenticated: false } },
    { body: appPayload() },
    {
      status: 201,
      body: {
        ...appPayload({
          registrations: [
            {
              id: 1,
              position: 1,
              name: "Ion",
              createdAt: "2026-03-19 12:00:00",
              status: "confirmed",
            },
            {
              id: 2,
              position: 2,
              name: "Ion",
              createdAt: "2026-03-19 12:01:00",
              status: "confirmed",
            },
            {
              id: 3,
              position: 3,
              name: "Vlad",
              createdAt: "2026-03-19 12:01:01",
              status: "confirmed",
            },
          ],
        }),
        message: "Înscrierea a fost salvată.",
        submittedRegistrationIds: [2, 3],
      },
    },
  ]);

  await flush();
  document.getElementById("person1").value = "Ion";
  document.getElementById("person2").value = "Vlad";

  await context.submitRegistration({ preventDefault() {} });

  assert.equal(document.getElementById("form-message").textContent, "Înscrierea a fost salvată.");
  assert.equal(document.getElementById("person1").value, "");
  assert.equal(document.getElementById("person2").value, "");
  assert.equal(document.getElementById("attendance-table-body").children.length, 3);
  assert.equal(document.getElementById("success-title").textContent, "Locuri înregistrate");
  assert.equal(
    document.getElementById("success-details").children[0].textContent,
    "Ion: poziția 2 · Confirmat",
  );
  assert.equal(
    document.getElementById("success-details").children[1].textContent,
    "Vlad: poziția 3 · Confirmat",
  );
  assert.equal(JSON.parse(requests[2].options.body).event, "friday");
});

test("app.js keeps and displays the private management link after submission", async () => {
  const document = buildAppDocument();
  const token = "a".repeat(43);
  const managementPath = `/inscriere/${token}`;
  const { context, storage } = loadScript("app.js", document, [
    { body: { enabled: true, authenticated: false } },
    { body: appPayload() },
    {
      status: 201,
      body: {
        ...appPayload(),
        message: "Înscriere reușită. Salvează linkul pentru modificare sau retragere.",
        submittedRegistrationIds: [1],
        managementPath,
      },
    },
  ]);

  await flush();
  document.getElementById("person1").value = "Ion";
  await context.submitRegistration({ preventDefault() {} });

  assert.equal(document.getElementById("success-title").textContent, "Înscriere reușită");
  assert.equal(
    document.getElementById("success-summary").textContent,
    "Salvează linkul pentru modificare sau retragere.",
  );
  assert.equal(document.getElementById("success-management-link").getAttribute("href"), managementPath);
  assert.equal(document.getElementById("success-management-actions").classList.contains("hidden"), false);
  assert.equal(document.getElementById("saved-management-panel").classList.contains("hidden"), false);
  assert.equal(document.getElementById("success-panel").scrollIntoViewOptions.behavior, "smooth");
  assert.equal(document.getElementById("success-panel").scrollIntoViewOptions.block, "center");
  const saved = JSON.parse(storage.get("football-attendance:management-links"));
  assert.equal(saved[0].path, managementPath);
});

test("app.js configures the Wednesday page and sends requests to the Wednesday event", async () => {
  const document = buildAppDocument();
  const { context, requests } = loadScript(
    "app.js",
    document,
    [
      { body: { enabled: true, authenticated: false } },
      { body: appPayload({ weekLabel: "26 Aug 2026" }) },
      {
        status: 201,
        body: {
          ...appPayload({ weekLabel: "26 Aug 2026" }),
          message: "Înscrierea a fost salvată.",
        },
      },
    ],
    { pathname: "/miercuri" },
  );

  await flush();

  assert.equal(document.title, "Prezență la fotbal miercuri");
  assert.equal(document.documentElement.dataset.event, "wednesday");
  assert.equal(document.body.dataset.event, "wednesday");
  assert.equal(document.getElementById("page-title").textContent, "Prezență la fotbal - Miercuri");
  assert.match(document.getElementById("page-description").textContent, /19:30 și 21:30/);
  assert.equal(
    document.getElementById("schedule-callout").textContent,
    "Înscrierile încep în fiecare luni la ora 19:30.",
  );
  assert.equal(
    document.getElementById("wednesday-event-link").getAttribute("aria-current"),
    "page",
  );
  assert.equal(document.getElementById("match-location-name").textContent, "D&C Sport - Siraj");
  assert.match(
    document.getElementById("match-location-link").getAttribute("href"),
    /D%26C\+Sport/,
  );
  assert.equal(document.getElementById("teams-page-link").classList.contains("hidden"), true);
  assert.equal(requests[1].url, "/api/registrations?event=wednesday");

  document.getElementById("person1").value = "Mihai";
  await context.submitRegistration({ preventDefault() {} });

  assert.equal(JSON.parse(requests[2].options.body).event, "wednesday");
});

test("app.js locks form and button when signup window is closed", async () => {
  const document = buildAppDocument();
  loadScript("app.js", document, [
    { body: { enabled: true, authenticated: false } },
    {
      body: appPayload({
        signupWindow: {
          isOpen: false,
          scheduleOpen: false,
          mode: "force_closed",
          message: "",
        },
      }),
    },
  ]);

  await flush();

  assert.equal(document.getElementById("person1").disabled, true);
  assert.equal(document.getElementById("person2").disabled, true);
  assert.equal(document.getElementById("submit-button").disabled, true);
  assert.equal(
    document.getElementById("submit-button").querySelector(".button-label").textContent,
    "Înscrierile sunt închise",
  );
  assert.equal(document.getElementById("content-grid").classList.contains("is-closed"), true);
});

test("app.js restores an authenticated backup file and refreshes the selected list", async () => {
  const document = buildAppDocument();
  const restoredPayload = appPayload({
    registrations: [
      {
        id: 7,
        position: 1,
        name: "Restaurat",
        createdAt: "2026-09-01 12:00:01",
        status: "confirmed",
      },
    ],
  });
  restoredPayload.message = "A fost restaurată o înscriere.";
  const { context, requests } = loadScript("app.js", document, [
    { body: { enabled: true, authenticated: true } },
    { body: appPayload({ registrations: [] }) },
    { status: 201, body: restoredPayload },
  ]);

  await flush();
  const backup = {
    backupVersion: 1,
    eventKey: "friday",
    weekKey: "2026-W36",
    registrations: [
      {
        position: 1,
        name: "Restaurat",
        createdAt: "2026-09-01 12:00:01",
        role: "any",
        team: null,
      },
    ],
  };

  await context.restoreWeekFromFile({
    text: async () => JSON.stringify(backup),
  });

  assert.equal(requests[2].url, "/api/admin/restore-week?event=friday");
  assert.equal(requests[2].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[2].options.body), backup);
  assert.equal(document.getElementById("attendance-table-body").children.length, 1);
  assert.equal(document.getElementById("admin-message").textContent, restoredPayload.message);
  assert.equal(document.getElementById("restore-week-button").disabled, false);
  assert.equal(
    document.getElementById("restore-week-button").textContent,
    "Restaurează lista salvată",
  );
});

test("app.js refuses a backup file for the other football day before upload", async () => {
  const document = buildAppDocument();
  const { context, requests } = loadScript("app.js", document, [
    { body: { enabled: true, authenticated: true } },
    { body: appPayload({ registrations: [] }) },
  ]);

  await flush();
  await context.restoreWeekFromFile({
    text: async () => JSON.stringify({
      backupVersion: 1,
      eventKey: "wednesday",
      weekKey: "2026-W36",
      registrations: [],
    }),
  });

  assert.equal(requests.length, 2);
  assert.equal(
    document.getElementById("admin-message").textContent,
    "Backupul aparține celeilalte zile de fotbal.",
  );
});

test("app.js shows an authoritative countdown for the next automatic opening", async () => {
  const document = buildAppDocument();
  loadScript("app.js", document, [
    { body: { enabled: true, authenticated: false } },
    {
      body: appPayload({
        signupWindow: {
          isOpen: false,
          scheduleOpen: false,
          mode: "auto",
          message: "",
          nextOpen: "2099-03-19T11:59:00+02:00",
          serverNow: "2099-03-18T11:59:00+02:00",
        },
      }),
    },
  ]);

  await flush();

  assert.equal(document.getElementById("countdown-card").classList.contains("hidden"), false);
  assert.equal(document.getElementById("countdown-label").textContent, "Următoarea deschidere");
  assert.match(document.getElementById("countdown-display").textContent, /1 zi/);
});

test("app.js success feedback identifies a newly waitlisted player", async () => {
  const document = buildAppDocument();
  const { context } = loadScript("app.js", document, [
    { body: { enabled: true, authenticated: false } },
    { body: appPayload() },
  ]);
  const registrations = Array.from({ length: 19 }, (_, index) => ({
    id: index + 1,
    position: index + 1,
    name: `Jucător ${index + 1}`,
    createdAt: "2026-08-24 19:30:00",
    status: index < 18 ? "confirmed" : "waiting",
  }));

  await flush();
  context.flashSuccessPanel({ registrations, submittedRegistrationIds: [19] });

  assert.equal(
    document.getElementById("success-details").children[0].textContent,
    "Jucător 19: poziția 19 · Lista de așteptare",
  );
  assert.match(document.getElementById("success-summary").textContent, /lista de așteptare/);
});

test("app.js falls back to the last saved list when a refresh loses connectivity", async () => {
  const document = buildAppDocument();
  const { context } = loadScript("app.js", document, [
    { body: { enabled: true, authenticated: false } },
    { body: appPayload() },
    { error: new Error("offline") },
  ]);

  await flush();
  await context.loadRegistrations();

  assert.equal(document.body.classList.contains("is-offline"), true);
  assert.equal(document.getElementById("connection-status").textContent, "Date salvate local");
  assert.equal(document.getElementById("person1").disabled, true);
  assert.equal(document.getElementById("attendance-table-body").children.length, 1);
});

test("teams.js renders confirmed players only and shows generated teams", async () => {
  const document = buildTeamsDocument();
  loadScript("teams.js", document, [
    { body: { enabled: true, authenticated: false } },
    { body: teamsPayload() },
  ]);

  await flush();

  assert.equal(document.body.classList.contains("app-booting"), false);
  assert.equal(document.getElementById("attendance-table-body").children.length, 1);
  assert.equal(document.getElementById("teams-grid").children.length, 1);
  assert.equal(document.getElementById("builder-state-title").textContent, "Pregătire lot");
  assert.equal(document.getElementById("assigned-counter").textContent, "1");
});

test("teams.js shows role selectors for authenticated admin and can refresh generated teams", async () => {
  const document = buildTeamsDocument();
  const { context } = loadScript("teams.js", document, [
    { body: { enabled: true, authenticated: true } },
    { body: teamsPayload({ teams: [] }) },
    {
      body: teamsPayload({
        teams: [
          {
            id: 1,
            label: "Echipa 1",
            counts: { forward: 1, middle: 1, back: 0 },
            players: [
              { id: 1, name: "Ion", roleLabel: "Atac" },
              { id: 3, name: "Andrei", roleLabel: "Mijloc" },
            ],
          },
          {
            id: 2,
            label: "Echipa 2",
            counts: { forward: 0, middle: 0, back: 1 },
            players: [{ id: 4, name: "Mihai", roleLabel: "Apărare" }],
          },
          {
            id: 3,
            label: "Echipa 3",
            counts: { forward: 1, middle: 0, back: 0 },
            players: [{ id: 5, name: "Dani", roleLabel: "Atac" }],
          },
        ],
        registrations: [
          {
            id: 1,
            position: 1,
            name: "Ion",
            status: "confirmed",
            role: "forward",
            roleLabel: "Atac",
            team: 1,
          },
        ],
      }),
    },
  ]);

  await flush();

  const firstRow = document.getElementById("attendance-table-body").children[0];
  const roleCell = firstRow.children[3];
  assert.equal(roleCell.children[0].tagName, "select");

  await context.runTeamAction("/api/admin/generate-teams", document.getElementById("generate-teams-button"));

  assert.equal(document.getElementById("teams-grid").children.length, 3);
  assert.equal(document.getElementById("builder-state-title").textContent, "Echipe gata");
  assert.equal(document.getElementById("builder-state-badge").textContent, "Generat");
});

const { buildHistoryDocument } = require("./frontend_harness");
const removalPayload = {
  eventKey: "friday", weekLabel: "04 Sep 2026",
  removalHistory: [
    { id: "a", name: "<img src=x onerror=alert(1)>", weekKey: "2026-W36", weekLabel: "04 Sep 2026", createdAt: "2026-09-03 12:00:00", removedAt: "2026-09-04 15:00:00", source: "organizer", sourceLabel: "Eliminat de organizator" },
    { id: "b", name: "Self target", weekKey: "2026-W36", weekLabel: "04 Sep 2026", createdAt: "2026-09-03 13:00:00", removedAt: null, source: "self", sourceLabel: "Retragere voluntară" },
  ],
};

test("history page displays both removal types, filters, and renders names as text", async () => {
  const document = buildHistoryDocument();
  const { context, storage, requests } = loadScript("history.js", document, [{ body: removalPayload }]);
  await flush();
  assert.equal(requests[0].url, "/api/removal-history?event=friday");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(document.getElementById("history-body").children.length, 2);
  const firstCell = document.getElementById("history-body").children[0].children[0];
  assert.equal(firstCell.children[1].textContent, removalPayload.removalHistory[0].name);
  assert.equal(firstCell.querySelector("img"), null);
  assert.equal(document.getElementById("history-body").children[1].children[3].children[1].textContent, "Necunoscut");
  document.getElementById("history-source").value = "self";
  context.renderHistory();
  assert.equal(document.getElementById("history-body").children.length, 1);
  assert.equal(document.getElementById("history-count").textContent, "1 din 2 eliminări");
  assert.equal(storage.size, 0);
});

test("history page scopes navigation to Wednesday and clears stale data on a server error", async () => {
  const document = buildHistoryDocument();
  const { context, requests } = loadScript("history.js", document, [
    { body: removalPayload },
    { ok: false, status: 503, body: { error: "Istoricul nu este disponibil momentan" } },
  ], { search: "?event=wednesday" });
  await flush();
  assert.equal(requests[0].url, "/api/removal-history?event=wednesday");
  assert.equal(document.getElementById("history-back-link").getAttribute("href"), "/miercuri");
  await context.loadHistory();
  assert.equal(document.getElementById("history-body").children.length, 0);
  assert.equal(document.getElementById("history-content").classList.contains("hidden"), true);
  assert.equal(document.getElementById("history-message").textContent, "Istoricul nu este disponibil momentan");
});

test("history page clears data offline and presents an empty session after reset", async () => {
  const document = buildHistoryDocument();
  const { context } = loadScript("history.js", document, [
    { body: removalPayload },
    { body: { ...removalPayload, removalHistory: [] } },
  ]);
  await flush();
  context.window.listeners.offline();
  assert.equal(document.getElementById("history-body").children.length, 0);
  await context.loadHistory();
  assert.equal(document.getElementById("history-count").textContent, "0 din 0 eliminări");
  assert.match(document.getElementById("history-body").textContent, /Nu există eliminări/);
});

test("attendance page has a separate event-aware history link and caches no removal data", async () => {
  const document = buildAppDocument();
  const { storage } = loadScript("app.js", document, [
    { body: { enabled: true, authenticated: false } },
    { body: appPayload({ inactiveRegistrations: [{ name: "Withdrawn", status: "withdrawn" }], removalHistory: removalPayload.removalHistory }) },
  ], { pathname: "/miercuri" });
  await flush();
  assert.equal(document.getElementById("removal-history-link").getAttribute("href"), "/istoric?event=wednesday");
  assert.equal(document.getElementById("attendance-table-body").children.length, 1);
  const cached = JSON.parse(storage.get("football-attendance:wednesday"));
  assert.equal("removalHistory" in cached, false);
  assert.equal("inactiveRegistrations" in cached, false);
});

const { buildManagementDocument } = require("./frontend_harness");
const savedLinksKey = "football-attendance:management-links";
const tokenA = "a".repeat(43);
const tokenB = "b".repeat(43);
function savedLinks(tokens) {
  return { [savedLinksKey]: JSON.stringify(tokens.map(token => ({ path: `/inscriere/${token}`, eventKey: "friday" }))) };
}
function managedPayload(ids, overrides = {}) {
  return {
    eventKey: "friday", weekKey: "2026-W36", weekLabel: "04 Sep 2026",
    registrations: ids.map(id => ({ id, name: `Player ${id}`, active: true, status: "confirmed", position: id })),
    ...overrides,
  };
}

test("saved submissions appear as one personal-player link and are not truncated", async () => {
  const tokens = Array.from({ length: 12 }, (_, i) => String.fromCharCode(65 + i).repeat(43));
  const document = buildAppDocument();
  const { context, storage } = loadScript("app.js", document, [
    { body: { enabled: true, authenticated: false } }, { body: appPayload() },
  ], { storage: savedLinks(tokens) });
  await flush();
  assert.equal(document.getElementById("saved-management-links").children.length, 1);
  assert.equal(document.getElementById("saved-management-links").children[0].getAttribute("href"), "/inscrierile-mele?event=friday");
  context.saveManagementLink(`/inscriere/${tokenA}`);
  assert.equal(JSON.parse(storage.get(savedLinksKey)).length, 13);
  assert.equal(document.getElementById("saved-management-links").children.length, 1);
});

for (const event of ["friday", "wednesday"]) {
  test(`combined management isolates ${event} using server data and returns to its list`, async () => {
    const document = buildManagementDocument();
    const { requests, storage } = loadScript("manage.js", document, [
      { body: managedPayload([1, 2]) },
      { body: managedPayload([3], { eventKey: "wednesday", weekLabel: "02 Sep 2026" }) },
    ], { pathname: "/inscrierile-mele", search: `?event=${event}`, storage: savedLinks([tokenA, tokenA, tokenB]) });
    await flush();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(r => r.options.headers.Authorization), [`Bearer ${tokenA}`, `Bearer ${tokenB}`]);
    assert.equal(document.getElementById("managed-registrations").children.length, event === "friday" ? 2 : 1);
    assert.equal(document.getElementById("back-to-event").getAttribute("href"), event === "friday" ? "/" : "/miercuri");
    assert.equal(document.getElementById("managed-registrations").textContent.includes("Player 3"), event === "wednesday");
    assert.equal(JSON.parse(storage.get(savedLinksKey)).length, 3);
  });

  test(`attendance shortcuts carry ${event} into the personal list`, async () => {
    const document = buildAppDocument();
    const stored = savedLinks([tokenA, tokenB]);
    stored[savedLinksKey] = JSON.stringify([{ path: `/inscriere/${tokenA}`, eventKey: "friday" }, { path: `/inscriere/${tokenB}`, eventKey: "wednesday" }]);
    loadScript("app.js", document, [{ body: { enabled: true, authenticated: false } }, { body: appPayload() }], {
      pathname: event === "wednesday" ? "/miercuri" : "/", storage: stored,
    });
    await flush();
    assert.equal(document.getElementById("withdraw-shortcut").getAttribute("href"), `/inscrierile-mele?event=${event}`);
    assert.equal(document.getElementById("saved-management-links").children[0].getAttribute("href"), `/inscrierile-mele?event=${event}`);
  });
}

test("combined withdrawal uses the selected player's token and refreshes every submission", async () => {
  const document = buildManagementDocument();
  const withdrawn = managedPayload([2], { registrations: [{ id: 2, name: "Player 2", active: false, status: "withdrawn", position: null }], message: "Retragere salvată" });
  const { requests } = loadScript("manage.js", document, [
    { body: managedPayload([1]) }, { body: managedPayload([2]) },
    { body: withdrawn }, { body: managedPayload([1]) }, { body: withdrawn },
  ], { pathname: "/inscrierile-mele", storage: savedLinks([tokenA, tokenB]) });
  await flush();
  const button = document.getElementById("managed-registrations").children[1].querySelector("button");
  await button.listeners.click();
  assert.equal(requests[2].url, "/api/management/withdraw");
  assert.equal(requests[2].options.headers.Authorization, `Bearer ${tokenB}`);
  assert.deepEqual(JSON.parse(requests[2].options.body), { registrationId: 2, confirmed: true });
  assert.equal(requests.length, 5);
  assert.equal(document.getElementById("managed-registrations").children.length, 2);
  assert.equal(document.getElementById("managed-registrations").children[1].querySelector("button"), null);
});

test("combined management drops expired links but keeps failed links and usable players", async () => {
  const tokenC = "c".repeat(43);
  const document = buildManagementDocument();
  const { storage } = loadScript("manage.js", document, [
    { body: managedPayload([1]) }, { ok: false, status: 404 }, { error: new Error("Offline") },
  ], { pathname: "/inscrierile-mele", storage: savedLinks([tokenA, tokenB, tokenC]) });
  await flush();
  assert.equal(document.getElementById("managed-registrations").children.length, 1);
  assert.deepEqual(JSON.parse(storage.get(savedLinksKey)).map(entry => entry.path), [`/inscriere/${tokenA}`, `/inscriere/${tokenC}`]);
  assert.match(document.getElementById("management-message").textContent, /Unele înscrieri/);
});

test("opening a shared link still exposes only its submission", async () => {
  const document = buildManagementDocument();
  const { requests } = loadScript("manage.js", document, [{ body: managedPayload([1]) }], {
    pathname: `/inscriere/${tokenA}`, storage: savedLinks([tokenA, tokenB]),
  });
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${tokenA}`);
  assert.equal(document.getElementById("managed-registrations").children.length, 1);
  assert.equal(document.getElementById("copy-current-link").classList.contains("hidden"), false);
});

test("combined page without saved links shows an empty personal list without fetching other players", async () => {
  const document = buildManagementDocument();
  const { requests } = loadScript("manage.js", document, [], { pathname: "/inscrierile-mele" });
  await flush();
  assert.equal(requests.length, 0);
  assert.match(document.getElementById("management-message").textContent, /Nu ai înscrieri/);
  assert.equal(document.body.classList.contains("app-booting"), false);
});
