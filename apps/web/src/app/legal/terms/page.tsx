import { DocHeader, H2, P, UL, TODO } from "../_components";

export const metadata = { title: "Terms of Service · AI Matchmaker" };

export default function Terms() {
  return (
    <>
      <DocHeader title="Terms of Service" version="2026-09" updated="23 September 2026" />

      <P>
        These terms are between you and <TODO>legal entity name</TODO> (&ldquo;we&rdquo;),
        registered at <TODO>registered address</TODO>. By creating an account you accept
        them.
      </P>

      <H2>What we provide</H2>
      <P>
        AI Matchmaker is an invite-only introduction service. We offer you between one and
        three introductions a week, chosen for you, each with the reasons behind it. We do
        not provide a browsable directory of people, and there is no way to pay for more
        visibility.
      </P>
      <P>
        We do not promise you will meet anyone, that anyone will say yes, or that any
        introduction will lead anywhere. What we promise is that everyone in the pool has
        passed the same identity and age check, that your decisions stay private, and that
        we will tell you honestly why each introduction was made.
      </P>

      <H2>Who may use it</H2>
      <UL
        items={[
          "You must be 18 or over. We verify this; misrepresenting your age ends the account.",
          "You must be the person in your photos and on your document.",
          "One account per person.",
          <>The service is offered in <TODO>launch markets</TODO> only.</>,
        ]}
      />

      <H2>Your account and your conduct</H2>
      <P>
        You agree to the Community Agreement, which is part of these terms. Breaking it can
        restrict or end your account. Serious matters — threats, sexual violence, anything
        involving a minor, financial exploitation — end it immediately and may be reported
        to the authorities.
      </P>

      <H2>Money</H2>
      <UL
        items={[
          "A free tier gives you a limited number of introductions.",
          "Paid plans renew each month until you cancel, at the price shown when you subscribe.",
          "You cancel in the app. Cancelling stops the next renewal; the plan runs to the end of the period you have paid for.",
          "Where you subscribed through Apple or Google, they take the payment and you manage or cancel the subscription in their account settings, under their refund rules.",
          <>Statutory withdrawal and refund rights, where they apply to you, are unaffected. <TODO>Confirm consumer-law position for launch markets</TODO>.</>,
          "A quiet week does not cost you an introduction. Where we cannot offer you anyone who clears your non-negotiables, we hold the credit rather than spending it.",
        ]}
      />

      <H2>AI, and what it is not allowed to do</H2>
      <P>
        We use AI to turn your interview answers into signals, to draft message
        suggestions, and to translate. Every one of those is a suggestion you approve.
        Nothing is ever sent as your words without you pressing send. AI never decides
        whether to restrict an account; a person does that.
      </P>

      <H2>Your content</H2>
      <P>
        Your photos and words stay yours. You give us the licence we need to run the
        service — to show your profile to people you are introduced to, to deliver your
        messages, and to keep backups — and nothing wider. We do not use your photos in
        advertising. That licence ends when you delete the content, except for copies we
        must keep for safety or legal reasons.
      </P>

      <H2>Ending it</H2>
      <UL
        items={[
          "You can delete your account in the app at any time, with a grace period before erasure.",
          "We can suspend or end an account that breaks these terms or the Community Agreement, or where we must for legal or safety reasons.",
          "Where we end your paid plan without cause, we refund the unused part of the period.",
        ]}
      />

      <H2>Liability</H2>
      <P>
        We are responsible for running the service with reasonable care. We are not
        responsible for what other members say or do, on or off the service, and we are not
        a background-checking service: verification confirms someone is a real adult, not
        that they are safe or honest. Meeting anyone is your decision, and we ask you to
        meet in public and to use the check-in tools.
      </P>
      <P>
        Nothing here limits liability for death or personal injury caused by our
        negligence, for fraud, or for anything else that cannot be limited by law. Subject
        to that, our total liability to you is limited to what you paid us in the twelve
        months before the claim.
      </P>

      <H2>Changes</H2>
      <P>
        We will tell you in the app before these terms change in a way that affects you,
        and ask you to accept the new version. If you do not want to accept it you can
        delete your account and we will refund the unused part of any period you have paid
        for.
      </P>

      <H2>Law</H2>
      <P>
        These terms are governed by the law of <TODO>governing law</TODO>, and the courts of{" "}
        <TODO>jurisdiction</TODO> have jurisdiction. If you are a consumer, you keep the
        protection of the mandatory law of the country you live in.
      </P>

      <H2>Contact</H2>
      <P>
        <TODO>support@yourdomain</TODO>
      </P>
    </>
  );
}
