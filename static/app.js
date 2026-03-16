const form = document.getElementById("attendance-form");
const person1Input = document.getElementById("person1");
const person2Input = document.getElementById("person2");
const submitButton = document.getElementById("submit-button");
const submitButtonLabel = submitButton.querySelector(".button-label");
const submissionOverlay = document.getElementById("submission-overlay");
const formMessage = document.getElementById("form-message");
const signupWindowMessage = document.getElementById("signup-window-message");
const formControlsShell = document.querySelector(".form-controls-shell");
const formLockedOverlay = document.getElementById("form-locked-overlay");
const tableBody = document.getElementById("attendance-table-body");
const weekLabel = document.getElementById("week-label");
const matchDateDisplay = document.getElementById("match-date-display");
const emptyStateTemplate = document.getElementById("empty-state-template");
const signupStateTitle = document.getElementById("signup-state-title");
const signupStateBadge = document.getElementById("signup-state-badge");
const confirmedCounter = document.getElementById("confirmed-counter");
const spotsLeftCounter = document.getElementById("spots-left-counter");
const waitingCounter = document.getElementById("waiting-counter");
const progressCaption = document.getElementById("progress-caption");
const progressFill = document.getElementById("progress-fill");
const successPanel = document.getElementById("success-panel");
const adminPanel = document.getElementById("admin-panel");
const adminLoginForm = document.getElementById("admin-login-form");
const adminPasswordInput = document.getElementById("admin-password");
const adminLoginButton = document.getElementById("admin-login-button");
const adminActions = document.getElementById("admin-actions");
const forceOpenButton = document.getElementById("force-open-button");
const togglePlaceholderButton = document.getElementById("toggle-placeholder-button");
const autoModeButton = document.getElementById("auto-mode-button");
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
const themeIconSun = document.getElementById("theme-icon-sun");
const themeIconMoon = document.getElementById("theme-icon-moon");
let isAdminAuthenticated = false;
let currentTheme = document.documentElement.dataset.theme || "light";
let isAdminExpanded = false;
let isSignupWindowOpen = true;
let currentSignupMode = "auto";
let isScheduleOpen = true;
let lastSeenRegistrationId = null;

function setAppReady(isReady) {
  document.body.classList.toggle("app-booting", !isReady);
}

function formatRegistrationTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  if (!match) {
    return value;
  }

  const [, , month, day, time] = match;
  return `${day}.${month} ${time}`;
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  themeToggleLabel.textContent = theme === "dark" ? "Mod luminos" : "Mod intunecat";
  themeIconSun.classList.toggle("hidden", theme !== "dark");
  themeIconMoon.classList.toggle("hidden", theme === "dark");
}

function setSubmissionLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButtonLabel.textContent = isLoading ? "Se trimite..." : "Trimite inscrierea";
  submissionOverlay.classList.toggle("hidden", !isLoading);
}

function setFormLocked(isLocked) {
  formControlsShell.classList.toggle("is-locked", isLocked);
  formLockedOverlay.classList.toggle("hidden", !isLocked);
  person1Input.disabled = isLocked;
  person2Input.disabled = isLocked;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Serverul a trimis un raspuns invalid. Reincarca pagina.");
  }
}

function updateSignupModeButtons() {
  forceOpenButton.disabled = currentSignupMode === "force_open";
  togglePlaceholderButton.disabled = currentSignupMode === "force_closed";
  autoModeButton.disabled = currentSignupMode === "auto";
}

function syncDashboardPayload(payload) {
  if (!payload) {
    return;
  }

  if (typeof payload.authenticated === "boolean") {
    setAdminAuthenticated(payload.authenticated);
  }

  if (payload.weekLabel) {
    weekLabel.textContent = payload.weekLabel;
    matchDateDisplay.textContent = payload.weekLabel;
  }

  updateSignupWindowState(payload.signupWindow);
  renderRows(Array.isArray(payload.registrations) ? payload.registrations : []);
}

function updateLiveBoard(registrations = []) {
  const confirmed = Math.min(registrations.length, 18);
  const waiting = Math.max(registrations.length - 18, 0);
  const spotsLeft = Math.max(18 - confirmed, 0);
  const progressPercent = Math.min((confirmed / 18) * 100, 100);

  confirmedCounter.textContent = `${confirmed} / 18`;
  spotsLeftCounter.textContent = `${spotsLeft}`;
  waitingCounter.textContent = `${waiting}`;
  progressCaption.textContent = `${confirmed} din 18 locuri confirmate`;
  progressFill.style.width = `${progressPercent}%`;

  let title = "Inchis";
  let badge = "Inchis";

  if (currentSignupMode === "force_open" || isSignupWindowOpen) {
    if (spotsLeft <= 3 && confirmed > 0) {
      title = "Aproape plin";
      badge = "Aproape plin";
    } else {
      title = "Deschis acum";
      badge = "Deschis";
    }
  } else if (waiting > 0) {
    title = "Lista de asteptare";
    badge = "Asteptare";
  }

  signupStateTitle.textContent = title;
  signupStateBadge.textContent = badge;
}

