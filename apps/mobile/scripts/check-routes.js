#!/usr/bin/env node
/**
 * Check that every router.push/replace/navigate target is a route this app actually has.
 *
 * Expo Router can type-check navigation, but every call site in this app casts its target
 * (`router.push("/dates/new" as never)`) because the generated types are not wired up. A
 * cast silences the one thing that would have caught a typo, so a navigation to a route
 * that does not exist compiles, bundles, ships, and then does nothing when tapped — the
 * same failure mode as an API call to a path that was renamed.
 *
 * The route list is not guessed from the filesystem: it is asked of expo-router's own
 * getRoutes, through its testing require-context stub, so it reflects what the app will
 * really register, including (group) segments being invisible in the URL.
 *
 *   node scripts/check-routes.js
 */
const fs = require("fs");
const path = require("path");
const { getRoutes } = require("expo-router/build/getRoutes");
const { inMemoryContext } = require("expo-router/build/testing-library/context-stubs");

const APP_DIR = path.resolve(__dirname, "..", "app");
const SEARCH_DIRS = ["app", "src"].map((d) => path.resolve(__dirname, "..", d));

function routeFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) routeFiles(p, out);
    else if (/\.[jt]sx?$/.test(e.name)) out.push("./" + path.relative(APP_DIR, p).split(path.sep).join("/"));
  }
  return out;
}

function registeredRoutes() {
  const ctx = inMemoryContext(Object.fromEntries(routeFiles(APP_DIR).map((f) => [f, { default: () => null }])));
  const tree = getRoutes(ctx, { ignoreEntryPoints: true, platform: "android" });
  const out = [];
  (function collect(node, prefix) {
    for (const child of node.children ?? []) {
      const seg = child.route ? (prefix ? `${prefix}/${child.route}` : child.route) : prefix;
      if (!child.children?.length) out.push("/" + seg.replace(/\/?index$/, ""));
      collect(child, seg);
    }
  })(tree, "");
  return out;
}

/** A (group) segment is an organisational folder and never appears in a URL. */
const stripGroups = (r) =>
  "/" + r.split("/").filter((s) => s && !(s.startsWith("(") && s.endsWith(")"))).join("/");

/** `[param]` and `[...rest]` match any segment(s). */
const toPattern = (r) =>
  new RegExp(
    "^" +
      stripGroups(r)
        .split("/")
        .map((s) => (s.startsWith("[...") ? ".*" : s.startsWith("[") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("/")
        .replace(/^\/\//, "/") +
      "$",
  );

function navigationTargets() {
  const found = new Map();
  const call = /router\.(?:push|replace|navigate)\(\s*(?:\{\s*pathname:\s*)?([`"'])([^`"']+)\1/g;
  for (const dir of SEARCH_DIRS) {
    for (const f of routeFiles(dir).map((rel) => path.resolve(dir, rel.replace(/^\.\//, "")))) {
      const file = fs.existsSync(f) ? f : null;
      if (!file) continue;
      const text = fs.readFileSync(file, "utf8");
      let m;
      while ((m = call.exec(text))) {
        const line = text.slice(0, m.index).split("\n").length;
        found.set(`${m[2]}@${path.relative(process.cwd(), file)}:${line}`, m[2]);
      }
    }
  }
  return [...found.entries()].map(([k, target]) => ({ target, where: k.split("@")[1] }));
}

const routes = registeredRoutes();
const patterns = routes.map(toPattern);
const targets = navigationTargets();

const broken = targets.filter(({ target }) => {
  // `${id}` stands in for one segment; a query string is not part of the route.
  const p = target.replace(/\$\{[^}]*\}/g, "X").split("?")[0].replace(/\/$/, "") || "/";
  return !patterns.some((rx) => rx.test(p));
});

console.log(`checked ${targets.length} navigation targets against ${routes.length} registered routes`);
for (const { target, where } of broken) console.log(`\n  ${target}\n         ${where}\n         no route matches this path`);
if (broken.length) {
  console.log(`\n${broken.length} navigation target(s) go nowhere`);
  process.exit(1);
}
console.log("every navigation target resolves to a route");
