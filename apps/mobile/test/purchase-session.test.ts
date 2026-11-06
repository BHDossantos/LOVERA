import { post, setTokens } from '../src/api/client';
jest.mock('expo-constants', () => ({ expoConfig: { extra: { apiOrigin: 'https://test.invalid' } } }));
test('bound purchase request rejects a changed session and never refreshes it', async () => {
  globalThis.fetch = jest.fn();
  await setTokens('account-b', null);
  await expect(post('/subscriptions/store-sync', undefined, { expectedAccessToken: 'account-a', retry: false })).rejects.toThrow('Account changed');
  expect(globalThis.fetch).not.toHaveBeenCalled();
  await setTokens('account-a', null);
  (globalThis.fetch as jest.Mock).mockResolvedValue({ status: 401, ok: false, text: async () => JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }) });
  await expect(post('/subscriptions/store-sync', undefined, { expectedAccessToken: 'account-a' })).rejects.toThrow('expired');
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect((globalThis.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer account-a');
});
