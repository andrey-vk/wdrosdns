import {
  loadSettings,
  effectiveProfileSettings,
  readDnsCache,
  filterDnsRecords,
  sortDnsRecords,
  dnsRecordTarget,
  isOwnedDnsRecord
} from "./common.js";
import { applyI18n, t, fmt } from "./i18n.js";

applyI18n();
document.title = t("recordsTitle");

const $ = id => document.getElementById(id);

const el = {
  profileSelect: $("profileSelect"),
  recordsStatus: $("recordsStatus"),
  refreshBtn: $("refreshBtn"),
  search: $("search"),
  onlyOwned: $("onlyOwned"),
  ownedLabel: $("ownedLabel"),
  onlyDisabled: $("onlyDisabled"),
  selectionInfo: $("selectionInfo"),
  bulkDisable: $("bulkDisable"),
  bulkEnable: $("bulkEnable"),
  bulkDelete: $("bulkDelete"),
  selectAll: $("selectAll"),
  rows: $("rows"),
  emptyText: $("emptyText")
};

// `selected` survives filtering and sorting; it is pruned only when a record
// disappears from the router.
const state = {
  settings: null,
  profileId: null,
  records: [],
  ownComment: "",
  selected: new Set(),
  sortKey: "name",
  sortDir: 1,
  busy: false
};

const params = new URLSearchParams(location.search);

function currentProfile() {
  return state.settings.profiles.find(p => p.id === state.profileId) || null;
}

