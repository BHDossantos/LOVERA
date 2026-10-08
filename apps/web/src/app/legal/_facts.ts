/**
 * Every operator-specific fact the legal pages state, in one place.
 *
 * These pages carried 21 inline `<TODO>` markers. Two problems with that, and the second is the
 * one that would actually have hurt:
 *
 *  1. The same fact appeared more than once — the legal entity and the registered address are in
 *     both the terms and the privacy notice — so filling them in was an exercise in finding every
 *     copy. Half-filled is worse than empty: a privacy notice naming a controller the terms do not
 *     is a document that contradicts itself.
 *  2. Nothing failed when they were left. A build shipped with the placeholders rendered in
 *     highlighted yellow, which looks like a deliberate design element to anybody who has not been
 *     told otherwise.
 *
 * So each fact is declared once here and rendered through `<Fact>`, and
 * `tools/check_legal_facts.py` both asserts no page names a fact that does not exist and, with
 * `--require-all`, refuses to pass while any required one is unset. docs/DEPLOY.md says to run that
 * before a production build.
 *
 * Values come from the environment so they can be set per deployment without a code change.
 * `NEXT_PUBLIC_` because these are rendered in the browser; none of it is secret — it is a
 * published legal document.
 *
 * **Nothing here is invented.** A legal entity name or a governing law that I guessed at would be a
 * fabricated legal document, which is worse than a visible gap. What is filled in below is only
 * what this repository already determines, and each one says where it comes from.
 */

/** What a value is for, and where the operator gets it. Shown by the checker, not on the page. */
export type FactSpec = {
  /** The value, or null when nobody has supplied it yet. */
  value: string | null;
  /** What to put there, in the operator's terms. */
  describe: string;
  /** False for facts that are genuinely optional (a DPO is not always required). */
  required?: boolean;
};

/**
 * Derived from this repository rather than asked for.
 *
 * `infra/fly/api.toml` pins `primary_region = "fra"` — Frankfurt, chosen because the pilot market is
 * Rome. `app/core/config.py` names the AI and payment providers. The identity line is the one that
 * changed with `MM_IDENTITY_PROVIDER=manual_review`: there is no verification vendor in that
 * posture, so claiming one in a privacy notice would be false. Set `NEXT_PUBLIC_LEGAL_*` to
 * override any of them when the deployment differs.
 */
const fromRepo = {
  hosting: "Fly.io, in Frankfurt (eu-central), with the database in the same region",
  aiProvider: "Anthropic",
  paymentProvider: "Stripe",
  identityVendor:
    "no third-party verification vendor — a member of our own team reviews each verification, " +
    "so your document is seen by us and by nobody else",
  // app/core/config.py: checkin_location_retention_hours = 24
  checkinLocationRetention: "24 hours",
};

const env = (name: string) => process.env[name]?.trim() || null;

export const FACTS: Record<string, FactSpec> = {
  entity: {
    value: env("NEXT_PUBLIC_LEGAL_ENTITY"),
    describe: "The registered company name that contracts with members, exactly as registered.",
  },
  address: {
    value: env("NEXT_PUBLIC_LEGAL_ADDRESS"),
    describe: "The registered office address, as it appears on the company register.",
  },
  markets: {
    value: env("NEXT_PUBLIC_LEGAL_MARKETS"),
    describe: 'The countries or cities the service is offered in at launch, e.g. "Italy and Spain".',
  },
  governingLaw: {
    value: env("NEXT_PUBLIC_LEGAL_GOVERNING_LAW"),
    describe: 'The law these terms are governed by, e.g. "Italy". A lawyer decides this, not a developer.',
  },
  jurisdiction: {
    value: env("NEXT_PUBLIC_LEGAL_JURISDICTION"),
    describe: 'The courts with jurisdiction, e.g. "Rome, Italy".',
  },
  supportEmail: {
    value: env("NEXT_PUBLIC_LEGAL_SUPPORT_EMAIL"),
    describe: "The address members reach support at. Must be monitored.",
  },
  privacyEmail: {
    value: env("NEXT_PUBLIC_LEGAL_PRIVACY_EMAIL"),
    describe: "The address for data-protection requests. Must be monitored; the UK/EU response clock runs from it.",
  },
  safetyEmail: {
    value: env("NEXT_PUBLIC_LEGAL_SAFETY_EMAIL"),
    describe: "The address for safety concerns raised outside the app. Must be monitored.",
  },
  dpo: {
    value: env("NEXT_PUBLIC_LEGAL_DPO"),
    describe: "Your data protection officer's name and contact, where one is required. Leave unset if not.",
    required: false,
  },
  transferMechanism: {
    value: env("NEXT_PUBLIC_LEGAL_TRANSFER_MECHANISM"),
    describe:
      'The lawful basis for transfers outside the UK/EEA, e.g. "the European Commission\'s Standard ' +
      'Contractual Clauses". Which one applies depends on the processors you actually sign.',
  },
  safetyRetention: {
    value: env("NEXT_PUBLIC_LEGAL_SAFETY_RETENTION"),
    describe:
      "How long safety reports and their evidence are kept. Nothing in the code deletes them today " +
      "(see `erase_member`: safety records are preserved on purpose), so this is a decision to make " +
      "and then implement, not just to write down.",
  },
  auditRetention: {
    value: env("NEXT_PUBLIC_LEGAL_AUDIT_RETENTION"),
    describe:
      "How long audit and billing records are kept. Usually set by tax and accounting law in your " +
      "jurisdiction rather than by choice.",
  },
  consumerLaw: {
    value: env("NEXT_PUBLIC_LEGAL_CONSUMER_LAW"),
    describe:
      "The statutory withdrawal and refund position for your launch markets, in one sentence. In the " +
      "EU a 14-day right of withdrawal generally applies to a subscription like this, and whether a " +
      "member waives it by starting immediately is exactly the sort of thing to have confirmed.",
  },

  // Derived, not asked for. Still overridable, because a different deployment may differ.
  hosting: {
    value: env("NEXT_PUBLIC_LEGAL_HOSTING") ?? fromRepo.hosting,
    describe: "Hosting and database provider, and the region. Taken from infra/fly/api.toml.",
  },
  aiProvider: {
    value: env("NEXT_PUBLIC_LEGAL_AI_PROVIDER") ?? fromRepo.aiProvider,
    describe: "The AI provider that structures interview answers. Taken from app/core/config.py.",
  },
  paymentProvider: {
    value: env("NEXT_PUBLIC_LEGAL_PAYMENT_PROVIDER") ?? fromRepo.paymentProvider,
    describe: "The payment provider. Taken from app/core/config.py.",
  },
  identityVendor: {
    value: env("NEXT_PUBLIC_LEGAL_IDENTITY_VENDOR") ?? fromRepo.identityVendor,
    describe:
      "The identity verification vendor. Defaults to the truthful statement for " +
      "MM_IDENTITY_PROVIDER=manual_review, which is that there is no vendor. Set this when you " +
      "contract one.",
  },
  checkinLocationRetention: {
    value: env("NEXT_PUBLIC_LEGAL_CHECKIN_RETENTION") ?? fromRepo.checkinLocationRetention,
    describe: "How long a shared check-in location is kept. Taken from checkin_location_retention_hours.",
  },
};

export type FactName = keyof typeof FACTS;

/** The facts somebody still has to supply. Empty is the condition for a production build. */
export function missingFacts(): string[] {
  return Object.entries(FACTS)
    .filter(([, spec]) => spec.required !== false && !spec.value)
    .map(([name]) => name);
}
