export function t(key, substitutions) {
  const msg = chrome.i18n.getMessage(key, substitutions);
  return msg || key;
}

export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
  });

  root.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.setAttribute("title", t(el.dataset.i18nTitle));
  });

  root.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
  });
}

export function fmt(key, values = []) {
  return t(key, values.map(v => String(v)));
}
