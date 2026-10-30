import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Button, Card, EmptyState, Field, Input, Select, Textarea } from "~/components/ui";
import { SectionHead } from "~/components/app-ui";
import {
  HIDDEN_MONEY,
  HIDDEN_MONEY_NOTE,
  formatMoneyOrHidden,
  parseMoneyInput,
  toUnitsInput,
} from "~/lib/money";
import { REGISTRATION_LOCKED_HINT, REGISTRATION_NO_PAYMENTS_NOTE } from "~/lib/plan";
import {
  attendeePaymentLabel,
  type Attendee,
  type RegistrationSettings,
  type TicketType, isAttendeePaid } from "~/lib/types";
import type { MemberRole } from "~/server/db.server";
import {
  addAttendeeFn,
  deleteAttendeeFn,
  deleteTicketTypeFn,
  getAttendeesCsvFn,
  saveRegistrationSettingsFn,
  saveTicketTypeFn,
  setAttendeePaidFn,
} from "~/server/api";
import { describeRefusal } from "~/lib/refusal";

/** What the registration reads look like once the server has shaped them. */
export type RegistrationView = {
  role: MemberRole;
  sample: boolean;
  canEdit: boolean;
  settings: RegistrationSettings;
  /** `/register/<token>` — the link an organizer sends to attendees. */
  publicPath: string | null;
  ticketTypes: TicketType[];
  attendees: Attendee[];
  totals: {
    headcount: number;
    attendeeCount: number;
    placesRemaining: number | null;
    totalDueCents: number | null;
    paidCents: number | null;
    unpaidCents: number | null;
    paidCount: number;
    unpaidCount: number;
  };
};

/**
 * Turn the server's `/register/<token>` into the full address the organizer should
 * copy, using whatever origin the browser is on. It starts as the path so the
 * first render (on the server too) cannot disagree with the browser's, then is
 * replaced once mounted.
 */
function useBrowserOrigin(path: string, setUrl: (url: string) => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    setUrl(`${window.location.origin}${path}`);
  }, [path, setUrl]);
}

/** A refusal thrown by a server function, as a sentence. */
const refusalMessage = async (cause: unknown): Promise<string> => (await describeRefusal(cause)).message;

const registeredOn = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Event registration — the workspace side (phase A).
 *
 * An organizer switches registration on, sets a cap, writes the words an attendee
 * will read, offers ticket types, and records who is coming. Nothing here takes
 * a card: a fee is either unpaid or marked paid by hand, because the organizer took
 * cash or a check. The server refuses every one of these writes for a Viewer, on
 * a locked conference, and on the read-only example — this section only declines
 * to offer a control that could not work.
 */
