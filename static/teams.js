const tableBody = document.getElementById("attendance-table-body");
const weekLabel = document.getElementById("week-label");
const matchDateDisplay = document.getElementById("match-date-display");
const emptyStateTemplate = document.getElementById("empty-state-template");
const teamsBoard = document.getElementById("teams-board");
const teamsGrid = document.getElementById("teams-grid");
const confirmedCounter = document.getElementById("confirmed-counter");
const teamsCounter = document.getElementById("teams-counter");
const assignedCounter = document.getElementById("assigned-counter");
const builderStateTitle = document.getElementById("builder-state-title");
const builderStateBadge = document.getElementById("builder-state-badge");
const adminPanel = document.getElementById("admin-panel");
const adminToggle = document.getElementById("admin-toggle");
const adminContent = document.getElementById("admin-content");
const adminToggleIcon = document.getElementById("admin-toggle-icon");
const adminLoginForm = document.getElementById("admin-login-form");
const adminPasswordInput = document.getElementById("admin-password");
const adminLoginButton = document.getElementById("admin-login-button");
const adminActions = document.getElementById("admin-actions");
const adminLogoutButton = document.getElementById("admin-logout-button");
const generateTeamsButton = document.getElementById("generate-teams-button");
const resetTeamsButton = document.getElementById("reset-teams-button");
const adminMessage = document.getElementById("admin-message");
const themeToggle = document.getElementById("theme-toggle");
const themeToggleLabel = document.getElementById("theme-toggle-label");
const themeIconSun = document.getElementById("theme-icon-sun");
const themeIconMoon = document.getElementById("theme-icon-moon");

let roleOptions = [
  { value: "forward", label: "Atac" },
  { value: "middle", label: "Mijloc" },
  { value: "back", label: "Aparare" },
  { value: "any", label: "Oriunde" },
];
let isAdminAuthenticated = false;
let isAdminExpanded = false;
let currentTheme = document.documentElement.dataset.theme || "light";

function setAppReady(isReady) {
  document.body.classList.toggle("app-booting", !isReady);
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  themeToggleLabel.textContent = theme === "dark" ? "Mod luminos" : "Mod intunecat";
  themeIconSun.classList.toggle("hidden", theme !== "dark");
  themeIconMoon.classList.toggle("hidden", theme === "dark");
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Serverul a trimis un raspuns invalid. Reincarca pagina.");
  }
}

function setAdminExpanded(expanded) {
  isAdminExpanded = expanded;
  adminContent.classList.toggle("hidden", !expanded);
  adminToggle.setAttribute("aria-expanded", String(expanded));
  adminToggleIcon.textContent = expanded ? "-" : "+";
}

function setAdminAuthenticated(authenticated) {
  isAdminAuthenticated = authenticated;
  adminActions.classList.toggle("hidden", !authenticated);
  adminLoginForm.classList.toggle("hidden", authenticated);
  adminPasswordInput.value = "";
}

function updateBuilderStats(registrations, teams) {
  const confirmed = registrations.filter((registration) => registration.status === "confirmed").slice(0, 18);
  const assigned = confirmed.filter((registration) => registration.team).length;

  confirmedCounter.textContent = `${confirmed.length} / 18`;
  teamsCounter.textContent = `${teams.length}`;
  assignedCounter.textContent = `${assigned}`;

  if (!confirmed.length) {
    builderStateTitle.textContent = "In asteptare";
    builderStateBadge.textContent = "Fara jucatori";
    return;
  }

  if (teams.length === 3 && assigned === confirmed.length) {
    builderStateTitle.textContent = "Echipe gata";
    builderStateBadge.textContent = "Generat";
    return;
  }

  builderStateTitle.textContent = "Pregatire lot";
  builderStateBadge.textContent = "In lucru";
}

function renderRows(registrations) {
  tableBody.innerHTML = "";
  const confirmed = registrations.filter((registration) => registration.status === "confirmed").slice(0, 18);

  if (!confirmed.length) {
    const content = emptyStateTemplate.content.cloneNode(true);
    tableBody.appendChild(content);
    return;
  }

  confirmed.forEach((registration) => {
    const row = document.createElement("tr");
    row.className = registration.status;

    const positionCell = document.createElement("td");
    positionCell.textContent = registration.position;

    const nameCell = document.createElement("td");
    nameCell.textContent = registration.name;

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = "status-badge";
    statusBadge.textContent = "Confirmat";
    statusCell.appendChild(statusBadge);

    const roleCell = document.createElement("td");
    if (isAdminAuthenticated) {
      const roleSelect = document.createElement("select");
      roleSelect.className = "role-select";
      roleSelect.setAttribute("aria-label", `Post pentru ${registration.name}`);
      roleOptions.forEach((option) => {
        const optionElement = document.createElement("option");
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        optionElement.selected = option.value === registration.role;
        roleSelect.appendChild(optionElement);
      });
      roleSelect.addEventListener("change", () => updateRegistrationRole(registration.id, roleSelect));
      roleCell.appendChild(roleSelect);
    } else {
      roleCell.textContent = registration.roleLabel;
    }

    const teamCell = document.createElement("td");
    if (registration.team) {
      const teamBadge = document.createElement("span");
      teamBadge.className = `team-badge team-${registration.team}`;
      teamBadge.textContent = `Echipa ${registration.team}`;
      teamCell.appendChild(teamBadge);
    } else {
      teamCell.textContent = "-";
    }

    row.append(positionCell, nameCell, statusCell, roleCell, teamCell);
    tableBody.appendChild(row);
  });
}

