import { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { create } from "react-test-renderer";
import { Text } from "react-native";

/**
 * Signing out has to empty the cache, not only the keychain.
 *
 * `clearSession()` takes the tokens, which stops new requests. Everything already fetched stays
 * in the QueryClient — safety case categories and receipt codes, blocked members' names,
 * conversations, the Blueprint — and a stale query renders its cached data while it refetches. On
 * a handset two people share, the next person to sign in sees the last person's until the
 * refetch lands. `signOut` already retires the push tokens for exactly this reason; the cache is
 * the rest of the same rule.
 */
jest.mock("@/api/client", () => ({
  get: jest.fn().mockResolvedValue({ id: "mem_me" }),
  post: jest.fn().mockResolvedValue({}),
  put: jest.fn(),
  patch: jest.fn(),
  del: jest.fn(),
  setTokens: jest.fn(),
  clearSession: jest.fn().mockResolvedValue(undefined),
  hasStoredSession: jest.fn().mockResolvedValue(false),
  onAuthChange: jest.fn(() => () => {}),
  refreshSession: jest.fn().mockResolvedValue(false),
  newIdempotencyKey: () => "idem_test",
  ApiError: class extends Error {},
}));
jest.mock("@/lib/push", () => ({ registerForPush: jest.fn(), unregisterPush: jest.fn().mockResolvedValue(undefined) }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue("dev_1"),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }) }));

import { AuthProvider, useAuth } from "@/lib/auth";

test("signing out empties the cache, so the next member sees none of it", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let auth: ReturnType<typeof useAuth> | undefined;
  function Probe() {
    auth = useAuth();
    return <Text>probe</Text>;
  }

  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );
  });

  // What the previous member's screens left behind. The safety ones are the point: a case's
  // category and its receipt code say what somebody reported and that they reported it.
  client.setQueryData(["safety-cases"], [{ id: "rep_1", category: "harassment", receipt_code: "SR-7731" }]);
  client.setQueryData(["blocks"], [{ member_id: "mem_them", display_name: "Ben" }]);
  client.setQueryData(["conversations"], { items: [{ id: "conv_1" }] });
  client.setQueryData(["blueprint"], { signals: [{ key: "values.faith_importance" }] });
  expect(client.getQueryData(["safety-cases"])).toBeDefined();

  await act(async () => {
    await auth!.signOut();
  });

  for (const key of [["safety-cases"], ["blocks"], ["conversations"], ["blueprint"]]) {
    expect(client.getQueryData(key)).toBeUndefined();
  }
  expect(client.getQueryCache().getAll()).toHaveLength(0);

  await act(async () => {
    tree!.unmount();
  });
});
