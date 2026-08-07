import {
  loadSettings,
  saveSettings,
  makeId,
  normalizeBaseUrl,
  DEFAULT_RECORD,
  DEFAULT_PROFILE_OVERRIDES,
  DEFAULT_DOMAIN_COLLECTOR,
  DEFAULT_RESOLVE_SERVER,
  normalizeDomainCollector,
  normalizeOverrideRecord,
  normalizeResolveServer,
  overrideOrInherit,
  redactSecrets,
  routerErrorText
} from "./common.js";
import { applyI18n, t, fmt } from "./i18n.js";

applyI18n();

const $ = id => document.getElementById(id);

const f = {
  navGlobal: $("navGlobal"),
  navCollector: $("navCollector"),
  secProfile: $("secProfile"),
  secDns: $("secDns"),
  secCollector: $("secCollector"),

  profileList: $("profileList"),
  formTitle: $("formTitle"),
  name: $("name"),
  url: $("url"),
  login: $("login"),
  password: $("password"),
  togglePassword: $("togglePassword"),
  expectedIdentity: $("expectedIdentity"),
  fetchIdentity: $("fetchIdentity"),
  saveProfile: $("saveProfile"),
  copyProfile: $("copyProfile"),
  deleteProfile: $("deleteProfile"),
  newProfile: $("newProfile"),

  profileOverridesDetails: $("profileOverridesDetails"),
  profileOverrideEnabled: $("profileOverrideEnabled"),
  profileOverridesBox: $("profileOverridesBox"),
  poRecordType: $("poRecordType"),
  poRecordAddress: $("poRecordAddress"),
  poRecordForwardTo: $("poRecordForwardTo"),
  poRecordAddressList: $("poRecordAddressList"),
  poRecordComment: $("poRecordComment"),
  poRecordMatchSubdomain: $("poRecordMatchSubdomain"),
  poDefaultTrimToBaseDomain: $("poDefaultTrimToBaseDomain"),
  poDoResolveAfterAdd: $("poDoResolveAfterAdd"),
  poResolveServer: $("poResolveServer"),
  poRequestTimeoutMs: $("poRequestTimeoutMs"),
  poAddressField: $("poAddressField"),
  poForwardField: $("poForwardField"),

  recordType: $("recordType"),
  recordAddress: $("recordAddress"),
  recordForwardTo: $("recordForwardTo"),
  recordAddressList: $("recordAddressList"),
  recordComment: $("recordComment"),
  recordMatchSubdomain: $("recordMatchSubdomain"),
  defaultTrimToBaseDomain: $("defaultTrimToBaseDomain"),
  doResolveAfterAdd: $("doResolveAfterAdd"),
  resolveServer: $("resolveServer"),
  requestTimeoutMs: $("requestTimeoutMs"),
  addressField: $("addressField"),
  forwardField: $("forwardField"),
  saveGlobal: $("saveGlobal"),

  collectorPendingNoDataMs: $("collectorPendingNoDataMs"),
  collectorMaxEntriesPerTab: $("collectorMaxEntriesPerTab"),
  collectorFiltersBody: $("collectorFiltersBody"),
  addCollectorFilter: $("addCollectorFilter"),
  resetCollectorFilters: $("resetCollectorFilters"),

  dirtyMark: $("dirtyMark"),
  status: $("status")
};

const asText = v => String(v === null || v === undefined ? "" : v).trim();
const asBool = v => !!v;
const asTimeout = v => Number(v) || 5000;

// Each profile override field, the global field it falls back to, and how the
// two are compared. A field that matches its global counterpart is stored as
// null, i.e. "inherit", so later changes to the global settings still reach it.
//
// `read` deliberately takes the value from saved settings rather than from the
// global form control: saving a profile does not save the global form, so an
// unsaved global edit must not make an override look inherited.
const OVERRIDE_FIELDS = [
  { po: "poRecordType", global: "recordType", read: s => s.record.type, transform: asText },
  { po: "poRecordAddress", global: "recordAddress", read: s => s.record.address, transform: asText },
  { po: "poRecordForwardTo", global: "recordForwardTo", read: s => s.record.forwardTo, transform: asText },
  { po: "poRecordAddressList", global: "recordAddressList", read: s => s.record.addressList, transform: asText },
  { po: "poRecordComment", global: "recordComment", read: s => s.record.comment, transform: asText },
  { po: "poResolveServer", global: "resolveServer", read: s => s.resolveServer, transform: normalizeResolveServer },
  { po: "poRequestTimeoutMs", global: "requestTimeoutMs", read: s => s.requestTimeoutMs, transform: asTimeout },
  { po: "poRecordMatchSubdomain", global: "recordMatchSubdomain", read: s => s.record.matchSubdomain, transform: asBool },
  { po: "poDefaultTrimToBaseDomain", global: "defaultTrimToBaseDomain", read: s => s.defaultTrimToBaseDomain, transform: asBool },
  { po: "poDoResolveAfterAdd", global: "doResolveAfterAdd", read: s => s.doResolveAfterAdd, transform: asBool }
];

