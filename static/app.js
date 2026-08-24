const form = document.getElementById("attendance-form");
const person1Input = document.getElementById("person1");
const person2Input = document.getElementById("person2");
const submitButton = document.getElementById("submit-button");
const submitButtonLabel = submitButton.querySelector(".button-label");
const submissionOverlay = document.getElementById("submission-overlay");
const formMessage = document.getElementById("form-message");
const signupWindowMessage = document.getElementById("signup-window-message");
const countdownCard = document.getElementById("countdown-card");
const countdownLabel = document.getElementById("countdown-label");
const countdownDisplay = document.getElementById("countdown-display");
const connectionStatus = document.getElementById("connection-status");
const formControlsShell = document.querySelector(".form-controls-shell");
const formLockedOverlay = document.getElementById("form-locked-overlay");
const tableBody = document.getElementById("attendance-table-body");
const weekLabel = document.getElementById("week-label");
const matchDateDisplay = document.getElementById("match-date-display");
const matchKicker = document.getElementById("match-kicker");
const pageTitle = document.getElementById("page-title");
const pageDescription = document.getElementById("page-description");
const scheduleCallout = document.getElementById("schedule-callout");
const matchDateSubtitle = document.getElementById("match-date-subtitle");
const matchLocationLink = document.getElementById("match-location-link");
const matchLocationName = document.getElementById("match-location-name");
const lockedScheduleCopy = document.getElementById("locked-schedule-copy");
const fridayEventLink = document.getElementById("friday-event-link");
const wednesdayEventLink = document.getElementById("wednesday-event-link");
const teamsPageLink = document.getElementById("teams-page-link");
const emptyStateTemplate = document.getElementById("empty-state-template");
const signupStateTitle = document.getElementById("signup-state-title");
const signupStateBadge = document.getElementById("signup-state-badge");
const confirmedCounter = document.getElementById("confirmed-counter");
const spotsLeftCounter = document.getElementById("spots-left-counter");
const waitingCounter = document.getElementById("waiting-counter");
const progressCaption = document.getElementById("progress-caption");
const progressFill = document.getElementById("progress-fill");
const progressTrack = document.getElementById("progress-track");
const contentGrid = document.getElementById("content-grid");
const successPanel = document.getElementById("success-panel");
const successTitle = document.getElementById("success-title");
const successSummary = document.getElementById("success-summary");
const successDetails = document.getElementById("success-details");
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
const currentPath = (window.location?.pathname || "/").replace(/\/+$/, "") || "/";
const eventKey = ["/miercuri", "/wednesday"].includes(currentPath)
  ? "wednesday"
  : "friday";
const EVENT_CONTENT = {
  friday: {
    documentTitle: "Prezență săptămânală la fotbal",
    kicker: "Meciul acestei săptămâni",
    title: "Prezență săptămânală la fotbal",
    description:
      "Completează formularul pentru a te înscrie la meciul din săptămâna aceasta. Poți trimite maximum 2 persoane într-o singură înscriere.",
    schedule: "Înscrierile încep în fiecare joi la ora 12:00.",
    dateSubtitle: "Fotbal de vineri seara",
    locationName: "Magic Stadium - Tudor",
    locationUrl:
      "https://www.google.com/maps/place/Magic+Stadium/@47.1574832,27.6050335,200m/data=!3m1!1e3!4m14!1m7!3m6!1s0x40cafbf72d089343:0xf8aa78e9b6dbaecf!2sMagic+Sport+Center+Alexandru!8m2!3d47.1669271!4d27.56082!16s%2Fg%2F11h3gp53y_!3m5!1s0x40cafb0053daf0a3:0xa928221648be6a61!8m2!3d47.1575625!4d27.6050018!16s%2Fg%2F11z6p7z834?entry=ttu&g_ep=EgoyMDI2MDgxOS4wIKXMDSoASAFQAw%3D%3D",
    lockedSchedule: "Formularul devine activ doar joia începând cu ora 12:00.",
  },
  wednesday: {
    documentTitle: "Prezență la fotbal miercuri",
    kicker: "Meciul de miercuri",
    title: "Prezență la fotbal - Miercuri",
    description:
      "Completează formularul pentru a te înscrie la meciul de miercuri, programat între orele 19:30 și 21:30. Poți trimite maximum 2 persoane într-o singură înscriere.",
    schedule: "Înscrierile încep în fiecare luni la ora 19:30.",
    dateSubtitle: "Miercuri, 19:30 - 21:30",
    locationName: "D&C Sport - Siraj",
    locationUrl:
      "https://www.google.com/maps/place/D%26C+Sport/@47.1354308,27.5888104,1044m/data=!3m2!1e3!4b1!4m6!3m5!1s0x40cafbb674767261:0x8b87d3b9d1de308f!8m2!3d47.1354272!4d27.5913907!16s%2Fg%2F11c6w058tj?entry=ttu&g_ep=EgoyMDI2MDgxOS4wIKXMDSoASAFQAw%3D%3D",
    lockedSchedule: "Formularul devine activ în fiecare luni începând cu ora 19:30.",
  },
};
let isAdminAuthenticated = false;
let currentTheme = document.documentElement.dataset.theme || "light";
let isAdminExpanded = false;
let isSignupWindowOpen = true;
let currentSignupMode = "auto";
let isScheduleOpen = true;
let lastSeenRegistrationId = null;
let countdownTimerId = null;
let countdownTarget = null;
let countdownClockOffset = 0;
let countdownRefreshPending = false;

