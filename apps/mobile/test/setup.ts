// React Native's test renderer is noisy about Animated and act(); a real failure still
// throws, so quieting the warnings keeps a failing run readable.
jest.spyOn(console, "warn").mockImplementation(() => {});

// Expo SDK 57 installs fetch as a lazy global. Jest reads globals while tearing
// down the environment; if fetch was never used, that read imports native Expo
// modules after their mocks have already been disposed. Resolve the getter while
// the native mocks are alive. This performs no request and preserves Expo fetch.
void globalThis.fetch;
