import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Button, Card, Field, Select } from "~/components/ui";
import { formatDate } from "~/lib/money";
import { LOCKED_CONTROL_HINT, SAMPLE_COMMITTEE_NOTE, UPGRADE_PRICE } from "~/lib/plan";
import type { ConferenceInvite, ConferenceMember, InviteRole, MemberRole } from "~/server/db.server";
import {
  createInviteFn,
  leaveConferenceFn,
  removeMemberFn,
  revokeInviteFn,
  setMemberRoleFn,
} from "~/server/api";

const roleLabel = (role: MemberRole | InviteRole): string =>
  role === "owner" ? "Owner" : role === "editor" ? "Editor" : "Viewer";

const roleTone: Record<MemberRole, string> = {
  owner: "bg-brand-soft text-brand ring-1 ring-brand/20",
  editor: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  viewer: "bg-slate-100 text-slate-700 ring-1 ring-line",
};

const roleHelp: Record<MemberRole | InviteRole, string> = {
  owner: "Everything, including invites and removing people",
  editor: "Build the budget and work the contracts board",
  viewer: "Read only — cannot change anything",
};

const epochToIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function PeopleSection({
  conferenceId,
  role,
  members,
  invites,
  currentUserId,
  locked,
  sample,
}: {
  conferenceId: number;
  role: MemberRole;
  members: ConferenceMember[];
  invites: ConferenceInvite[];
  currentUserId: number;
  locked?: boolean;
  /** The shared read-only example: committee access is not part of it. */
  sample?: boolean;
}) {
  if (sample) {
    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-xl text-ink">People with access</h2>
        </div>
        <Card className="p-4">
          <p className="text-sm text-ink">{SAMPLE_COMMITTEE_NOTE}</p>
        </Card>
      </section>
    );
  }
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl text-ink">People with access</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          A conference is run by a committee. The owner can invite people by link and decide
          whether each of them can edit or only read.
        </p>
      </div>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-line/70">
          {members.map((member) => (
            <MemberRow
              key={member.userId}
              conferenceId={conferenceId}
              member={member}
              canManage={role === "owner"}
              isSelf={member.userId === currentUserId}
            />
          ))}
        </ul>
      </Card>

      {role === "owner" ? (
        locked ? (
          <Card className="p-4">
            <p className="text-sm text-ink">
              <span className="font-medium">Inviting your committee is part of the {UPGRADE_PRICE} upgrade.</span>{" "}
              On the free plan this conference is yours alone — no Editor or Viewer links can be
              created. Unlock the conference for {UPGRADE_PRICE} at the top of this page and
              inviting your committee opens with it.
            </p>
            <div className="mt-3">
              <Button disabled title={LOCKED_CONTROL_HINT}>
                Create an invite link
              </Button>
            </div>
          </Card>
        ) : (
          <InvitePanel conferenceId={conferenceId} invites={invites} />
        )
      ) : (
        <LeavePanel conferenceId={conferenceId} />
      )}
    </section>
  );
}

