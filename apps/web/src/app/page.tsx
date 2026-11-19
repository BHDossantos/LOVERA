"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { nextOnboardingPath, useAuth } from "@/lib/auth";
import { campaignCodeFromSearch } from "@/lib/acquisition";
import { Skeleton } from "@/components/ui";

export default function Home() {
  const { me, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    const campaign = campaignCodeFromSearch(window.location.search);
    const welcome = campaign ? `/welcome?campaign=${encodeURIComponent(campaign)}` : "/welcome";
    router.replace(me ? nextOnboardingPath(me) : welcome);
  }, [me, loading, router]);
  return (
    <div className="mx-auto max-w-xl p-6">
      <Skeleton />
    </div>
  );
}
