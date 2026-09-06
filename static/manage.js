const managedRegistrations = document.getElementById("managed-registrations");
const managementLoading = document.getElementById("management-loading");
const managementMessage = document.getElementById("management-message");
const managementIntro = document.getElementById("management-intro");
const backToEvent = document.getElementById("back-to-event");
const copyCurrentLinkButton = document.getElementById("copy-current-link");
const refreshManagementButton = document.getElementById("refresh-management");
const isCombinedManagement = window.location.pathname.replace(/\/+$/, "") === "/inscrierile-mele";
const selectedEvent = new URLSearchParams(window.location.search).get("event") === "wednesday" ? "wednesday" : "friday";
const selectedDay = selectedEvent === "wednesday" ? "miercuri" : "vineri";
const managementToken = (window.location.pathname.split("/").filter(Boolean).pop() || "").trim();
const MANAGEMENT_LINKS_KEY = "football-attendance:management-links";
let combinedLoadVersion = 0;

function managementHeaders(token = managementToken) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function savedManagementLinks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MANAGEMENT_LINKS_KEY) || "[]");
    const seen = new Set();
    return Array.isArray(parsed) ? parsed.filter((entry) => {
      if (!/^\/inscriere\/[A-Za-z0-9_-]{43,128}$/.test(entry?.path || "") || seen.has(entry.path)) return false;
      seen.add(entry.path);
      return true;
    }) : [];
  } catch {
    return [];
  }
}

function saveCurrentLink(eventKey) {
  if (isCombinedManagement) return;
  const path = window.location.pathname.replace(/\/$/, "");
  try {
    const links = savedManagementLinks().filter((entry) => entry.path !== path);
    links.unshift({ path, eventKey, savedAt: new Date().toISOString() });
    localStorage.setItem(MANAGEMENT_LINKS_KEY, JSON.stringify(links));
  } catch {
    // The private page remains usable when browser storage is unavailable.
  }
}

function statusLabel(registration) {
  if (!registration.active) {
    return "Retrasă";
  }
  return registration.status === "confirmed" ? "Confirmat" : "Lista de așteptare";
}

function appendManagedPlayer(registration, payload, token) {
  const card = document.createElement("article");
  card.className = `managed-registration ${registration.active ? registration.status : "withdrawn"}`;
  const copy = document.createElement("div");
  copy.className = "managed-registration-copy";
  const name = document.createElement("strong");
  name.textContent = registration.name;
  const status = document.createElement("span");
  status.className = "status-badge";
  status.textContent = registration.active && registration.position
    ? `${statusLabel(registration)} · poziția ${registration.position}`
    : statusLabel(registration);
  copy.append(name, status);
  if (isCombinedManagement) {
    const match = document.createElement("span");
    match.textContent = `${payload.eventKey === "wednesday" ? "Miercuri" : "Vineri"} · ${payload.weekLabel}`;
    copy.appendChild(match);
  }
  card.appendChild(copy);

  if (registration.active) {
    const withdrawButton = document.createElement("button");
    withdrawButton.type = "button";
    withdrawButton.className = "danger-button managed-withdraw-button";
    withdrawButton.textContent = "Retrage";
    withdrawButton.addEventListener("click", () => withdrawRegistration(registration, withdrawButton, token));
    card.appendChild(withdrawButton);
  }
  managedRegistrations.appendChild(card);
}

function renderSubmission(payload) {
  managedRegistrations.innerHTML = "";
  managementIntro.textContent = `Înscriere pentru ${payload.weekLabel}. Poți retrage separat fiecare persoană.`;
  backToEvent.href = payload.eventKey === "wednesday" ? "/miercuri" : "/";
  saveCurrentLink(payload.eventKey);
  payload.registrations.forEach((registration) => {
    appendManagedPlayer(registration, payload, managementToken);
  });
}

