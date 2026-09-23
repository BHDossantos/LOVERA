import { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Switch,
  ScrollView,
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, radius, space, type as typo } from "@/theme";
import { ApiError } from "@/api/client";

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const inner = <View style={s.screenInner}>{children}</View>;
  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function PageTitle({ eyebrow, title, lede }: { eyebrow?: string; title: string; lede?: string | null }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      {!!eyebrow && <Text style={s.eyebrow}>{eyebrow.toUpperCase()}</Text>}
      <Text style={s.title} accessibilityRole="header">
        {title}
      </Text>
      {!!lede && <Text style={s.lede}>{lede}</Text>}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({
  children,
  onPress,
  variant = "primary",
  loading,
  disabled,
  fullWidth = true,
}: {
  children: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        s.btn,
        fullWidth && { alignSelf: "stretch" },
        variant === "primary" && s.btnPrimary,
        variant === "secondary" && s.btnSecondary,
        variant === "ghost" && s.btnGhost,
        variant === "danger" && s.btnDanger,
        off && s.btnOff,
        pressed && !off && { opacity: 0.85 },
      ]}
    >
      {loading && <ActivityIndicator size="small" color={variant === "primary" ? "#fff" : color.action} />}
      <Text
        style={[
          s.btnLabel,
          variant === "primary" && { color: "#fff" },
          variant === "danger" && { color: "#fff" },
          (variant === "secondary" || variant === "ghost") && { color: color.action },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

/** Single-select card, the phone counterpart of the web ChoiceCard. */
export function ChoiceCard({
  title,
  body,
  selected,
  onSelect,
}: {
  title: string;
  body?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={[s.choice, selected && { borderColor: color.action, backgroundColor: color.actionSoft }]}
    >
      <View style={[s.dot, selected && { borderColor: color.action, backgroundColor: color.action }]}>
        {selected && <View style={s.dotInner} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.choiceTitle}>{title}</Text>
        {!!body && <Text style={s.choiceBody}>{body}</Text>}
      </View>
    </Pressable>
  );
}

/** Multi-select pill. */
export function Chip({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      style={[s.chip, on && { borderColor: color.action, backgroundColor: color.actionSoft }]}
    >
      <Text style={[s.chipLabel, on && { color: color.action }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, help, error, children }: { label: string; help?: string; error?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={s.label}>{label}</Text>
      {!!help && <Text style={s.help}>{help}</Text>}
      {children}
      {!!error && <Text style={s.fieldError}>{error}</Text>}
    </View>
  );
}

export function TextInput(props: TextInputProps) {
  return <RNTextInput placeholderTextColor={color.inkTertiary} {...props} style={[s.input, props.style]} />;
}

export function StatusBanner({ tone = "context", title, body }: { tone?: "context" | "caution" | "success"; title: string; body?: string }) {
  const bg = tone === "caution" ? color.cautionSoft : tone === "success" ? color.successSoft : color.contextSoft;
  const fg = tone === "caution" ? color.caution : tone === "success" ? color.success : color.context;
  return (
    <View style={[s.banner, { backgroundColor: bg, borderColor: fg }]} accessibilityRole="alert">
      <Text style={[s.bannerTitle, { color: fg }]}>{title}</Text>
      {!!body && <Text style={s.bannerBody}>{body}</Text>}
    </View>
  );
}

/**
 * Errors carry a machine code from the API. We show the server's sentence, which is
 * already written for members, and only add a retry when the server says it is retryable.
 */
export function ErrorState({ error, retry }: { error: ApiError | null; retry?: () => void }) {
  if (!error) return null;
  return (
    <View style={{ marginBottom: space.lg }}>
      <StatusBanner tone="caution" title={error.body.message} />
      {(error.body.retryable ?? false) && !!retry && (
        <View style={{ marginTop: space.sm }}>
          <Button variant="secondary" onPress={retry}>
            Try again
          </Button>
        </View>
      )}
    </View>
  );
}

export function Badge({ label, tone = "context" }: { label: string; tone?: "context" | "success" | "caution" | "muted" }) {
  const bg =
    tone === "success" ? color.successSoft : tone === "caution" ? color.cautionSoft : tone === "muted" ? color.surfaceMuted : color.contextSoft;
  const fg =
    tone === "success" ? color.success : tone === "caution" ? color.caution : tone === "muted" ? color.inkSecondary : color.context;
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <View style={s.loading} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={color.action} />
    </View>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <Card>
      <Text style={s.choiceTitle}>{title}</Text>
      {!!body && <Text style={s.choiceBody}>{body}</Text>}
    </Card>
  );
}

/** Consent and preference switch. The description carries the commitment being made. */
export function Toggle({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={s.toggleRow}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text style={s.toggleLabel}>{label}</Text>
        {!!description && <Text style={s.choiceBody}>{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        trackColor={{ false: color.disabled, true: color.action }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

/** Single-select rendered as a stack of cards: no hidden native picker to fight with. */
export function Options<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; body?: string }[];
}) {
  return (
    <View accessibilityRole="radiogroup">
      {options.map((o) => (
        <ChoiceCard
          key={String(o.value)}
          title={o.label}
          body={o.body}
          selected={value === o.value}
          onSelect={() => onChange(o.value)}
        />
      ))}
    </View>
  );
}

/** Multi-select pill row. */
export function ChipGroup<T extends string>({
  values,
  onChange,
  options,
}: {
  values: T[];
  onChange: (v: T[]) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          on={values.includes(o.value)}
          onToggle={() =>
            onChange(values.includes(o.value) ? values.filter((v) => v !== o.value) : [...values, o.value])
          }
        />
      ))}
    </View>
  );
}

/** Onboarding progress. Announced as text so it is not a purely visual cue. */
export function Steps({ step, total = 8 }: { step: number; total?: number }) {
  return (
    <View style={s.steps} accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[s.stepDot, i < step && { backgroundColor: color.action }]} />
      ))}
    </View>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix = "",
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  label: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <View style={s.stepper}>
      <Pressable
        onPress={() => onChange(clamp(value - step))}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        style={s.stepperBtn}
      >
        <Text style={s.stepperGlyph}>−</Text>
      </Pressable>
      <Text style={s.stepperValue} accessibilityLabel={`${label}: ${value}${suffix}`}>
        {value}
        {suffix}
      </Text>
      <Pressable
        onPress={() => onChange(clamp(value + step))}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        style={s.stepperBtn}
      >
        <Text style={s.stepperGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

export function Divider() {
  return <View style={s.divider} />;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  scroll: { flexGrow: 1 },
  screenInner: { padding: space.lg, paddingBottom: space.xxl, flex: 1 },
  eyebrow: { ...typo.caption, color: color.context, letterSpacing: 0.8, marginBottom: space.xs },
  title: { ...typo.display, color: color.ink },
  lede: { ...typo.body, color: color.inkSecondary, marginTop: space.sm },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.lg,
    marginBottom: space.md,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: space.xl,
    borderWidth: 1,
    borderColor: "transparent",
    marginBottom: space.sm,
  },
  btnPrimary: { backgroundColor: color.action },
  btnSecondary: { backgroundColor: color.surface, borderColor: color.border },
  btnGhost: { backgroundColor: "transparent" },
  btnDanger: { backgroundColor: color.caution },
  btnOff: { opacity: 0.55 },
  btnLabel: { ...typo.body, fontWeight: "700" },
  choice: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "flex-start",
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.sm,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: color.inkTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  dotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  choiceTitle: { ...typo.heading, color: color.ink },
  choiceBody: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
  chip: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: space.lg,
    marginRight: space.sm,
    marginBottom: space.sm,
  },
  chipLabel: { ...typo.small, fontWeight: "700", color: color.inkSecondary },
  label: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  help: { ...typo.small, color: color.inkSecondary, marginBottom: space.sm },
  fieldError: { ...typo.small, color: color.caution, marginTop: space.xs },
  input: {
    ...typo.body,
    color: color.ink,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: space.md,
  },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  bannerTitle: { ...typo.small, fontWeight: "700" },
  bannerBody: { ...typo.small, color: color.inkSecondary, marginTop: 2 },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, alignSelf: "flex-start" },
  badgeLabel: { ...typo.caption },
  loading: { paddingVertical: space.xxl, alignItems: "center" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  toggleLabel: { ...typo.body, fontWeight: "600", color: color.ink },
  steps: { flexDirection: "row", gap: 6, marginBottom: space.lg },
  stepDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.border },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
  },
  stepperBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  stepperGlyph: { fontSize: 24, color: color.action, fontWeight: "700" },
  stepperValue: { ...typo.heading, color: color.ink },
  divider: { height: 1, backgroundColor: color.border, marginVertical: space.lg },

});
