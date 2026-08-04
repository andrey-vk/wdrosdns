import {
  loadSettings,
  hostnameFromUrl,
  trimToBaseDomain,
  parseDomainLines,
  uniqueDomains,
  effectiveProfileSettings,
  filterNetworkEntries,
  normalizeDomainCollector
} from "./common.js";
import { createResultView } from "./result-view.js";
import { applyI18n, t, fmt } from "./i18n.js";

applyI18n();

const $ = id => document.getElementById(id);

const el = {
  routerDot: $("routerDot"),
  routerName: $("routerName"),
  routerMeta: $("routerMeta"),
  profileBtn: $("profileBtn"),
  profilePopover: $("profilePopover"),
  detectBtn: $("detectBtn"),
  openOptions: $("openOptions"),

  currentDomain: $("currentDomain"),
  segBase: $("segBase"),
  segHost: $("segHost"),
  recordChips: $("recordChips"),
  extraDomains: $("extraDomains"),
  addBtn: $("addBtn"),

  collectorInfo: $("collectorInfo"),
  collectNetworkBtn: $("collectNetworkBtn"),
  clearNetworkBtn: $("clearNetworkBtn"),
  collectorSearch: $("collectorSearch"),
  filtersBtn: $("filtersBtn"),
  filtersCount: $("filtersCount"),
  filtersPopover: $("filtersPopover"),
  collectorList: $("collectorList"),
  selectionInfo: $("selectionInfo"),
  toggleAll: $("toggleAll"),
  addSelectedNetwork: $("addSelectedNetwork"),
  moreAddBtn: $("moreAddBtn"),
  moreAddPopover: $("moreAddPopover"),

  mismatchBox: $("mismatchBox"),
  mismatchText: $("mismatchText"),
  createFromDetected: $("createFromDetected"),
  updateDetectedIdentity: $("updateDetectedIdentity"),

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

let settings = null;
let selectedProfileId = null;
let lastDetection = null;
let currentTabId = null;
let rawCurrentHost = "";
let trimBase = true;
let showAll = false;
let lastNetworkResult = null;
let collectorRows = [];
let popupCollector = null;

/* --- generic ui helpers --- */

async function withBusy(button, label, fn) {
  const prev = button.textContent;
  button.setAttribute("aria-busy", "true");
  if (label) button.textContent = label;

  try {
    return await fn();
  } finally {
    button.removeAttribute("aria-busy");
    if (label) button.textContent = prev;
  }
}

function closePopovers(except = null) {
  for (const pop of [el.profilePopover, el.filtersPopover, el.moreAddPopover]) {
    if (pop !== except) pop.classList.add("hidden");
  }
}

function togglePopover(pop) {
  const willOpen = pop.classList.contains("hidden");
  closePopovers(pop);
  pop.classList.toggle("hidden", !willOpen);
}

document.addEventListener("click", ev => {
  if (!ev.target.closest(".popWrap")) closePopovers();
});

/* --- router header --- */

function selectedProfile() {
  const id = selectedProfileId || settings.lastProfileId;
  return settings.profiles.find(p => p.id === id) || null;
}

function setRouterState(state, name, meta) {
  el.routerDot.className = `dot ${state}`;
  el.routerName.textContent = name;
  el.routerMeta.textContent = meta || "";
}

function renderProfilePopover() {
  el.profilePopover.innerHTML = "";

  const entries = [{ id: null, label: t("auto") }].concat(
    settings.profiles.map(p => ({
      id: p.id,
      label: p.name || p.url,
      meta: p.expectedIdentity || ""
    }))
  );

  for (const entry of entries) {
    const item = document.createElement("button");
    item.className = "checkItem";
    item.style.width = "100%";
    item.style.justifyContent = "flex-start";
    item.style.border = "0";
    item.style.background = "transparent";

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.visibility = entry.id === selectedProfileId ? "visible" : "hidden";
    dot.classList.add("ok");

    const label = document.createElement("span");
    label.className = "ellipsis";
    label.textContent = entry.meta ? `${entry.label} · ${entry.meta}` : entry.label;

    item.append(dot, label);
    item.addEventListener("click", () => {
      selectedProfileId = entry.id;
      closePopovers();
      applyProfileDefaults();
      renderProfilePopover();
      detectRouter(false);
    });

    el.profilePopover.appendChild(item);
  }
}

async function detectRouter(interactive = true) {
  hideMismatch();
  setRouterState("busy", t("statusChecking"), "");

  const detection = await chrome.runtime.sendMessage({
    type: "DETECT_ROUTER",
    preferredProfileId: selectedProfileId
  });

  if (detection.status === "matched" || detection.status === "matched_other_identity_profile") {
    const p = detection.profile;
    setRouterState("ok", p.name || p.url, `${p.url} · ${detection.identity}`);
    return detection;
  }

  if (detection.status === "identity_mismatch") {
    setRouterState("warn", detection.profile.name || detection.profile.url, t("statusIdentityMismatch"));
    showMismatch(detection);
    return detection;
  }

  if (detection.status === "no_profiles") {
    setRouterState("err", t("statusNoProfiles"), "");
    return detection;
  }

  setRouterState("err", t("statusNoRouter"), "");
  if (interactive) resultView.showError(t("statusNoRouter"), detection);
  return detection;
}

/* --- domain card --- */

function applyProfileDefaults() {
  const eff = effectiveProfileSettings(settings, selectedProfile() || {});
  setTrimMode(!!eff.defaultTrimToBaseDomain);
  renderRecordChips(eff);
}

function renderRecordChips(eff) {
  const chips = [];
  const record = eff.record || {};

  chips.push({
    text: record.type === "A"
      ? `A → ${record.address || "?"}`
      : `FWD → ${record.forwardTo || "?"}`,
    cls: "accent"
  });

  if (record.matchSubdomain) chips.push({ text: "match-subdomain" });
  if (record.addressList) chips.push({ text: fmt("chipList", [record.addressList]) });
  chips.push(
    eff.doResolveAfterAdd
      ? { text: fmt("chipResolve", [eff.resolveServer]) }
      : { text: t("chipNoResolve") }
  );

  el.recordChips.innerHTML = "";
  for (const chip of chips) {
    const span = document.createElement("span");
    span.className = `badge ${chip.cls || ""}`.trim();
    span.textContent = chip.text;
    el.recordChips.appendChild(span);
  }
}

function setTrimMode(enabled) {
  trimBase = enabled;
  el.segBase.classList.toggle("active", enabled);
  el.segHost.classList.toggle("active", !enabled);

  if (enabled) {
    const src = el.currentDomain.value.trim() || rawCurrentHost;
    el.currentDomain.value = trimToBaseDomain(src);
  } else if (rawCurrentHost) {
    el.currentDomain.value = rawCurrentHost;
  }

  if (lastNetworkResult) renderCollector();
}

function domainsFromForm() {
  return uniqueDomains([
    el.currentDomain.value.trim(),
    ...parseDomainLines(el.extraDomains.value)
  ]);
}

/* --- network collector --- */

function domainFromNetworkEntry(entry) {
  const host = entry.host || hostnameFromUrl(entry.url);
  return trimBase ? trimToBaseDomain(host) : host;
}

function activeCollector() {
  const base = normalizeDomainCollector(popupCollector || settings.domainCollector);
  return { ...base, filters: base.filters.map(f => ({ ...f })) };
}

function buildCollectorRows(entries) {
  const map = new Map();

  for (const entry of entries || []) {
    const domain = domainFromNetworkEntry(entry);
    if (!domain) continue;

    if (!map.has(domain)) {
      map.set(domain, {
        domain,
        count: 0,
        selected: true,
        statuses: new Set(),
        errors: new Set(),
        reasons: new Set()
      });
    }

    const row = map.get(domain);
    row.count += 1;

    if (entry.statusCode) row.statuses.add(String(entry.statusCode));
    if (entry.error) row.errors.add(entry.error);

    for (const r of entry.reasons || []) {
      row.reasons.add(r.label || r.id);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.domain.localeCompare(b.domain));
}

function renderFiltersPopover() {
  const collector = activeCollector();
  el.filtersPopover.innerHTML = "";

  const allItem = document.createElement("label");
  allItem.className = "checkItem";
  const allCb = document.createElement("input");
  allCb.type = "checkbox";
  allCb.checked = showAll;
  allCb.addEventListener("change", () => {
    showAll = allCb.checked;
    renderFiltersPopover();
    renderCollector();
  });
  const allText = document.createElement("span");
  allText.textContent = t("showAll");
  allItem.append(allCb, allText);
  el.filtersPopover.appendChild(allItem);

  const sep = document.createElement("div");
  sep.className = "popSep";
  el.filtersPopover.appendChild(sep);

  for (const filter of collector.filters) {
    const item = document.createElement("label");
    item.className = "checkItem";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!filter.enabled;
    cb.disabled = showAll;
    cb.addEventListener("change", () => {
      filter.enabled = cb.checked;
      popupCollector = collector;
      renderFiltersPopover();
      renderCollector();
    });

    const span = document.createElement("span");
    span.className = "ellipsis";
    span.textContent = filter.label || filter.id;

    item.append(cb, span);
    el.filtersPopover.appendChild(item);
  }

  const enabled = collector.filters.filter(f => f.enabled).length;
  el.filtersCount.textContent = showAll ? t("chipAll") : String(enabled);
}

function visibleRows() {
  const q = el.collectorSearch.value.trim().toLowerCase();
  return q ? collectorRows.filter(r => r.domain.includes(q)) : collectorRows;
}

function renderCollector() {
  el.collectorList.innerHTML = "";

  if (!lastNetworkResult) {
    el.collectorInfo.textContent = "";
    const empty = document.createElement("div");
    empty.className = "emptyText";
    empty.textContent = t("collectorIdle");
    el.collectorList.appendChild(empty);
    updateSelectionInfo();
    return;
  }

  const entries = filterNetworkEntries(
    lastNetworkResult.entries || [],
    activeCollector(),
    showAll,
    Date.now()
  );

  collectorRows = buildCollectorRows(entries);
  const rows = visibleRows();

  el.collectorInfo.textContent = fmt("networkInfo", [
    (lastNetworkResult.entries || []).length,
    collectorRows.length
  ]);

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "emptyText";
    empty.textContent = t("noDomainsByFilters");
    el.collectorList.appendChild(empty);
    updateSelectionInfo();
    return;
  }

  for (const row of rows) {
    const item = document.createElement("label");
    item.className = "listRow";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = row.selected;
    cb.addEventListener("change", () => {
      row.selected = cb.checked;
      updateSelectionInfo();
    });

    const domain = document.createElement("span");
    domain.className = "listDomain";
    domain.textContent = row.domain;

    item.append(cb, domain);

    for (const status of Array.from(row.statuses).sort()) {
      const badge = document.createElement("span");
      const code = Number(status);
      badge.className = `badge ${code >= 500 ? "err" : code >= 400 ? "warn" : ""}`.trim();
      badge.textContent = status;
      item.appendChild(badge);
    }

    for (const error of Array.from(row.errors)) {
      const badge = document.createElement("span");
      badge.className = "badge err";
      badge.textContent = shortError(error);
      item.appendChild(badge);
    }

    const count = document.createElement("span");
    count.className = "faint";
    count.textContent = `×${row.count}`;
    item.appendChild(count);

    const details = [];
    if (row.errors.size) details.push(fmt("errors", [Array.from(row.errors).join(", ")]));
    if (row.reasons.size) details.push(fmt("reasons", [Array.from(row.reasons).join(", ")]));
    if (details.length) item.title = details.join("\n");

    el.collectorList.appendChild(item);
  }

  updateSelectionInfo();
}

function shortError(error) {
  return String(error || "")
    .replace(/^net::/, "")
    .replace(/^ERR_/, "")
    .toLowerCase()
    .replace(/_/g, " ");
}

function updateSelectionInfo() {
  const rows = visibleRows();
  const selected = rows.filter(r => r.selected).length;

  el.selectionInfo.textContent = rows.length
    ? fmt("selectionInfo", [selected, rows.length])
    : "";

  el.toggleAll.classList.toggle("hidden", !rows.length);
  el.toggleAll.textContent = selected === rows.length && rows.length
    ? t("selectNone")
    : t("selectAll");

  el.addSelectedNetwork.disabled = selected === 0;
}

async function collectNetwork() {
  if (currentTabId === null || currentTabId === undefined) {
    resultView.showError(t("statusNoTab"), null);
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: "GET_TAB_NETWORK",
    tabId: currentTabId,
    includeAll: true
  });

  if (!result || !result.ok) {
    resultView.showError(t("statusNetworkFailed"), result);
    return;
  }

  lastNetworkResult = result;
  popupCollector = normalizeDomainCollector(settings.domainCollector);
  renderFiltersPopover();
  renderCollector();
}

