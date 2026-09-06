const historyContent = document.getElementById("history-content");
const historyBody = document.getElementById("history-body");
const historyMessage = document.getElementById("history-message");
const historyCount = document.getElementById("history-count");
const historySource = document.getElementById("history-source");
const historyRefresh = document.getElementById("history-refresh");
const historyEvent = new URLSearchParams(window.location.search).get("event") === "wednesday" ? "wednesday" : "friday";
let historyRows = [];
let historyRequest = 0;

document.documentElement.dataset.event = historyEvent;
document.getElementById("history-event").textContent = historyEvent === "wednesday" ? "Istoric · Miercuri" : "Istoric · Vineri";
document.getElementById("history-back-link").setAttribute("href", historyEvent === "wednesday" ? "/miercuri" : "/");

function renderHistory() {
  const visible = historyRows.filter((row) =>
    (historySource.value === "all" || row.source === historySource.value));
  historyBody.innerHTML = "";
  historyCount.textContent = `${visible.length} din ${historyRows.length} eliminări`;
  if (!visible.length) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "Nu există eliminări înregistrate pentru selecția curentă.";
    row.appendChild(cell);
    historyBody.appendChild(row);
  }
  const labels = ["Nume", "Meci", "Înscris la", "Eliminat la", "Tipul eliminării"];
  visible.forEach((entry) => {
    const row = document.createElement("tr");
    [entry.name, entry.weekLabel, entry.createdAt, entry.removedAt || "Necunoscut", entry.sourceLabel].forEach((value, index) => {
      const cell = document.createElement("td");
      const label = document.createElement("span");
      label.className = "history-mobile-label";
      label.setAttribute("aria-hidden", "true");
      label.textContent = labels[index];
      const text = document.createElement("span");
      text.textContent = value;
      cell.append(label, text);
      row.appendChild(cell);
    });
    historyBody.appendChild(row);
  });
}

function acceptHistory(payload) {
  historyRows = payload.removalHistory;
  document.getElementById("history-event").textContent = `Istoric · ${historyEvent === "wednesday" ? "Miercuri" : "Vineri"} · ${payload.weekLabel}`;
  historyContent.classList.remove("hidden");
  renderHistory();
}

function clearHistory(message) {
  historyRequest += 1;
  historyRows = [];
  historyBody.innerHTML = "";
  historyContent.classList.add("hidden");
  historyMessage.textContent = message;
}

async function loadHistory() {
  const request = ++historyRequest;
  historyRefresh.disabled = true;
  try {
    const response = await fetch(`/api/removal-history?event=${historyEvent}`, { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json();
    if (request !== historyRequest) return;
    if (!response.ok) throw new Error(payload.error || "Istoricul nu a putut fi încărcat.");
    acceptHistory(payload);
    historyMessage.textContent = "";
  } catch (error) {
    if (request === historyRequest) {
      clearHistory(error.message || "Nu am putut încărca istoricul. Reîncarcă pagina când revine conexiunea.");
    }
  } finally {
    historyRefresh.disabled = false;
  }
}

historySource.addEventListener("change", renderHistory);
historyRefresh.addEventListener("click", loadHistory);
window.addEventListener("offline", () => clearHistory("Istoricul necesită conexiune. Reîncearcă după reconectare."));
window.addEventListener("online", loadHistory);
window.addEventListener("focus", loadHistory);
window.addEventListener("pagehide", () => clearHistory("Se verifică accesul..."));
window.addEventListener("pageshow", (event) => { if (event.persisted) loadHistory(); });
if (typeof window.setInterval === "function") {
  window.setInterval(loadHistory, 30000);
}
loadHistory();
