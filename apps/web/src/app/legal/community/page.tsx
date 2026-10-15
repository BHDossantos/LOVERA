import { DocHeader, Fact, H2, P, UL } from "../_components";

export const metadata = { title: "Community Agreement · Lovera" };

export default function Community() {
  return (
    <>
      <DocHeader title="Community Agreement" version="2026-09" updated="23 September 2026" />

      <P>
        Everyone here has been verified and is looking for a serious relationship. This is
        what we all agree to. It is short because it is meant to be remembered.
      </P>

      <H2>Be who you say you are</H2>
      <UL
        items={[
          "Recent photos of you, and only you.",
          "Your real age, your real situation. If you are seeing someone, say so.",
          "No accounts run on behalf of someone else.",
        ]}
      />

      <H2>Take a no as an answer</H2>
      <UL
        items={[
          "A pass is private and final. You will never be told who passed on you, and nobody is told when you pass.",
          "If someone stops replying, that is an answer. Do not pursue it elsewhere.",
          "Do not contact anyone who has blocked you, by any route.",
        ]}
      />

      <H2>First dates happen in public</H2>
      <UL
        items={[
          "Somewhere public, at a time you both chose.",
          "Tell someone you trust, or use the check-in in the app.",
          "Nobody is owed anything for showing up — not a second date, not contact details, not the rest of the evening.",
        ]}
      />

      <H2>Never</H2>
      <UL
        items={[
          "Ask another member for money, crypto, gift cards, or an investment. This is the single most common way people are hurt here, and it ends the account on the first occurrence.",
          "Send sexual images to someone who has not asked for them.",
          "Share, or threaten to share, anyone's private images or messages.",
          "Record a call or a date without consent.",
          "Pressure anyone into anything, including staying longer than they want to.",
          "Target anyone for who they are — their background, faith, body, disability, or identity.",
        ]}
      />

      <H2>What happens when someone reports</H2>
      <P>
        Reporting is one tap from anywhere in the app. The person you report is never told
        that you reported them, or what you said. Blocking is immediate and silent.
      </P>
      <UL
        items={[
          "A person reads every report. Urgent ones are acknowledged within 24 hours.",
          "We may pause a conversation while we look, and we will tell you when we do.",
          "We do not explain what triggered a restriction, because doing so would tell people how to work around it.",
          "If you think a decision about your account is wrong, you can appeal, and a different person reviews it.",
        ]}
      />

      <H2>If you are in danger</H2>
      <P>
        Contact your local emergency services first. We are not an emergency service. The
        Safety centre in the app has the number for your market and can put a report on
        record afterwards. For anything else: <Fact name="safetyEmail" />.
      </P>
    </>
  );
}
