import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "react-native";
import { ApiError, get, newIdempotencyKey, post } from "@/api/client";
import { useRequireMember } from "@/lib/auth";
import type { DatePlan, Venue } from "@/api/types";
import { Badge, Button, Card, ChoiceCard, Chip, Empty, ErrorState, Loading, Options, PageTitle, Screen, StatusBanner } from "@/components/ui";
import { color, space, type as typo } from "@/theme";

/**
 * D02 Date planner, step two: where, and the one request that sends the proposal.
 *
 * Public places only, and travel is balanced across both coarse zones so neither person
 * is quietly asked to cross the city. The proposal carries If-Match, so two people
 * proposing at once get a VERSION_MISMATCH rather than one silently overwriting the
 * other, and an Idempotency-Key so a retry on a flaky phone connection cannot send twice.
 */
type VenuesOut = { items: Venue[]; concierge: boolean; rules: string[] };

const STYLES = [
  { value: "", label: "Any" },
  { value: "coffee", label: "Coffee" },
  { value: "walk", label: "Walk" },
  { value: "lunch", label: "Lunch" },
  { value: "drinks", label: "Drinks" },
  { value: "activity", label: "Activity" },
];

export default function DateVenues() {
  const { me } = useRequireMember();
  const router = useRouter();
  const qc = useQueryClient();
  const { plan: planId, starts_at: startsAt } = useLocalSearchParams<{ plan: string; starts_at: string }>();

  const [style, setStyle] = useState("");
  const [venueId, setVenueId] = useState<string | null>(null);
  const [duration, setDuration] = useState(120);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [key] = useState(() => newIdempotencyKey());

  const plan = useQuery({
    queryKey: ["date-plan", planId],
    queryFn: () => get<DatePlan>(`/date-plans/${planId}`),
    enabled: !!me && !!planId,
  });
  const venues = useQuery({
    queryKey: ["date-plan", planId, "venues", style],
    queryFn: () => get<VenuesOut>(`/date-plans/${planId}/venues${style ? `?style=${encodeURIComponent(style)}` : ""}`),
    enabled: !!me && !!planId,
  });

  const selected = venues.data?.items.find((v) => v.id === venueId) ?? null;

  const propose = async () => {
    if (!plan.data || !selected || !startsAt) return;
    setBusy(true);
    setError(null);
    try {
      const next = await post<DatePlan>(
        `/date-plans/${plan.data.id}/proposals`,
        { starts_at: startsAt, duration_minutes: duration, venue_id: selected.id, date_style: style || null },
        { ifMatch: plan.data.version, idempotencyKey: key },
      );
      qc.setQueryData(["date-plan", next.id], next);
      await qc.invalidateQueries({ queryKey: ["date-plans"] });
      router.replace(`/dates/${next.id}` as never);
    } catch (e) {
      setError(e as ApiError);
      // A mismatch means the other person moved first; refetching shows what they did.
      if ((e as ApiError).code === "VERSION_MISMATCH") void plan.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageTitle
        eyebrow="Plan a date · venue"
        title="Pick a public place"
        lede={
          plan.data && startsAt
            ? `For ${new Date(startsAt).toLocaleString()} with ${plan.data.other_display_name}.`
            : undefined
        }
      />
      {plan.isLoading && <Loading label="Loading your plan" />}
      <ErrorState
        error={error ?? ((plan.error as ApiError) ?? null)}
        retry={() => void plan.refetch()}
      />
      {!startsAt && !!plan.data && (
        <StatusBanner tone="caution" title="Pick a window first" body="Go back and choose when you could meet." />
      )}

      <Card>
        <Text style={s.h2}>Date style</Text>
        <Options value={style} options={STYLES} onChange={setStyle} />
      </Card>

      <Card>
        <Text style={s.h2}>Venue</Text>
        {venues.isLoading && <Loading label="Finding public places" />}
        {!!venues.error && <ErrorState error={venues.error as ApiError} retry={() => venues.refetch()} />}
        {venues.data?.items.length === 0 && (
          <Empty title="Nothing matches that style" body="Try Any, or a different style." />
        )}
        {venues.data?.items.map((v) => (
          <ChoiceCard
            key={v.id}
            title={v.name}
            body={`${v.coarse_area} · ${v.price_band}${v.travel ? ` · you ${v.travel.you_km_band}km, them ${v.travel.them_km_band}km` : ""}`}
            selected={venueId === v.id}
            onSelect={() => setVenueId(v.id)}
          />
        ))}
        {!!selected?.public_place && <Badge label="Public place" tone="success" />}
        {venues.data?.rules.map((r) => (
          <Text key={r} style={s.rule}>
            • {r}
          </Text>
        ))}
        {venues.data?.concierge === false && (
          <Text style={s.rule}>
            Membership balances travel across three options. Manual planning always works.
          </Text>
        )}
      </Card>

      <Card>
        <Text style={s.h2}>How long?</Text>
        <Options
          value={duration}
          options={[
            { value: 60, label: "1 hour" },
            { value: 90, label: "90 minutes" },
            { value: 120, label: "2 hours" },
          ]}
          onChange={setDuration}
        />
      </Card>

      <Button disabled={!selected || !startsAt} loading={busy} onPress={propose}>
        {selected ? `Propose ${selected.name}` : "Pick a venue first"}
      </Button>
      <Button variant="ghost" onPress={() => router.back()}>
        Back to the windows
      </Button>
    </Screen>
  );
}

const s = {
  h2: { ...typo.heading, color: color.ink, marginBottom: space.xs },
  rule: { ...typo.small, color: color.inkTertiary, marginTop: 2 },
} as const;