function savedGlobalValue(field) {
  return field.read({ ...settings, record: { ...DEFAULT_RECORD, ...(settings.record || {}) } });
}

function overrideValue(field) {
  return overrideOrInherit(fieldValue(f[field.po]), savedGlobalValue(field), field.transform);
}

let settings = null;
let editingId = null;
let dirty = false;

function setStatus(text, obj = null) {
  f.status.textContent = text;
  f.status.title = obj ? JSON.stringify(redactSecrets(obj), null, 2) : "";
}

function setDirty(on) {
  dirty = on;
  f.dirtyMark.classList.toggle("hidden", !on);
}

function fieldValue(el) {
  return el.type === "checkbox" ? el.checked : el.value;
}

function setFieldValue(el, value) {
  if (el.type === "checkbox") {
    el.checked = !!value;
  } else {
    el.value = value;
  }
}

function toggleRecordFields(typeEl, addressField, forwardField) {
  const isA = typeEl.value === "A";
  addressField.classList.toggle("hidden", !isA);
  forwardField.classList.toggle("hidden", isA);
}

function renderOverrideMarks() {
  const enabled = !!f.profileOverrideEnabled.checked;

  for (const field of OVERRIDE_FIELDS) {
    const poId = field.po;
    const mark = document.querySelector(`.overrideMark[data-for="${poId}"]`);
    if (!mark) continue;

    mark.innerHTML = "";
    if (!enabled) continue;

    if (overrideValue(field) === null) continue;

    const badge = document.createElement("span");
    badge.className = "badge accent";
    badge.textContent = t("overridden");

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "link";
    reset.textContent = t("resetToGlobal");
    reset.addEventListener("click", () => {
      // The saved value, so the field really ends up inheriting.
      setFieldValue(f[poId], savedGlobalValue(field));
      toggleRecordFields(f.poRecordType, f.poAddressField, f.poForwardField);
      renderOverrideMarks();
      setDirty(true);
    });

    mark.append(badge, reset);
  }
}

function toggleProfileOverridesUi() {
  const enabled = !!f.profileOverrideEnabled.checked;
  f.profileOverridesDetails.open = enabled;
  f.profileOverridesBox.classList.toggle("off", !enabled);

  for (const input of f.profileOverridesBox.querySelectorAll("input, select")) {
    input.disabled = !enabled;
  }

  renderOverrideMarks();
}

// null means "inherit", so the form shows the global value for those fields.
function inherited(overrideValue, globalValue) {
  return overrideValue === null || overrideValue === undefined ? globalValue : overrideValue;
}

function fillProfileOverrides(overrides = DEFAULT_PROFILE_OVERRIDES) {
  const o = {
    ...DEFAULT_PROFILE_OVERRIDES,
    ...(overrides || {}),
    record: normalizeOverrideRecord((overrides && overrides.record) || {})
  };

  const globalRecord = { ...DEFAULT_RECORD, ...(settings.record || {}) };

  f.profileOverrideEnabled.checked = !!o.enabled;
  f.poRecordType.value = inherited(o.record.type, globalRecord.type) || "FWD";
  f.poRecordAddress.value = inherited(o.record.address, globalRecord.address) || "";
  f.poRecordForwardTo.value = inherited(o.record.forwardTo, globalRecord.forwardTo) || "";
  f.poRecordAddressList.value = inherited(o.record.addressList, globalRecord.addressList) || "";
  f.poRecordComment.value = inherited(o.record.comment, globalRecord.comment) || "";
  f.poRecordMatchSubdomain.checked = !!inherited(o.record.matchSubdomain, globalRecord.matchSubdomain);

  f.poDefaultTrimToBaseDomain.checked =
    o.defaultTrimToBaseDomain === null || o.defaultTrimToBaseDomain === undefined
      ? !!settings.defaultTrimToBaseDomain
      : !!o.defaultTrimToBaseDomain;

  f.poDoResolveAfterAdd.checked =
    o.doResolveAfterAdd === null || o.doResolveAfterAdd === undefined
      ? !!settings.doResolveAfterAdd
      : !!o.doResolveAfterAdd;

  f.poResolveServer.value =
    o.resolveServer === null || o.resolveServer === undefined || o.resolveServer === ""
      ? (settings.resolveServer || DEFAULT_RESOLVE_SERVER)
      : o.resolveServer;

  f.poRequestTimeoutMs.value =
    o.requestTimeoutMs === null || o.requestTimeoutMs === undefined
      ? (settings.requestTimeoutMs || 5000)
      : o.requestTimeoutMs;

  toggleRecordFields(f.poRecordType, f.poAddressField, f.poForwardField);
  toggleProfileOverridesUi();
}

