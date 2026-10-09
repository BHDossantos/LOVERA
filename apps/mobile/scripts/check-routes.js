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
 * It checks two sets of paths:
 *
 *   1. Every router.push/replace/navigate literal in this app.
 *   2. Every client path the API hands back — a Today task's `path`, the safety centre's
 *      action list, `safety_shortcut`, and a notification's `deep_link`. Those are routes in
 *      the web app and this one, and both apps navigate to them verbatim. The web app has had
 *      them all along; this app diverged (/account-review for /account/review,
 *      /dates/{id}/check-in for /dates/{id}/safety, no /introductions/{id}/mutual at all), so
 *      the "you both said yes" notification and the missed-check-in notification opened
 *      nothing when tapped. Nothing could have caught that: it is a Python string on one side
 *      and a file name on the other.
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

const API_DIR = path.resolve(__dirname, "..", "..", "api", "app");

function pyFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== "__pycache__") pyFiles(p, out);
    else if (e.name.endsWith(".py")) out.push(p);
  }
  return out;
}

/**
 * Paths the API hands to a client. Three places produce them, and all three are matched on
 * the line, not parsed: a `"path"`/`"cta_path"`/`"safety_shortcut"`/`"deep_link"` value; any
 * route literal on a `notify(...)` line, where the deep link is a positional argument; and
 * every literal in core/client_paths.py, which exists for the paths that cannot be written as
 * a single literal at the call site.
 */
function apiClientPaths() {
  const found = new Map();
  const keyed = /"(?:path|cta_path|safety_shortcut|deep_link)":\s*f?(["'])((?:[^"'\\]|\\.)*)\1/g;
  const literal = /f?(["'])(\/(?:[^"'\\]|\\.)*)\1/g;
  for (const file of pyFiles(API_DIR)) {
    const declared = file.endsWith(path.join("core", "client_paths.py"));
    const text = fs.readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      const scan = declared || /\bnotify\(/.test(line) ? [literal] : [];
      for (const rx of [keyed, ...scan]) {
        rx.lastIndex = 0;
        let m;
        while ((m = rx.exec(line))) {
          if (!m[2].startsWith("/")) continue;
          found.set(`${m[2]}@${path.relative(process.cwd(), file)}:${i + 1}`, m[2]);
        }
      }
    });
  }
  return [...found.entries()].map(([k, target]) => ({ target, where: k.slice(k.indexOf("@") + 1) }));
}

const routes = registeredRoutes();
const patterns = routes.map(toPattern);
/**
 * Routes with no [param] segment, by their exact URL.
 *
 * A fully literal path is checked against these rather than against the patterns, because a
 * dynamic sibling will happily swallow it: with /introductions/waiting deleted, the path still
 * "matches" /introductions/[id], and the app renders the introduction screen with id="waiting".
 * That is not a 404 a tester would notice — it is a screen full of the wrong thing.
 */
const staticRoutes = new Set(routes.filter((r) => !r.includes("[")).map(stripGroups).map((r) => r.replace(/\/$/, "") || "/"));
const targets = navigationTargets();
const fromApi = apiClientPaths();

/** `${id}` and an f-string's `{id}` each stand in for one segment; a query string is not part of the route. */
const normalise = (target) =>
  target
    .replace(/\$?\{[^}]*\}/g, "X")
    .split("?")[0]
    .replace(/\/$/, "") || "/";

const resolves = (target) => {
  const p = normalise(target);
  return p.includes("X") ? patterns.some((rx) => rx.test(p)) : staticRoutes.has(p);
};

const unmatched = (list) => list.filter(({ target }) => !resolves(target));

const broken = unmatched(targets);
const brokenFromApi = unmatched(fromApi);

console.log(`checked ${targets.length} navigation targets and ${fromApi.length} API-supplied paths against ${routes.length} registered routes`);
for (const { target, where } of broken) console.log(`\n  ${target}\n         ${where}\n         no route matches this path`);
for (const { target, where } of brokenFromApi)
  console.log(`\n  ${target}\n         ${where}\n         the API hands this path to the app, and no route matches it`);
if (broken.length || brokenFromApi.length) {
  if (broken.length) console.log(`\n${broken.length} navigation target(s) go nowhere`);
  if (brokenFromApi.length) console.log(`${brokenFromApi.length} path(s) the API hands out go nowhere`);
  process.exit(1);
}
console.log("every navigation target and every path the API hands out resolves to a route");
