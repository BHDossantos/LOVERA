"use client";

import { useEffect, useState } from "react";
import { newIdempotencyKey } from "@/lib/api";
import { Button, TextArea } from "@/components/ui";
import type { SendPayload } from "./types";

export type Prefill = { text: string; translation_id?: string; source_lang?: string } | null;

/**
 * Manual composer. Generates one client_message_id per composed message so a retry never duplicates.
 * The member's text is the only thing that gets sent; AI drafts and translations arrive here as editable text.
 */
export function Composer({ disabled, disabledReason, prefill, onSend }: { disabled?: boolean; disabledReason?: string; prefill?: Prefill; onSend: (p: SendPayload) => Promise<void> }) {
  const [text, setText] = useState("");
  const [clientId, setClientId] = useState(() => newIdempotencyKey());
  const [assist, setAssist] = useState<{ translation_id?: string; source_lang?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    setAssist({ translation_id: prefill.translation_id, source_lang: prefill.source_lang });
  }, [prefill]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || disabled || busy) return;
    setBusy(true);
    const payload: SendPayload = { client_message_id: clientId, text: body, ...assist };
    // The message now lives in the conversation's pending list (with retry); the composer starts a fresh draft.
    setText("");
    setAssist({});
    setClientId(newIdempotencyKey());
    try {
      await onSend(payload);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="sticky bottom-14 z-30 -mx-4 border-t border-border bg-canvas px-4 py-3">
      {disabled ? (
        <p className="py-2 text-center text-sm text-ink-secondary">{disabledReason ?? "Messaging is not available in this conversation."}</p>
      ) : (
        <div className="flex items-end gap-2">
          <label htmlFor="composer" className="sr-only">
            Your message
          </label>
          <TextArea
            id="composer"
            rows={2}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write in your own words…"
            className="max-h-40 min-h-11 resize-y"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
            }}
          />
          <Button type="submit" disabled={!text.trim() || busy} aria-label="Send message">
            Send
          </Button>
        </div>
      )}
      {!disabled && assist.translation_id && <p className="mt-1 text-xs text-ink-tertiary">Contains a translation you reviewed. Edit freely; it is sent only when you press Send.</p>}
    </form>
  );
}
