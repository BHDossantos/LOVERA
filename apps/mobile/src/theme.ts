/**
 * The design tokens from the web app (specification Section 3), as plain values.
 * Kept identical on purpose: a member who signs up on the web and opens the phone
 * should not feel they have arrived somewhere else.
 */
export const color = {
  canvas: "#faf7f1",
  surface: "#ffffff",
  surfaceMuted: "#f3efe6",
  ink: "#16243a",
  inkSecondary: "#4b586d",
  inkTertiary: "#7a8598",
  action: "#0f766e",
  actionStrong: "#0b5f59",
  actionSoft: "#e0f2f0",
  caution: "#d9553f",
  cautionSoft: "#fbe9e5",
  context: "#b98a2e",
  contextSoft: "#f8efd9",
  success: "#2f7d4f",
  successSoft: "#e3f2e8",
  border: "#e3ddd1",
  focus: "#1d4ed8",
  disabled: "#b9bfc9",
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  small: { fontSize: 14, lineHeight: 20, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
} as const;
