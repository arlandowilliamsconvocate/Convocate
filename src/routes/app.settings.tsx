import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Card, Field, Input } from "~/components/ui";
import type { OrganizerIdentity } from "~/lib/agreement";
import {
  connectPayoutsStartFn,
  connectPayoutsStatusFn,
  getOrganizerLogoInfoFn,
  getOrganizerProfileFn,
  getPayoutsCardFn,
  saveOrganizerProfileFn,
} from "~/server/api";

/**
 * `/app/settings` — the organizer's own details, saved once and printed on every
 * document they generate.
 *
 * What it is for: the generated agreement names the Organizer on its parties
 * line, gives an address for notices and has a signature block; the invitation
 * letter is signed by a person. All of that is the same on every conference the
 * organizer runs, so it is asked for once here instead of on each conference.
 *
 * The rules the page follows, matching `lib/agreement.ts`:
 *  - **Nothing is required.** Every box may stay empty, and an empty box prints a
 *    blank line to complete by hand — never a guess and never an email address
 *    standing in for a legal name.
 *  - **Only this account.** The save goes to the signed-in account; the server
 *    takes the account from the session, so there is no id on this page to get
 *    wrong or to forge.
 *  - **Honest feedback.** "Saved" is shown only after the server has written the
 *    row and read it back; a refused field is named on its own box.
 *
 * American English, neutral wording: nothing here assumes a denomination.
 */
/**
 * The two ways Stripe sends an organizer back to this page, and nothing else:
 *  - `?connect=return`  — they finished (or stopped part way through) Stripe's
 *                         own onboarding, so the page asks Stripe how it went;
 *  - `?connect=refresh` — the onboarding link expired, so the page offers a
 *                         fresh one instead of stranding them.
 * Any other value is ignored rather than trusted.
 */
type ConnectSearch = { connect?: "return" | "refresh" };

export const Route = createFileRoute("/app/settings")({
  validateSearch: (search: Record<string, unknown>): ConnectSearch => ({
    connect:
      search.connect === "return"
        ? "return"
        : search.connect === "refresh"
          ? "refresh"
          : undefined,
  }),
  loader: async () => ({
    profile: (await getOrganizerProfileFn()).profile,
    logo: (await getOrganizerLogoInfoFn()).logo,
    // The stored state of this account's Stripe connection — no call to Stripe.
    // `visible` is false for an account that does not run an event of its own
    // (a committee editor or viewer), and then the card is not rendered at all.
    payouts: await getPayoutsCardFn(),
  }),
  component: SettingsPage,
});

/** The eleven boxes, grouped exactly as they are printed on the document. */
type ProfileKey = keyof OrganizerIdentity;

const EMPTY_FORM: OrganizerIdentity = {
  legalName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateRegion: "",
  postalCode: "",
  country: "",
  signerName: "",
  signerTitle: "",
  noticesEmail: "",
  phone: "",
};