const DASHBOARD_CACHE_KEY = `football-attendance:${eventKey}`;

function eventApiUrl(path) {
  return `${path}?event=${eventKey}`;
}

function applyEventContent() {
  const content = EVENT_CONTENT[eventKey];
  document.title = content.documentTitle;
  document.documentElement.dataset.event = eventKey;
  document.body.dataset.event = eventKey;
  matchKicker.textContent = content.kicker;
  pageTitle.textContent = content.title;
  pageDescription.textContent = content.description;
  scheduleCallout.textContent = content.schedule;
  matchDateSubtitle.textContent = content.dateSubtitle;
  matchLocationName.textContent = content.locationName;
  matchLocationLink.setAttribute("href", content.locationUrl);
  matchLocationLink.setAttribute(
    "aria-label",
    `Deschide traseul către ${content.locationName} în Google Maps`,
  );
  lockedScheduleCopy.textContent = content.lockedSchedule;
  fridayEventLink.setAttribute("aria-current", eventKey === "friday" ? "page" : "false");
  wednesdayEventLink.setAttribute("aria-current", eventKey === "wednesday" ? "page" : "false");
  teamsPageLink.classList.toggle("hidden", eventKey !== "friday");
}

function setAppReady(isReady) {
  document.body.classList.toggle("app-booting", !isReady);
}

function setConnectionStatus(isOnline, isUsingCache = false) {
  document.body.classList.toggle("is-offline", !isOnline);
  connectionStatus.classList.toggle("hidden", isOnline);
  connectionStatus.textContent = isUsingCache ? "Date salvate local" : "Fără conexiune";
  if (!isOnline) {
    setFormLocked(true);
    setSubmissionLoading(false);
  }
}

function cacheDashboardPayload(payload) {
  try {
    localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // The live API remains the source of truth when browser storage is unavailable.
  }
}

function readCachedDashboardPayload() {
  try {
    const cachedPayload = localStorage.getItem(DASHBOARD_CACHE_KEY);
    return cachedPayload ? JSON.parse(cachedPayload) : null;
  } catch {
    return null;
  }
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `${days} ${days === 1 ? "zi" : "zile"} · ${clock}` : clock;
}

function stopCountdown() {
  if (countdownTimerId !== null && typeof window.clearInterval === "function") {
    window.clearInterval(countdownTimerId);
  }
  countdownTimerId = null;
  countdownTarget = null;
  countdownCard.classList.add("hidden");
}

function renderCountdown() {
  if (!countdownTarget) {
    return;
  }

  const remaining = countdownTarget - (Date.now() + countdownClockOffset);
  countdownDisplay.textContent = remaining > 0 ? formatCountdown(remaining) : "Se actualizează...";

  if (remaining <= 0) {
    stopCountdown();
    if (!countdownRefreshPending) {
      countdownRefreshPending = true;
      const refreshTimer = window.setTimeout(() => {
        loadRegistrations()
          .catch(() => {})
          .finally(() => {
            countdownRefreshPending = false;
          });
      }, 1500);
      refreshTimer?.unref?.();
    }
  }
}

function configureCountdown(signupWindow) {
  stopCountdown();
  if (!signupWindow || signupWindow.mode !== "auto") {
    return;
  }

  const targetValue = signupWindow.isOpen ? signupWindow.end : signupWindow.nextOpen;
  const target = Date.parse(String(targetValue || ""));
  const serverNow = Date.parse(String(signupWindow.serverNow || ""));
  if (!Number.isFinite(target)) {
    return;
  }

  countdownClockOffset = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
  countdownTarget = target;
  countdownLabel.textContent = signupWindow.isOpen
    ? "Înscrierile se închid în"
    : "Următoarea deschidere";
  countdownCard.classList.remove("hidden");
  renderCountdown();

  if (typeof window.setInterval === "function") {
    countdownTimerId = window.setInterval(renderCountdown, 1000);
  }
}

function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