function setStatus(text) {
  el.recordsStatus.textContent = text;
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function loadRecords({ refresh = false } = {}) {
  const profile = currentProfile();
  if (!profile) {
    setStatus(t("statusNoProfiles"));
    state.records = [];
    render();
    return;
  }

  const eff = effectiveProfileSettings(state.settings, profile);
  state.ownComment = eff.record.comment || "";
  el.ownedLabel.textContent = fmt("recordsOnlyOwned", [state.ownComment || "—"]);

  let cache = await readDnsCache(profile.id).catch(() => null);

  // The router is asked only when asked to refresh, or when nothing is cached yet.
  if (refresh || !cache) {
    setBusy(true);
    const result = await chrome.runtime.sendMessage({ type: "REFRESH_STATIC_DNS", profileId: profile.id });
    setBusy(false);
    if (!result || !result.ok) {
      setStatus(t("recordsRefreshFailed"));
      return;
    }
    cache = result.cache;
  }

  state.records = cache.records.filter(r => !r.dynamic);
  state.selected = new Set([...state.selected].filter(id => state.records.some(r => r.id === id)));
  setStatus(fmt("dnsUpdatedAt", [formatTime(cache.fetchedAt)]));
  render();
}

function setBusy(busy) {
  state.busy = busy;
  el.refreshBtn.disabled = busy;
  updateBulk();
}

function visibleRecords() {
  return sortDnsRecords(
    filterDnsRecords(state.records, {
      query: el.search.value,
      onlyOwned: el.onlyOwned.checked,
      ownComment: state.ownComment,
      onlyDisabled: el.onlyDisabled.checked
    }),
    state.sortKey,
    state.sortDir
  );
}

function cell(text, className = "") {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function rowFor(record) {
  const tr = document.createElement("tr");
  if (record.disabled) tr.classList.add("disabledRow");

  const checkCell = document.createElement("td");
  checkCell.className = "chk";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = state.selected.has(record.id);
  cb.setAttribute("aria-label", record.name);
  cb.addEventListener("change", () => {
    if (cb.checked) state.selected.add(record.id);
    else state.selected.delete(record.id);
    updateBulk();
  });
  checkCell.appendChild(cb);

  const nameCell = cell(record.name, "mono");
  if (isOwnedDnsRecord(record, state.ownComment)) nameCell.title = t("recordsOwnerMine");

  const stateCell = document.createElement("td");
  const chip = document.createElement("span");
  chip.className = `badge ${record.disabled ? "warn" : "ok"}`;
  chip.textContent = t(record.disabled ? "recordsStateOff" : "recordsStateOn");
  stateCell.appendChild(chip);

  const actions = document.createElement("td");
  actions.className = "actions";
  const toggle = document.createElement("button");
  toggle.className = "quiet";
  toggle.textContent = t(record.disabled ? "recordsRowEnable" : "recordsRowDisable");
  toggle.addEventListener("click", () => runDisable([record.id], !record.disabled));
  const del = document.createElement("button");
  del.className = "quiet danger";
  del.textContent = t("recordsRowDelete");
  del.addEventListener("click", () => runDelete([record.id]));
  actions.append(toggle, del);

  tr.append(
    checkCell,
    nameCell,
    cell(record.type),
    cell(dnsRecordTarget(record) || "", "mono"),
    cell(record.addressList || ""),
    cell(t(record.matchSubdomain ? "recordsYes" : "recordsNo")),
    stateCell,
    cell(record.comment || "", "faint"),
    actions
  );
  return tr;
}

function render() {
  const rows = visibleRecords();

  el.rows.innerHTML = "";
  for (const record of rows) el.rows.appendChild(rowFor(record));

  el.emptyText.classList.toggle("hidden", rows.length > 0);
  el.emptyText.textContent = state.records.length ? t("recordsNoMatch") : t("recordsEmpty");

  for (const th of document.querySelectorAll("th.sortable")) {
    const active = th.dataset.sort === state.sortKey;
    th.classList.toggle("sorted", active);
    th.dataset.dir = active ? (state.sortDir > 0 ? "▲" : "▼") : "";
  }

  const selectedVisible = rows.filter(r => state.selected.has(r.id)).length;
  el.selectAll.checked = rows.length > 0 && selectedVisible === rows.length;
  el.selectAll.indeterminate = selectedVisible > 0 && selectedVisible < rows.length;

  updateBulk();
}

function updateBulk() {
  const selected = state.records.filter(r => state.selected.has(r.id)).length;
  el.selectionInfo.textContent = fmt("recordsSelected", [selected, state.records.length]);

  const enabled = selected > 0 && !state.busy;
  el.bulkDisable.disabled = !enabled;
  el.bulkEnable.disabled = !enabled;
  el.bulkDelete.disabled = !enabled;
}

function selectedIds() {
  return state.records.filter(r => state.selected.has(r.id)).map(r => r.id);
}

// Every operation goes through the background, which writes the router and
// the session cache; reading the cache back keeps this page and the popup in step.
async function runDisable(ids, disabled) {
  if (!ids.length) return;
  setBusy(true);
  const result = await chrome.runtime.sendMessage({
    type: "SET_STATIC_DNS_DISABLED",
    profileId: state.profileId,
    ids,
    disabled
  });
  setBusy(false);
  reportFailures(result, disabled ? "recordsDisabledDone" : "recordsEnabledDone", ids.length);
  await loadRecords();
}

async function runDelete(ids) {
  if (!ids.length) return;
  if (!confirm(fmt("recordsDeleteConfirm", [ids.length]))) return;

  setBusy(true);
  const result = await chrome.runtime.sendMessage({
    type: "DELETE_STATIC_DNS",
    profileId: state.profileId,
    ids
  });
  setBusy(false);
  reportFailures(result, "recordsDeletedDone", ids.length);
  ids.forEach(id => state.selected.delete(id));
  await loadRecords();
}

function reportFailures(result, doneKey, total) {
  if (!result) {
    setStatus(t("recordsRefreshFailed"));
    return;
  }
  const failed = Array.isArray(result.failed) ? result.failed.length : 0;
  const done = total - failed;
  setStatus(failed ? fmt("recordsPartial", [done, failed]) : fmt(doneKey, [done]));
}

function wire() {
  el.profileSelect.addEventListener("change", () => {
    state.profileId = el.profileSelect.value;
    state.selected.clear();
    loadRecords();
  });

  el.refreshBtn.addEventListener("click", () => loadRecords({ refresh: true }));

  el.search.addEventListener("input", render);
  el.onlyOwned.addEventListener("change", render);
  el.onlyDisabled.addEventListener("change", render);

  el.selectAll.addEventListener("change", () => {
    const visible = visibleRecords();
    for (const r of visible) {
      if (el.selectAll.checked) state.selected.add(r.id);
      else state.selected.delete(r.id);
    }
    render();
  });

  for (const th of document.querySelectorAll("th.sortable")) {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      state.sortDir = key === state.sortKey ? -state.sortDir : 1;
      state.sortKey = key;
      render();
    });
  }

  el.bulkDisable.addEventListener("click", () => runDisable(selectedIds(), true));
  el.bulkEnable.addEventListener("click", () => runDisable(selectedIds(), false));
  el.bulkDelete.addEventListener("click", () => runDelete(selectedIds()));
}

async function init() {
  state.settings = await loadSettings();

  for (const profile of state.settings.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name || profile.url} · ${profile.url}`;
    el.profileSelect.appendChild(option);
  }

  state.profileId = params.get("profile") || state.settings.lastProfileId || (state.settings.profiles[0] && state.settings.profiles[0].id) || null;
  if (state.profileId) el.profileSelect.value = state.profileId;

  wire();
  await loadRecords();
}

init();
