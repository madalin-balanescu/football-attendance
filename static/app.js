const form = document.getElementById("attendance-form");
const person1Input = document.getElementById("person1");
const person2Input = document.getElementById("person2");
const submitButton = document.getElementById("submit-button");
const submitButtonLabel = submitButton.querySelector(".button-label");
const submissionOverlay = document.getElementById("submission-overlay");
const formMessage = document.getElementById("form-message");
const tableBody = document.getElementById("attendance-table-body");
const weekLabel = document.getElementById("week-label");
const emptyStateTemplate = document.getElementById("empty-state-template");
const adminPanel = document.getElementById("admin-panel");
const adminLoginForm = document.getElementById("admin-login-form");
const adminPasswordInput = document.getElementById("admin-password");
const adminLoginButton = document.getElementById("admin-login-button");
const adminActions = document.getElementById("admin-actions");
const clearWeekButton = document.getElementById("clear-week-button");
const clearAllButton = document.getElementById("clear-all-button");
const adminLogoutButton = document.getElementById("admin-logout-button");
const adminMessage = document.getElementById("admin-message");
const adminActionsHeader = document.getElementById("admin-actions-header");
const adminToggle = document.getElementById("admin-toggle");
const adminContent = document.getElementById("admin-content");
const adminToggleIcon = document.getElementById("admin-toggle-icon");
const themeToggle = document.getElementById("theme-toggle");
const themeToggleLabel = document.getElementById("theme-toggle-label");
let isAdminAuthenticated = false;
let currentTheme = document.documentElement.dataset.theme || "light";
let isAdminExpanded = false;

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  themeToggleLabel.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

function setSubmissionLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButtonLabel.textContent = isLoading ? "Se trimite..." : "Trimite inscrierea";
  submissionOverlay.classList.toggle("hidden", !isLoading);
}

function renderRows(registrations) {
  tableBody.innerHTML = "";

  if (!registrations.length) {
    const content = emptyStateTemplate.content.cloneNode(true);
    const cell = content.querySelector("td");
    cell.colSpan = isAdminAuthenticated ? 5 : 4;
    tableBody.appendChild(content);
    return;
  }

  registrations.forEach((registration) => {
    const row = document.createElement("tr");
    row.className = registration.status;

    const positionCell = document.createElement("td");
    positionCell.textContent = registration.position;

    const createdAtCell = document.createElement("td");
    createdAtCell.textContent = registration.createdAt;

    const nameCell = document.createElement("td");
    nameCell.textContent = registration.name;

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "status-badge";
    badge.textContent = registration.status === "confirmed" ? "Confirmat" : "Asteptare";
    statusCell.appendChild(badge);

    row.append(positionCell, createdAtCell, nameCell, statusCell);

    if (isAdminAuthenticated) {
      const actionCell = document.createElement("td");
      actionCell.className = "table-action-cell";

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "danger-button table-delete-button";
      deleteButton.textContent = "Sterge";
      deleteButton.addEventListener("click", () => deleteOneRegistration(registration.id, deleteButton));

      actionCell.appendChild(deleteButton);
      row.appendChild(actionCell);
    }

    tableBody.appendChild(row);
  });
}

async function loadRegistrations() {
  const response = await fetch("/api/registrations");
  if (!response.ok) {
    throw new Error("Nu am putut incarca lista curenta.");
  }

  const payload = await response.json();
  weekLabel.textContent = payload.weekLabel;
  renderRows(payload.registrations);
}

function setAdminAuthenticated(authenticated) {
  isAdminAuthenticated = authenticated;
  adminActions.classList.toggle("hidden", !authenticated);
  adminLoginForm.classList.toggle("hidden", authenticated);
  adminActionsHeader.classList.toggle("hidden", !authenticated);
  adminPasswordInput.value = "";
}

async function loadAdminStatus() {
  const response = await fetch("/api/admin/status", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    return;
  }

  const payload = await response.json();
  if (!payload.enabled) {
    adminPanel.classList.add("hidden");
    return;
  }

  adminPanel.classList.remove("hidden");
  setAdminAuthenticated(payload.authenticated);
}

function setAdminExpanded(expanded) {
  isAdminExpanded = expanded;
  adminContent.classList.toggle("hidden", !expanded);
  adminToggle.setAttribute("aria-expanded", String(expanded));
  adminToggleIcon.textContent = expanded ? "-" : "+";
}

async function submitRegistration(event) {
  event.preventDefault();

  formMessage.textContent = "";
  setSubmissionLoading(true);

  try {
    const response = await fetch("/api/registrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        person1: person1Input.value,
        person2: person2Input.value,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Inscrierea nu a putut fi salvata.");
    }

    form.reset();
    weekLabel.textContent = payload.weekLabel;
    renderRows(payload.registrations);
    formMessage.textContent = payload.message;
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    setSubmissionLoading(false);
  }
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
      body: JSON.stringify({
        password: adminPasswordInput.value,
      }),
    });

    const payload = await response.json();
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

async function clearRegistrations(endpoint, triggerButton) {
  adminMessage.textContent = "";
  triggerButton.disabled = true;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
    });

    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        setAdminAuthenticated(false);
      }
      throw new Error(payload.error || "Actiunea nu a putut fi finalizata.");
    }

    weekLabel.textContent = payload.weekLabel;
    setAdminAuthenticated(Boolean(payload.authenticated));
    renderRows(payload.registrations);
    adminMessage.textContent = payload.message;
  } catch (error) {
    adminMessage.textContent = error.message;
  } finally {
    triggerButton.disabled = false;
  }
}

async function deleteOneRegistration(registrationId, triggerButton) {
  adminMessage.textContent = "";
  triggerButton.disabled = true;

  try {
    const response = await fetch("/api/admin/delete-registration", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: registrationId }),
    });

    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        setAdminAuthenticated(false);
      }
      throw new Error(payload.error || "Inscrierea nu a putut fi stearsa.");
    }

    weekLabel.textContent = payload.weekLabel;
    setAdminAuthenticated(Boolean(payload.authenticated));
    renderRows(payload.registrations);
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

form.addEventListener("submit", submitRegistration);
adminLoginForm.addEventListener("submit", loginAdmin);
adminToggle.addEventListener("click", () => setAdminExpanded(!isAdminExpanded));
clearWeekButton.addEventListener("click", () =>
  clearRegistrations("/api/admin/clear-week", clearWeekButton),
);
clearAllButton.addEventListener("click", () =>
  clearRegistrations("/api/admin/clear-all", clearAllButton),
);
adminLogoutButton.addEventListener("click", logoutAdmin);
themeToggle.addEventListener("click", toggleTheme);

applyTheme(currentTheme);
setAdminExpanded(false);

loadAdminStatus().then(() => {
  loadRegistrations().catch((error) => {
    formMessage.textContent = error.message;
  });
});