async function loadCombinedRegistrations() {
  const version = ++combinedLoadVersion;
  managementLoading.classList.remove("hidden");
  refreshManagementButton.disabled = true;
  const links = savedManagementLinks();
  const results = await Promise.allSettled(links.map(async (entry) => {
    const token = entry.path.split("/").pop();
    const response = await fetch("/api/management", { headers: managementHeaders(token), cache: "no-store" });
    const payload = await parseJsonResponse(response);
    if (response.status === 404) return { expired: entry.path };
    if (!response.ok) throw new Error(payload.error || "Înscrierea nu a putut fi încărcată.");
    if (!Array.isArray(payload.registrations)) throw new Error("Răspuns invalid.");
    return { payload, token };
  }));
  if (version !== combinedLoadVersion) return;
  managedRegistrations.innerHTML = "";
  const players = new Map();
  const expired = new Set();
  let failures = 0;
  results.forEach((result) => {
    if (result.status === "rejected") { failures += 1; return; }
    if (result.value.expired) { expired.add(result.value.expired); return; }
    const { payload, token } = result.value;
    if (payload.eventKey !== selectedEvent) return;
    payload.registrations.forEach((registration) => {
      if (!players.has(registration.id)) players.set(registration.id, { registration, payload, token });
    });
  });
  [...players.values()]
    .sort((a, b) => b.payload.weekKey.localeCompare(a.payload.weekKey)
      || a.payload.eventKey.localeCompare(b.payload.eventKey)
      || Number(b.registration.active) - Number(a.registration.active)
      || (a.registration.position || 0) - (b.registration.position || 0)
      || a.registration.id - b.registration.id)
    .forEach(({ registration, payload, token }) => appendManagedPlayer(registration, payload, token));
  if (expired.size) {
    try {
      localStorage.setItem(MANAGEMENT_LINKS_KEY, JSON.stringify(savedManagementLinks().filter((entry) => !expired.has(entry.path))));
    } catch {
      // Unavailable storage does not prevent managing the loaded players.
    }
  }
  managementMessage.textContent = failures
    ? "Unele înscrieri nu au putut fi încărcate. Apasă Actualizează pentru a reîncerca."
    : players.size ? "" : `Nu ai înscrieri pentru ${selectedDay} în acest browser. Înscrie un jucător sau deschide un link privat salvat.`;
  managementLoading.classList.add("hidden");
  refreshManagementButton.disabled = false;
  document.body.classList.remove("app-booting");
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Serverul a trimis un răspuns invalid.");
  }
}

async function loadSubmission() {
  if (isCombinedManagement) return loadCombinedRegistrations();
  managementLoading.classList.remove("hidden");
  try {
    const response = await fetch("/api/management", {
      headers: managementHeaders(),
      cache: "no-store",
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || "Înscrierea nu a putut fi încărcată.");
    }
    renderSubmission(payload);
  } catch (error) {
    managementMessage.textContent = error.message;
  } finally {
    managementLoading.classList.add("hidden");
    document.body.classList.remove("app-booting");
  }
}

async function withdrawRegistration(registration, triggerButton, token = managementToken) {
  const confirmed = window.confirm(
    `Confirmi retragerea lui ${registration.name}? Locul va fi oferit automat primei persoane în așteptare.`,
  );
  if (!confirmed) {
    return;
  }

  managementMessage.textContent = "";
  triggerButton.disabled = true;
  triggerButton.textContent = "Se retrage...";
  try {
    const response = await fetch("/api/management/withdraw", {
      method: "POST",
      headers: managementHeaders(token),
      body: JSON.stringify({ registrationId: registration.id, confirmed: true }),
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || "Retragerea nu a putut fi salvată.");
    }
    if (isCombinedManagement) {
      await loadCombinedRegistrations();
      managementMessage.textContent = [payload.message, managementMessage.textContent].filter(Boolean).join(" ");
    } else {
      renderSubmission(payload);
      managementMessage.textContent = payload.message;
    }
  } catch (error) {
    managementMessage.textContent = error.message;
    triggerButton.disabled = false;
    triggerButton.textContent = "Retrage";
  }
}

async function copyCurrentLink() {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard unavailable");
    }
    await navigator.clipboard.writeText(window.location.href);
    copyCurrentLinkButton.textContent = "Link copiat";
  } catch {
    copyCurrentLinkButton.textContent = "Copiază adresa din browser";
  }
}

copyCurrentLinkButton.addEventListener("click", copyCurrentLink);
refreshManagementButton.addEventListener("click", loadSubmission);
if (isCombinedManagement) {
  document.documentElement.dataset.event = selectedEvent;
  document.title = `Înscrierea ta · ${selectedDay === "miercuri" ? "Miercuri" : "Vineri"}`;
  document.getElementById("management-title").textContent = "Înscrierea ta";
  document.getElementById("management-kicker").textContent = `Fotbal · ${selectedDay === "miercuri" ? "Miercuri" : "Vineri"}`;
  backToEvent.setAttribute("href", selectedEvent === "wednesday" ? "/miercuri" : "/");
  backToEvent.textContent = `Vezi lista de ${selectedDay}`;
  managementIntro.textContent = "Vezi înscrierea ta sau retrage-te. Dacă ai înscris și un prieten, îl găsești tot aici.";
  document.getElementById("management-security-note").textContent = "Această pagină reunește înscrierile salvate în acest browser. Pe alt dispozitiv, deschide linkurile private primite la înscriere pentru a le adăuga aici.";
  copyCurrentLinkButton.classList.add("hidden");
  window.addEventListener("storage", (event) => { if (event.key === MANAGEMENT_LINKS_KEY) loadSubmission(); });
}
loadSubmission();
