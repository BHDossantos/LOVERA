const mockRestore = jest.fn();
const mockPost = jest.fn();
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@/api/client', () => ({ post: (...args: unknown[]) => mockPost(...args) }));
jest.mock('react-native-purchases', () => ({ restorePurchases: () => mockRestore() }));
import { restore, purchase, availability } from '../src/lib/purchases';
import { Platform } from 'react-native';

beforeEach(() => { jest.clearAllMocks(); Platform.OS = 'ios'; mockPost.mockResolvedValue({}); });
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
