import type { ReactElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * A deliberately small renderer, on react-test-renderer directly.
 *
 * @testing-library/react-native v14 wants the standalone `test-renderer` package while
 * jest-expo 57 ships `react-test-renderer`, and under that combination its `screen` never
 * binds — `render` runs and the queries insist it did not. Rather than pin a third
 * renderer to get two helpers, these tests use the one jest-expo already provides.
 *
 * What matters here is that rendering happens at all: a screen that reads `.map` on a
 * field the API does not send throws during render, which is the bug class these tests
 * exist to catch. `texts()` is then enough to assert what a member would see.
 */
export async function renderScreen(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  // Let the queries settle so the screen renders its loaded state rather than its spinner.
  // One microtask is not enough: react-query resolves, notifies on a timer, then the screen
  // re-renders and may start a dependent query. Flushing a few rounds is the difference
  // between asserting on real data and asserting on a fallback that happens to match.
  await flush();
  const r = tree as ReactTestRenderer;
  return {
    tree: r,
    /** Every string rendered anywhere in the tree. */
    texts: () => collect(r.root),
    /** True when some single rendered string contains `needle`. */
    hasText: (needle: string) => collect(r.root).some((t) => t.includes(needle)),
    /**
     * Every rendered string joined, for a sentence React split across nodes — a line like
     * `{a.type} · decided by {source}` arrives as several children, so `hasText` cannot see
     * it whole. Prefer `hasText` where the string is one node; this is for the other case.
     */
    joined: () => collect(r.root).join(""),
    /**
     * Press an enabled control whose subtree renders `label`.
     *
     * A disabled control is skipped rather than fired, because calling onPress directly
     * would let a test "press" a button a member cannot — and then assert behaviour the
     * real app does not have.
     *
     * `nth` counts controls, not nodes, and counts from the end when negative. Leaving it out
     * presses the last one, which is what a screen with several "Yes" options wants and a list
     * of rows sharing a button label does not: taking whichever was last made a concurrency
     * test press the same row twice and pass against the bug it was written to catch. So a
     * test over a list has to say which row it means.
     */
    press: async (label: string, nth = -1) => {
      const controls = pressables(r.root, label, false);
      if (!controls.length) {
        throw new Error(
          pressables(r.root, label, true).length
            ? `${JSON.stringify(label)} is rendered but disabled, so a member could not press it`
            : `nothing pressable renders ${JSON.stringify(label)}`,
        );
      }
      const node = at(controls, nth);
      if (!node)
        throw new Error(
          `only ${controls.length} enabled control(s) render ${JSON.stringify(label)}, so there is no #${nth}`,
        );
      await act(async () => {
        (node.props as { onPress: () => void }).onPress();
      });
    },
    /**
     * Type into the nth text input, by calling the handler the real component calls.
     *
     * Buttons on these screens are disabled until there is something to send, and `press`
     * refuses a disabled control, so a test that never types can only ever assert the
     * disabled half of the behaviour.
     */
    type: async (text: string, index = 0) => {
      const inputs = r.root.findAll((n) => typeof (n.props as { onChangeText?: unknown }).onChangeText === "function");
      const node = at(inputs, index);
      if (!node) throw new Error(`no text input at index ${index} (found ${inputs.length})`);
      await act(async () => {
        (node.props as { onChangeText: (t: string) => void }).onChangeText(text);
      });
    },
    /**
     * Fire the nth onLayout with a measured position, as the native side would.
     *
     * A screen that reports what the member has reached has to learn where things are from
     * layout. Nothing measures in a test renderer, so without this the measurement never
     * arrives and such a screen can only be tested in its "I don't know yet" state.
     */
    layout: async (index: number, y: number, height = 400) => {
      const nodes = r.root.findAll((n) => typeof (n.props as { onLayout?: unknown }).onLayout === "function");
      const node = at(nodes, index);
      if (!node) throw new Error(`no onLayout at index ${index} (found ${nodes.length})`);
      await act(async () => {
        (node.props as { onLayout: (e: unknown) => void }).onLayout({
          nativeEvent: { layout: { x: 0, y, width: 360, height } },
        });
      });
      await flush();
    },
    /** Fire the scroll view's onScroll at an offset, as a member dragging the page would. */
    scroll: async (y: number) => {
      const nodes = r.root.findAll((n) => typeof (n.props as { onScroll?: unknown }).onScroll === "function");
      if (!nodes.length) throw new Error("nothing on this screen handles onScroll");
      await act(async () => {
        (nodes[0].props as { onScroll: (e: unknown) => void }).onScroll({ nativeEvent: { contentOffset: { x: 0, y } } });
      });
      await flush();
    },
    settle: flush,
  };
}

/** Run the microtask queue and react-query's notify timers until the tree stops changing. */
async function flush(rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime?.(0);
    });
  }
}

/** Negative indices count from the end, so a test can say "the last one" without counting. */
function at<T>(list: T[], index: number): T | undefined {
  return index < 0 ? list[list.length + index] : list[index];
}

/**
 * The controls whose subtree renders `label`, one node per control, in tree order.
 *
 * A control shows up once per wrapper around it, and every one of those nodes carries the
 * same onPress, so the handler identity is what distinguishes one control from another. The
 * innermost node is kept for each: that is the control rather than something wrapping it.
 */
function pressables(root: ReactTestInstance, label: string, wantDisabled: boolean): ReactTestInstance[] {
  const byHandler = new Map<unknown, ReactTestInstance>();
  for (const n of root.findAll((node) => {
    const props = node.props as { onPress?: unknown; disabled?: boolean; accessibilityState?: { disabled?: boolean } };
    if (typeof props.onPress !== "function") return false;
    if (Boolean(props.disabled || props.accessibilityState?.disabled) !== wantDisabled) return false;
    return collect(node).some((t) => t.includes(label));
  })) {
    byHandler.set((n.props as { onPress: unknown }).onPress, n); // later = deeper = the control
  }
  return [...byHandler.values()];
}

function collect(node: ReactTestInstance): string[] {
  const out: string[] = [];
  const walk = (children: unknown[]) => {
    for (const c of children) {
      if (typeof c === "string") out.push(c);
      else if (typeof c === "number") out.push(String(c));
      else if (c && typeof c === "object" && "children" in (c as ReactTestInstance))
        walk((c as ReactTestInstance).children as unknown[]);
    }
  };
  walk(node.children as unknown[]);
  return out;
}

/** Route a mocked `get` by path, so each test states the payload for the endpoints it touches. */
export function routeGet(routes: Record<string, unknown>) {
  return (path: string) => {
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length) // longest prefix first: /safety/cases before /safety
      .find((r) => path === r || path.startsWith(r));
    if (!key) return Promise.reject(new Error(`test did not stub GET ${path}`));
    return Promise.resolve(routes[key]);
  };
}
