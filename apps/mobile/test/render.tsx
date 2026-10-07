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
     * Press the first pressable whose subtree renders `label`.
     *
     * A disabled control is skipped rather than fired, because calling onPress directly
     * would let a test "press" a button a member cannot — and then assert behaviour the
     * real app does not have.
     */
    press: async (label: string) => {
      const matches = r.root.findAll((n) => {
        const props = n.props as { onPress?: unknown; disabled?: boolean; accessibilityState?: { disabled?: boolean } };
        if (typeof props.onPress !== "function") return false;
        if (props.disabled || props.accessibilityState?.disabled) return false;
        return collect(n).some((t) => t.includes(label));
      });
      if (!matches.length) {
        const disabled = r.root.findAll((n) => {
          const props = n.props as { onPress?: unknown; disabled?: boolean; accessibilityState?: { disabled?: boolean } };
          return (
            typeof props.onPress === "function" &&
            Boolean(props.disabled || props.accessibilityState?.disabled) &&
            collect(n).some((t) => t.includes(label))
          );
        });
        throw new Error(
          disabled.length
            ? `${JSON.stringify(label)} is rendered but disabled, so a member could not press it`
            : `nothing pressable renders ${JSON.stringify(label)}`,
        );
      }
      // The innermost match is the actual control rather than a wrapper around it.
      const node = matches[matches.length - 1];
      await act(async () => {
        (node.props as { onPress: () => void }).onPress();
      });
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
