const addForm = document.getElementById("add-name-form");
const newNameInput = document.getElementById("new-name");
const namesList = document.getElementById("names-list");
const filterInput = document.getElementById("name-filter");

let allNames = [];

async function loadNames() {
  const res = await fetch("/api/names");
  if (!res.ok) return;
  allNames = await res.json();
  renderNames();
}

function renderNames() {
  const q = filterInput.value.trim().toLowerCase();
  const filtered = q
    ? allNames.filter((n) => n.name.toLowerCase().includes(q))
    : allNames;

  if (!filtered.length) {
    namesList.innerHTML = '<p class="hint">Keine Namen gespeichert.</p>';
    return;
  }

  namesList.innerHTML = filtered
    .map(
      (n) => `
      <div class="name-row" data-id="${n.id}">
        <span class="name-text">${escapeHtml(n.name)}</span>
        <div class="name-actions">
          <button class="button secondary small" onclick="editName(${n.id})">Bearbeiten</button>
          <button class="button danger small" onclick="deleteName(${n.id})">Löschen</button>
        </div>
      </div>
    `
    )
    .join("");
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = newNameInput.value.trim();
  if (!name) return;
  const res = await fetch("/api/names", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (res.ok) {
    newNameInput.value = "";
    await loadNames();
  } else if (res.status === 409) {
    alert("Name existiert bereits.");
  } else {
    alert("Fehler beim Hinzufügen.");
  }
});

filterInput.addEventListener("input", renderNames);

window.editName = (id) => {
  const row = namesList.querySelector(`.name-row[data-id="${id}"]`);
  if (!row) return;
  const nameEl = row.querySelector(".name-text");
  const current = nameEl.textContent;
  const actions = row.querySelector(".name-actions");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "edit-input";
  input.value = current;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  actions.innerHTML = `
    <button class="button success small" id="save-${id}">Speichern</button>
    <button class="button secondary small" id="cancel-${id}">Abbrechen</button>
  `;

  const save = async () => {
    const newName = input.value.trim();
    if (!newName) {
      alert("Name darf nicht leer sein.");
      return;
    }
    const res = await fetch(`/api/names/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (res.ok) {
      await loadNames();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Fehler beim Speichern.");
    }
  };

  document.getElementById(`save-${id}`).addEventListener("click", save);
  document.getElementById(`cancel-${id}`).addEventListener("click", loadNames);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
    else if (e.key === "Escape") loadNames();
  });
};

window.deleteName = async (id) => {
  if (!confirm("Name wirklich löschen?")) return;
  const res = await fetch(`/api/names/${id}`, { method: "DELETE" });
  if (res.ok) await loadNames();
  else alert("Fehler beim Löschen.");
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

loadNames();