function readProfileOverridesFromForm() {
  const value = Object.fromEntries(
    OVERRIDE_FIELDS.map(field => [field.po, overrideValue(field)])
  );

  return {
    enabled: !!f.profileOverrideEnabled.checked,
    defaultTrimToBaseDomain: value.poDefaultTrimToBaseDomain,
    doResolveAfterAdd: value.poDoResolveAfterAdd,
    resolveServer: value.poResolveServer,
    requestTimeoutMs: value.poRequestTimeoutMs,
    record: {
      type: value.poRecordType,
      address: value.poRecordAddress,
      forwardTo: value.poRecordForwardTo,
      addressList: value.poRecordAddressList,
      comment: value.poRecordComment,
      matchSubdomain: value.poRecordMatchSubdomain
    }
  };
}

function showView(view) {
  f.secProfile.classList.toggle("hidden", view !== "profile");
  f.secDns.classList.toggle("hidden", view !== "global");
  f.secCollector.classList.toggle("hidden", view !== "collector");

  f.navGlobal.classList.toggle("active", view === "global");
  f.navCollector.classList.toggle("active", view === "collector");

  if (view !== "profile") {
    f.profileList.querySelectorAll(".profileItem").forEach(el => el.classList.remove("active"));
  }
}

function clearForm() {
  editingId = null;
  f.formTitle.textContent = t("profileNew");
  f.name.value = "";
  f.url.value = "";
  f.login.value = "";
  f.password.value = "";
  f.expectedIdentity.value = "";
  fillProfileOverrides();
  renderProfiles();
  showView("profile");
}

function fillForm(profile, asCopy = false) {
  editingId = asCopy ? null : profile.id;
  f.formTitle.textContent = asCopy ? t("profileCopy") : (profile.name || t("profile"));

  f.name.value = asCopy ? `${profile.name || "Profile"} copy` : (profile.name || "");
  f.url.value = profile.url || "";
  f.login.value = profile.login || "";
  f.password.value = profile.password || "";
  f.expectedIdentity.value = asCopy ? "" : (profile.expectedIdentity || "");

  fillProfileOverrides(profile.overrides);
  renderProfiles();
  showView("profile");
}

function readProfileFromForm() {
  return {
    id: editingId || makeId(),
    name: f.name.value.trim(),
    url: normalizeBaseUrl(f.url.value),
    login: f.login.value.trim(),
    password: f.password.value,
    expectedIdentity: f.expectedIdentity.value.trim(),
    overrides: readProfileOverridesFromForm()
  };
}

function renderProfiles() {
  f.profileList.innerHTML = "";

  if (!settings.profiles.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = t("noProfiles");
    f.profileList.appendChild(p);
    return;
  }

  for (const p of settings.profiles) {
    const item = document.createElement("button");
    item.className = "profileItem";
    if (p.id === editingId) item.classList.add("active");

    const title = document.createElement("strong");
    title.textContent = p.name || p.url;

    const url = document.createElement("span");
    url.textContent = p.url;

    const identity = document.createElement("span");
    identity.textContent = fmt("identityLabel", [p.expectedIdentity || "?"]);

    item.append(title, url, identity);

    if (p.overrides && p.overrides.enabled) {
      const over = document.createElement("span");
      over.className = "profileBadge";
      over.textContent = t("overridesOn");
      item.appendChild(over);
    }

    item.addEventListener("click", () => fillForm(p));
    f.profileList.appendChild(item);
  }
}

