import { DocHeader, H2, P, UL, TODO } from "../_components";

export const metadata = { title: "Privacy Notice · AI Matchmaker" };

/**
 * The URL both stores require as a listing field, and the one a member reads before
 * handing over a passport photo. Written from what the code actually does — the data
 * map here is the same one in docs/STORE-SUBMISSION.md, so the store answers and this
 * page cannot drift apart without someone noticing.
 */
export default function Privacy() {
  return (
    <>
      <DocHeader title="Privacy Notice" version="2026-09" updated="23 September 2026" />

      <P>
        This notice describes what AI Matchmaker collects, what it deliberately does not,
        and how you get any of it back or deleted. It is written to be read, not to be
        survived.
      </P>
      <P>
        The controller is <TODO>legal entity name</TODO>, <TODO>registered address</TODO>.
        Contact <TODO>privacy@yourdomain</TODO>. Our data protection officer, where one is
        required, is <TODO>DPO name and contact</TODO>.
      </P>

      <H2>What we collect, and why</H2>
      <UL
        items={[
          <><strong>Email address</strong> — to create your account and sign you in. Legal basis: performance of the contract.</>,
          <><strong>Date of birth</strong> — to enforce the 18+ gate and to show your age to introductions. Legal basis: legal obligation and contract.</>,
          <><strong>Identity verification result</strong> — a verified / not verified answer, an over-18 answer, a vendor reference and the date. Legal basis: contract and our legitimate interest in keeping fakes and minors out.</>,
          <><strong>Coarse location</strong> — your city and a neighbourhood-sized zone. Used only to show distance as a band. Legal basis: contract.</>,
          <><strong>Photos and profile text</strong> — what you choose to show. Legal basis: contract.</>,
          <><strong>Blueprint answers</strong> — what you tell us about what you want. Legal basis: contract.</>,
          <><strong>Messages</strong> — the conversation itself, and moderation state. Legal basis: contract, and legal obligation where a safety report is involved.</>,
          <><strong>Who you want to meet</strong> — this reveals sexual orientation, which is special category data. Legal basis: your explicit consent, given at sign-up.</>,
          <><strong>Faith, only if you switch it on</strong> — special category data. Legal basis: your explicit consent. You can withdraw it without deleting your account, and the answers are then ignored rather than used.</>,
          <><strong>Device push token</strong> — so notifications reach your phone. Revoked when you sign out of that device.</>,
        ]}
      />

      <H2>What we never collect</H2>
      <UL
        items={[
          "Your precise location. Matching works on zones; we do not ask for GPS and the mobile app blocks the permission outright.",
          "Your contacts, your calendar contents, or your browsing history.",
          "Advertising identifiers. There are no advertising SDKs in our apps.",
          "Your identity documents. The verification vendor checks them and we never receive them.",
        ]}
      />

      <H2>We do not track you, and we do not sell anything</H2>
      <P>
        We do not track you across other companies&apos; apps or websites, we do not sell
        personal data, and we do not share it with data brokers. There is no advertising
        business here — the subscription is the business.
      </P>

      <H2>Who else processes your data</H2>
      <UL
        items={[
          <>Our identity verification vendor, <TODO>vendor name</TODO>, which checks your document and liveness and returns only a result.</>,
          <>Our hosting and database provider, <TODO>hosting provider and region</TODO>.</>,
          <>Our payment provider, <TODO>payment provider</TODO>, and, where you subscribe inside a mobile app, Apple or Google.</>,
          <>An AI provider, <TODO>AI provider</TODO>, which structures your interview answers into signals you then confirm. It is never used to decide anything about you on its own, and never to write a message as you.</>,
        ]}
      />
      <P>
        Each is bound by a data processing agreement. Where a provider is outside the
        UK or EEA, transfers rely on <TODO>transfer mechanism, e.g. Standard Contractual Clauses</TODO>.
      </P>

      <H2>Automated decisions</H2>
      <P>
        Introductions are chosen by an algorithm. It has legal or similarly significant
        effects on nobody: it decides who is suggested to whom, not access to anything you
        are entitled to. Every introduction comes with the reasons behind it, you can
        correct any signal it used, and a person reviews any decision you challenge. We
        never produce a compatibility score or a desirability ranking.
      </P>

      <H2>How long we keep things</H2>
      <UL
        items={[
          "Your account and profile: until you delete it.",
          "After deletion: a grace period during which you can change your mind, then erasure.",
          <>Safety reports and their evidence: <TODO>retention period</TODO>, because deleting them would let a reported person erase their own history.</>,
          <>Audit and billing records we must keep by law: <TODO>retention period</TODO>.</>,
        ]}
      />

      <H2>Your rights</H2>
      <P>
        You can exercise all of these in the app, under <strong>You → Your data</strong>,
        without emailing anyone:
      </P>
      <UL
        items={[
          "See everything we hold about you, and export it.",
          "Correct anything wrong, including any signal used for matching.",
          "Delete your account, in the app, with a grace period before erasure.",
          "Pause, which hides you from new introductions without deleting anything.",
          "Withdraw the optional consents — AI assistance, and faith for matching — without losing your account.",
        ]}
      />
      <P>
        You also have the right to complain to a supervisory authority. In Italy that is
        the Garante per la protezione dei dati personali; in the UK, the Information
        Commissioner&apos;s Office.
      </P>

      <H2>Security</H2>
      <P>
        Data is encrypted in transit and at rest, sensitive fields are encrypted
        additionally by policy, access is logged to a tamper-evident audit trail, and the
        session token on your phone lives in the device keychain rather than ordinary
        storage.
      </P>

      <H2>Changes</H2>
      <P>
        We will tell you in the app before any change to what we do with your data, and
        ask again where the law requires it. Past versions are available on request.
      </P>
    </>
  );
}
