import { resolveOrigin } from "@/api/client";

/**
 * Where the app sends its requests when it is running from `expo start` on a real phone.
 *
 * `app.config.ts` runs on the developer's machine, so the origin it bakes in defaults to
 * `http://127.0.0.1:8000` — the machine's own loopback. On a simulator that is the same loopback
 * and it works. On a phone it is the phone, nothing is listening, and every request fails before
 * it leaves the handset, which looks exactly like "the API is down".
 */
const DEV_SERVER = "192.168.1.24:8081";

test("a loopback origin becomes the host the bundle was served from, on the API's port", () => {
  expect(resolveOrigin("http://127.0.0.1:8000", DEV_SERVER)).toBe("http://192.168.1.24:8000");
  expect(resolveOrigin("http://localhost:8000", DEV_SERVER)).toBe("http://192.168.1.24:8000");
  // Expo has handed this over with a scheme in front of it before now.
  expect(resolveOrigin("http://127.0.0.1:8000", `exp://${DEV_SERVER}`)).toBe("http://192.168.1.24:8000");
  // The port stays the API's. Taking the dev server's would reach Metro, which answers with a
  // bundle rather than JSON and makes the failure look like a parse error instead of a wrong host.
  expect(resolveOrigin("http://127.0.0.1:9999", DEV_SERVER)).toBe("http://192.168.1.24:9999");
});

test("an origin somebody configured is never rewritten", () => {
  // This is the whole point of EXPO_PUBLIC_API_ORIGIN, so it has to survive a dev server.
  expect(resolveOrigin("https://api.example.invalid", DEV_SERVER)).toBe("https://api.example.invalid");
  expect(resolveOrigin("http://10.0.0.5:8000", DEV_SERVER)).toBe("http://10.0.0.5:8000");
});

test("without a dev server nothing is rewritten, so a release build is untouched", () => {
  expect(resolveOrigin("http://127.0.0.1:8000", undefined)).toBe("http://127.0.0.1:8000");
  expect(resolveOrigin("https://api.example.invalid", undefined)).toBe("https://api.example.invalid");
});

test("a dev server that is itself loopback leaves the origin alone", () => {
  // A simulator reports loopback, and rewriting loopback to loopback would be churn that hides
  // whether this ran at all.
  expect(resolveOrigin("http://127.0.0.1:8000", "127.0.0.1:8081")).toBe("http://127.0.0.1:8000");
  expect(resolveOrigin("http://127.0.0.1:8000", "localhost:8081")).toBe("http://127.0.0.1:8000");
});

test("nonsense is passed through rather than mangled", () => {
  expect(resolveOrigin("not-a-url", DEV_SERVER)).toBe("not-a-url");
  expect(resolveOrigin("http://127.0.0.1:8000", "")).toBe("http://127.0.0.1:8000");
});
