const form = document.getElementById("attendance-form");
const person1Input = document.getElementById("person1");
const person2Input = document.getElementById("person2");
const submitButton = document.getElementById("submit-button");
const formMessage = document.getElementById("form-message");
const tableBody = document.getElementById("attendance-table-body");
const weekLabel = document.getElementById("week-label");
const emptyStateTemplate = document.getElementById("empty-state-template");

function renderRows(registrations) {
  tableBody.innerHTML = "";

  if (!registrations.length) {
    tableBody.appendChild(emptyStateTemplate.content.cloneNode(true));
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

async function submitRegistration(event) {
  event.preventDefault();

  formMessage.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "Se trimite...";

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
    submitButton.disabled = false;
    submitButton.textContent = "Trimite inscrierea";
  }
}

form.addEventListener("submit", submitRegistration);

loadRegistrations().catch((error) => {
  formMessage.textContent = error.message;
});
