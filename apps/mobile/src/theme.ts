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
  /** Warm bone. Almost no pink in it: the rose is an accent, and an accent is not a wash. */
  canvas: "#fbf8f4",
  surface: "#ffffff",
  surfaceMuted: "#f4efe8",
  /** Behind a photo that has not loaded, and inside wells. Reads as a shape rather than a hole. */
  surfaceSunk: "#eae2d8",
  /** Deep plum-black, for a section that inverts: the opening hero, the safety control. */
  inkSurface: "#221a1d",
  ink: "#1b1517",
  inkSecondary: "#5e5459",
  inkTertiary: "#7e7276",
  /** On the action colour, on `inkSurface`, and over the scrim on a photo. Never pure white. */
  inkInverse: "#fbf8f4",
  action: "#a62b4c",
  actionStrong: "#82203a",
  actionSoft: "#f8e9ec",
  /** Rose light enough to sit on `inkSurface` and still read as the brand. */
  actionOnDark: "#f0a8b8",
  caution: "#a8391e",
  cautionSoft: "#f9e8e2",
  /** Bronze, not mustard. The gold this replaced read as a warning triangle on a filing cabinet. */
  context: "#8a5a33",
  contextSoft: "#f5ebe1",
  success: "#2e6f4a",
  successSoft: "#e4efe8",
  border: "#ebe3d9",
  /** Where a border has to carry a boundary on its own, with no shadow helping it. */
  borderStrong: "#dcd1c3",
  focus: "#1d4ed8",
  disabled: "#bfb5ae",
  /**
   * The three stops of the warm wash — dusty, not bubblegum. There is no gradient library in this
   * app and adding a native module for a decoration would mean a new development build, so `Wash`
   * stacks these instead.
   */
  wash1: "#f7efe7",
  wash2: "#f2e2dc",
  wash3: "#ebcfc9",
  /** Over a photo, so a name laid on it keeps its contrast whatever the photo is. */
  scrim: "rgba(27, 21, 23, 0.55)",
} as const;

/**
 * Tighter than the first pass. 28px on a card is a toy; 22 is a considered object. The pill stays
 * for buttons, where full-round is the one shape that reads as "press me" at any width.
 */
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
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
  /** The one-per-app size: the opening hero and nothing else. */
  hero: { fontSize: 44, lineHeight: 47, fontWeight: "700", fontFamily: serif, letterSpacing: -1.2 },
  display: { fontSize: 34, lineHeight: 38, fontWeight: "700", fontFamily: serif, letterSpacing: -0.8 },
  title: { fontSize: 24, lineHeight: 28, fontWeight: "700", fontFamily: serif, letterSpacing: -0.4 },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: "700", letterSpacing: -0.1 },
  body: { fontSize: 16, lineHeight: 25, fontWeight: "400" },
  small: { fontSize: 14, lineHeight: 21, fontWeight: "400" },
  /** Small caps in everything but name. The wide tracking is what makes it read as a label. */
  caption: { fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 1.4 },
} as const;

/**
 * Elevation. The first design had none at all — every surface was a 1px border on a flat canvas —
 * which is why it read as a form rather than as something to touch.
 */
export const shadow = {
  /**
   * Wide and faint rather than tight and dark. A small, visible drop shadow is the single most
   * dated thing a 2020s interface can have; what reads as expensive is a large blur at an opacity
   * you would not notice if it were missing — you only notice that the card is sitting on
   * something.
   */
  raised: {
    shadowColor: "#1b1517",
    shadowOpacity: 0.055,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  lifted: {
    shadowColor: "#1b1517",
    shadowOpacity: 0.1,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 16 },
    elevation: 6,
  },
} as const;
