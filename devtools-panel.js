import {
  hostnameFromUrl,
  trimToBaseDomain,
  uniqueDomains
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

let requests = [];
let rows = [];
let trimBase = true;
const selection = new Set();

function domainOf(host) {
  return trimBase ? trimToBaseDomain(host) : host;
}

function addRequest(request) {
  const url = request && request.url;
  const host = hostnameFromUrl(url);
  if (!host) return false;

  if (requests.some(r => r.url === url)) return false;
  requests.push({ url, host });
  return true;
}

function buildRows() {
  const map = new Map();

  for (const request of requests) {
    const domain = domainOf(request.host);
    if (!domain) continue;

    if (!map.has(domain)) {
      map.set(domain, { domain, count: 0, hosts: new Set() });
    }

    const row = map.get(domain);
    row.count += 1;
    row.hosts.add(request.host);
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

  el.info.textContent = fmt("networkInfo", [requests.length, rows.length]);
  el.rows.innerHTML = "";

  if (!shown.length) {
    const empty = document.createElement("div");
    empty.className = "emptyText";
    empty.textContent = requests.length ? t("noDomainsByFilters") : t("collectorIdle");
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
    requests = [];
    for (const entry of har.entries || []) {
      addRequest(entry.request);
    }
    render();
  });
}

async function addDomains(domains) {
  const unique = uniqueDomains(domains);
  if (!unique.length) {
    resultView.showError(t("statusNoDomains"), null);
    return;
  }

  el.addSelected.setAttribute("aria-busy", "true");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "ADD_DOMAINS",
      domains: unique,
      tabId: chrome.devtools.inspectedWindow.tabId,
      resolveCandidates: requests.map(r => r.host).filter(Boolean)
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
reloadHar();