function SettingsPage() {
  const router = useRouter();
  const { profile, logo, payouts } = Route.useLoaderData();
  const { connect } = Route.useSearch();
  const [form, setForm] = useState<OrganizerIdentity>({ ...EMPTY_FORM, ...profile });
  const [saved, setSaved] = useState<OrganizerIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProfileKey, string>>>({});
  const [busy, setBusy] = useState(false);

  const set = (key: ProfileKey) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const result = await saveOrganizerProfileFn({ data: { profile: form } });
      if (!result.ok) {
        // The server names the field it refused, so the message lands on that
        // box instead of in a banner the reader has to match up by hand.
        const refused = result as { field?: ProfileKey; error?: string };
        if (refused.field) {
          setFieldErrors({ [refused.field]: refused.error ?? "That value was refused." });
        } else {
          setError(refused.error ?? "Your details could not be saved.");
        }
        return;
      }
      setForm({ ...EMPTY_FORM, ...result.profile });
      setSaved(result.profile);
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl text-ink">Your details</h1>
        <p className="mt-1 text-sm text-ink-soft">
          These print on the documents you generate — the agreement's parties line, its notices
          clause and its signature block, and the signature of an invitation letter. Fill in what
          you can; anything you leave empty prints as a blank line to complete by hand.
        </p>
      </div>

      <LogoCard initial={logo} />

      <PayoutsCard initial={payouts} connect={connect} />

      <form onSubmit={submit} className="space-y-6">
        <Card className="p-6">
          <h2 className="text-lg text-ink">Your organization</h2>
          <p className="mt-1 text-sm text-ink-soft">
            The body or organization running the conference or event, as it should appear on a
            contract.
          </p>
          <div className="mt-4 space-y-4">
            <Field
              label="Legal name"
              hint="The organization's own name, as it would sign a contract. Not an email address."
            >
              <Input
                value={form.legalName}
                onChange={set("legalName")}
                placeholder="Riverside Events Association"
                autoComplete="organization"
              />
              <FieldError message={fieldErrors.legalName} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Address line 1">
                <Input
                  value={form.addressLine1}
                  onChange={set("addressLine1")}
                  placeholder="1200 Riverside Avenue"
                  autoComplete="address-line1"
                />
                <FieldError message={fieldErrors.addressLine1} />
              </Field>
              <Field label="Address line 2" hint="Suite, floor or building — optional.">
                <Input
                  value={form.addressLine2}
                  onChange={set("addressLine2")}
                  placeholder="Suite 200"
                  autoComplete="address-line2"
                />
                <FieldError message={fieldErrors.addressLine2} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City">
                <Input
                  value={form.city}
                  onChange={set("city")}
                  placeholder="Springfield"
                  autoComplete="address-level2"
                />
                <FieldError message={fieldErrors.city} />
              </Field>
              <Field label="State or region">
                <Input
                  value={form.stateRegion}
                  onChange={set("stateRegion")}
                  placeholder="Illinois"
                  autoComplete="address-level1"
                />
                <FieldError message={fieldErrors.stateRegion} />
              </Field>
              <Field label="Postal code">
                <Input
                  value={form.postalCode}
                  onChange={set("postalCode")}
                  placeholder="62701"
                  autoComplete="postal-code"
                />
                <FieldError message={fieldErrors.postalCode} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Country">
                <Input
                  value={form.country}
                  onChange={set("country")}
                  placeholder="United States"
                  autoComplete="country-name"
                />
                <FieldError message={fieldErrors.country} />
              </Field>
              <Field label="Phone" hint="Optional — prints nowhere on the agreement today.">
                <Input
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder="(555) 010-1234"
                  autoComplete="tel"
                />
                <FieldError message={fieldErrors.phone} />
              </Field>
            </div>
            <Field
              label="Email for notices"
              hint="Where the other party sends formal notices under an agreement."
            >
              <Input
                type="email"
                value={form.noticesEmail}
                onChange={set("noticesEmail")}
                placeholder="contracts@riversideevents.org"
                autoComplete="email"
              />
              <FieldError message={fieldErrors.noticesEmail} />
            </Field>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg text-ink">Who signs</h2>
          <p className="mt-1 text-sm text-ink-soft">
            The person who signs an agreement or a letter on the organization's behalf. Leave the
            name empty and the documents use your account name instead.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Name of the person who signs">
              <Input
                value={form.signerName}
                onChange={set("signerName")}
                placeholder="Dana Whitfield"
                autoComplete="name"
              />
              <FieldError message={fieldErrors.signerName} />
            </Field>
            <Field label="Their role">
              <Input
                value={form.signerTitle}
                onChange={set("signerTitle")}
                placeholder="Conference director"
                autoComplete="organization-title"
              />
              <FieldError message={fieldErrors.signerTitle} />
            </Field>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save details"}
          </Button>
          {saved ? (
            <p className="text-sm text-emerald-800" role="status">
              Saved. Your details print on the agreement and the invitation letter you generate
              from now on.
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </form>

      <p className="text-xs text-ink-soft">
        Nothing is emailed from here, and these details are used only on the documents you generate
        in your own conferences.
      </p>
    </div>
  );
}

/** What the server says about this account's Stripe connection. */
type PayoutsState = {
  visible: boolean;
  configured: boolean;
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  last4: string | null;
};

/**
 * The Payouts card: the organizer connects their OWN Stripe account, once for
 * the whole account, so registration fees can be paid to them.
 *
 * Four honest states, and nothing in between:
 *
 *  1. **Convocate has no Stripe key** — the card says so plainly ("Payouts
 *     aren't available yet") and the button is disabled. It does not pretend a
 *     connection could be made.
 *  2. **Not connected** — what registration fees need, and a "Connect payouts"
 *     button that opens Stripe's own onboarding page.
 *  3. **Started but not finished** (`details_submitted` or `charges_enabled`
 *     still false) — "Finish setting up payouts". Stripe keeps whatever the
 *     organizer already entered, so this is a resume, not a restart.
 *  4. **Ready** — "Payouts are on", with a quiet "Update payout details" that
 *     mints a fresh onboarding link (bank details change; that is normal).
 *
 * The page never sees the account id, only its last four characters, and never
 * sees the Stripe key: everything here is decided on the server. The two return
 * parameters Stripe appends are handled on mount — `?connect=return` asks Stripe
 * how the account is doing ("Checking with Stripe…"), `?connect=refresh` says the
 * link expired and offers a fresh one.
 */
function PayoutsCard({ initial, connect }: { initial: PayoutsState; connect?: "return" | "refresh" }) {
  const [state, setState] = useState<PayoutsState>(initial);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connect === "refresh") {
      setNote("That link expired — here's a fresh one. Start again below and Stripe picks up where you left off.");
      return;
    }
    if (connect !== "return") return;
    let live = true;
    setChecking(true);
    void (async () => {
      try {
        const result = await connectPayoutsStatusFn();
        if (!live) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setState({
          visible: true,
          configured: result.configured,
          connected: result.connected,
          chargesEnabled: result.chargesEnabled,
          payoutsEnabled: result.payoutsEnabled,
          detailsSubmitted: result.detailsSubmitted,
          last4: result.last4,
        });
        if (!(result.chargesEnabled && result.payoutsEnabled)) {
          setNote(
            "Saved. Stripe has what you entered so far — some accounts finish their checks within a few minutes, so come back and check again shortly.",
          );
        }
      } catch {
        setError("Stripe could not be reached just now, so nothing was changed. Try again in a moment.");
      } finally {
        if (live) setChecking(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [connect]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await connectPayoutsStartFn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Stripe's own onboarding page. Everything typed there goes to Stripe,
      // not to Convocate — which is why no bank detail is asked for here.
      window.location.assign(result.url);
    } catch {
      setError("The connection to Stripe could not be started, so nothing was changed. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  // An account that does not run an event of its own (a committee editor or
  // viewer) has no payouts card: the server says `visible: false`.
  if (!state.visible) return null;

  const ready = state.connected && state.chargesEnabled && state.payoutsEnabled;
  const label = busy
    ? "Opening Stripe…"
    : ready
      ? "Update payout details"
      : state.connected
        ? "Finish setting up payouts"
        : "Connect payouts";

  return (
    <Card className="p-6">
      <h2 className="text-lg text-ink">Payouts</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Registration fees and donations are yours, not ours: they are paid into your own Stripe
        account and Convocate takes no share of them. Connect that account once here and every event
        you run pays into it.
      </p>

      {!state.configured ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-ink">
            Payouts aren&rsquo;t available yet — Convocate hasn&rsquo;t been connected to Stripe.
          </p>
          <Button type="button" disabled>
            Connect payouts
          </Button>
          <p className="text-xs text-ink-soft">
            Nothing for you to do. This card will offer the connection as soon as Convocate is
            connected to Stripe.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {checking ? (
            <p className="text-sm text-ink-soft" role="status">
              Checking with Stripe…
            </p>
          ) : null}
          <p className="text-sm text-ink">
            {ready
              ? "Payouts are on — registration fees go straight to your Stripe account."
              : state.connected
                ? "Stripe still needs a few details before registration fees can be collected."
                : "Registration fees can only be collected once you have connected a Stripe account."}
          </p>
          {state.last4 ? (
            <p className="text-xs text-ink-soft">Stripe account ending {state.last4}.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {ready ? (
              <Button type="button" variant="secondary" onClick={start} disabled={busy}>
                {label}
              </Button>
            ) : (
              <Button type="button" onClick={start} disabled={busy || checking}>
                {label}
              </Button>
            )}
          </div>
          <p className="text-xs text-ink-soft">
            Stripe collects your bank and tax details on its own page. Convocate never sees them.
          </p>
        </div>
      )}

      {note ? (
        <p className="mt-3 text-sm text-emerald-800" role="status">
          {note}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

/** What the server will say about the saved logo — never the bytes themselves. */
type LogoInfo = { mime: string; sizeBytes: number; updatedAt: number };

/**
 * The organization's logo: a preview of what is saved, a picker, and a Remove.
 *
 * The image itself is not carried in this page's data — it is fetched from
 * `/api/logo`, which answers only to the signed-in account and never to an id in
 * the address, so there is no link to this logo that anyone else could open. The
 * `?v=` is the row's own timestamp: it makes a replaced logo appear at once
 * instead of a cached copy of the old one.
 *
 * The file travels as the request body, not inside a JSON argument, because a
 * logo may be up to 1 MB and a JSON body that size does not survive the trip.
 * Every rule — PNG or JPEG from the magic bytes, 1 MB, nothing stored when it is
 * refused — is enforced by the server, so this page's own check is a courtesy.
 */
function LogoCard({ initial }: { initial: LogoInfo | null }) {
  const router = useRouter();
  const [info, setInfo] = useState<LogoInfo | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/logo", {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        mime?: string;
        sizeBytes?: number;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        setError(result.error || "That file was refused. Nothing was saved.");
        return;
      }
      setInfo({
        mime: result.mime ?? "image/png",
        sizeBytes: result.sizeBytes ?? file.size,
        updatedAt: Date.now(),
      });
      setNote("Saved. It now prints at the top of your agreement, invitation letter and contract sheets.");
      await router.invalidate();
    } catch {
      setError("The upload could not be completed. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/logo", { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        setError(result.error || "The logo could not be removed.");
        return;
      }
      setInfo(null);
      setNote("Removed. Your documents print as they did before a logo was saved.");
      await router.invalidate();
    } catch {
      setError("The logo could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-lg text-ink">Your logo</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Printed at the top of the agreement, the invitation letter and the contract sheets you
        generate, with your organization&rsquo;s legal name beside it. A PNG or a JPEG, up to 1 MB.
        Nothing is printed when you have not saved one.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex h-24 w-56 items-center justify-center rounded-lg border border-line bg-paper-deep p-2">
          {info ? (
            <img
              src={`/api/logo?v=${String(info.updatedAt)}`}
              alt="Your organization's saved logo"
              style={{ maxHeight: "80px", maxWidth: "208px", height: "auto", width: "auto" }}
            />
          ) : (
            <span className="text-xs text-ink-soft">No logo saved</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm ${
              busy ? "bg-brand/60" : "bg-brand hover:bg-brand/90"
            }`}
          >
            {busy ? "Working…" : info ? "Replace logo" : "Choose a file"}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              disabled={busy}
              onChange={upload}
            />
          </label>
          {info ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={remove}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {info ? (
        <p className="mt-2 text-xs text-ink-soft">
          Saved: {info.mime === "image/jpeg" ? "JPEG" : "PNG"}, {Math.max(1, Math.round(info.sizeBytes / 1024))} KB.
        </p>
      ) : null}
      {note ? (
        <p className="mt-2 text-sm text-emerald-800" role="status">
          {note}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="block text-xs text-red-700">{message}</span>;
}