function renderCollectorFilters() {
  const dc = normalizeDomainCollector(settings.domainCollector);
  f.collectorFiltersBody.innerHTML = "";

  for (const filter of dc.filters) {
    const tr = document.createElement("tr");
    tr.dataset.id = filter.id;

    const tdEnabled = document.createElement("td");
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = !!filter.enabled;
    tdEnabled.appendChild(enabled);

    const tdLabel = document.createElement("td");
    const label = document.createElement("input");
    label.type = "text";
    label.value = filter.label || "";
    tdLabel.appendChild(label);

    const tdKind = document.createElement("td");
    const kind = document.createElement("select");
    for (const k of [
      ["status", "status"],
      ["error", "error"],
      ["pendingNoData", "pending"]
    ]) {
      const opt = document.createElement("option");
      opt.value = k[0];
      opt.textContent = k[1];
      kind.appendChild(opt);
    }
    kind.value = filter.kind || "status";
    tdKind.appendChild(kind);

    const tdFrom = document.createElement("td");
    const from = document.createElement("input");
    from.type = "number";
    from.value = filter.from === null || filter.from === undefined ? "" : filter.from;
    tdFrom.appendChild(from);

    const tdTo = document.createElement("td");
    const to = document.createElement("input");
    to.type = "number";
    to.value = filter.to === null || filter.to === undefined ? "" : filter.to;
    tdTo.appendChild(to);

    const tdPattern = document.createElement("td");
    const pattern = document.createElement("input");
    pattern.type = "text";
    pattern.value = filter.pattern || "";
    tdPattern.appendChild(pattern);

    const tdDelete = document.createElement("td");
    const del = document.createElement("button");
    del.textContent = "✕";
    del.className = "iconBtn sm quiet";
    del.title = t("deleteFilter");
    del.addEventListener("click", () => {
      tr.remove();
      setDirty(true);
    });
    tdDelete.appendChild(del);

    tr.append(tdEnabled, tdLabel, tdKind, tdFrom, tdTo, tdPattern, tdDelete);
    f.collectorFiltersBody.appendChild(tr);
  }
}

function readCollectorFilters() {
  const filters = [];

  for (const tr of f.collectorFiltersBody.querySelectorAll("tr")) {
    const controls = tr.querySelectorAll("input, select");
    const [enabled, label, kind, from, to, pattern] = controls;

    filters.push({
      id: tr.dataset.id || makeId(),
      enabled: enabled.checked,
      label: label.value.trim() || "Filter",
      kind: kind.value,
      from: from.value === "" ? null : Number(from.value),
      to: to.value === "" ? null : Number(to.value),
      pattern: pattern.value.trim()
    });
  }

  return filters;
}

function loadGlobalForm() {
  f.recordType.value = settings.record.type || "FWD";
  f.recordAddress.value = settings.record.address || "";
  f.recordForwardTo.value = settings.record.forwardTo || "";
  f.recordAddressList.value = settings.record.addressList || "";
  f.recordComment.value = settings.record.comment || "";
  f.recordMatchSubdomain.checked = !!settings.record.matchSubdomain;
  f.defaultTrimToBaseDomain.checked = !!settings.defaultTrimToBaseDomain;
  f.doResolveAfterAdd.checked = !!settings.doResolveAfterAdd;
  f.resolveServer.value = settings.resolveServer || DEFAULT_RESOLVE_SERVER;
  f.requestTimeoutMs.value = settings.requestTimeoutMs || 5000;

  const dc = normalizeDomainCollector(settings.domainCollector);
  f.collectorPendingNoDataMs.value = dc.pendingNoDataMs;
  f.collectorMaxEntriesPerTab.value = dc.maxEntriesPerTab;

  toggleRecordFields(f.recordType, f.addressField, f.forwardField);
  renderCollectorFilters();
}

function readGlobalForm() {
  settings.record = {
    type: f.recordType.value,
    address: f.recordAddress.value.trim(),
    forwardTo: f.recordForwardTo.value.trim(),
    addressList: f.recordAddressList.value.trim(),
    comment: f.recordComment.value.trim(),
    matchSubdomain: f.recordMatchSubdomain.checked
  };
  settings.defaultTrimToBaseDomain = f.defaultTrimToBaseDomain.checked;
  settings.doResolveAfterAdd = f.doResolveAfterAdd.checked;
  settings.resolveServer = normalizeResolveServer(f.resolveServer.value);
  settings.requestTimeoutMs = Number(f.requestTimeoutMs.value || 5000);
  settings.domainCollector = normalizeDomainCollector({
    pendingNoDataMs: Number(f.collectorPendingNoDataMs.value || DEFAULT_DOMAIN_COLLECTOR.pendingNoDataMs),
    maxEntriesPerTab: Number(f.collectorMaxEntriesPerTab.value || DEFAULT_DOMAIN_COLLECTOR.maxEntriesPerTab),
    filters: readCollectorFilters()
  });
}

async function init() {
  settings = await loadSettings();
  loadGlobalForm();

  if (settings.pendingProfileDraft) {
    fillForm(settings.pendingProfileDraft, true);
    f.expectedIdentity.value = settings.pendingProfileDraft.expectedIdentity || "";
    settings.pendingProfileDraft = null;
    await saveSettings(settings);
    setStatus(t("statusProfileCopied"));
  } else {
    clearForm();
  }

  setDirty(false);
}

