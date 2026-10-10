import Constants from "expo-constants";
import { Platform } from "react-native";
import { post } from "@/api/client";

/**
 * In-app purchase, through RevenueCat, with every way it can be absent handled as "not available"
 * rather than as a crash.
 *
 * Four separate things have to be true before the phone may sell anything, and in a real
 * deployment they become true on four different days:
 *
 *   1. the native module is in the binary — it is not in Expo Go, so a development build is
 *      needed and the JS has to survive its absence;
 *   2. a RevenueCat public key is configured for this platform;
 *   3. the server says receipts can be verified (`/plans` → `store.enabled`), which is false
 *      until an operator sets `MM_STORE_VALIDATION`;
 *   4. the products exist in App Store Connect / the Play Console and the store returns them.
 *
 * Any of them missing means **no purchase UI at all**. A button that leads to an error is worse
 * than no button, and on iOS a purchase path that does not work is a guideline 2.1 rejection on
 * its own — so `availability()` has to answer honestly before anything is drawn.
 *
 * The module is loaded with a guarded `require` rather than an import. A top-level import of a
 * native module that is not in the binary throws while the bundle is evaluating, which takes the
 * whole app down on launch — in Expo Go, in the test runner, and in any build where the module
 * was not linked. There is no version of that failure worth risking for a feature nobody can use
 * until an operator has done four other things.
 */
type Package = { identifier: string; product: { identifier: string; priceString: string } };
type PurchasesModule = {
  configure: (opts: { apiKey: string; appUserID?: string | null }) => void;
  getOfferings: () => Promise<{ current: { availablePackages: Package[] } | null }>;
  purchaseStoreProduct: (product: unknown) => Promise<{ transaction: { transactionIdentifier: string } }>;
  getProducts: (ids: string[]) => Promise<{ identifier: string; priceString: string }[]>;
  purchaseProduct: (productId: string) => Promise<{ productIdentifier: string; transaction?: { transactionIdentifier?: string } }>;
  restorePurchases: () => Promise<unknown>;
  logIn: (appUserID: string) => Promise<unknown>;
};

export type StoreStatus = { enabled: boolean; validation: string; reason: string | null; products: Record<string, [string, string]> };

/** Why the phone is not offering a purchase, in words a member could be shown. */
export type Availability = { available: true } | { available: false; reason: string };

let cached: PurchasesModule | null | undefined;
let configuredFor: string | null = null;

function nativeModule(): PurchasesModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-purchases");
    cached = (mod?.default ?? mod) as PurchasesModule;
  } catch {
    cached = null;
  }
  return cached;
}

function publicKey(): string | null {
  const extra = Constants.expoConfig?.extra as { revenueCat?: { ios?: string | null; android?: string | null } } | undefined;
  const key = Platform.OS === "ios" ? extra?.revenueCat?.ios : extra?.revenueCat?.android;
  return key && key.trim() ? key.trim() : null;
}

/**
 * Whether a purchase can be offered right now, given the server's answer and this binary.
 *
 * `store` comes from `/plans`; passing it in rather than fetching it keeps this synchronous and
 * keeps the screen's one source of truth in the screen.
 */
export function availability(store: StoreStatus | undefined): Availability {
  if (!store?.enabled) return { available: false, reason: store?.reason ?? "Memberships cannot be bought in the app yet." };
  if (!publicKey()) return { available: false, reason: "In-app purchase is not configured in this build." };
  if (!nativeModule()) return { available: false, reason: "This build does not include in-app purchase. It arrives in the next release." };
  return { available: true };
}

/**
 * Point RevenueCat at this member.
 *
 * The member id, not the email: RevenueCat stores the app user id and we have no reason to put an
 * email address into a third party that does not need one. Safe to call repeatedly — it does the
 * work once per member and returns false when purchases are unavailable, so callers can treat it
 * as "did this work".
 */
export function configure(memberId: string): boolean {
  const mod = nativeModule();
  const key = publicKey();
  if (!mod || !key) return false;
  if (configuredFor === memberId) return true;
  try {
    mod.configure({ apiKey: key, appUserID: memberId });
    configuredFor = memberId;
    return true;
  } catch {
    return false;
  }
}

