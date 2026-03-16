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
      message: "Inscrierile sunt deschise acum.",
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
      { value: "back", label: "Aparare" },
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
  assert.equal(loaded.getElementById("attendance-table-body").children.length, 1);
});

test("app.js submitRegistration updates message and resets form on success", async () => {
  const document = buildAppDocument();
  const { context } = loadScript("app.js", document, [
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
              name: "Vlad",
              createdAt: "2026-03-19 12:01:00",
              status: "confirmed",
            },
          ],
        }),
        message: "Inscrierea a fost salvata.",
      },
    },
  ]);

  await flush();
  document.getElementById("person1").value = "Ion";
  document.getElementById("person2").value = "Vlad";

  await context.submitRegistration({ preventDefault() {} });

  assert.equal(document.getElementById("form-message").textContent, "Inscrierea a fost salvata.");
  assert.equal(document.getElementById("person1").value, "");
  assert.equal(document.getElementById("person2").value, "");
  assert.equal(document.getElementById("attendance-table-body").children.length, 2);
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
    "Inscrierile sunt inchise",
  );
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
  assert.equal(document.getElementById("builder-state-title").textContent, "Pregatire lot");
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
            players: [{ id: 4, name: "Mihai", roleLabel: "Aparare" }],
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
