import {
  hostnameFromUrl,
  trimToBaseDomain,
  partitionDomainInput,
  DEFAULT_DOMAIN_COLLECTOR
} from "./common.js";
import { createResultView } from "./result-view.js";
import { applyI18n, t, fmt } from "./i18n.js";

applyI18n();

const $ = id => document.getElementById(id);

const el = {
  reloadHar: $("reloadHar"),
  filter: $("filter"),
  segBase: $("segBase"),
  segHost: $("segHost"),
  addSelected: $("addSelected"),
  info: $("info"),
  selectionInfo: $("selectionInfo"),
  toggleAll: $("toggleAll"),
  rows: $("rows"),
  resultSection: $("resultSection"),
  resultSummary: $("resultSummary"),
  resultList: $("resultList"),
  rawBox: $("rawBox"),
  rawJson: $("rawJson")
};

const resultView = createResultView({
  section: el.resultSection,
  summary: el.resultSummary,
  list: el.resultList,
  rawBox: el.rawBox,
  rawJson: el.rawJson
});

// Hosts and their request counts, not full URLs: a long DevTools session would
// otherwise grow without bound, and query strings often carry tokens the panel
// has no use for. Insertion order lets the oldest host drop out at the cap.
let hostCounts = new Map();
let requestCount = 0;
let maxHosts = DEFAULT_DOMAIN_COLLECTOR.maxEntriesPerTab;

let rows = [];
let trimBase = true;

// Unlike the popup collector — which only lists requests matching the failure
// filters — this panel lists every domain the page touched, so nothing is
// pre-selected here.
const selection = new Set();

function domainOf(host) {
  return trimBase ? trimToBaseDomain(host) : host;
}

function addRequest(request) {
  const host = hostnameFromUrl(request && request.url);
  if (!host) return false;

  requestCount += 1;
  hostCounts.set(host, (hostCounts.get(host) || 0) + 1);

  while (hostCounts.size > maxHosts) {
    hostCounts.delete(hostCounts.keys().next().value);
  }

  return true;
}

function buildRows() {
  const map = new Map();

  for (const [host, count] of hostCounts) {
    const domain = domainOf(host);
    if (!domain) continue;

    if (!map.has(domain)) {
      map.set(domain, { domain, count: 0, hosts: new Set() });
    }

    const row = map.get(domain);
    row.count += count;
    row.hosts.add(host);
  }

  return Array.from(map.values()).sort((a, b) => a.domain.localeCompare(b.domain));
}

function visibleRows() {
  const q = el.filter.value.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => r.domain.includes(q) || Array.from(r.hosts).some(h => h.includes(q)));
}

function render() {
  rows = buildRows();
  const shown = visibleRows();

  el.info.textContent = fmt("networkInfo", [requestCount, rows.length]);
  el.rows.innerHTML = "";

  if (!shown.length) {
    const empty = document.createElement("div");
    empty.className = "emptyText";
    empty.textContent = requestCount ? t("noDomainsByFilters") : t("collectorIdle");
    el.rows.appendChild(empty);
    updateSelectionInfo(shown);
    return;
  }

  for (const row of shown) {
    const item = document.createElement("label");
    item.className = "listRow";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selection.has(row.domain);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        selection.add(row.domain);
      } else {
        selection.delete(row.domain);
      }
      updateSelectionInfo(visibleRows());
    });

    const domain = document.createElement("span");
    domain.className = "listDomain";
    domain.textContent = row.domain;

    const hosts = document.createElement("span");
    hosts.className = "faint";
    hosts.textContent = row.hosts.size > 1 ? fmt("hostsCount", [row.hosts.size]) : "";

    const count = document.createElement("span");
    count.className = "faint";
    count.textContent = `×${row.count}`;

    item.title = Array.from(row.hosts).sort().join("\n");
    item.append(cb, domain, hosts, count);
    el.rows.appendChild(item);
  }

  updateSelectionInfo(shown);
}

function updateSelectionInfo(shown) {
  const selected = shown.filter(r => selection.has(r.domain)).length;

  el.selectionInfo.textContent = shown.length ? fmt("selectionInfo", [selected, shown.length]) : "";
  el.toggleAll.classList.toggle("hidden", !shown.length);
  el.toggleAll.textContent = selected === shown.length && shown.length ? t("selectNone") : t("selectAll");
  el.addSelected.disabled = selected === 0;
}

function setTrimMode(enabled) {
  trimBase = enabled;
  el.segBase.classList.toggle("active", enabled);
  el.segHost.classList.toggle("active", !enabled);
  selection.clear();
  render();
}

function reloadHar() {
  chrome.devtools.network.getHAR(har => {
    hostCounts = new Map();
    requestCount = 0;
    for (const entry of har.entries || []) {
      addRequest(entry.request);
    }
    render();
  });
}

async function loadCollectorLimit() {
  try {
    const r = await chrome.runtime.sendMessage({ type: "GET_COLLECTOR_SETTINGS" });
    if (r && r.ok && r.domainCollector) maxHosts = r.domainCollector.maxEntriesPerTab;
  } catch {
    // Keep the default limit if the service worker is not reachable yet.
  }
}

async function addDomains(domains) {
  const { valid, invalid } = partitionDomainInput(domains);

  if (!valid.length) {
    resultView.showError(
      t(invalid.length ? "statusNoValidDomains" : "statusNoDomains"),
      invalid.length ? { invalidDomains: invalid } : null
    );
    return;
  }

  el.addSelected.setAttribute("aria-busy", "true");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "ADD_DOMAINS",
      domains,
      tabId: chrome.devtools.inspectedWindow.tabId,
      resolveCandidates: Array.from(hostCounts.keys())
    });

    resultView.render(result);
  } finally {
    el.addSelected.removeAttribute("aria-busy");
  }
}

el.reloadHar.addEventListener("click", reloadHar);
el.filter.addEventListener("input", render);
el.segBase.addEventListener("click", () => setTrimMode(true));
el.segHost.addEventListener("click", () => setTrimMode(false));

el.toggleAll.addEventListener("click", () => {
  const shown = visibleRows();
  const selectAll = shown.some(r => !selection.has(r.domain));

  for (const row of shown) {
    if (selectAll) {
      selection.add(row.domain);
    } else {
      selection.delete(row.domain);
    }
  }

  render();
});

el.addSelected.addEventListener("click", () => {
  addDomains(visibleRows().filter(r => selection.has(r.domain)).map(r => r.domain));
});

chrome.devtools.network.onRequestFinished.addListener(req => {
  if (addRequest(req.request)) render();
});

setTrimMode(true);
loadCollectorLimit().then(reloadHar);
