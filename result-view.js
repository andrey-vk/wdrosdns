import { addResultStats, detectionFailureKey } from "./common.js";
import { t, fmt } from "./i18n.js";

function noteFor(row) {
  const parts = [];

  if (row.added === true) parts.push(t("noteAdded"));
  if (row.added === false) parts.push(row.addError || t("noteAddFailed"));
  if (row.added === null) parts.push(t("noteRelated"));

  if (row.resolveState === "ok") parts.push(t("noteResolveOk"));
  if (row.resolveState === "fail") parts.push(`resolve: ${row.resolveError}`);

  return parts.join(" · ");
}

// Shared "what happened" block for the popup and the devtools panel:
// one line per domain plus the raw router response behind a details toggle.
export function createResultView(el) {
  function setRaw(raw) {
    el.rawBox.classList.toggle("hidden", !raw);
    el.rawJson.textContent = raw ? JSON.stringify(raw, null, 2) : "";
    el.rawBox.open = false;
  }

  function showError(text, raw = null) {
    el.section.classList.remove("hidden");
    el.summary.textContent = "";
    el.list.innerHTML = "";

    const row = document.createElement("div");
    row.className = "resultRow err";

    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = "✕";

    const label = document.createElement("span");
    label.className = "grow";
    label.textContent = text;

    row.append(mark, label);
    el.list.appendChild(row);
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
    el.summary.textContent = parts.join(" · ");

    el.list.innerHTML = "";

    for (const row of stats.rows) {
      const line = document.createElement("div");
      const failed = row.added === false || row.resolveState === "fail";
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
