import { addResultStats, detectionFailureKey, invalidDomainRows, redactSecrets } from "./common.js";
import { t, fmt } from "./i18n.js";

const ACTION_KEYS = {
  created: "noteAdded",
  updated: "noteUpdated",
  unchanged: "noteUnchanged"
};

function noteFor(row) {
  const parts = [];

  if (row.invalid) parts.push(t("noteInvalidDomain"));
  else if (row.added === true) parts.push(t(ACTION_KEYS[row.action] || "noteAdded"));
  else if (row.added === false) parts.push(row.addError || t("noteAddFailed"));
  else if (row.added === null) parts.push(t("noteRelated"));

  if (row.duplicates) parts.push(fmt("noteDuplicates", [row.duplicates]));

  if (row.resolveState === "ok") parts.push(t("noteResolveOk"));
  if (row.resolveState === "fail") parts.push(`resolve: ${row.resolveError}`);

  return parts.join(" · ");
}

// Shared "what happened" block for the popup and the devtools panel:
// one line per domain plus the raw router response behind a details toggle.
export function createResultView(el) {
  function setRaw(raw) {
    el.rawBox.classList.toggle("hidden", !raw);
    el.rawJson.textContent = raw ? JSON.stringify(redactSecrets(raw), null, 2) : "";
    el.rawBox.open = false;
  }

  function appendRow(text, cls, mark) {
    const row = document.createElement("div");
    row.className = `resultRow ${cls}`;

    const markEl = document.createElement("span");
    markEl.className = "mark";
    markEl.textContent = mark;

    const label = document.createElement("span");
    label.className = "grow ellipsis";
    label.textContent = text;

    row.append(markEl, label);
    el.list.appendChild(row);
  }

  function showError(text, raw = null) {
    el.section.classList.remove("hidden");
    el.summary.textContent = "";
    el.list.innerHTML = "";

    appendRow(text, "err", "✕");

    // Names the user typed that could never be valid DNS entries.
    for (const row of invalidDomainRows(raw)) {
      appendRow(`${row.domain} — ${t("noteInvalidDomain")}`, "err", "✕");
    }

    setRaw(raw);
  }

  function render(result) {
    el.section.classList.remove("hidden");

    if (!result || !result.ok) {
      showError(t(detectionFailureKey(result)), result);
      return;
    }

    const stats = addResultStats(result);
    const parts = [fmt("summaryAdded", [stats.added, stats.addTotal])];
    if (stats.resolveTotal) {
      parts.push(fmt("summaryResolved", [stats.resolved, stats.resolveTotal, stats.server]));
    }
    if (stats.duplicates) {
      parts.push(fmt("summaryDuplicates", [stats.duplicates]));
    }
    el.summary.textContent = parts.join(" · ");

    el.list.innerHTML = "";

    for (const row of stats.rows) {
      const line = document.createElement("div");
      const failed = row.added === false || row.invalid || row.resolveState === "fail";
      line.className = `resultRow ${failed ? "err" : row.added === null ? "muted" : "ok"}`;

      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = failed ? "✕" : row.added === null ? "·" : "✓";

      const domain = document.createElement("span");
      domain.className = "grow ellipsis";
      domain.textContent = row.domain;

      const note = document.createElement("span");
      note.className = "resultNote";
      note.textContent = noteFor(row);

      line.append(mark, domain, note);
      el.list.appendChild(line);
    }

    setRaw(result);
  }

  return { render, showError };
}
