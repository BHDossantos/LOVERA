import { View, type ColorValue } from "react-native";
import { color } from "@/theme";

/**
 * The five tab icons, composed from views.
 *
 * They used to be the characters ◎ ✦ ✉ ◈ ☺, which is five unrelated things — two geometric
 * shapes, a dingbat, a text symbol and a smiley that arrives in full colour on some Android
 * builds. Every platform renders them at a different weight, so the bar read as a row of
 * mismatched glyphs rather than one set, which is the loudest "nobody designed this" signal in
 * an app whose first screen is that bar.
 *
 * There is no SVG renderer and no icon font in this project. `react-native-svg` is a native
 * module, so adding it means a new development build and another entry in the native-config
 * guard; `@expo/vector-icons` means shipping a font. Neither is worth it for five shapes that
 * circles and rounded rectangles already make, and these inherit the tint the tab bar passes in,
 * which an image never would.
 *
 * The Introductions icon is the app's own mark — the same two overlapping rings as the home
 * screen icon and the web wordmark, so the three places a member meets the brand agree.
 */
function Ring({ size, color: c, width = 2, style }: { size: number; color: ColorValue; width?: number; style?: object }) {
  return <View style={[{ width: size, height: size, borderRadius: size / 2, borderWidth: width, borderColor: c }, style]} />;
}

export function TabIcon({ name, color: c, size = 24 }: { name: string; color: ColorValue; size?: number }) {
  const u = size / 24; // one unit of the 24-grid everything below is drawn on
  const box = { width: size, height: size, alignItems: "center", justifyContent: "center" } as const;

  if (name === "today")
    // A ring with a filled centre: one thing to look at, which is the whole screen's argument.
    return (
      <View style={box} accessibilityElementsHidden importantForAccessibility="no">
        <Ring size={18 * u} color={c} width={2 * u} />
        <View style={{ position: "absolute", width: 8 * u, height: 8 * u, borderRadius: 4 * u, backgroundColor: c }} />
      </View>
    );

  if (name === "introductions")
    return (
      <View style={[box, { flexDirection: "row" }]} accessibilityElementsHidden importantForAccessibility="no">
        <Ring size={14 * u} color={c} width={2 * u} style={{ marginRight: -6 * u }} />
        <Ring size={14 * u} color={c} width={2 * u} />
      </View>
    );

  if (name === "messages")
    // A speech bubble: a rounded body with one squared corner standing in for the tail.
    return (
      <View style={box} accessibilityElementsHidden importantForAccessibility="no">
        <View
          style={{
            width: 19 * u,
            height: 15 * u,
            borderWidth: 2 * u,
            borderColor: c,
            borderRadius: 5 * u,
            borderBottomLeftRadius: 0,
            marginBottom: 2 * u,
          }}
        />
      </View>
    );

  if (name === "dates")
    // A calendar: two posts, a head rule, a body.
    return (
      <View style={box} accessibilityElementsHidden importantForAccessibility="no">
        <View style={{ flexDirection: "row", width: 12 * u, justifyContent: "space-between", marginBottom: 1 * u }}>
          <View style={{ width: 2 * u, height: 4 * u, borderRadius: u, backgroundColor: c }} />
          <View style={{ width: 2 * u, height: 4 * u, borderRadius: u, backgroundColor: c }} />
        </View>
        <View style={{ width: 18 * u, height: 15 * u, borderWidth: 2 * u, borderColor: c, borderRadius: 4 * u, overflow: "hidden" }}>
          <View style={{ height: 3 * u, backgroundColor: c }} />
        </View>
      </View>
    );

  // "you": a head over shoulders. The shoulders are the top half of a tall rounded rect, clipped.
  return (
    <View style={box} accessibilityElementsHidden importantForAccessibility="no">
      <Ring size={9 * u} color={c} width={2 * u} style={{ marginBottom: 1.5 * u }} />
      <View style={{ height: 7 * u, width: 18 * u, overflow: "hidden" }}>
        <View style={{ width: 18 * u, height: 18 * u, borderRadius: 9 * u, borderWidth: 2 * u, borderColor: c }} />
      </View>
    </View>
  );
}

/** The mark on its own, for a header or a splash-adjacent placement. */
export function Mark({ size = 28, tint = color.action }: { size?: number; tint?: ColorValue }) {
  return <TabIcon name="introductions" color={tint} size={size} />;
}