export function RegistrationSection({
  conferenceId,
  registration,
  locked,
  sample,
}: {
  conferenceId: number;
  /** `null` when the server refused the read (a locked conference does). */
  registration: RegistrationView | null;
  locked: boolean;
  sample: boolean;
}) {
  if (locked || !registration) {
    return (
      <section id="registration" className="scroll-mt-32 space-y-4">
        <SectionHead
          title="Registration"
          lede="Take registrations for the conference and keep the attendee list here."
        />
        <EmptyState
          title={locked ? "Event registration comes with the unlock" : "Registration is not available here"}
          body={locked ? REGISTRATION_LOCKED_HINT : REGISTRATION_NO_PAYMENTS_NOTE}
          action={
            locked ? (
              <span className="text-sm text-ink-soft">
                Use the unlock panel at the top of this page.
              </span>
            ) : undefined
          }
        />
      </section>
    );
  }

  const { ticketTypes, attendees, settings, totals, canEdit, role } = registration;
  const moneyHidden = role === "viewer" && !sample;
  const activeTickets = ticketTypes.filter((ticket) => ticket.active);
  const ticketName = (id: number | null): string =>
    ticketTypes.find((ticket) => ticket.id === id)?.name || "—";

  return (
    <section id="registration" className="scroll-mt-32 space-y-6">
      <SectionHead
        title="Registration"
        lede={<>Who is coming, on which ticket, and what they owe. {REGISTRATION_NO_PAYMENTS_NOTE}</>}
        actions={<CsvButton conferenceId={conferenceId} disabled={attendees.length === 0} />}
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Registered</p>
          <p className="mt-1 font-serif text-2xl text-ink">
            {totals.headcount}
            <span className="ml-1 text-sm font-normal text-ink-soft">
              place{totals.headcount === 1 ? "" : "s"}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {totals.attendeeCount} registration{totals.attendeeCount === 1 ? "" : "s"} on the list
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Places left</p>
          <p className="mt-1 font-serif text-2xl text-ink">
            {totals.placesRemaining === null ? "No cap" : totals.placesRemaining}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {settings.capacity > 0 ? `Capped at ${String(settings.capacity)} places` : "Set a cap below if the hall has one"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Total due</p>
          <p className="mt-1 font-serif text-2xl text-ink">{formatMoneyOrHidden(totals.totalDueCents)}</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {totals.totalDueCents === null ? HIDDEN_MONEY_NOTE : "Every registration's amount, added up"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Paid by hand</p>
          <p className="mt-1 font-serif text-2xl text-ink">{formatMoneyOrHidden(totals.paidCents)}</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {totals.paidCents === null
              ? HIDDEN_MONEY_NOTE
              : `${String(totals.unpaidCount)} place${totals.unpaidCount === 1 ? "" : "s"} still to pay`}
          </p>
        </Card>
      </section>

      <SettingsPanel
        conferenceId={conferenceId}
        settings={settings}
        publicPath={registration.publicPath}
        canEdit={canEdit}
        sample={sample}
      />

      <TicketTypesPanel
        conferenceId={conferenceId}
        ticketTypes={ticketTypes}
        canEdit={canEdit}
        sample={sample}
      />

      <AttendeesPanel
        conferenceId={conferenceId}
        attendees={attendees}
        ticketTypes={activeTickets}
        ticketName={ticketName}
        canEdit={canEdit}
        sample={sample}
        moneyHidden={moneyHidden}
        totalDueCents={totals.totalDueCents}
        placesRemaining={totals.placesRemaining}
        hasTickets={ticketTypes.length > 0}
      />
    </section>
  );
}

/** The switch, the cap and the organizer's own words for attendees. */
function SettingsPanel({
  conferenceId,
  settings,
  publicPath,
  canEdit,
  sample,
}: {
  conferenceId: number;
  settings: RegistrationSettings;
  publicPath: string | null;
  canEdit: boolean;
  sample: boolean;
}) {
  const router = useRouter();
  const [capacity, setCapacity] = useState(settings.capacity > 0 ? String(settings.capacity) : "");
  const [instructions, setInstructions] = useState(settings.instructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (next: { isOpen: boolean; capacity: string; instructions: string }) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await saveRegistrationSettingsFn({
        data: {
          conferenceId,
          isOpen: next.isOpen,
          capacity: next.capacity,
          instructions: next.instructions,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The whole section comes from the loader, so one invalidation refreshes
      // the switch, the counts and the list together — never a stale panel.
      await router.invalidate();
      setSaved(true);
    } catch (cause) {
      setError(await refusalMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Registration settings
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            {settings.isOpen
              ? "Registration is open — anyone with the link below can register."
              : "Registration is closed — the link below tells anyone who opens it that registration is closed."}{" "}
            Nothing is charged online: a registration records who is coming and what they owe.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line text-brand focus:ring-2 focus:ring-brand/20"
            checked={settings.isOpen}
            disabled={!canEdit || busy || sample}
            onChange={(event) => {
              void save({ isOpen: event.target.checked, capacity, instructions });
            }}
          />
          <span>Open registration</span>
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field
          label="Capacity"
          hint="Leave blank for no cap. Places are counted across every ticket."
          className="sm:col-span-1"
        >
          <Input
            inputMode="numeric"
            placeholder="No cap"
            value={capacity}
            disabled={!canEdit || sample}
            onChange={(event) => {
              setCapacity(event.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <Field
          label="Instructions for attendees"
          hint="What to tell someone registering — where to park, what to bring, who to ask."
          className="sm:col-span-2"
        >
          <Textarea
            rows={3}
            placeholder="Doors open at 8:30am. Bring your own lunch; coffee is provided."
            value={instructions}
            disabled={!canEdit || sample}
            onChange={(event) => {
              setInstructions(event.target.value);
              setSaved(false);
            }}
          />
        </Field>
      </div>

      {publicPath ? <PublicLink publicPath={publicPath} isOpen={settings.isOpen} /> : null}

      {canEdit && !sample ? (
        <div className="mt-4 flex items-center justify-end gap-3">
          {saved ? <span className="text-xs text-ink-soft">Saved.</span> : null}
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              void save({ isOpen: settings.isOpen, capacity, instructions });
            }}
          >
            {busy ? "Saving…" : "Save settings"}
          </Button>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-[#8A2F22]">{error}</p> : null}
    </Card>
  );
}

/**
 * The link an organizer sends to attendees.
 *
 * The path comes from the server (`/register/<token>`, unguessable, generated
 * once); the origin is read from the browser so the copied link is whatever
 * address the organizer is using — the domain once it is attached, and the
 * site's own address before that. The link is shown to a Viewer as well: it is
 * not money, and a committee greets attendees too. Only opening and closing
 * registration is the owner's, above.
 */
function PublicLink({ publicPath, isOpen }: { publicPath: string; isOpen: boolean }) {
  const [url, setUrl] = useState(publicPath);
  const [copied, setCopied] = useState(false);
  useBrowserOrigin(publicPath, setUrl);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard still has the text selected for a
      // plain copy, so say what to do rather than pretending it worked.
      setCopied(false);
    }
  };
  return (
    <div className="mt-4 rounded-lg border border-line bg-paper-deep/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Public registration link
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        Share this link with attendees — they don&rsquo;t need an account.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          readOnly
          value={url}
          aria-label="Public registration link"
          className="min-w-[16rem] flex-1 font-mono text-xs"
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
        <Button type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      {isOpen ? null : (
        <p className="mt-2 text-xs text-ink-soft">
          Registration is closed at the moment, so anyone opening the link sees that it is closed.
          The link itself stays the same.
        </p>
      )}
    </div>
  );
}

/** Ticket types: the things someone can register on. */
function TicketTypesPanel({
  conferenceId,
  ticketTypes,
  canEdit,
  sample,
}: {
  conferenceId: number;
  ticketTypes: TicketType[];
  canEdit: boolean;
  sample: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (ticketTypeId: number) => {
    setError(null);
    try {
      const result = await deleteTicketTypeFn({ data: { ticketTypeId } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await router.invalidate();
    } catch (cause) {
      setError(await refusalMessage(cause));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Ticket types
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            One line per kind of place — general, concession, a table for a group.
          </p>
        </div>
        {canEdit && !showForm ? (
          <Button
            type="button"
            onClick={() => {
              setEditingId(null);
              setShowForm(true);
            }}
          >
            Add ticket type
          </Button>
        ) : null}
      </div>

      {showForm && canEdit ? (
        <TicketTypeForm
          conferenceId={conferenceId}
          onCancel={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false);
            await router.invalidate();
          }}
        />
      ) : null}

      {ticketTypes.length === 0 ? (
        <EmptyState
          title="No ticket types yet"
          body={
            canEdit
              ? "Add one to start registering people — “General”, at whatever a place costs, is the usual first line. Leave the limit blank for no limit."
              : "The owner has not set up ticket types on this conference yet."
          }
          action={
            canEdit && !showForm ? (
              <Button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setShowForm(true);
                }}
              >
                Add first ticket type
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper-deep/70 text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Ticket</th>
                <th className="px-4 py-2.5 text-right font-semibold">Price</th>
                <th className="px-4 py-2.5 text-right font-semibold">Limit</th>
                <th className="px-4 py-2.5 text-right font-semibold">Taken</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {ticketTypes.map((ticket) =>
                editingId === ticket.id && canEdit ? (
                  <tr key={ticket.id} className="bg-paper-deep/30">
                    <td colSpan={5} className="p-0">
                      <TicketTypeForm
                        conferenceId={conferenceId}
                        ticket={ticket}
                        onCancel={() => setEditingId(null)}
                        onSaved={async () => {
                          setEditingId(null);
                          await router.invalidate();
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={ticket.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{ticket.name}</p>
                      {ticket.active ? null : (
                        <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          Switched off
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">
                      {formatMoneyOrHidden(ticket.priceCents)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-soft">
                      {ticket.quantityLimit > 0 ? ticket.quantityLimit : "No limit"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">
                      {ticket.registered}
                      {ticket.quantityLimit > 0 ? (
                        <span className="text-xs text-ink-soft"> / {ticket.quantityLimit}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canEdit ? (
                        <>
                          <Button type="button" variant="ghost" onClick={() => setEditingId(ticket.id)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => {
                              void remove(ticket.id);
                            }}
                          >
                            Delete
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-ink-soft">—</span>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </Card>
      )}
      {sample ? (
        <p className="text-xs text-ink-soft">
          The example conference takes no changes, so its registration stays empty.
        </p>
      ) : null}
      {error ? <p className="text-sm text-[#8A2F22]">{error}</p> : null}
    </div>
  );
}

function TicketTypeForm({
  conferenceId,
  ticket,
  onSaved,
  onCancel,
}: {
  conferenceId: number;
  ticket?: TicketType;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    name: ticket?.name ?? "",
    price: ticket ? toUnitsInput(ticket.priceCents) : "",
    limit: ticket && ticket.quantityLimit > 0 ? String(ticket.quantityLimit) : "",
    active: ticket?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    if (!values.name.trim()) {
      setError("Give this ticket a name.");
      setBusy(false);
      return;
    }
    const price = parseMoneyInput(values.price);
    if ("error" in price) {
      setError(price.error);
      setBusy(false);
      return;
    }
    if (values.limit.trim() !== "" && !/^\d+$/.test(values.limit.trim())) {
      setError("Enter the limit as a whole number of places, or leave it blank for no limit.");
      setBusy(false);
      return;
    }
    try {
      const result = await saveTicketTypeFn({
        data: {
          conferenceId,
          ticketTypeId: ticket?.id ?? 0,
          name: values.name,
          priceCents: price.cents,
          quantityLimit: values.limit.trim() === "" ? 0 : Number(values.limit.trim()),
          active: values.active,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await onSaved();
    } catch (cause) {
      setError(await refusalMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className={
        ticket
          ? "grid gap-3 p-4 sm:grid-cols-5 sm:items-end"
          : "rounded-xl border border-line bg-white p-5 shadow-sm"
      }
    >
      <div className={ticket ? "contents" : "grid gap-4 sm:grid-cols-2"}>
        <Field label="Ticket name" className={ticket ? "sm:col-span-2" : ""}>
          <Input
            required
            value={values.name}
            placeholder="General"
            onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
          />
        </Field>
        <Field label="Price per place">
          <Input
            inputMode="decimal"
            value={values.price}
            placeholder="75"
            onChange={(event) => setValues((prev) => ({ ...prev, price: event.target.value }))}
          />
        </Field>
        <Field label="Limit" hint="Blank = no limit">
          <Input
            inputMode="numeric"
            value={values.limit}
            placeholder="No limit"
            onChange={(event) => setValues((prev) => ({ ...prev, limit: event.target.value }))}
          />
        </Field>
        {ticket ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line text-brand focus:ring-2 focus:ring-brand/20"
              checked={values.active}
              onChange={(event) => setValues((prev) => ({ ...prev, active: event.target.checked }))}
            />
            <span>On offer</span>
          </label>
        ) : null}
      </div>
      <div className={`flex gap-2 ${ticket ? "sm:col-span-5 sm:justify-end" : "mt-4 justify-end"}`}>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : ticket ? "Save ticket" : "Add ticket"}
        </Button>
      </div>
      {error ? <p className="text-sm text-[#8A2F22] sm:col-span-5">{error}</p> : null}
    </form>
  );
}

/** The attendee list, and the form for adding a registration by hand. */
function AttendeesPanel({
  conferenceId,
  attendees,
  ticketTypes,
  ticketName,
  canEdit,
  sample,
  moneyHidden,
  totalDueCents,
  placesRemaining,
  hasTickets,
}: {
  conferenceId: number;
  attendees: Attendee[];
  ticketTypes: TicketType[];
  ticketName: (id: number | null) => string;
  canEdit: boolean;
  sample: boolean;
  moneyHidden: boolean;
  totalDueCents: number | null;
  placesRemaining: number | null;
  hasTickets: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setPaid = async (attendeeId: number, paid: boolean) => {
    setBusyId(attendeeId);
    setError(null);
    try {
      // A refusal here throws (403 with a readable body), so there is no
      // `{ ok: false }` to check — `describeRefusal` turns the throw into words.
      await setAttendeePaidFn({
        data: { attendeeId, paid, note: paid ? "cash or check" : "" },
      });
      await router.invalidate();
    } catch (cause) {
      setError(await refusalMessage(cause));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (attendeeId: number) => {
    setBusyId(attendeeId);
    setError(null);
    try {
      await deleteAttendeeFn({ data: { attendeeId } });
      await router.invalidate();
    } catch (cause) {
      setError(await refusalMessage(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Attendees</h3>
          <p className="mt-1 text-sm text-ink-soft">
            Everyone registered, added here by hand — a walk-up at the desk, or a registration taken
            by phone or on paper.
          </p>
        </div>
        {canEdit && !showForm ? (
          <Button
            type="button"
            onClick={() => setShowForm(true)}
            disabled={!hasTickets}
            title={hasTickets ? undefined : "Add a ticket type first."}
          >
            Add registration
          </Button>
        ) : null}
      </div>

      {showForm && canEdit ? (
        <AttendeeForm
          conferenceId={conferenceId}
          ticketTypes={ticketTypes}
          placesRemaining={placesRemaining}
          onCancel={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false);
            await router.invalidate();
          }}
        />
      ) : null}

      {attendees.length === 0 ? (
        <EmptyState
          title="Nobody registered yet"
          body={
            hasTickets
              ? "Add the first registration — name, ticket and how many places. The amount due is the ticket's price times the places, kept on the row so a later price change does not rewrite it."
              : "Add a ticket type first: it is what a registration is for, and it sets the amount due."
          }
          action={
            canEdit && hasTickets && !showForm ? (
              <Button type="button" onClick={() => setShowForm(true)}>
                Add first registration
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper-deep/70 text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Ticket</th>
                <th className="px-4 py-2.5 text-right font-semibold">Places</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount due</th>
                <th className="px-4 py-2.5 font-semibold">Paid</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {attendees.map((attendee) => (
                <tr key={attendee.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{attendee.name}</p>
                    {attendee.email ? (
                      <p className="mt-0.5 text-xs text-ink-soft">{attendee.email}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {registeredOn(attendee.registeredAt)}
                      {attendee.source === "public" ? " · from the registration page" : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-ink">{ticketName(attendee.ticketTypeId)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{attendee.quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">
                    {formatMoneyOrHidden(attendee.amountDueCents)}
                  </td>
                  <td className="px-4 py-3">
                    {isAttendeePaid(attendee.paymentStatus) ? (
                      <span className="rounded-full bg-sage/15 px-2 py-0.5 text-xs font-medium text-sage-ink ring-1 ring-sage/40">
                        {attendeePaymentLabel(attendee.paymentStatus)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-terracotta/[0.08] px-2 py-0.5 text-xs font-medium text-terracotta-ink ring-1 ring-terracotta/40">
                        {attendeePaymentLabel(attendee.paymentStatus)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canEdit ? (
                      <>
                        {isAttendeePaid(attendee.paymentStatus) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={busyId === attendee.id}
                            onClick={() => {
                              void setPaid(attendee.id, false);
                            }}
                          >
                            Undo
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={busyId === attendee.id}
                            onClick={() => {
                              void setPaid(attendee.id, true);
                            }}
                          >
                            Mark paid
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="danger"
                          disabled={busyId === attendee.id}
                          onClick={() => {
                            void remove(attendee.id);
                          }}
                        >
                          Delete
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-ink-soft">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-paper-deep/40 text-xs text-ink-soft">
              <tr>
                <td className="px-4 py-2.5 font-medium text-ink" colSpan={2}>
                  {attendees.length} registration{attendees.length === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {attendees.reduce((sum, attendee) => sum + attendee.quantity, 0)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {moneyHidden ? HIDDEN_MONEY : formatMoneyOrHidden(totalDueCents)}
                </td>
                <td className="px-4 py-2.5" colSpan={2}>
                  {moneyHidden ? HIDDEN_MONEY_NOTE : "Total due across every registration"}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
      {error ? <p className="text-sm text-[#8A2F22]">{error}</p> : null}
      {sample ? (
        <p className="text-xs text-ink-soft">
          The example conference takes no changes, so nothing can be added to its attendee list.
        </p>
      ) : null}
    </div>
  );
}

function AttendeeForm({
  conferenceId,
  ticketTypes,
  placesRemaining,
  onSaved,
  onCancel,
}: {
  conferenceId: number;
  ticketTypes: TicketType[];
  placesRemaining: number | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    name: "",
    email: "",
    ticketTypeId: ticketTypes[0] ? String(ticketTypes[0].id) : "",
    quantity: "1",
    paidByHand: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = ticketTypes.find((ticket) => String(ticket.id) === values.ticketTypeId);
  const price = selected?.priceCents ?? null;
  const places = /^\d+$/.test(values.quantity) ? Number(values.quantity) : 0;
  const projected = price === null || places < 1 ? null : price * places;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    if (!values.name.trim()) {
      setError("Add the name of the person registering.");
      setBusy(false);
      return;
    }
    try {
      const result = await addAttendeeFn({
        data: {
          conferenceId,
          ticketTypeId: Number(values.ticketTypeId),
          name: values.name,
          email: values.email,
          quantity: values.quantity,
          paidByHand: values.paidByHand,
          paidNote: values.paidByHand ? "cash or check" : "",
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await onSaved();
    } catch (cause) {
      setError(await refusalMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Name" className="sm:col-span-2">
          <Input
            required
            value={values.name}
            placeholder="Ada Okonkwo"
            onChange={(event) => setValues((prev) => ({ ...prev, name: event.target.value }))}
          />
        </Field>
        <Field label="Email" hint="Optional">
          <Input
            type="email"
            value={values.email}
            placeholder="ada@example.org"
            onChange={(event) => setValues((prev) => ({ ...prev, email: event.target.value }))}
          />
        </Field>
        <Field label="Places" hint={placesRemaining === null ? undefined : `${String(placesRemaining)} left`}>
          <Input
            inputMode="numeric"
            value={values.quantity}
            onChange={(event) => setValues((prev) => ({ ...prev, quantity: event.target.value }))}
          />
        </Field>
        <Field label="Ticket" className="sm:col-span-2">
          <Select
            value={values.ticketTypeId}
            onChange={(event) => setValues((prev) => ({ ...prev, ticketTypeId: event.target.value }))}
          >
            {ticketTypes.map((ticket) => (
              <option key={ticket.id} value={String(ticket.id)}>
                {ticket.name}
                {ticket.priceCents === null
                  ? ""
                  : ` — ${formatMoneyOrHidden(ticket.priceCents)}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount due" hint="The ticket's price times the places">
          <p className="pt-2 text-sm font-medium text-ink">{formatMoneyOrHidden(projected)}</p>
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line text-brand focus:ring-2 focus:ring-brand/20"
            checked={values.paidByHand}
            onChange={(event) => setValues((prev) => ({ ...prev, paidByHand: event.target.checked }))}
          />
          <span>Already paid by hand</span>
        </label>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add registration"}
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-[#8A2F22]">{error}</p> : null}
    </form>
  );
}

/**
 * The attendee list as a CSV file. The server builds it and decides what may be
 * in it: a Viewer's download has no money columns at all, a signed-out caller is
 * refused, and a locked conference is refused.
 */
function CsvButton({ conferenceId, disabled }: { conferenceId: number; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await getAttendeesCsvFn({ data: { conferenceId } });
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNote(
        `Downloaded ${String(result.rowCount)} registration${result.rowCount === 1 ? "" : "s"}${
          result.moneyIncluded ? "" : ", with no money columns"
        }.`,
      );
    } catch (cause) {
      setError(await refusalMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-right">
      <Button
        type="button"
        variant="secondary"
        disabled={busy || disabled}
        title={disabled ? "Nobody is registered yet." : undefined}
        onClick={() => {
          void download();
        }}
      >
        {busy ? "Preparing…" : "Export attendees (CSV)"}
      </Button>
      {note ? <p className="mt-1 text-xs text-ink-soft">{note}</p> : null}
      {error ? <p className="mt-1 max-w-xs text-xs text-[#8A2F22]">{error}</p> : null}
    </div>
  );
}