/* --- actions --- */

async function addDomains(domains, button) {
  hideMismatch();
  const unique = uniqueDomains(domains);

  if (!unique.length) {
    resultView.showError(t("statusNoDomains"), null);
    return;
  }

  await withBusy(button, t("statusAdding"), async () => {
    const result = await chrome.runtime.sendMessage({
      type: "ADD_DOMAINS",
      domains: unique,
      preferredProfileId: selectedProfileId,
      tabId: currentTabId,
      resolveCandidates: rawCurrentHost ? [rawCurrentHost] : []
    });

    if (!result.ok && result.detection && result.detection.status === "identity_mismatch") {
      showMismatch(result.detection);
    }

    if (result.ok && result.profile) {
      setRouterState("ok", result.profile.name || result.profile.url, `${result.profile.url} · ${result.identity || ""}`);
    }

    resultView.render(result);
  });
}

function showMismatch(detection) {
  lastDetection = detection;
  el.mismatchBox.classList.remove("hidden");
  el.mismatchText.textContent = fmt("mismatchText", [
    detection.profile.name || detection.profile.url,
    detection.expectedIdentity || "(empty)",
    detection.actualIdentity
  ]);
}

function hideMismatch() {
  lastDetection = null;
  el.mismatchBox.classList.add("hidden");
}

