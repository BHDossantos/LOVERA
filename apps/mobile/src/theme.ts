import { Platform } from "react-native";

/**
 * The design tokens, shared value-for-value with the web app's `globals.css`.
 *
 * Kept identical on purpose: a member who signs up on the web and opens the phone should not feel
 * they have arrived somewhere else. Change a value here and change it there in the same commit.
 *
 * **Why these values and not the first set.** The first palette was a teal action on a navy ink
 * over a yellow-cream canvas. Every number in it was defensible and the whole of it read as a bank:
 * teal is the colour of insurance portals and dental practices, and navy-on-cream is a quarterly
 * report. For an app whose entire proposition is that a person is going to meet another person,
 * that is the wrong promise before a single word is read.
 *
 * So: a warm rose action, a warm near-black ink with a plum cast rather than a blue one, and a
 * canvas with pink in it instead of yellow. Rose is the one hue nobody mistakes for a utility, and
 * it is still a deep, saturated rose rather than a bubblegum pink, because the product is a
 * matchmaker and not a party.
 *
 * Two of these are accessibility fixes rather than taste. `context` was `#b98a2e`, which at the
 * 12px caption size it is used for gave 2.9:1 on the canvas — a WCAG AA failure on the eyebrow
 * above the title of every single screen. `inkTertiary` was `#7a8598` for 4.3:1, also short. Both
 * are now darker than they look like they need to be, and that is why.
 */
export const color = {
  canvas: "#fdf7f4",
  surface: "#ffffff",
  surfaceMuted: "#f9edea",
  /** Behind a photo that has not loaded, and inside wells. Reads as a shape rather than a hole. */
  surfaceSunk: "#f3e2de",
  ink: "#2a1a21",
  inkSecondary: "#6a5560",
  inkTertiary: "#7d6872",
  /** On the action colour and over the scrim on a photo. Not pure white: it belongs to this palette. */
  inkInverse: "#fffaf8",
  action: "#b42d55",
  actionStrong: "#8f2244",
  actionSoft: "#fceaef",
  caution: "#b3301c",
  cautionSoft: "#fceae4",
  context: "#8a5a0f",
  contextSoft: "#fbf0dc",
  success: "#2f7d4f",
  successSoft: "#e3f2e8",
  border: "#f0e2de",
  /** Where a border has to carry a boundary on its own, with no shadow helping it. */
  borderStrong: "#e4cdc7",
  focus: "#1d4ed8",
  disabled: "#c6b7bb",
  /**
   * The three stops of the warm wash. There is no gradient library in this app and adding a native
   * module for a decoration would mean a new development build, so `Wash` stacks these instead.
   */
  wash1: "#fdeaee",
  wash2: "#fbd8dc",
  wash3: "#f7c2c6",
  /** Over a photo, so a name laid on it keeps its contrast whatever the photo is. */
  scrim: "rgba(42, 26, 33, 0.55)",
} as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/**
 * A serif for the display sizes, by platform name rather than a bundled file.
 *
 * Shipping a font file would be better typography and a worse trade: another asset in the bundle,
 * another thing to license, and `expo-font` loading state in front of the first paint. Both
 * platforms already carry a serif that is good at large sizes, so the display face is theirs.
 */
const serif = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" });

export const font = { serif } as const;

export const type = {
  /** The one-per-app size: the sign-in screen and nothing else. */
  hero: { fontSize: 40, lineHeight: 44, fontWeight: "700", fontFamily: serif, letterSpacing: -0.8 },
  display: { fontSize: 32, lineHeight: 38, fontWeight: "700", fontFamily: serif, letterSpacing: -0.5 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700", fontFamily: serif, letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  small: { fontSize: 14, lineHeight: 20, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 0.9 },
} as const;

/**
 * Elevation. The first design had none at all — every surface was a 1px border on a flat canvas —
 * which is why it read as a form rather than as something to touch.
 */
export const shadow = {
  raised: {
    shadowColor: "#2a1a21",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  lifted: {
    shadowColor: "#2a1a21",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
} as const;
