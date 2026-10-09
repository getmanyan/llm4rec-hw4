// Loads the app's own transactions.js and script.js into a Node sandbox, so the
// analysis uses exactly the same code as the page.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadApp() {
  const root = path.join(__dirname, "..");
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "transactions.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), context);
  // `const` / `let` declarations are not properties of the context; expose them.
  vm.runInContext("globalThis.__app = { TRANSACTIONS, data };", context);
  return { ...context, ...context.__app };
}

module.exports = { loadApp };