function bindConnectivityEvents() {
  if (typeof navigator === "undefined") {
    return;
  }

  setConnectionStatus(navigator.onLine !== false);
  if (typeof window.addEventListener !== "function") {
    return;
  }

  window.addEventListener("offline", () => setConnectionStatus(false));
  window.addEventListener("online", () => {
    setConnectionStatus(true);
    loadRegistrations().catch(() => setConnectionStatus(false, true));
  });
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
  themeToggleLabel.textContent = theme === "dark" ? "Mod luminos" : "Mod întunecat";
  themeIconSun.classList.toggle("hidden", theme !== "dark");
  themeIconMoon.classList.toggle("hidden", theme === "dark");
}

function setSubmissionLoading(isLoading) {
  const cannotSubmit = !isSignupWindowOpen || document.body.classList.contains("is-offline");
  submitButton.disabled = isLoading || cannotSubmit;
  if (isLoading) {
    submitButtonLabel.textContent = "Se trimite...";
  } else if (!isSignupWindowOpen) {
    submitButtonLabel.textContent = "Înscrierile sunt închise";
  } else if (document.body.classList.contains("is-offline")) {
    submitButtonLabel.textContent = "Necesită conexiune";
  } else {
    submitButtonLabel.textContent = "Trimite înscrierea";
  }
  submissionOverlay.classList.toggle("hidden", !isLoading);
  submissionOverlay.setAttribute("aria-hidden", String(!isLoading));
}

function setFormLocked(isLocked) {
  formControlsShell.classList.toggle("is-locked", isLocked);
  formLockedOverlay.classList.toggle("hidden", !isLocked);
  formLockedOverlay.setAttribute("aria-hidden", String(!isLocked));
  person1Input.disabled = isLocked;
  person2Input.disabled = isLocked;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Serverul a trimis un răspuns invalid. Reîncarcă pagina.");
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
  progressTrack.setAttribute("aria-valuenow", String(confirmed));

  let title = "Închis";
  let badge = "Închis";

  if (confirmed >= 18) {
    title = "Plin";
    badge = "Plin";
  } else if (currentSignupMode === "force_open" || isSignupWindowOpen) {
    if (spotsLeft <= 3 && confirmed > 0) {
      title = "Aproape plin";
      badge = "Aproape plin";
    } else {
      title = "Deschis acum";
      badge = "Deschis";
    }
  } else if (waiting > 0) {
    title = "Lista de așteptare";
    badge = "Așteptare";
  }

  signupStateTitle.textContent = title;
  signupStateBadge.textContent = badge;
}

function flashSuccessPanel(payload) {
  const submittedIds = new Set(payload.submittedRegistrationIds || []);
  const registrations = Array.isArray(payload.registrations) ? payload.registrations : [];
  const submitted = registrations.filter((registration) => submittedIds.has(registration.id));
  const confirmed = Math.min(registrations.length, 18);
  const spotsLeft = Math.max(18 - confirmed, 0);

  successTitle.textContent = submitted.length > 1 ? "Locuri înregistrate" : "Loc înregistrat";
  successSummary.textContent = spotsLeft > 0
    ? `Mai sunt ${spotsLeft} ${spotsLeft === 1 ? "loc confirmat disponibil" : "locuri confirmate disponibile"}.`
    : "Primele 18 locuri sunt ocupate; înscrierile noi intră pe lista de așteptare.";
  successDetails.innerHTML = "";

  submitted.forEach((registration) => {
    const detail = document.createElement("li");
    const status = registration.status === "confirmed" ? "Confirmat" : "Lista de așteptare";
    detail.textContent = `${registration.name}: poziția ${registration.position} · ${status}`;
    successDetails.appendChild(detail);
  });

  if (!submitted.length) {
    const detail = document.createElement("li");
    detail.textContent = "Înscrierea apare acum în lista curentă.";
    successDetails.appendChild(detail);
  }

  successPanel.classList.remove("hidden");
  successPanel.focus?.({ preventScroll: true });
  window.clearTimeout(flashSuccessPanel.timeoutId);
  flashSuccessPanel.timeoutId = window.setTimeout(() => {
    successPanel.classList.add("hidden");
  }, 6500);
  flashSuccessPanel.timeoutId?.unref?.();
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
  contentGrid.classList.toggle("is-closed", !isSignupWindowOpen);
  document.body.classList.toggle("signup-is-closed", !isSignupWindowOpen);
  setFormLocked(!isSignupWindowOpen);
  configureCountdown(signupWindow);
  updateSignupModeButtons();

  if (!isSignupWindowOpen) {
    submitButton.disabled = true;
    submitButtonLabel.textContent = "Înscrierile sunt închise";
    return;
  }

  submitButton.disabled = false;
  submitButtonLabel.textContent = "Trimite înscrierea";
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
    positionCell.dataset.label = "Poziție";
    positionCell.textContent = registration.position;

    const createdAtCell = document.createElement("td");
    createdAtCell.className = "time-cell";
    createdAtCell.dataset.label = "Ora";
    const formattedTime = formatRegistrationTime(registration.createdAt);
    const [datePart, clockPart] = formattedTime.split(" ");
    createdAtCell.setAttribute("aria-label", formattedTime);

    const dateText = document.createElement("span");
    dateText.className = "time-date";
    dateText.textContent = datePart;

    const clockText = document.createElement("span");
    clockText.className = "time-clock";
    clockText.textContent = clockPart || "";

    createdAtCell.append(dateText, clockText);

    const nameCell = document.createElement("td");
    nameCell.className = "name-cell";
    nameCell.dataset.label = "Nume";
    nameCell.textContent = registration.name;
    nameCell.setAttribute("title", registration.name);

    const statusCell = document.createElement("td");
    statusCell.className = "status-cell";
    statusCell.dataset.label = "Status";
    const badge = document.createElement("span");
    badge.className = "status-badge";
    badge.textContent = registration.status === "confirmed" ? "Confirmat" : "Așteptare";
    statusCell.appendChild(badge);

    row.append(positionCell, createdAtCell, nameCell, statusCell);

    if (isAdminAuthenticated) {
      const actionCell = document.createElement("td");
      actionCell.className = "table-action-cell";
      actionCell.dataset.label = "Admin";

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "danger-button table-delete-button";
      deleteButton.textContent = "Șterge";
      deleteButton.addEventListener("click", () => deleteOneRegistration(registration.id, deleteButton));

      actionCell.appendChild(deleteButton);
      row.appendChild(actionCell);
    }

    tableBody.appendChild(row);
  });
}

