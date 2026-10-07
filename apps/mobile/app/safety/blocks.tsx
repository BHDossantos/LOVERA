import { useRequireMember } from "@/lib/auth";
import { BlockList } from "@/components/BlockList";
import { PageTitle, Screen } from "@/components/ui";

/**
 * S04 Blocks. Its own page because the API's safety-centre actions link to /safety/blocks,
 * and because a member who wants to review who they have cut off should not have to scroll
 * past their open safety cases to do it.
 */
export default function Blocks() {
  useRequireMember({ allowRestricted: true, allowOnboarding: true });
  return (
    <Screen>
      <PageTitle
        eyebrow="Safety"
        title="People you've blocked"
        lede="Blocking is immediate and silent. They are never told, and they cannot contact you again."
      />
      <BlockList />
    </Screen>
  );
}
