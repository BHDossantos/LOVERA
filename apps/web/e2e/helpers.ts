import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8000/v1";

export type Actor = { email: string; token: string; id: string };

async function json<T>(res: import("@playwright/test").APIResponse): Promise<T> {
  const text = await res.text();
  if (!res.ok()) throw new Error(`${res.status()} ${res.url()} ${text}`);
  return JSON.parse(text) as T;
}

export async function signInApi(request: APIRequestContext, email: string): Promise<Actor> {
  const start = await json<{ challenge_id: string; dev_code: string }>(await request.post(`${API}/auth/start`, { data: { email } }));
  const tok = await json<{ access_token: string }>(await request.post(`${API}/auth/verify`, { data: { challenge_id: start.challenge_id, code: start.dev_code, device_id: "e2e" } }));
  const me = await json<{ id: string }>(await request.get(`${API}/me`, { headers: { Authorization: `Bearer ${tok.access_token}` } }));
  return { email, token: tok.access_token, id: me.id };
}

export function auth(actor: Actor) {
  return { Authorization: `Bearer ${actor.token}` };
}

const ANSWERS: Record<string, Record<string, unknown>> = {
  children: { choice: "open", tier: "must", partner_values: ["want", "open"] },
  relationship_structure: { choice: "monogamous", tier: "must", partner_values: ["monogamous"] },
  age_range: { range: { min: 25, max: 45 } },
  distance: { range: { value: 25 } },
  marriage: { choice: "open", tier: "open", partner_values: ["important", "open", "not_important"] },
  smoking: { choice: "never", tier: "prefer", partner_values: ["never", "socially"] },
  relocation: { choice: "maybe", tier: "open", partner_values: ["open", "maybe", "no"] },
  faith: { skip: true },
  weekend: { choice: "calm" },
  weeknight_party: { choice: "balanced" },
  conflict: { choice: "talk_now" },
  contact: { choice: "few_times_week" },
  spontaneous_trip: { choice: "mixed" },
  affection: { choice: "moderate" },
  family: { choice: "close" },
  movement: { choice: "moderate" },
  bonus: { choice: "balanced" },
  career: { choice: "balanced" },
  drinking: { choice: "socially", tier: "open", partner_values: ["never", "socially"] },
  pets: { choice: "none" },
  sleep: { choice: "flexible" },
  readiness: { choice: "14" },
};

/** Full API-driven onboarding (sandbox vendor), mirroring the backend test harness. */
export async function onboardApi(request: APIRequestContext, opts: { email: string; name: string; gender: string; seeking: string[]; zone: string; birth?: string }): Promise<Actor> {
  const actor = await signInApi(request, opts.email);
  const h = auth(actor);
  await json(await request.post(`${API}/me/adult-consent`, { headers: h, data: { birth_date: opts.birth ?? "1991-04-12", accept_terms: true, accept_privacy: true, accept_community: true } }));
  const session = await json<{ session: { provider_ref: string } }>(await request.post(`${API}/verification/sessions`, { headers: h }));
  await json(await request.post(`${API}/verification/sandbox/complete`, { headers: h, data: { provider_ref: session.session.provider_ref, outcome: "verified" } }));
  await json(await request.post(`${API}/me/intent`, { headers: h, data: { intent: "long_term", home_city_id: "rome", home_zone_id: opts.zone, gender: opts.gender, seeking: opts.seeking, max_distance_km: 25 } }));
  let state = await json<{ session_id: string; next_question: { key: string } | null }>(await request.post(`${API}/blueprint/sessions`, { headers: h, data: { mode: "initial" } }));
  for (let i = 0; i < 30 && state.next_question; i++) {
    state = await json(await request.post(`${API}/blueprint/sessions/${state.session_id}/answers`, { headers: h, data: { question_key: state.next_question.key, ...ANSWERS[state.next_question.key] } }));
  }
  await json(await request.post(`${API}/blueprint/confirm`, { headers: h, data: { session_id: state.session_id } }));
  await json(await request.patch(`${API}/profile`, { headers: h, data: { display_name: opts.name, bio: "Slow mornings, long lunches and honest conversations about the future.", languages: ["en", "it"], prompts: [{ key: "second_date", answer: "Something outdoors with good coffee." }, { key: "repair", answer: "Say what I felt, then listen." }] } }));
  const media = await json<{ media: { id: string } }>(await request.post(`${API}/profile/media`, { headers: h, data: { type: "photo", content_type: "image/png", size_bytes: 68 } }));
  await json(await request.post(`${API}/profile/media/${media.media.id}/complete`, { headers: h, data: { data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" } }));
  await json(await request.put(`${API}/availability`, { headers: h, data: { recurring_windows: [{ weekday: 3, start: "18:00", end: "22:00" }, { weekday: 5, start: "10:00", end: "16:00" }], date_styles: ["coffee", "walk"], date_ready: true } }));
  return actor;
}

export async function subscribeApi(request: APIRequestContext, actor: Actor) {
  const checkout = await json<{ provider_ref: string }>(await request.post(`${API}/subscriptions/checkout`, { headers: { ...auth(actor), "Idempotency-Key": crypto.randomUUID() }, data: { plan: "pro" } }));
  await json(await request.post(`${API}/subscriptions/sandbox/pay`, { headers: auth(actor), data: { checkout_ref: checkout.provider_ref, outcome: "paid" } }));
}

export async function runBatchApi(request: APIRequestContext) {
  const concierge = await signInApi(request, "concierge@example.test");
  return json<{ id: string; allocation_count: number }>(await request.post(`${API}/admin/matching/runs`, { headers: auth(concierge), data: { market_id: "rome", auto_publish: true } }));
}

export async function introductionBetween(request: APIRequestContext, actor: Actor, otherId: string) {
  const list = await json<{ current: { id: string; profile: { member_id: string } | null }[] }>(await request.get(`${API}/introductions`, { headers: auth(actor) }));
  const found = list.current.find((i) => i.profile?.member_id === otherId) ?? null;
  if (!found) console.log("introductions for", actor.email, JSON.stringify(list.current.map((i) => [i.id, i.profile?.member_id])), "wanted", otherId);
  return found;
}

/** Browser sign-in with the sandbox one-time code. */
export async function signInBrowser(page: Page, email: string) {
  await page.goto("/welcome");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/welcome/, { timeout: 20_000 });
}
