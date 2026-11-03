const mockRestore = jest.fn();
const mockPost = jest.fn();
const mockBuy = jest.fn();
const mockConfigure = jest.fn();
const mockLogin = jest.fn();
jest.mock('expo-constants', () => ({ expoConfig: { extra: { revenueCat: { ios: 'ios-public-test', android: 'android-public-test' } } } }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@/api/client', () => ({ post: (...args: unknown[]) => mockPost(...args) }));
jest.mock('react-native-purchases', () => ({ restorePurchases: () => mockRestore(), purchaseProduct: (...args: unknown[]) => mockBuy(...args), configure: (...args: unknown[]) => mockConfigure(...args), logIn: (...args: unknown[]) => mockLogin(...args) }));
import { restore, purchase, availability, configure } from '../src/lib/purchases';
import { Platform } from 'react-native';

beforeEach(() => { jest.clearAllMocks(); Platform.OS = 'ios'; mockPost.mockResolvedValue({ status: 'granted', entitlements: { paid: true } }); });
test('never invents a receipt from a product identifier', async () => {
  mockRestore.mockResolvedValue({ allPurchasedProductIdentifiers: ['pro_monthly'] });
  expect((await restore()).ok).toBe(false);
  expect(mockPost).not.toHaveBeenCalled();
});
test('replays a genuine iOS transaction once', async () => {
  const transaction = { transactionIdentifier: 'store-123', productIdentifier: 'product-1' };
  mockRestore.mockResolvedValue({ nonSubscriptionTransactions: [transaction, transaction], allPurchasedProductIdentifiers: ['product-1'] });
  expect((await restore()).ok).toBe(true);
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith('/subscriptions/store-purchase', { store: 'app_store', product_id: 'product-1', transaction_id: 'store-123' });
});
test('does not claim partial restore is complete', async () => {
  mockRestore.mockResolvedValue({ nonSubscriptionTransactions: [{ transactionIdentifier: 'store-123', productIdentifier: 'old-product' }], allPurchasedProductIdentifiers: ['old-product', 'pro_monthly'] });
  expect((await restore()).ok).toBe(false);
  expect(mockPost).toHaveBeenCalledTimes(1);
});
test('does not treat an Android order ID as a purchase token', async () => {
  Platform.OS = 'android';
  expect((await restore()).ok).toBe(false);
  expect(mockRestore).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
});
test('reports an empty store account', async () => {
  mockRestore.mockResolvedValue({});
  expect((await restore()).ok).toBe(false);
});
test('does not report success when server verification fails', async () => {
  mockRestore.mockResolvedValue({ nonSubscriptionTransactions: [{ transactionIdentifier: 'store-123', productIdentifier: 'product-1' }] });
  mockPost.mockRejectedValue(new Error('Verification unavailable'));
  expect((await restore()).ok).toBe(false);
});

test('does not charge on Android without a verifiable purchase token', async () => {
  Platform.OS = 'android';
  expect(availability({ enabled: true, validation: 'live', reason: null, products: {} }).available).toBe(false);
  expect((await purchase('pro_monthly')).ok).toBe(false);
  expect(mockPost).not.toHaveBeenCalled();
});

test('restores an active iOS subscription using its real store receipt', async () => {
  mockRestore.mockResolvedValue({ activeSubscriptions: ['pro_monthly'], subscriptionsByProductIdentifier: {
    pro_monthly: { productIdentifier: 'pro_monthly', storeTransactionId: 'apple-456', store: 'APP_STORE', isActive: true },
  } });
  expect((await restore()).ok).toBe(true);
  expect(mockPost).toHaveBeenCalledWith('/subscriptions/store-purchase', { store: 'app_store', product_id: 'pro_monthly', transaction_id: 'apple-456' });
});
test.each([
  { storeTransactionId: null, store: 'APP_STORE', isActive: true },
  { storeTransactionId: 'GPA.order', store: 'PLAY_STORE', isActive: true },
  { storeTransactionId: 'expired', store: 'APP_STORE', isActive: false },
])('does not send an unusable subscription receipt: %j', async subscription => {
  mockRestore.mockResolvedValue({ activeSubscriptions: ['pro_monthly'], subscriptionsByProductIdentifier: {
    pro_monthly: { productIdentifier: 'pro_monthly', ...subscription },
  } });
  expect((await restore()).ok).toBe(false);
  expect(mockPost).not.toHaveBeenCalled();
});

test.each([
  { status: 'refused_unavailable', duplicate: true, entitlements: { paid: false } },
  { status: 'granted', duplicate: true, entitlements: { paid: false } },
])('does not claim a refused or foreign receipt replay restored membership: %j', async response => {
  mockRestore.mockResolvedValue({ nonSubscriptionTransactions: [{ transactionIdentifier: 'store-123', productIdentifier: 'product-1' }] });
  mockPost.mockResolvedValue(response);
  expect((await restore()).ok).toBe(false);
});

test('enables Android only when a server RevenueCat verifier is available', () => {
  Platform.OS = 'android';
  expect(availability({ enabled: true, validation: 'revenuecat', reason: null, products: {} }).available).toBe(true);
});
test('purchases Android through the SDK and reconciles without sending an order ID as a token', async () => {
  Platform.OS = 'android';
  await configure('android-buyer');
  mockBuy.mockResolvedValue({ transaction: { transactionIdentifier: 'GPA.order' } });
  expect((await purchase('pro_monthly', 'revenuecat')).ok).toBe(true);
  expect(mockPost).toHaveBeenCalledWith('/subscriptions/store-sync');
  expect(mockPost).not.toHaveBeenCalledWith('/subscriptions/store-purchase', expect.anything());
});
test('restores Android and asks the server to verify instead of trusting CustomerInfo', async () => {
  Platform.OS = 'android';
  await configure('android-restorer');
  mockRestore.mockResolvedValue({ entitlements: { active: { concierge: {} } } });
  mockPost.mockResolvedValue({ status: 'no_active_purchase', entitlements: { paid: false } });
  expect((await restore('revenuecat')).ok).toBe(false);
  expect(mockRestore).toHaveBeenCalled();
  expect(mockPost).toHaveBeenCalledWith('/subscriptions/store-sync');
});
test('tells a charged Android buyer to restore after a temporary verification outage', async () => {
  Platform.OS = 'android';
  await configure('android-outage');
  mockBuy.mockResolvedValue({ transaction: { transactionIdentifier: 'GPA.order' } });
  mockPost.mockRejectedValue(new Error('Network unavailable'));
  expect(await purchase('pro_monthly', 'revenuecat')).toEqual(expect.objectContaining({ ok: false, message: expect.stringContaining('do not buy again') }));
});
test('waits for RevenueCat identity changes and fails closed when login fails', async () => {
  await configure('identity-first');
  mockLogin.mockRejectedValueOnce(new Error('Login failed'));
  expect(await configure('identity-second')).toBe(false);
  expect((await purchase('pro_monthly', 'revenuecat')).ok).toBe(false);
  expect(mockBuy).not.toHaveBeenCalled();
});
