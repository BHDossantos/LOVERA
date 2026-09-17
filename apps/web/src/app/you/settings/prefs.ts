/**
 * Per-device accessibility and notification conveniences. Stored in localStorage (never sent to the API)
 * and applied as data attributes plus inline root variables so every screen honours them.
 * Safe to call when storage is blocked: everything is wrapped and falls back to defaults.
 */
export type Prefs = {
  textSize: "default" | "large" | "xlarge";
  reducedMotion: boolean;
  highContrast: boolean;
  notify: { introductions: boolean; conversations: boolean; dates: boolean; safety: true };
  quietHours: { enabled: boolean; from: string; to: string };
};

export const DEFAULT_PREFS: Prefs = {
  textSize: "default",
  reducedMotion: false,
  highContrast: false,
  notify: { introductions: true, conversations: true, dates: true, safety: true },
  quietHours: { enabled: false, from: "22:00", to: "08:00" },
};

const KEY = "mm.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...parsed, notify: { ...DEFAULT_PREFS.notify, ...(parsed.notify ?? {}), safety: true }, quietHours: { ...DEFAULT_PREFS.quietHours, ...(parsed.quietHours ?? {}) } };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the preference still applies for this page session */
  }
  applyPrefs(p);
}

export function applyPrefs(p: Prefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.textSize = p.textSize;
  root.dataset.reducedMotion = p.reducedMotion ? "true" : "false";
  root.dataset.highContrast = p.highContrast ? "true" : "false";
  root.style.fontSize = { default: "16px", large: "18px", xlarge: "21px" }[p.textSize];
  const contrast: Record<string, string> = p.highContrast ? { "--ink": "#000000", "--ink-secondary": "#1f2937", "--ink-tertiary": "#374151", "--border": "#111827", "--action": "#065f56", "--caution": "#b91c1c", "--context": "#7c5a10" } : {};
  for (const v of ["--ink", "--ink-secondary", "--ink-tertiary", "--border", "--action", "--caution", "--context"]) {
    if (contrast[v]) root.style.setProperty(v, contrast[v]);
    else root.style.removeProperty(v);
  }
  let style = document.getElementById("mm-reduced-motion") as HTMLStyleElement | null;
  if (p.reducedMotion) {
    if (!style) {
      style = document.createElement("style");
      style.id = "mm-reduced-motion";
      document.head.appendChild(style);
    }
    style.textContent = "*,*::before,*::after{animation-duration:0.001ms!important;transition-duration:0.001ms!important;scroll-behavior:auto!important}";
  } else if (style) style.remove();
}
