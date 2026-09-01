const managedRegistrations = document.getElementById("managed-registrations");
const managementLoading = document.getElementById("management-loading");
const managementMessage = document.getElementById("management-message");
const managementIntro = document.getElementById("management-intro");
const backToEvent = document.getElementById("back-to-event");
const copyCurrentLinkButton = document.getElementById("copy-current-link");
const managementToken = (window.location.pathname.split("/").filter(Boolean).pop() || "").trim();
const MANAGEMENT_LINKS_KEY = "football-attendance:management-links";

function managementHeaders() {
  return {
    Authorization: `Bearer ${managementToken}`,
    "Content-Type": "application/json",
  };
}

function saveCurrentLink(eventKey) {
  const path = window.location.pathname.replace(/\/$/, "");
  try {
    const parsed = JSON.parse(localStorage.getItem(MANAGEMENT_LINKS_KEY) || "[]");
    const links = Array.isArray(parsed) ? parsed.filter((entry) => entry?.path !== path) : [];
    links.unshift({ path, eventKey, savedAt: new Date().toISOString() });
    localStorage.setItem(MANAGEMENT_LINKS_KEY, JSON.stringify(links.slice(0, 10)));
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

function renderSubmission(payload) {
  managedRegistrations.innerHTML = "";
  managementIntro.textContent = `Înscriere pentru ${payload.weekLabel}. Poți retrage separat fiecare persoană.`;
  backToEvent.href = payload.eventKey === "wednesday" ? "/miercuri" : "/";
  saveCurrentLink(payload.eventKey);

  payload.registrations.forEach((registration) => {
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
    card.appendChild(copy);

    if (registration.active) {
      const withdrawButton = document.createElement("button");
      withdrawButton.type = "button";
      withdrawButton.className = "danger-button managed-withdraw-button";
      withdrawButton.textContent = "Retrage";
      withdrawButton.addEventListener("click", () => withdrawRegistration(registration, withdrawButton));
      card.appendChild(withdrawButton);
    }
    managedRegistrations.appendChild(card);
  });
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

async function withdrawRegistration(registration, triggerButton) {
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
      headers: managementHeaders(),
      body: JSON.stringify({ registrationId: registration.id, confirmed: true }),
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || "Retragerea nu a putut fi salvată.");
    }
    renderSubmission(payload);
    managementMessage.textContent = payload.message;
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
loadSubmission();