function flashSuccessPanel(message) {
  successPanel.classList.remove("hidden");
  const detail = successPanel.querySelector("span");
  detail.textContent = message;
  window.clearTimeout(flashSuccessPanel.timeoutId);
  flashSuccessPanel.timeoutId = window.setTimeout(() => {
    successPanel.classList.add("hidden");
  }, 3200);
}

function updateSignupWindowState(signupWindow) {
  if (!signupWindow) {
    signupWindowMessage.classList.add("hidden");
    updateSignupModeButtons();
    return;
  }

  isSignupWindowOpen = Boolean(signupWindow.isOpen);
  isScheduleOpen = Boolean(signupWindow.scheduleOpen);
  currentSignupMode = String(signupWindow.mode || "auto");
  const message = isSignupWindowOpen ? String(signupWindow.message || "").trim() : "";
  signupWindowMessage.textContent = message;
  signupWindowMessage.classList.toggle("hidden", !message);
  signupWindowMessage.classList.toggle("is-open", isSignupWindowOpen);
  signupWindowMessage.classList.toggle("is-closed", !isSignupWindowOpen);
  setFormLocked(!isSignupWindowOpen);
  updateSignupModeButtons();

  if (!isSignupWindowOpen) {
    submitButton.disabled = true;
    submitButtonLabel.textContent = "Inscrierile sunt inchise";
    return;
  }

  submitButton.disabled = false;
  submitButtonLabel.textContent = "Trimite inscrierea";
}

function renderRows(registrations) {
  tableBody.innerHTML = "";
  updateLiveBoard(registrations);

  const newestRegistrationId = registrations.length ? registrations[registrations.length - 1].id : null;
  const shouldAnimateNewest = newestRegistrationId !== null && newestRegistrationId !== lastSeenRegistrationId;
  lastSeenRegistrationId = newestRegistrationId;

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
    if (shouldAnimateNewest && registration.id === newestRegistrationId) {
      row.classList.add("new-entry");
    }

    const positionCell = document.createElement("td");
    positionCell.dataset.label = "Pozitie";
    positionCell.textContent = registration.position;

    const createdAtCell = document.createElement("td");
    createdAtCell.className = "time-cell";
    createdAtCell.dataset.label = "Ora";
    createdAtCell.textContent = formatRegistrationTime(registration.createdAt);

    const nameCell = document.createElement("td");
    nameCell.dataset.label = "Nume";
    nameCell.textContent = registration.name;

    const statusCell = document.createElement("td");
    statusCell.dataset.label = "Status";
    const badge = document.createElement("span");
    badge.className = "status-badge";
    badge.textContent = registration.status === "confirmed" ? "Confirmat" : "Asteptare";
    statusCell.appendChild(badge);

    row.append(positionCell, createdAtCell, nameCell, statusCell);

    if (isAdminAuthenticated) {
      const actionCell = document.createElement("td");
      actionCell.className = "table-action-cell";
      actionCell.dataset.label = "Admin";

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

  const payload = await parseJsonResponse(response);
  syncDashboardPayload(payload);
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

  if (!isSignupWindowOpen) {
    formMessage.textContent = signupWindowMessage.textContent;
    return;
  }

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

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      updateSignupWindowState(payload.signupWindow);
      throw new Error(payload.error || "Inscrierea nu a putut fi salvata.");
    }

    form.reset();
    syncDashboardPayload(payload);
    formMessage.textContent = payload.message;
    flashSuccessPanel("Inscrierea este deja in tabel si a fost marcata in ordinea sosirii.");
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

async function clearRegistrations(endpoint, triggerButton) {
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
      throw new Error(payload.error || "Actiunea nu a putut fi finalizata.");
    }

    syncDashboardPayload(payload);
    adminMessage.textContent = payload.message;
  } catch (error) {
    adminMessage.textContent = error.message;
  } finally {
    triggerButton.disabled = false;
  }
}

async function setSignupMode(mode) {
  adminMessage.textContent = "";
  updateSignupModeButtons();

  try {
    const response = await fetch("/api/admin/signup-mode", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode }),
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      if (response.status === 401) {
        setAdminAuthenticated(false);
      }
      throw new Error(payload.error || "Setarea placeholder-ului nu a putut fi schimbata.");
    }

    syncDashboardPayload(payload);
    adminMessage.textContent = payload.message;
  } catch (error) {
    adminMessage.textContent = error.message;
  } finally {
    updateSignupModeButtons();
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

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      if (response.status === 401) {
        setAdminAuthenticated(false);
      }
      throw new Error(payload.error || "Inscrierea nu a putut fi stearsa.");
    }

    syncDashboardPayload(payload);
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
forceOpenButton.addEventListener("click", () => setSignupMode("force_open"));
togglePlaceholderButton.addEventListener("click", () => setSignupMode("force_closed"));
autoModeButton.addEventListener("click", () => setSignupMode("auto"));
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
setAppReady(false);

Promise.allSettled([loadAdminStatus(), loadRegistrations()]).then((results) => {
  const registrationResult = results[1];
  if (registrationResult.status === "rejected") {
    formMessage.textContent = registrationResult.reason.message;
  }
  setAppReady(true);
});