/* --- events --- */

f.navGlobal.addEventListener("click", () => showView("global"));
f.navCollector.addEventListener("click", () => showView("collector"));

document.querySelector("main").addEventListener("input", () => setDirty(true));
document.querySelector("main").addEventListener("change", () => setDirty(true));

f.profileOverrideEnabled.addEventListener("change", toggleProfileOverridesUi);

f.recordType.addEventListener("change", () => {
  toggleRecordFields(f.recordType, f.addressField, f.forwardField);
  renderOverrideMarks();
});

f.poRecordType.addEventListener("change", () => {
  toggleRecordFields(f.poRecordType, f.poAddressField, f.poForwardField);
  renderOverrideMarks();
});

f.profileOverridesBox.addEventListener("input", renderOverrideMarks);
f.profileOverridesBox.addEventListener("change", renderOverrideMarks);

f.togglePassword.addEventListener("click", () => {
  const shown = f.password.type === "text";
  f.password.type = shown ? "password" : "text";
  f.togglePassword.title = t(shown ? "showPassword" : "hidePassword");
});

f.newProfile.addEventListener("click", () => clearForm());

f.fetchIdentity.addEventListener("click", async () => {
  const profile = readProfileFromForm();

  if (!profile.url || !profile.login) {
    setStatus(t("statusNeedUrlLogin"));
    return;
  }

  setStatus(t("statusFetchingIdentity"));

  const r = await chrome.runtime.sendMessage({
    type: "GET_IDENTITY_FOR_PROFILE",
    profile
  });

  if (!r.ok) {
    f.expectedIdentity.value = "";
    setStatus(`${t("statusIdentityFetchFailed")} ${routerErrorText(r)}`, r);
    return;
  }

  f.expectedIdentity.value = r.identity;
  setStatus(fmt("statusIdentityFetched", [r.identity]));
});

f.saveProfile.addEventListener("click", async () => {
  const profile = readProfileFromForm();

  if (!profile.name || !profile.url || !profile.login || !profile.expectedIdentity) {
    setStatus(t("statusNeedProfileFields"));
    return;
  }

  const idx = settings.profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) {
    settings.profiles[idx] = profile;
  } else {
    settings.profiles.push(profile);
  }

  if (!settings.lastProfileId) settings.lastProfileId = profile.id;
  await saveSettings(settings);

  editingId = profile.id;
  f.formTitle.textContent = profile.name;
  renderProfiles();
  setDirty(false);
  setStatus(t("statusProfileSaved"));
});

f.copyProfile.addEventListener("click", () => {
  const profile = readProfileFromForm();
  if (!profile.url) {
    setStatus(t("statusNothingToCopy"));
    return;
  }
  fillForm(profile, true);
  setStatus(t("statusProfileCopied"));
});

f.deleteProfile.addEventListener("click", async () => {
  if (!editingId) {
    setStatus(t("statusNoSavedProfileSelected"));
    return;
  }

  const profile = settings.profiles.find(p => p.id === editingId);
  if (!profile) return;

  if (!confirm(fmt("confirmDeleteProfile", [profile.name || profile.url]))) return;

  settings.profiles = settings.profiles.filter(p => p.id !== editingId);
  if (settings.lastProfileId === editingId) {
    settings.lastProfileId = settings.profiles[0]?.id || null;
  }

  await saveSettings(settings);
  clearForm();
  setStatus(t("statusProfileDeleted"));
});

f.addCollectorFilter.addEventListener("click", () => {
  const dc = normalizeDomainCollector({
    ...settings.domainCollector,
    filters: readCollectorFilters()
  });

  dc.filters.push({
    id: makeId(),
    label: "HTTP code",
    kind: "status",
    enabled: true,
    from: 400,
    to: 499,
    pattern: ""
  });

  settings.domainCollector = dc;
  renderCollectorFilters();
  setDirty(true);
});

f.resetCollectorFilters.addEventListener("click", () => {
  if (!confirm(t("confirmResetFilters"))) return;
  settings.domainCollector = normalizeDomainCollector(DEFAULT_DOMAIN_COLLECTOR);
  renderCollectorFilters();
  setDirty(true);
  setStatus(t("statusFiltersReset"));
});

f.saveGlobal.addEventListener("click", async () => {
  readGlobalForm();
  await saveSettings(settings);
  renderOverrideMarks();
  setDirty(false);
  setStatus(t("statusGlobalSaved"));
});

window.addEventListener("beforeunload", ev => {
  if (!dirty) return;
  ev.preventDefault();
  ev.returnValue = "";
});

init().catch(err => setStatus(String(err && err.stack || err)));