export type StoreProduct = { productId: string; priceLabel: string };

/** What the store will actually charge, which is the only price allowed on a purchase button. */
export async function products(productIds: string[]): Promise<StoreProduct[]> {
  const mod = nativeModule();
  if (!mod || productIds.length === 0) return [];
  try {
    const found = await mod.getProducts(productIds);
    return found.map((p) => ({ productId: p.identifier, priceLabel: p.priceString }));
  } catch {
    return [];
  }
}

export type PurchaseResult =
  | { ok: true; entitlementsChanged: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

/**
 * Buy a product, then tell the server about it.
 *
 * The server grants the plan, not this function: it verifies the receipt and maps the product id
 * to a plan and a cadence. A client that decided its own entitlements would be a free upgrade to
 * the most expensive tier for anybody willing to edit a JSON body.
 */
export async function purchase(productId: string): Promise<PurchaseResult> {
  const mod = nativeModule();
  if (!mod) return { ok: false, cancelled: false, message: "In-app purchase is not available in this build." };
  let transactionId: string | undefined;
  try {
    const result = await mod.purchaseProduct(productId);
    transactionId = result.transaction?.transactionIdentifier;
  } catch (err) {
    // RevenueCat reports a user cancelling as an error with a flag. Cancelling is not a failure
    // and must never produce an error banner.
    if ((err as { userCancelled?: boolean })?.userCancelled) return { ok: false, cancelled: true };
    return { ok: false, cancelled: false, message: (err as Error)?.message || "The purchase did not complete." };
  }
  if (!transactionId) {
    return { ok: false, cancelled: false, message: "The store did not return a receipt. If you were charged, restore purchases to finish." };
  }
  try {
    await post("/subscriptions/store-purchase", {
      store: Platform.OS === "ios" ? "app_store" : "play_store",
      product_id: productId,
      transaction_id: transactionId,
    });
    return { ok: true, entitlementsChanged: true };
  } catch (err) {
    // The store has taken the money and we could not record it. Restoring replays the same
    // transaction id, and the endpoint is idempotent on it, so this is recoverable rather than
    // lost — which is exactly what the member needs to be told.
    return {
      ok: false,
      cancelled: false,
      message: (err as { message?: string })?.message || "Your purchase went through but we could not record it. Use Restore purchases to finish.",
    };
  }
}

/**
 * Restore an earlier purchase.
 *
 * Apple requires a restore path for a non-consumable or subscription purchase, and it is also the
 * recovery route when a purchase succeeded at the store and failed to reach us. Every transaction
 * it finds is replayed to the server, which is idempotent on the transaction id.
 */
export async function restore(): Promise<PurchaseResult> {
  const mod = nativeModule();
  if (!mod) return { ok: false, cancelled: false, message: "In-app purchase is not available in this build." };
  try {
    const info = (await mod.restorePurchases()) as {
      nonSubscriptionTransactions?: { transactionIdentifier: string; productIdentifier: string }[];
      allPurchasedProductIdentifiers?: string[];
      latestExpirationDate?: string | null;
      originalPurchaseDate?: string | null;
    };
    const store = Platform.OS === "ios" ? "app_store" : "play_store";
    const seen = new Set<string>();
    for (const t of info.nonSubscriptionTransactions ?? []) {
      if (seen.has(t.transactionIdentifier)) continue;
      seen.add(t.transactionIdentifier);
      await post("/subscriptions/store-purchase", { store, product_id: t.productIdentifier, transaction_id: t.transactionIdentifier });
    }
    // A subscription has no transaction list on every platform, so fall back to the product ids
    // the store says this account owns. The transaction id is derived from the product and the
    // app user id, which keeps the server's idempotency key stable across restores.
    for (const productId of info.allPurchasedProductIdentifiers ?? []) {
      const key = `${productId}:${configuredFor ?? "unknown"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await post("/subscriptions/store-purchase", { store, product_id: productId, transaction_id: key });
    }
    if (seen.size === 0) return { ok: false, cancelled: false, message: "No previous purchase was found for this store account." };
    return { ok: true, entitlementsChanged: true };
  } catch (err) {
    return { ok: false, cancelled: false, message: (err as Error)?.message || "We could not reach the store to restore your purchases." };
  }
}
