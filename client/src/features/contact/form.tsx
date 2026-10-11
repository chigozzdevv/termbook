"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { reasons, schema, type ContactValues } from "./schema";
import { useSubmit } from "./use-submit";

export function Form({ reason }: { reason?: ContactValues["reason"] }) {
  const { pending, status, reset, submit } = useSubmit();
  const [error, setError] = useState<string | null>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = schema.safeParse(Object.fromEntries(new FormData(form)));
    if (!values.success) {
      setError(values.error.issues[0].message);
      return;
    }
    setError(null);
    if (await submit(values.data)) form.reset();
  }

  return (
    <form
      onSubmit={send}
      aria-busy={pending}
      onChange={() => {
        reset();
        setError(null);
      }}
    >
      <fieldset disabled={pending} className="m-0 min-w-0 border-0 p-0">
        <div className="grid grid-cols-2 gap-4 max-[430px]:grid-cols-1 max-[430px]:gap-0">
          <label className="field-label">
            Name
            <Input name="name" autoComplete="name" maxLength={100} required autoFocus />
          </label>
          <label className="field-label">
            Email
            <Input name="email" type="email" autoComplete="email" maxLength={254} required />
          </label>
        </div>
        <label className="field-label">
          What’s this about?
          <Select name="reason" required defaultValue={reason ?? ""}>
            <option value="" disabled>
              Choose a reason
            </option>
            {reasons.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
        </label>
        <label className="field-label">
          Project or website (optional)
          <Input name="project" maxLength={200} placeholder="Project name or URL" />
        </label>
        <label className="field-label">
          Message
          <Textarea
            name="message"
            rows={4}
            maxLength={1200}
            required
            placeholder="How can we help?"
          />
        </label>
        <div className="mt-[18px] flex gap-[10px]">
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send message"}
          </Button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="mt-4 text-[13px] leading-[1.6] text-danger">
          {error}
        </p>
      )}
      <div role="status" aria-live="polite">
        {status && (
          <p
            className={`mt-4 text-[13px] leading-[1.6] ${status.kind === "success" ? "text-success" : "text-danger"}`}
          >
            {status.message}
          </p>
        )}
      </div>
    </form>
  );
}
