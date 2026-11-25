import Link from "next/link";
import { H2, P, UL } from "../_components";
import { FACTS } from "../_facts";

export const metadata = { title: "Delete your Lovera account" };

export default function DeleteAccountPage() {
  const privacyEmail = FACTS.privacyEmail.value;

  return (
    <>
      <h1 className="mb-4 text-3xl font-bold text-ink">Delete your Lovera account</h1>
      <P>You can request account and data deletion on the web. You don&apos;t need to reinstall the app.</P>

      <H2>Request deletion</H2>
      <UL items={[
        <> <Link href="/welcome" className="text-action underline">Sign in to Lovera</Link> with your account email.</>,
        <>Open <strong>You → Your data → Delete my account</strong> and confirm to start the deletion grace period.</>,
      ]} />
      {privacyEmail && (
        <P>
          If you can&apos;t sign in,{" "}
          <a className="text-action underline" href={`mailto:${privacyEmail}?subject=Lovera%20account%20deletion`}>
            email Lovera Privacy to request deletion
          </a>
          {" "}from your Lovera account address. Don&apos;t send your password, sign-in code, or identity document.
        </P>
      )}

      <H2>What happens after you request deletion</H2>
      <P>
        Your profile is hidden when the request is scheduled. You can cancel before the erasure date shown in
        your account. After the grace period, your profile, preferences, Blueprint answers, and associated
        messages and feedback are erased. The{" "}
        <Link href="/legal/privacy" className="text-action underline">Lovera Privacy Notice</Link>
        {" "}explains the limited retention of safety, audit and billing records.
      </P>
      <P>
        If you bought a subscription through Apple or Google, manage or cancel it separately in that
        store&apos;s subscription settings so it doesn&apos;t renew.
      </P>
    </>
  );
}
