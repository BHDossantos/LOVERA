// React Native's test renderer is noisy about Animated and act(); a real failure still
// throws, so quieting the warnings keeps a failing run readable.
jest.spyOn(console, "warn").mockImplementation(() => {});