function renderTeams(teams) {
  teamsGrid.innerHTML = "";
  const hasTeams = Array.isArray(teams) && teams.length > 0;
  teamsBoard.classList.toggle("hidden", !hasTeams);

  if (!hasTeams) {
    return;
  }

  teams.forEach((team) => {
    const card = document.createElement("article");
    card.className = `team-card team-card-${team.id}`;

    const header = document.createElement("div");
    header.className = "team-card-header";

    const heading = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = team.label;
    const meta = document.createElement("span");
    meta.textContent = `${team.players.length} jucatori`;
    heading.append(title, meta);

    const balance = document.createElement("div");
    balance.className = "team-balance";
    balance.innerHTML = `
      <span>Atac ${team.counts.forward}</span>
      <span>Mijloc ${team.counts.middle}</span>
      <span>Aparare ${team.counts.back}</span>
    `;

    header.append(heading, balance);
    card.appendChild(header);

    const list = document.createElement("div");
    list.className = "team-player-list";
    team.players.forEach((player) => {
      const item = document.createElement("div");
      item.className = "team-player";

      const name = document.createElement("strong");
      name.textContent = player.name;

      const role = document.createElement("span");
      role.textContent = player.roleLabel;

      item.append(name, role);
      list.appendChild(item);
    });

    card.appendChild(list);
    teamsGrid.appendChild(card);
  });
}

function syncPayload(payload) {
  if (Array.isArray(payload.roleOptions) && payload.roleOptions.length) {
    roleOptions = payload.roleOptions;
  }
  if (typeof payload.authenticated === "boolean") {
    setAdminAuthenticated(payload.authenticated);
  }
  if (payload.weekLabel) {
    weekLabel.textContent = payload.weekLabel;
    matchDateDisplay.textContent = payload.weekLabel;
  }

  const registrations = Array.isArray(payload.registrations) ? payload.registrations : [];
  const teams = Array.isArray(payload.teams) ? payload.teams : [];
  renderRows(registrations);
  renderTeams(teams);
  updateBuilderStats(registrations, teams);
}

async function loadAdminStatus() {
  const response = await fetch("/api/admin/status", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    return;
  }

  const payload = await parseJsonResponse(response);
  if (!payload.enabled) {
    adminPanel.classList.add("hidden");
    return;
  }

  adminPanel.classList.remove("hidden");
  setAdminAuthenticated(Boolean(payload.authenticated));
}

async function loadRegistrations() {
  const response = await fetch("/api/registrations", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("Nu am putut incarca generatorul de echipe.");
  }

  const payload = await parseJsonResponse(response);
  syncPayload(payload);
}

async function loginAdmin(event) {
  event.preventDefault();
  adminMessage.textContent = "";
  adminLoginButton.disabled = true;
  adminLoginButton.textContent = "Se verifica...";

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: adminPasswordInput.value }),
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || "Autentificarea a esuat.");
    }

    setAdminAuthenticated(true);
    adminMessage.textContent = payload.message;
    await loadRegistrations();
  } catch (error) {
    adminMessage.textContent = error.message;
  } finally {
    adminLoginButton.disabled = false;
    adminLoginButton.textContent = "Intra in panoul admin";
  }
}

async function updateRegistrationRole(registrationId, selectElement) {
  adminMessage.textContent = "";
  selectElement.disabled = true;

  try {
    const response = await fetch("/api/admin/update-role", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: registrationId, role: selectElement.value }),
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      if (response.status === 401) {
        setAdminAuthenticated(false);
      }
      throw new Error(payload.error || "Postul nu a putut fi actualizat.");
    }

    syncPayload(payload);
    adminMessage.textContent = payload.message;
  } catch (error) {
    adminMessage.textContent = error.message;
  } finally {
    selectElement.disabled = false;
  }
}

async function runTeamAction(endpoint, triggerButton) {
  adminMessage.textContent = "";
  triggerButton.disabled = true;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      if (response.status === 401) {
        setAdminAuthenticated(false);
      }
      throw new Error(payload.error || "Actiunea pentru echipe nu a putut fi finalizata.");
    }

    syncPayload(payload);
    adminMessage.textContent = payload.message;
  } catch (error) {
    adminMessage.textContent = error.message;
  } finally {
    triggerButton.disabled = false;
  }
}

async function logoutAdmin() {
  await fetch("/api/admin/session", {
    method: "DELETE",
    credentials: "same-origin",
  });
  setAdminAuthenticated(false);
  adminMessage.textContent = "Te-ai delogat din panoul de admin.";
}

function toggleTheme() {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
}

adminLoginForm.addEventListener("submit", loginAdmin);
adminToggle.addEventListener("click", () => setAdminExpanded(!isAdminExpanded));
adminLogoutButton.addEventListener("click", logoutAdmin);
generateTeamsButton.addEventListener("click", () =>
  runTeamAction("/api/admin/generate-teams", generateTeamsButton),
);
resetTeamsButton.addEventListener("click", () =>
  runTeamAction("/api/admin/reset-teams", resetTeamsButton),
);
themeToggle.addEventListener("click", toggleTheme);

applyTheme(currentTheme);
setAdminExpanded(false);
setAppReady(false);

Promise.allSettled([loadAdminStatus(), loadRegistrations()]).then((results) => {
  const registrationResult = results[1];
  if (registrationResult.status === "rejected") {
    adminMessage.textContent = registrationResult.reason.message;
  }
  setAppReady(true);
});
