import { useRequireMember } from "@/lib/auth";
import { CaseList } from "@/components/CaseList";
import { PageTitle, Screen } from "@/components/ui";

/** S03 Case list. The path the API's safety-centre actions use for "see your reports". */
export default function Cases() {
  useRequireMember({ allowRestricted: true, allowOnboarding: true });
  return (
    <Screen>
      <PageTitle
        eyebrow="Safety"
        title="Your reports"
        lede="Every report you have made, with where it has got to. The person you reported never sees any of this."
      />
      <CaseList />
    </Screen>
  );
}