function renderMoreAddPopover() {
  el.moreAddPopover.innerHTML = "";

  const actions = [
    {
      label: t("addFiltered"),
      run: () => addDomains(visibleRows().map(r => r.domain), el.addSelectedNetwork)
    },
    {
      label: t("addAllCaptured"),
      run: async () => {
        if (!lastNetworkResult) await collectNetwork();
        const rows = buildCollectorRows(
          filterNetworkEntries(
            lastNetworkResult ? lastNetworkResult.entries : [],
            activeCollector(),
            true,
            Date.now()
          )
        );
        await addDomains(rows.map(r => r.domain), el.addSelectedNetwork);
      }
    }
  ];

  for (const action of actions) {
    const item = document.createElement("button");
    item.className = "checkItem";
    item.style.width = "100%";
    item.style.justifyContent = "flex-start";
    item.style.border = "0";
    item.style.background = "transparent";
    item.textContent = action.label;
    item.addEventListener("click", () => {
      closePopovers();
      action.run();
    });
    el.moreAddPopover.appendChild(item);
  }
}

async function loadCurrentTabDomain() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  currentTabId = tab && tab.id;
  rawCurrentHost = hostnameFromUrl(tab && tab.url);
  el.currentDomain.value = rawCurrentHost;
}

async function init() {
  settings = await loadSettings();
  selectedProfileId = settings.lastProfileId || null;
  popupCollector = normalizeDomainCollector(settings.domainCollector);

  await loadCurrentTabDomain();
  applyProfileDefaults();
  renderProfilePopover();
  renderFiltersPopover();
  renderMoreAddPopover();
  renderCollector();

  await detectRouter(false);
}