function MemberRow({
  conferenceId,
  member,
  canManage,
  isSelf,
}: {
  conferenceId: number;
  member: ConferenceMember;
  canManage: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeRole = async (next: InviteRole) => {
    setBusy(true);
    setError(null);
    try {
      const result = await setMemberRoleFn({
        data: { conferenceId, userId: member.userId, role: next },
      });
      if (!result.ok) setError(result.error || "That role change was not saved.");
      else await router.invalidate();
    } catch (cause) {
      setError("Could not change that role — the request did not reach Convocate. Try again.");
      console.error("setMemberRoleFn", cause);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await removeMemberFn({ data: { conferenceId, userId: member.userId } });
      if (!result.ok) setError(result.error || "That person was not removed.");
      else await router.invalidate();
    } catch (cause) {
      setError("Could not remove that person — the request did not reach Convocate. Try again.");
      console.error("removeMemberFn", cause);
    } finally {
      setBusy(false);
    }
  };

  const isOwner = member.role === "owner";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">
          {member.name || member.email}
          {isSelf ? <span className="ml-1.5 text-xs text-ink-soft">(you)</span> : null}
        </p>
        <p className="truncate text-xs text-ink-soft">{member.email}</p>
        {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${roleTone[member.role]}`}
          title={roleHelp[member.role]}
        >
          {roleLabel(member.role)}
        </span>
        {canManage && !isOwner ? (
          <>
            <Select
              className="w-32 py-1 text-xs"
              value={member.role}
              disabled={busy}
              onChange={(e) => changeRole(e.target.value as InviteRole)}
              aria-label={`Role for ${member.email}`}
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </Select>
            <Button
              variant="danger"
              className="px-2 py-1 text-xs"
              disabled={busy}
              onClick={remove}
              title="Remove this person from the conference"
            >
              Remove
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function LeavePanel({ conferenceId }: { conferenceId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await leaveConferenceFn({ data: { conferenceId } });
      if (!result.ok) {
        setError(result.error || "You could not be removed from this conference.");
        return;
      }
      await router.invalidate();
      await router.navigate({ to: "/app" });
    } catch (cause) {
      setError("Could not leave this conference — the request did not reach Convocate. Try again.");
      console.error("leaveConferenceFn", cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="text-sm text-ink-soft">
          You were invited to this conference. You can take yourself off the list at any time.
        </p>
        {error ? <p className="mt-1 text-sm text-red-700">{error}</p> : null}
      </div>
      <Button variant="secondary" disabled={busy} onClick={leave}>
        Leave this conference
      </Button>
    </Card>
  );
}

function InvitePanel({
  conferenceId,
  invites,
}: {
  conferenceId: number;
  invites: ConferenceInvite[];
}) {
  const router = useRouter();
  const [role, setRole] = useState<InviteRole>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ token: string; role: InviteRole } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const linkFor = (token: string) => `${origin}/invite/${token}`;

  const copy = async (token: string) => {
    const url = linkFor(token);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API needs a secure context; fall back to a hidden textarea.
      const area = document.createElement("textarea");
      area.value = url;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(token);
    window.setTimeout(() => setCopied((current) => (current === token ? null : current)), 2000);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createInviteFn({ data: { conferenceId, role } });
      if (result.ok) {
        setFresh({ token: result.token, role: result.role });
        setNotice(
          `${roleLabel(result.role)} invite link created. It is listed below and works until you revoke it.`,
        );
        await router.invalidate();
      } else {
        setError(result.error || "Could not create the invite link. Nothing was saved.");
      }
    } catch (cause) {
      setError(
        "Could not create the invite link — the request did not reach Convocate. Check your connection and try again.",
      );
      console.error("createInviteFn", cause);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await revokeInviteFn({ data: { token } });
      if (result.ok) {
        setFresh((current) => (current?.token === token ? null : current));
        setNotice("Link revoked. Anyone opening it now is told it is no longer valid.");
        await router.invalidate();
      } else {
        setError(result.error || "Could not revoke that link.");
      }
    } catch (cause) {
      setError("Could not revoke that link — the request did not reach Convocate. Try again.");
      console.error("revokeInviteFn", cause);
    } finally {
      setBusy(false);
    }
  };

  const active = invites.filter((invite) => invite.revokedAt === null && invite.expiresAt > Date.now());
  const past = invites.filter((invite) => invite.revokedAt !== null || invite.expiresAt <= Date.now());

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-ink">Invite someone</h3>
      <p className="mt-1 text-sm text-ink-soft">
        Creates a link you send yourself — Convocate cannot send email yet. Anyone who opens it
        joins this conference at the role you pick. The link keeps working until you revoke it or
        it expires after 30 days, and it only ever opens <em>this</em> conference.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Field label="Role this link grants">
          <Select
            className="w-48"
            value={role}
            onChange={(e) => setRole(e.target.value as InviteRole)}
          >
            <option value="editor">Editor — can make changes</option>
            <option value="viewer">Viewer — read only</option>
          </Select>
        </Field>
        <Button onClick={create} disabled={busy}>
          {busy ? "Working…" : "Create invite link"}
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {notice ? (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          {notice}
        </p>
      ) : null}

      {fresh ? (
        <div className="mt-4 rounded-lg border border-brand/30 bg-brand-soft/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            New {roleLabel(fresh.role).toLowerCase()} link
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={origin ? linkFor(fresh.token) : "…"}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 font-mono text-xs text-ink"
              aria-label="Invite link"
            />
            <Button variant="secondary" onClick={() => copy(fresh.token)}>
              {copied === fresh.token ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Send it by hand — email, message, or printed on the committee notes. Keep it private:
            anyone with the link can join as {roleLabel(fresh.role).toLowerCase()}.
          </p>
        </div>
      ) : null}

      <div className="mt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Outstanding invites ({active.length})
        </h4>
        {active.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">No invite links are active right now.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line/70">
            {active.map((invite) => (
              <li key={invite.token} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    {roleLabel(invite.role)} link{" "}
                    <span className="text-xs text-ink-soft">
                      · created {formatDate(epochToIso(invite.createdAt))} · expires{" "}
                      {formatDate(epochToIso(invite.expiresAt))} · used {invite.uses}×
                    </span>
                  </p>
                  <p className="truncate font-mono text-[11px] text-ink-soft">
                    {origin ? linkFor(invite.token) : invite.token}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => copy(invite.token)}
                  >
                    {copied === invite.token ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    variant="danger"
                    className="px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() => revoke(invite.token)}
                  >
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {past.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Expired or revoked links ({past.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-ink-soft">
            {past.map((invite) => (
              <li key={invite.token}>
                {roleLabel(invite.role)} ·{" "}
                {invite.revokedAt !== null
                  ? `revoked ${formatDate(epochToIso(invite.revokedAt))}`
                  : `expired ${formatDate(epochToIso(invite.expiresAt))}`}{" "}
                · used {invite.uses}× · no longer works
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
