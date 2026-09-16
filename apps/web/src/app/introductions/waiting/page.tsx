"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "@/lib/api";
import { useRequireMember } from "@/lib/auth";
import { AppShell } from "@/components/shell/AppShell";
import { ErrorState, PageTitle, Skeleton } from "@/components/ui";
import type { WaitingPayload } from "@/components/introductions/types";
import { WaitingCard } from "@/components/introductions/WaitingCard";

/** I06 No qualified introduction: transparent reasons, protected credit, optional preference review. Never pressure. */
export default function WaitingPage() {
  const { me } = useRequireMember();
  const q = useQuery({ queryKey: ["introductions", "waiting"], queryFn: () => get<WaitingPayload>("/introductions/waiting"), enabled: !!me });
  return (
    <AppShell>
      <PageTitle eyebrow="Introductions" title="Why there's nothing to decide right now" lede="An honest wait beats a bad introduction. Here is exactly what is happening." />
      {q.isLoading && <Skeleton lines={5} label="Loading" />}
      {q.isError && <ErrorState error={q.error as ApiError} retry={() => q.refetch()} />}
      {q.data && <WaitingCard waiting={q.data} standalone />}
    </AppShell>
  );
}