/* --- events --- */

el.profileBtn.addEventListener("click", () => togglePopover(el.profilePopover));
el.filtersBtn.addEventListener("click", () => togglePopover(el.filtersPopover));
el.moreAddBtn.addEventListener("click", () => togglePopover(el.moreAddPopover));

el.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
el.recordChips.addEventListener("click", () => chrome.runtime.openOptionsPage());

el.detectBtn.addEventListener("click", () => withBusy(el.detectBtn, "", () => detectRouter(true)));

el.segBase.addEventListener("click", () => setTrimMode(true));
el.segHost.addEventListener("click", () => setTrimMode(false));

el.addBtn.addEventListener("click", () => addDomains(domainsFromForm(), el.addBtn));

el.currentDomain.addEventListener("keydown", ev => {
  if (ev.key === "Enter") addDomains(domainsFromForm(), el.addBtn);
});

el.collectNetworkBtn.addEventListener("click", () =>
  withBusy(el.collectNetworkBtn, t("statusCollecting"), collectNetwork)
);

el.collectorSearch.addEventListener("input", () => {
  renderCollector();
});

el.clearNetworkBtn.addEventListener("click", async () => {
  if (currentTabId === null || currentTabId === undefined) return;

  await chrome.runtime.sendMessage({ type: "CLEAR_TAB_NETWORK", tabId: currentTabId });
  lastNetworkResult = null;
  collectorRows = [];
  renderCollector();
});

el.toggleAll.addEventListener("click", () => {
  const rows = visibleRows();
  const selectAll = rows.some(r => !r.selected);
  for (const row of rows) row.selected = selectAll;
  renderCollector();
});

el.addSelectedNetwork.addEventListener("click", () =>
  addDomains(visibleRows().filter(r => r.selected).map(r => r.domain), el.addSelectedNetwork)
);

el.createFromDetected.addEventListener("click", async () => {
  if (!lastDetection || !lastDetection.draftProfile) return;

  await chrome.runtime.sendMessage({
    type: "SAVE_PENDING_PROFILE_DRAFT",
    draftProfile: lastDetection.draftProfile
  });

  chrome.runtime.openOptionsPage();
});

el.updateDetectedIdentity.addEventListener("click", async () => {
  if (!lastDetection) return;

  const p = lastDetection.profile;
  const ok = confirm(fmt("confirmUpdateIdentity", [
    p.name || p.url,
    lastDetection.expectedIdentity || "(empty)",
    lastDetection.actualIdentity
  ]));

  if (!ok) return;

  const r = await chrome.runtime.sendMessage({
    type: "UPDATE_PROFILE_IDENTITY",
    profileId: p.id,
    identity: lastDetection.actualIdentity
  });

  if (!r.ok) {
    resultView.showError(t("statusIdentityUpdateFailed"), r);
    return;
  }

  hideMismatch();
  settings = await loadSettings();
  renderProfilePopover();
  await detectRouter(false);
});

init().catch(err => resultView.showError(String(err && err.stack || err), null));
