const browserGlobals = {
  chrome: "readonly",
  window: "readonly",
  document: "readonly",
  console: "readonly",
  fetch: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  AbortController: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  localStorage: "readonly",
  navigator: "readonly",
  location: "readonly",
  crypto: "readonly",
  btoa: "readonly",
  atob: "readonly",
  confirm: "readonly",
  alert: "readonly",
};

const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  fetch: "readonly",
  URL: "readonly",
  globalThis: "readonly",
  Buffer: "readonly",
};

const rules = {
  "no-unused-vars": "warn",
  "no-undef": "error",
};

export default [
  {
    files: ["**/*.js"],
    ignores: ["icons/**", "dist/**", "tests/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: browserGlobals,
    },
    rules,
  },
  {
    // Build and test tooling runs under Node, not in the extension.
    files: ["scripts/**/*.mjs", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules,
  },
];