async function loadRegistrations() {
  try {
    const response = await fetch(eventApiUrl("/api/registrations"));
    if (!response.ok) {
      throw new Error("Nu am putut încărca lista curentă.");
    }

    const payload = await parseJsonResponse(response);
    syncDashboardPayload(payload);
    cacheDashboardPayload(payload);
    setConnectionStatus(true);
    return payload;
  } catch (error) {
    const cachedPayload = readCachedDashboardPayload();
    if (!cachedPayload) {
      setConnectionStatus(false);
      throw error;
    }

    syncDashboardPayload(cachedPayload);
    setConnectionStatus(false, true);
    setFormLocked(true);
    submitButton.disabled = true;
    submitButtonLabel.textContent = "Necesită conexiune";
    formMessage.textContent = "Afișăm ultima listă salvată pe acest dispozitiv.";
    return cachedPayload;
  }
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
        event: eventKey,
      }),
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      updateSignupWindowState(payload.signupWindow);
      throw new Error(payload.error || "Înscrierea nu a putut fi salvată.");
    }

    form.reset();
    syncDashboardPayload(payload);
    cacheDashboardPayload(payload);
    formMessage.textContent = payload.message;
    flashSuccessPanel(payload);
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
  adminLoginButton.textContent = "Se verifică...";

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
      throw new Error(payload.error || "Autentificarea a eșuat.");
    }

    setAdminAuthenticated(true);
    adminMessage.textContent = payload.message;
    await loadRegistrations();
  } catch (error) {
    adminMessage.textContent = error.message;
  } finally {
    adminLoginButton.disabled = false;
    adminLoginButton.textContent = "Intră în panoul de administrare";
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
      throw new Error(payload.error || "Acțiunea nu a putut fi finalizată.");
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
      body: JSON.stringify({ mode, event: eventKey }),
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      if (response.status === 401) {
        setAdminAuthenticated(false);
      }
      throw new Error(payload.error || "Starea formularului nu a putut fi schimbată.");
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
      body: JSON.stringify({ id: registrationId, event: eventKey }),
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      if (response.status === 401) {
        setAdminAuthenticated(false);
      }
      throw new Error(payload.error || "Înscrierea nu a putut fi ștearsă.");
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
  adminMessage.textContent = "Te-ai delogat din panoul de administrare.";
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
  clearRegistrations(eventApiUrl("/api/admin/clear-week"), clearWeekButton),
);
clearAllButton.addEventListener("click", () =>
  clearRegistrations(eventApiUrl("/api/admin/clear-all"), clearAllButton),
);
adminLogoutButton.addEventListener("click", logoutAdmin);
themeToggle.addEventListener("click", toggleTheme);

applyEventContent();
applyTheme(currentTheme);
setAdminExpanded(false);
setAppReady(false);
bindConnectivityEvents();
registerServiceWorker();

Promise.allSettled([loadAdminStatus(), loadRegistrations()]).then((results) => {
  const registrationResult = results[1];
  if (registrationResult.status === "rejected") {
    formMessage.textContent = registrationResult.reason.message;
  }
  setAppReady(true);
});
