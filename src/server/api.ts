import { createServerFn } from "@tanstack/react-start";
import {
  acceptInvite,
  canCreateConference,
  conferenceIdForAttendee,
  conferenceIdForTicketType,
  deleteAttendee,
  deleteTicketType,
  ensurePublicRegistrationToken,
  confirmAttendeeCardPaid,
  getAttendeePaymentTarget,
  getPublicRegistrationPage,
  getPayoutAccount,
  getRegistrationSettings,
  insertAttendee,
  insertPublicAttendee,
  listAttendees,
  listTicketTypes,
  registrationHeadcount,
  saveRegistrationSettings,
  sampleConferenceForAnyone,
  saveTicketType,
  setAttendeePaid,
  startAttendeeCardPayment,
  canEditRole,
  conferenceEntitlement,
  conferenceIdForBudgetItem,
  conferenceIdForContract,
  conferenceUploadBytes,
  confirmPaymentForConference,
  contractDocumentOwner,
  createInvite,
  deleteBudgetItem,
  deleteConference,
  deleteContract,
  deleteContractDocument,
  extensionForMime,
  findInvite,
  findLeadSignupByToken,
  findUserByEmail,
  createSignatureRequest,
  getAgreementTerms,
  getConference,
  getContractSignature,
  getSignaturePage,
  latestSignatureRequest,
  recordSignatureAcceptance,
  revokeSignatureRequest,
  signatureAgreementVersion,
  getConferenceName,
  getOrganizerProfile,
  getOrganizerLogo,
  insertBudgetItem,
  insertConference,
  insertContract,
  isConferenceUnlocked,
  isSampleConference,
  ownsAnyConference,
  latestPaymentFor,
  leaveConference,
  listBudgetItems,
  listConferences,
  listContractDocuments,
  listContracts,
  listInvites,
  listMembers,
  MAX_CONFERENCE_UPLOAD_BYTES,
  MAX_DOCUMENT_BYTES,
  moneyVisibleOn,
  readContractDocument,
  recordLeadSignup,
  recordPendingPayment,
  removeMember,
  revokeInvite,
  roleForBudgetItem,
  roleForConference,
  roleForContract,
  addChecklistItem,
  conferenceIdForChecklistItem,
  deleteChecklistItem,
  listChecklistItems,
  moveChecklistItem,
  renameChecklistItem,
  seedChecklistOnce,
  setChecklistItemDone,
  saveContractDocument,
  saveOrganizerProfile,
  setContractStage,
  setContractStatus,
  setMemberRole,
  countPasswordResetsForEmailSince,
  countPasswordResetsForIpSince,
  createPasswordReset,
  deleteSessionsForUser,
  findPasswordResetByHash,
  PASSWORD_RESET_RETENTION_MS,
  PASSWORD_RESET_TTL_MS,
  prunePasswordResets,
  setUserPasswordHash,
  spendPasswordReset,
  updateAgreementTerms,
  unsubscribeLeadSignupByToken,
  updateBudgetItem,
  updateConferenceTarget,
  updateContract,
  withholdMoneyDeep,
  adminOverview,
  checkAdminToken,
  countBudgetItems,
  saveEstimateAsBudget,
  savedEstimateFor,
  hasEverUnlockedAnEvent,
  isAdminUser,
  createSnapshot,
  dailySnapshot,
  SnapshotUnavailableError,
  lastExportAt,
  recordBackup,
  type BudgetInput,
  type ContractDocument,
  type ContractInput,
  type InviteRole,
  type MemberRole,
  type User,
} from "./db.server";
import {
  BUDGET_CATEGORIES,
  CONTRACT_KINDS,
  CONTRACT_STAGES,
  CONTRACT_STATUSES,
  attendeePaymentLabel,
  contractTotalCents,
  isAttendeePaid,
  type AttendeePaymentStatus,
  type Contract,
  type ContractKind,
  type ContractStage,
  type ContractStatus,
  type Money,
} from "../lib/types";
import { trafficReport } from "./analytics.server";
import { AI_EMPTY_MESSAGE, AI_QUESTION_MAX, askHelp } from "./ai";
// The "Where you stand" summary: the conference's own figures, and the model's
// three to five sentences about them. It is a read that costs a model call, so
// it is a POST of its own rather than something the page loader does — a page
// that will not open until a provider answers is a page that fails when it does.
import { eventStandFor } from "./event-stand.server";
import {
  createAttendeeCheckout,
  isAccountReadyForCharges,
  payoutsCardState,
  refreshPayoutStatus,
  retrieveCheckoutSession,
  startPayoutOnboarding,
} from "./payouts.server";
import { sendRegistrationConfirmation } from "./registration-email.server";
import {
  getCookie,
  getRequestHeaders,
  getRequestIP,
  getRequestUrl,
  setCookie,
} from "@tanstack/react-start/server";
import { createHash, randomBytes } from "node:crypto";
import {
  authenticate,
  currentUser,
  endSession,
  hashPassword,
  registerUser,
  startSession,
} from "./auth.server";
import { sendPasswordResetEmail } from "./password-reset-email.server";
import { runStorageProbe } from "./data-dir.server";
import {
  PRINTABLE_COOKIE,
  PRINTABLE_COOKIE_MAX_AGE,
  decodePrintableUnlock,
  encodePrintableUnlock,
} from "./printable.server";
import { parseMoneyInput, sumMoney } from "../lib/money";
import {
  budgetLinesFromEstimate,
  estimateEvent,
  normalizeBudgetInputs,
} from "../lib/budget-estimate";
import {
  CONSENT_TEXT,
  CONSENT_VERSION,
  PRINTABLE_CONSENT_TEXT,
  PRINTABLE_CONSENT_VERSION,
  emailProblem,
  leadMagnet,
  leadMagnetPath,
  normaliseEmail,
  printablePath,
  printableSection,
} from "../lib/lead-magnets";
import {
  CHECKLIST_ITEMS_MAX,
  CHECKLIST_LABEL_MAX,
  CHECKLIST_PHASES,
  CHECKLIST_TEMPLATE,
  type ChecklistItem,
  type ChecklistPhase,
} from "../lib/checklist";
import { buildInvitationLetter, canHaveInvitationLetter } from "../lib/letter";
import {
  buildAgreement,
  EMPTY_ORGANIZER,
  normalizeClauses,
  type AgreementTerms,
  type OrganizerIdentity,
} from "../lib/agreement";
import {
  BUDGET_LINE_LIMIT_MESSAGE,
  CONFERENCE_LIMIT_MESSAGE,
  FREE_PLAN_BUDGET_LINES,
  PAYMENT_PENDING_REFUSAL,
  SAMPLE_NOT_PAYABLE,
  SAMPLE_READ_ONLY_MESSAGE,
  REGISTRATION_LOCKED_MESSAGE,
  CHECKLIST_LOCKED_MESSAGE,
  UPGRADE_PITCH,
  UPGRADE_PRICE,
  UPGRADE_PRICE_CENTS,
  isPaymentAttemptStale,
  paymentLinkFor,
} from "../lib/plan";

/* ------------------------------------------------------------ validation */

const text = (value: unknown, max = 400): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const wholeCents = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
};

const category = (value: unknown): string =>
  BUDGET_CATEGORIES.find((c) => c === value) ?? "Other";

const stage = (value: unknown): ContractStage =>
  CONTRACT_STAGES.find((s) => s.key === value)?.key ?? "invited";

const id = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

const inviteRole = (value: unknown): InviteRole => (value === "editor" ? "editor" : "viewer");

const tokenText = (value: unknown): string => text(value, 128);

type ConferenceSummary = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  expectedAttendance: number;
  budgetTargetCents: Money;
  createdAt: number;
  role: MemberRole;
  plannedCents: Money;
  committedCents: Money;
  budgetLineCount: number;
  contractCount: number;
  contractedCount: number;
  signedCount: number;
  contractedCostCents: Money;
  /** Free tier: 'free' until this conference has been paid for — or owned by an admin. */
  plan: "free" | "unlocked";
  /** Open because its owner's account is an admin, not because it was paid for. */
  adminUnlocked: boolean;
};

const requireUser = async () => {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");
  return user;
};

/**
 * Why these helpers are written as annotated consts (`const f: (..) => never`)
 * rather than bare arrows: TypeScript only treats a call as unreachable when the
 * callee is a const with an explicit type. Annotated, a `refuseX()` statement
 * narrows the checks after it — `if (!conference) refuseRead(...)` then lets the
 * line below use `conference` without a cast, in the places that already rely on
 * it. The behavior is identical; only the compiler's view of it changes.
 */
/**
 * The server-side refusal for a write the caller's role does not allow.
 *
 * This is the enforcement point — the UI also hides the buttons, but hiding
 * buttons is not security: a forged request that reaches this handler is
 * refused here with HTTP 403 and nothing is written.
 */
const refuseWrite: (role: MemberRole | null) => never = (role) => {
  const message =
    role === "viewer"
      ? "Your role on this conference is Viewer — you can read it but not change it."
      : "That conference is not in your workspace.";
  // `setResponseStatus(403)` + returning a value does NOT survive the server
  // function layer: the framework re-writes any non-2xx result into a bare
  // "Forbidden" body (or an opaque 500 "HTTPError"), so the caller never sees
  // why it was refused. A thrown Response is the one shape the handler passes
  // through verbatim (server-functions-handler: `if (error instanceof Response)
  // return error`), so the 403 and the readable message both reach the client.
  throw new Response(JSON.stringify({ ok: false, error: message }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
};

/**
 * The free-tier refusal, thrown exactly like `refuseWrite` and for the same
 * reason: only a thrown `Response` survives the server-function layer with its
 * status and body intact, so a forged request to a locked conference gets a real
 * HTTP 403 and a machine-readable code instead of a quiet no-op.
 */
const refuseUpgrade: (message?: string) => never = (message = UPGRADE_PITCH) => {
  throw new Response(JSON.stringify({ ok: false, code: "upgrade_required", error: message }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
};

/**
 * The free plan's one-budget-line limit, refused with the same
 * `upgrade_required` code as every other free-tier refusal but with a message
 * that names the actual limit — a director who already has their line is not
 * told "budget lines are not on the free plan", because theirs is.
 */
const refuseBudgetLineLimit: () => never = () => refuseUpgrade(BUDGET_LINE_LIMIT_MESSAGE);

/**
 * The shared example conference, refused. It is readable by every signed-in
 * account and writable by none — the demonstration would be worthless if anyone
 * could change the figures it is demonstrating.
 *
 * Checked *before* the role and the plan, because those gates are about who you
 * are and what you have paid, and neither of them would ever let anyone write
 * here. Thrown the same way as `refuseWrite` so the status and body survive.
 */
const refuseSample: () => never = () => {
  throw new Response(
    JSON.stringify({ ok: false, code: "sample_read_only", error: SAMPLE_READ_ONLY_MESSAGE }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
};

/**
 * A refusal on the money path, thrown the same way as `refuseWrite` so its
 * status and readable message survive the server-function layer.
 */
const refusePayment: (code: string, message: string, status?: number) => never = (code, message, status = 403) => {
  throw new Response(JSON.stringify({ ok: false, code, error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
};

/**
 * Both gates on a write, in the order a caller should meet them: the example
 * first (nobody writes there, at any role, whatever the plan), then the role (a
 * stranger must not learn whether the conference is paid for), then the free
 * tier. Owner and editor rights on an unlocked conference are unchanged — this
 * only adds a door in front of the ones that already existed.
 */
const requireEditor = async (userId: number, conferenceId: number): Promise<void> => {
  if (await isSampleConference(conferenceId)) refuseSample();
  const role = await roleForConference(userId, conferenceId);
  if (!await canEditRole(role)) return refuseWrite(role);
  if (!await isConferenceUnlocked(conferenceId)) refuseUpgrade();
};

/**
 * The gates on a budget-line write: the example first (nobody writes there),
 * then the role (a stranger or a Viewer is refused), and *no plan gate* — the
 * free plan includes one budget line, so the budget is the one place a locked
 * conference still accepts changes. The limit is enforced by the caller with
 * `countBudgetItems` and again inside `insertBudgetItem`.
 */
const requireBudgetEditor = async (userId: number, conferenceId: number): Promise<void> => {
  if (await isSampleConference(conferenceId)) refuseSample();
  const role = await roleForConference(userId, conferenceId);
  if (!await canEditRole(role)) return refuseWrite(role);
};

/** The same gates for a budget write addressed by budget-line id. */
const requireBudgetEditorForBudgetItem = async (userId: number, itemId: number): Promise<void> => {
  const conferenceId = await conferenceIdForBudgetItem(itemId);
  await requireBudgetEditor(userId, conferenceId ?? 0);
};

/** The same two gates for a write addressed by contract id. */
const requireEditorForContract = async (userId: number, contractId: number): Promise<void> => {
  const conferenceId = await conferenceIdForContract(contractId);
  await requireEditor(userId, conferenceId ?? 0);
};

/* ------------------------------------------------------------------ auth */

export const getSessionUser = createServerFn({ method: "GET" }).handler(async () => {
  const user = await currentUser();
  if (!user) return null;
  // `isAdmin` is what the workspace header uses to decide whether to offer a link
  // to /admin. It is a convenience for the link only — nothing is authorized by
  // it: the page's data comes from `getAdminOverviewFn`, which checks the same
  // column on the server for every request.
  return { ...user, isAdmin: await isAdminUser(user.id) };
});

/**
 * **The one password rule in the product.**
 *
 * Signup and password reset both read it from here, so a password that would be
 * refused when an account is created is refused when it is reset, and a rule
 * change reaches both at once. Returns the sentence to show, or `null` when the
 * password is acceptable.
 */
const MIN_PASSWORD_LENGTH = 8;

const passwordProblem = (password: string): string | null =>
  password.length < MIN_PASSWORD_LENGTH
    ? `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`
    : null;

export const signUpFn = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; name: string; password: string }) => ({
    email: text(data?.email, 200).toLowerCase(),
    name: text(data?.name, 120),
    password: typeof data?.password === "string" ? data.password : "",
  }))
  .handler(async ({ data }) => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      return { ok: false as const, error: "Enter a valid email address." };
    }
    const problem = passwordProblem(data.password);
    if (problem) return { ok: false as const, error: problem };
    if (!data.name) return { ok: false as const, error: "Enter your name." };
    if (await findUserByEmail(data.email)) {
      return { ok: false as const, error: "An account with that email already exists." };
    }
    const user = await registerUser(data.email, data.name, data.password);
    await startSession(user.id);
    return { ok: true as const };
  });

export const signInFn = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string }) => ({
    email: text(data?.email, 200).toLowerCase(),
    password: typeof data?.password === "string" ? data.password : "",
  }))
  .handler(async ({ data }) => {
    const user = await authenticate(data.email, data.password);
    if (!user) return { ok: false as const, error: "Email or password is incorrect." };
    await startSession(user.id);
    return { ok: true as const };
  });

export const signOutFn = createServerFn({ method: "POST" }).handler(async () => {
  await endSession();
  return { ok: true as const };
});

/* --------------------------------------------------------- password reset */

/**
 * The one answer a reset request ever gets.
 *
 * Identical whether the address has an account, whether one was just emailed,
 * whether the rate limit has been reached, or whether the address is not even a
 * well-formed one. Nothing about this string, and nothing about the HTTP
 * response, can be used to find out who has an account here.
 */
const RESET_REQUEST_ANSWER =
  "If an account uses that email address, a reset link is on its way. Check your inbox and the spam " +
  "folder. The link works once and expires in 60 minutes.";

/** What a link that cannot be used says. One sentence for expired, used and superseded alike. */
const RESET_LINK_INVALID =
  "This password reset link is no longer valid. It may have expired, already been used, or been " +
  "replaced by a newer link. Request a new one and open the newest email.";

/** 3 links an hour for one address, 10 an hour from one address of origin. */
const PASSWORD_RESET_PER_EMAIL_PER_HOUR = 3;
const PASSWORD_RESET_PER_IP_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

/** SHA-256, hex. What is stored — the token itself never is. */
const hashResetToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

/**
 * Where the request came from, for the per-IP limit.
 *
 * The LAST entry of `x-forwarded-for`: our proxy appends the address it actually
 * saw, so the last value is the one a caller cannot choose. A caller-supplied
 * header of their own sits in front of it and is ignored — otherwise the per-IP
 * limit would be a limit on a value the attacker writes.
 */
const requestAddress = (): string => {
  const headers = getRequestHeaders();
  const chain = String(headers.get("x-forwarded-for") ?? "");
  const parts = chain
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const address =
    (parts.length > 0 ? parts[parts.length - 1] : "") ||
    String(headers.get("x-real-ip") ?? "").trim() ||
    String(headers.get("cf-connecting-ip") ?? "").trim();
  // `1.2.3.4:5678` is an address with a port; an IPv6 literal is left alone.
  return address.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1").slice(0, 64);
};

/**
 * The base URL the emailed link is built from.
 *
 * Taken from the request, so an organizer who uses the owner's domain gets a
 * link back to that domain and one on the platform's preview address gets a link
 * back to the preview. Only OUR hosts are accepted: a forged `Host` header (or a
 * proxy we do not know) falls back to the public site, because an emailed link
 * must never point anywhere we do not control — the token in it is the whole
 * password reset.
 */
const RESET_LINK_HOSTS = new Set(["getconvocate.com", "www.getconvocate.com"]);

const resetLinkOrigin = (): string => {
  try {
    const url = getRequestUrl({ xForwardedHost: true, xForwardedProto: true });
    const host = url.hostname.toLowerCase();
    const ours = RESET_LINK_HOSTS.has(host) || host.endsWith(".ctonew.app");
    if (!ours) return PUBLIC_SITE_ORIGIN;
    // The site is only ever served over https on these hosts.
    return `https://${url.host}`;
  } catch {
    return PUBLIC_SITE_ORIGIN;
  }
};

/**
 * "Forgot your password?" — issue a link, or quietly do nothing.
 *
 * The rules this follows, in order:
 *
 *  1. **The answer never changes.** Same object, same words, whatever happened:
 *     an account found and emailed, no account at all, a malformed address, or a
 *     caller over the limit. There is no branch that tells a stranger who has an
 *     account here.
 *
 *  2. **The limits are counted in the database**, not in the browser: 3 an hour
 *     for one address, 10 an hour from one address of origin. Over the limit is
 *     not an error to the caller — the request is simply not acted on, so a
 *     limit cannot be used as an oracle either.
 *
 *  3. **Only the newest link works.** Writing a new row retires every unused one
 *     this account holds, inside one transaction (see `createPasswordReset`).
 *
 *  4. **The token is never stored, never logged and never returned.** It is
 *     generated here, hashed for the row, and put in the email. It reaches the
 *     browser only inside the link.
 */
export const requestPasswordResetFn = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string }) => ({
    email: text(data?.email, 200).toLowerCase(),
  }))
  .handler(async ({ data }) => {
    const now = Date.now();
    const ip = requestAddress();

    // Housekeeping: rows older than a day serve neither the limiter nor the
    // history. Never throws.
    await prunePasswordResets(now - PASSWORD_RESET_RETENTION_MS);

    // Both limits are read before anything is written, and both are read on
    // every request — including the ones for addresses with no account — so the
    // work done is the same either way.
    const [forEmail, forIp] = await Promise.all([
      countPasswordResetsForEmailSince(data.email, now - HOUR_MS),
      countPasswordResetsForIpSince(ip, now - HOUR_MS),
    ]);
    if (forEmail >= PASSWORD_RESET_PER_EMAIL_PER_HOUR || forIp >= PASSWORD_RESET_PER_IP_PER_HOUR) {
      // No address in the log line, and no difference in the answer.
      console.warn(
        `[convocate] password reset: hourly limit reached (${String(forEmail)} for this address, ` +
          `${String(forIp)} from this origin) — no link issued.`,
      );
      return { ok: true as const, message: RESET_REQUEST_ANSWER };
    }

    const account = await findUserByEmail(data.email);
    if (account) {
      const token = randomBytes(32).toString("base64url");
      await createPasswordReset({
        userId: account.id,
        tokenHash: hashResetToken(token),
        expiresAt: now + PASSWORD_RESET_TTL_MS,
        requestIp: ip,
        nowMs: now,
      });
      const link = `${resetLinkOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
      // Not awaited on purpose: the answer must take the same time whether or
      // not a message is being sent. The send records its own outcome in
      // email_log, which is where "did it actually go?" is answered.
      void sendPasswordResetEmail({
        email: account.email,
        name: account.name,
        link,
        minutes: Math.round(PASSWORD_RESET_TTL_MS / 60000),
      }).catch(() => undefined);
    }

    return { ok: true as const, message: RESET_REQUEST_ANSWER };
  });

/**
 * Choose a new password with a link.
 *
 * The link is checked before anything is written: an unknown, spent, superseded
 * or expired hash gets one honest sentence and changes nothing. The password
 * rule is the signup rule (`passwordProblem`), and a password that fails it does
 * NOT spend the link — a person who mistypes a short password can try again with
 * the same email still open.
 *
 * On success, in this order: the link is spent (conditional on it still being
 * unspent, so two requests racing one link cannot both win), the new hash is
 * written, and every session this account holds is deleted. A password change
 * signs out everywhere, including a browser an attacker may be holding.
 */
export const resetPasswordFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; password: string }) => ({
    token: typeof data?.token === "string" ? data.token.trim().slice(0, 200) : "",
    password: typeof data?.password === "string" ? data.password : "",
  }))
  .handler(async ({ data }) => {
    if (data.token === "") {
      return { ok: false as const, code: "invalid_token", error: RESET_LINK_INVALID };
    }

    const row = await findPasswordResetByHash(hashResetToken(data.token));
    if (!row || row.usedAt !== null || row.expiresAt <= Date.now()) {
      return { ok: false as const, code: "invalid_token", error: RESET_LINK_INVALID };
    }

    const problem = passwordProblem(data.password);
    if (problem) return { ok: false as const, code: "weak_password", error: problem };

    const passwordHash = await hashPassword(data.password);
    // Spend first: if this loses a race, the password is not written at all.
    if (!await spendPasswordReset(row.id, Date.now())) {
      return { ok: false as const, code: "invalid_token", error: RESET_LINK_INVALID };
    }
    await setUserPasswordHash(row.userId, passwordHash);
    await deleteSessionsForUser(row.userId);
    return { ok: true as const };
  });

/* ---------------------------------------------------------- conferences */

export const listConferencesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const conferences = await listConferences(user.id);
  // Roll up real totals per conference so the list shows live numbers. Each
  // conference is read as *this user's* role on it, so a Viewer's rollup is
  // `null` rather than a total built out of amounts they were not given.
  // `Promise.all` over an async callback, never a bare `map`: each conference
  // needs several awaits, and a plain `map` here would hand the page an array of
  // promises instead of an array of rollups.
  return await Promise.all(
    conferences.map(async (c): Promise<ConferenceSummary> => {
      const budget = await listBudgetItems(c.id, c.role);
      const contracts = await listContracts(c.id, c.role);
      return await withholdMoneyDeep<ConferenceSummary>(
        {
          ...c,
          plannedCents: sumMoney(budget.map((item) => item.plannedCents)),
          committedCents: sumMoney(budget.map((item) => item.committedCents)),
          budgetLineCount: budget.length,
          contractCount: contracts.length,
          contractedCount: contracts.filter((c) => c.stage === "contracted" || c.stage === "booked")
            .length,
          signedCount: contracts.filter((c) => c.contractStatus === "signed").length,
          contractedCostCents: sumMoney(contracts.map((contract) => contractTotalCents(contract))),
        },
        await moneyVisibleOn(c.id, c.role),
      );
    }),
  );
});

export const getConferenceFn = createServerFn({ method: "GET" })
  .inputValidator((data: { conferenceId: number }) => ({ conferenceId: id(data?.conferenceId) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    // getConference() already filters by membership: someone outside the
    // member list gets the same answer as a conference that does not exist.
    const conference = await getConference(user.id, data.conferenceId);
    if (!conference) return null;
    const role = conference.role;
    const isOwner = role === "owner";
    // Money is stripped at the read layer, per reader's role: a Viewer's
    // payload carries every label and stage but no amount anywhere. The one
    // exception is the shared example (invented figures, shown on purpose).
    const payment = await latestPaymentFor(conference.id);
    // One question, one answer: the same entry point every write path asks
    // (`isConferenceUnlocked` → `conferenceEntitlement`), so the page and the
    // server can never disagree about whether this conference is open.
    const entitlement = await conferenceEntitlement(conference.id);
    return await withholdMoneyDeep(
      {
        conference,
        role,
        currentUserId: user.id,
        // The free-tier state travels with the conference so the page can show
        // the real structure plus the upgrade panel instead of a blank screen.
        entitlement: {
          plan: entitlement.plan,
          unlocked: entitlement.unlocked,
          // True when it is open because the owner's account is an admin: the
          // page then says so instead of asking for $199.
          adminUnlocked: entitlement.ownerIsAdmin && entitlement.plan === "free",
          unlockedAt: conference.unlockedAt,
          paidCents: conference.paidCents,
          // How many budget lines the un-unlocked plan allows, so the page shows
          // the same number the server enforces and neither can drift.
          freePlanBudgetLines: FREE_PLAN_BUDGET_LINES,
          // Where the owner is in the payment flow, if anywhere. Only the
          // status and when it started — the amount they will pay is the price
          // in `lib/plan.ts`, not something a page needs to read from here.
          //
          // `retryable` is true when an attempt was started and never confirmed,
          // and it is old enough that a fresh one may replace it. The page shows
          // the retry sentence and the button from this flag; the server applies
          // the same rule again in `recordPendingPayment`, so the page cannot
          // offer something the server would refuse.
          payment: payment
            ? {
                status: payment.status,
                startedAt: payment.createdAt,
                retryable:
                  payment.status === "pending" && isPaymentAttemptStale(payment.createdAt),
              }
            : null,
        },
        budgetItems: await listBudgetItems(conference.id, role),
        contracts: await listContracts(conference.id, role),
        // Attached contract documents, as names and sizes only — never bytes.
        // Withheld from a Viewer for the same reason the amounts are: an attached
        // contract is a document full of fees, and a Viewer is not shown money.
        documents: await moneyVisibleOn(conference.id, role)
          ? await listContractDocuments(conference.id)
          : [],
        // The example is shared by every account: its committee list and invite
        // panel are not part of the demonstration, and the email address of the
        // account the seed happens to attach it to is nobody else's business.
        members: conference.isSample && !isOwner ? [] : await listMembers(conference.id),
        invites: isOwner && !conference.isSample ? await listInvites(user.id, conference.id) : [],
      },
      await moneyVisibleOn(conference.id, role),
    );
  });

/**
 * **Where you stand** — the conference's own figures, and a short summary of them.
 *
 * This is the one AI slice that reads an organizer's data. What it is given is
 * decided in `event-stand.server.ts`: budget lines, contracts, checklist counts
 * and places registered, shaped by the same money gate as every other read — a
 * committee Viewer's payload carries no amount, so the model is not handed one
 * either. No name, note, email address or contract text is passed, which is what
 * keeps a summary from repeating anything a reader should not see.
 *
 * A POST, for the reason `SITE.md` gives: it costs a model call, and a gateway
 * that re-sends a POST does not re-send this one. The page loader does not call
 * it — the panel asks after it has painted, so a slow provider never holds the
 * workspace shut.
 *
 * Three answers, and no throw for any of them: `summaryState: "ok"` with a
 * paragraph, `"empty"` when there is nothing on the conference yet (no model
 * was called), and `"unavailable"` when the model could not be reached or wrote
 * a figure it was not given. The last two still carry the facts and the numbers
 * line, which is the whole of what the panel needs to be useful.
 */
export const getEventStandSummaryFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number }) => ({ conferenceId: id(data?.conferenceId) }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    if (!data.conferenceId) refuseRead("not_found", "There is no conference with that id.", 404);
    const stand = await eventStandFor(user.id, data.conferenceId);
    // Not a member: refused exactly like a conference that does not exist, so a
    // stranger cannot learn that an event is there by asking for its summary.
    if (!stand) return refuseWrite(await roleForConference(user.id, data.conferenceId));
    return stand;
  });
/** A calendar date as an <input type="date"> submits it: YYYY-MM-DD. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const createConferenceFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      name: string;
      startDate: string;
      endDate: string;
      venue: string;
      expectedAttendance: number | string;
      budgetTargetCents: number | string;
    }) => ({
      name: text(data?.name, 160),
      startDate: text(data?.startDate, 20),
      endDate: text(data?.endDate, 20),
      venue: text(data?.venue, 200),
      // The two numbers are carried through as typed text and checked in the
      // handler. Rounding a junk figure here would store a plausible wrong
      // number (a budget of 0, an attendance of 0) and look like a success.
      expectedAttendance:
        typeof data?.expectedAttendance === "number" || typeof data?.expectedAttendance === "string"
          ? String(data.expectedAttendance).trim()
          : "",
      budgetTargetCents:
        typeof data?.budgetTargetCents === "number" || typeof data?.budgetTargetCents === "string"
          ? String(data?.budgetTargetCents).trim()
          : "",
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    // The same rules the form applies, enforced here because the browser is not
    // the guard: a crafted request gets the identical refusal, naming the field.
    const refuse = (field: string, error: string) => ({ ok: false as const, field, error });
    if (!data.name) return refuse("name", "Give the conference a name.");
    if (!ISO_DATE.test(data.startDate)) return refuse("startDate", "Enter the start date.");
    if (!ISO_DATE.test(data.endDate)) return refuse("endDate", "Enter the end date.");
    if (data.endDate < data.startDate) {
      return refuse("endDate", "The end date cannot be before the start date.");
    }
    let attendance = 0;
    if (data.expectedAttendance !== "") {
      if (!/^\d+$/.test(data.expectedAttendance)) {
        return refuse(
          "expectedAttendance",
          "Expected attendance must be a whole number, for example 240.",
        );
      }
      attendance = Number.parseInt(data.expectedAttendance, 10);
      if (!Number.isSafeInteger(attendance)) {
        return refuse("expectedAttendance", "That attendance is too large to store.");
      }
    }
    const money = parseMoneyInput(data.budgetTargetCents);
    if ("error" in money) return refuse("budgetTargetCents", money.error);
    // The free plan is one conference per account. A second one is refused
    // outright — never created and then hidden — and the refusal says why.
    if (!await canCreateConference(user.id)) {
      return { ok: false as const, code: "conference_limit" as const, error: CONFERENCE_LIMIT_MESSAGE };
    }
    const newId = await insertConference(user.id, {
      name: data.name,
      startDate: data.startDate,
      endDate: data.endDate,
      venue: data.venue,
      expectedAttendance: attendance,
      budgetTargetCents: money.cents,
    });
    return { ok: true as const, conferenceId: newId };
  });

export const updateBudgetTargetFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number; budgetTargetCents: number }) => ({
    conferenceId: id(data?.conferenceId),
    budgetTargetCents: wholeCents(data?.budgetTargetCents),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    // The target is part of the budget, so it sits behind the same two gates.
    await requireEditor(user.id, data.conferenceId);
    const ok = await updateConferenceTarget(user.id, data.conferenceId, data.budgetTargetCents);
    return ok ? { ok: true as const } : refuseWrite(await roleForConference(user.id, data.conferenceId));
  });

export const deleteConferenceFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number }) => ({ conferenceId: id(data?.conferenceId) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    // The example is shared with every account: nobody owns it, so nobody can
    // delete it. Checked before the owner test for the same reason as above.
    if (await isSampleConference(data.conferenceId)) refuseSample();
    // Deleting the conference itself stays an owner-only action.
    if (await roleForConference(user.id, data.conferenceId) !== "owner") return refuseWrite(null);
    await deleteConference(user.id, data.conferenceId);
    return { ok: true as const };
  });

/* ------------------------------------------------------------ the money path */

/**
 * Start paying for one conference.
 *
 * The only user-reachable way into the money path, and it does not unlock
 * anything: it records that a payment is in progress and hands back the payment
 * link with this conference attached as `client_reference_id`. The conference
 * stays on the free plan until a payment is confirmed with the admin token
 * (`confirmPaymentFn`), so a church that opens the payment page and closes it
 * again is left exactly where they were.
 *
 * Refused:
 *  - anyone not signed in;
 *  - anyone who is not the owner (an editor or viewer cannot buy someone else's
 *    conference);
 *  - the example conference (it is not for sale);
 *  - a conference whose payment attempt is still fresh (403 `payment_pending`) —
 *    paying twice for one conference is the failure that would actually hurt. An
 *    attempt that was never confirmed and is older than
 *    `PAYMENT_RETRY_AFTER_MINUTES` is marked `abandoned` and replaced by a new
 *    one, so a closed checkout is a pause the organizer can get out of
 *    themselves rather than a dead end only the team can clear;
 *  - a conference that is already unlocked: an honest no-op, not a second sale.
 */
export const startUnlockFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number }) => ({ conferenceId: id(data?.conferenceId) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (await isSampleConference(data.conferenceId)) {
      throw new Response(JSON.stringify({ ok: false, code: "sample_read_only", error: SAMPLE_NOT_PAYABLE }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    // Paying is the owner's act. A committee member on an unlocked conference
    // never reaches here; a stranger or a viewer is refused by role.
    const role = await roleForConference(user.id, data.conferenceId);
    if (role !== "owner") return refuseWrite(role);
    if (await isConferenceUnlocked(data.conferenceId)) {
      return { ok: true as const, alreadyUnlocked: true as const, url: null };
    }
    const started = await recordPendingPayment(
      data.conferenceId,
      UPGRADE_PRICE_CENTS,
      String(data.conferenceId),
    );
    if (!started.ok) {
      if (started.reason === "pending") refusePayment("payment_pending", PAYMENT_PENDING_REFUSAL);
      if (started.reason === "sample") refusePayment("sample_read_only", SAMPLE_NOT_PAYABLE);
      if (started.reason === "unlocked") {
        return { ok: true as const, alreadyUnlocked: true as const, url: null };
      }
      return refuseWrite(role);
    }
    return {
      ok: true as const,
      alreadyUnlocked: false as const,
      url: paymentLinkFor(data.conferenceId),
      paymentId: started.paymentId,
    };
  });

/**
 * Confirm a payment and unlock its conference. **Admin only.**
 *
 * This is the one path in the product that moves a conference from `free` to
 * `unlocked`, and it is deliberately not part of any signed-in flow: there is no
 * button for it, no page calls it, and it is refused unless the caller presents
 * the admin token (32 random bytes, generated on first boot and kept in
 * `app_settings`, mirrored to `/home/team/shared/convocate-admin-token.txt`).
 *
 * It is called by hand, after the payment has been seen in the Stripe account:
 *
 *   POST /_serverFn/<id>  { conferenceId, amountCents, adminToken, reference? }
 *
 * Refused with a real 403 and a machine-readable code:
 *   admin_token_denied — missing or wrong token (checked first, before anything
 *                        else is looked at, so a wrong token learns nothing)
 *   sample_read_only   — the example conference is not for sale at any price
 *   amount_mismatch    — the amount is not exactly the price we charge
 *   no_pending_payment — no payment was ever started for this conference, or the
 *                        only one was already confirmed
 * and an already-unlocked conference is an honest no-op (`alreadyUnlocked: true`),
 * not an error, so a repeated confirmation changes nothing.
 */
export const confirmPaymentFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { conferenceId: number; amountCents: number; adminToken: string; reference?: string }) => ({
      conferenceId: id(data?.conferenceId),
      amountCents: wholeCents(data?.amountCents),
      adminToken: typeof data?.adminToken === "string" ? data.adminToken : "",
      reference: text(data?.reference, 200),
    }),
  )
  .handler(async ({ data }) => {
    if (!await checkAdminToken(data.adminToken)) {
      refusePayment(
        "admin_token_denied",
        "Refused: confirming a payment needs the admin token. Nothing was changed.",
      );
    }
    if (await isSampleConference(data.conferenceId)) {
      refusePayment("sample_read_only", SAMPLE_NOT_PAYABLE);
    }
    if (data.amountCents !== UPGRADE_PRICE_CENTS) {
      refusePayment(
        "amount_mismatch",
        `Refused: this conference unlocks for ${UPGRADE_PRICE} (${String(UPGRADE_PRICE_CENTS)} cents), not ${String(data.amountCents)} cents. Nothing was changed.`,
      );
    }
    const result = await confirmPaymentForConference(data.conferenceId, data.amountCents, data.reference);
    if (!result.ok) {
      if (result.reason === "sample") return refusePayment("sample_read_only", SAMPLE_NOT_PAYABLE);
      if (result.reason === "no_pending") {
        return refusePayment(
          "no_pending_payment",
          "Refused: no payment has been started for this conference, so there is nothing to confirm. Nothing was changed.",
        );
      }
      return refusePayment("conference_missing", "Refused: there is no conference with that id.");
    }
    // The one line in the log that shows money changing hands. No token, and no
    // figure the caller could not already see from their own request.
    console.log(
      `[convocate] payment ${result.alreadyUnlocked ? "already confirmed (no-op)" : "confirmed"} conference=${String(data.conferenceId)} amount_cents=${String(data.amountCents)} reference=${data.reference || "-"} paid_cents=${String(result.paidCents)}`,
    );
    return {
      ok: true as const,
      conferenceId: data.conferenceId,
      alreadyUnlocked: result.alreadyUnlocked,
      paidCents: result.paidCents,
    };
  });


/* -------------------------------------------------------------- backups */

/**
 * How often the token-gated export may run: once a minute. A retried pull, or two
 * pulls at the same moment, gets a readable refusal instead of two full copies of
 * the database in flight at once.
 */
const EXPORT_MIN_INTERVAL_MS = 60_000;
/**
 * One export at a time. The check and the flip happen in the same synchronous
 * tick (nothing awaits between them), so two requests cannot both get through.
 * It guards this process only — with one server process serving the site, that is
 * the whole of it.
 */
let exportInFlight = false;

/**
 * The whole live database as one consistent snapshot, for the team to pull off
 * the box. This is the real backup: the only copy that leaves the machine.
 *
 * The admin token is the *only* key. A signed-in session is not authority here —
 * the check below never looks at who is calling, and it runs first, before
 * anything is read or written, so a call without the token produces no file, no
 * log row and no bytes. The comparison is `checkAdminToken`: timing-safe, the
 * same one `confirmPaymentFn` uses.
 *
 * The snapshot is taken with `VACUUM INTO` (see `createSnapshot`): the live file
 * is only read, the WAL is folded in, and the temp copy is deleted before the
 * bytes are returned. Each export writes one `backup_log` row and returns it with
 * the bytes, so the pull can be checked against a history that lives in the
 * database itself. An export also takes the day's on-disk snapshot if it is not
 * there yet — a pull is a good moment to know the quick restore exists.
 *
 * No UI calls this and no page links to it.
 */
export const exportSnapshotFn = createServerFn({ method: "POST" })
  .inputValidator((data: { adminToken?: string }) => ({
    adminToken: typeof data?.adminToken === "string" ? data.adminToken : "",
  }))
  .handler(async ({ data }) => {
    if (!await checkAdminToken(data.adminToken)) {
      refusePayment(
        "admin_token_denied",
        "Refused: exporting the database needs the admin token. Nothing was exported and nothing was changed.",
      );
    }
    if (exportInFlight) {
      refusePayment(
        "export_in_progress",
        "Refused: an export is already running. Wait for it to finish and try again.",
        429,
      );
    }
    const lastExport = await lastExportAt();
    const sinceLastExport = lastExport > 0 ? Date.now() - lastExport : Number.POSITIVE_INFINITY;
    if (sinceLastExport < EXPORT_MIN_INTERVAL_MS) {
      const wait = Math.ceil((EXPORT_MIN_INTERVAL_MS - sinceLastExport) / 1000);
      refusePayment(
        "export_rate_limited",
        `Refused: an export was taken ${String(Math.round(sinceLastExport / 1000))} seconds ago, and the export runs at most once a minute. Try again in ${String(wait)} seconds.`,
        429,
      );
    }
    exportInFlight = true;
    try {
      // A remote (libSQL-over-the-wire) database has no file to VACUUM, and that
      // is a refusal to explain, not a crash to leak: "export_unavailable" says
      // the export cannot be taken here and points at the remote's own backups.
      let snapshot: Awaited<ReturnType<typeof createSnapshot>>;
      try {
        snapshot = await createSnapshot();
      } catch (cause) {
        if (cause instanceof SnapshotUnavailableError) {
          refusePayment(
            "export_unavailable",
            `Refused: ${cause.message} Nothing was exported and nothing was changed.`,
            409,
          );
        }
        throw cause;
      }
      const log = await recordBackup({
        sha256: snapshot.sha256,
        sizeBytes: snapshot.sizeBytes,
        source: "export",
        createdAt: snapshot.createdAt,
      });
      // Opportunistic and never fatal: the bytes are already in hand, so a failed
      // on-disk copy must not turn a good export into an error.
      try {
        await dailySnapshot("export");
      } catch (cause) {
        console.error("[convocate] daily snapshot during export failed", cause);
      }
      console.log(
        `[convocate] backup exported id=${String(log.id)} bytes=${String(snapshot.sizeBytes)} sha256=${snapshot.sha256}`,
      );
      return {
        ok: true as const,
        fileName: snapshot.fileName,
        sha256: snapshot.sha256,
        sizeBytes: snapshot.sizeBytes,
        createdAt: snapshot.createdAt,
        base64: snapshot.bytes.toString("base64"),
        log,
      };
    } finally {
      exportInFlight = false;
    }
  });

/**
 * Storage probe — admin token only. No route, no component and no UI imports it.
 *
 * Writes a small timestamped file into each directory in `PROBE_CANDIDATES`
 * (`data-dir.server.ts`), or reads back which files from earlier runs are still
 * there. That is how the team proves which location survives a publish: `write`,
 * publish, `read` — any directory still holding the earlier file is somewhere
 * the platform keeps between deploys. It touches no table, no conference row and
 * no uploads; the only files it creates are its own probe files.
 *
 * The token is checked first, exactly as `exportSnapshotFn` does, so a caller
 * without it learns nothing about the machine.
 */
export const storageProbeFn = createServerFn({ method: "POST" })
  .inputValidator((data: { adminToken?: string; action?: string }) => ({
    adminToken: typeof data?.adminToken === "string" ? data.adminToken : "",
    action:
      data?.action === "read" ? ("read" as const) : data?.action === "write" ? ("write" as const) : null,
  }))
  .handler(async ({ data }) => {
    if (!await checkAdminToken(data.adminToken)) {
      refusePayment(
        "admin_token_denied",
        "Refused: the storage probe needs the admin token. Nothing was written and nothing was changed.",
      );
    }
    if (!data.action) {
      refusePayment(
        "bad_action",
        'Refused: send {"action":"write"} or {"action":"read"}. Nothing was written.',
        400,
      );
    }
    return { ok: true as const, ...runStorageProbe(data.action) };
  });
/* ---------------------------------------------------------- budget items */

const budgetInput = (data: BudgetInput): BudgetInput => ({
  category: category(data?.category),
  label: text(data?.label, 160),
  plannedCents: wholeCents(data?.plannedCents),
  committedCents: wholeCents(data?.committedCents),
  notes: text(data?.notes, 600),
});

export const addBudgetItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number } & BudgetInput) => ({
    conferenceId: id(data?.conferenceId),
    ...budgetInput(data),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    // Role first, then the label, then the plan's line limit — so a Viewer is
    // told they are a Viewer, an empty label is told it is empty, and only a
    // director who already has their one free line is told about the limit.
    await requireBudgetEditor(user.id, data.conferenceId);
    if (!data.label) return { ok: false as const, error: "Add a label for this line." };
    if (
      !await isConferenceUnlocked(data.conferenceId) &&
      await countBudgetItems(data.conferenceId) >= FREE_PLAN_BUDGET_LINES
    ) {
      refuseBudgetLineLimit();
    }
    const created = await insertBudgetItem(user.id, data.conferenceId, data, FREE_PLAN_BUDGET_LINES);
    if (created === "limit") refuseBudgetLineLimit();
    if (created !== "ok") return refuseWrite(await roleForConference(user.id, data.conferenceId));
    return { ok: true as const };
  });

export const updateBudgetItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: { itemId: number } & BudgetInput) => ({
    itemId: id(data?.itemId),
    ...budgetInput(data),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    // Editing the line a free conference already holds is allowed: a director
    // must be able to correct a number without paying for the privilege.
    await requireBudgetEditorForBudgetItem(user.id, data.itemId);
    const { itemId, ...input } = data;
    const updated = await updateBudgetItem(user.id, itemId, input);
    return updated ? { ok: true as const } : refuseWrite(await roleForBudgetItem(user.id, itemId));
  });

export const deleteBudgetItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: { itemId: number }) => ({ itemId: id(data?.itemId) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    // Deleting is allowed too, and it is what frees the slot: with no lines
    // left, the free conference can hold one again.
    await requireBudgetEditorForBudgetItem(user.id, data.itemId);
    const deleted = await deleteBudgetItem(user.id, data.itemId);
    return deleted ? { ok: true as const } : refuseWrite(await roleForBudgetItem(user.id, data.itemId));
  });

/* ------------------------------- the budget calculator's save / gate */

/**
 * What `/budget-calculator` may offer this visitor, decided on the server.
 *
 * The page is public and stays public: a signed-out visitor gets `signedIn:
 * false` and the same handoff it has always had. A signed-in organizer gets one
 * of three answers, and the page renders the handoff from them rather than
 * guessing:
 *
 *   canSave: true        → their estimate can be saved onto a conference they
 *                          can already edit that is unlocked ($199 paid, or an
 *                          admin account's own). `conferences` is what the page
 *                          offers to save into — one entry for almost everyone.
 *   canSave: false,
 *   locked: {...}        → they own or edit a conference that is still on the
 *                          free plan. The handoff stays the gate: the free plan
 *                          holds one budget line and an estimate is seven.
 *   canSave: false,
 *   locked: null         → signed in with no conference yet. The handoff points
 *                          at creating one, then at the unlock.
 *
 * `unlocked` is asked of `isConferenceUnlocked`, the same entry point every
 * other unlock feature asks, so this can never drift from what the workspace
 * itself will allow. Nothing here grants anything: the save itself re-checks the
 * role and the plan in `requireEditor`.
 *
 * A database that cannot answer is not allowed to break a public page: it is
 * logged and the visitor is treated as signed out, which shows the gate.
 */
export type BudgetSaveAccess = {
  signedIn: boolean;
  canSave: boolean;
  conferences: { id: number; name: string; role: "owner" | "editor" }[];
  locked: { id: number; name: string } | null;
  lastSaved: { conferenceId: number; conferenceName: string; savedAt: number } | null;
};

export const budgetSaveAccessFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<BudgetSaveAccess> => {
    const nobody: BudgetSaveAccess = {
      signedIn: false,
      canSave: false,
      conferences: [],
      locked: null,
      lastSaved: null,
    };
    try {
      const user = await currentUser();
      if (!user) return nobody;
      // The example is not theirs and is never writable; a Viewer may look at a
      // budget but not write one, so neither is a place to save an estimate.
      const mine = (await listConferences(user.id)).filter(
        (conference) =>
          !conference.isSample && (conference.role === "owner" || conference.role === "editor"),
      );
      const conferences: BudgetSaveAccess["conferences"] = [];
      let locked: BudgetSaveAccess["locked"] = null;
      let lastSaved: BudgetSaveAccess["lastSaved"] = null;
      for (const conference of mine) {
        if (!await isConferenceUnlocked(conference.id)) {
          locked ??= { id: conference.id, name: conference.name };
          continue;
        }
        conferences.push({
          id: conference.id,
          name: conference.name,
          role: conference.role === "owner" ? "owner" : "editor",
        });
        const saved = await savedEstimateFor(conference.id);
        if (saved && (!lastSaved || saved.savedAt > lastSaved.savedAt)) {
          lastSaved = {
            conferenceId: conference.id,
            conferenceName: conference.name,
            savedAt: saved.savedAt,
          };
        }
      }
      return {
        signedIn: true,
        canSave: conferences.length > 0,
        conferences,
        // Only worth saying when there is nowhere else to save.
        locked: conferences.length === 0 ? locked : null,
        lastSaved,
      };
    } catch (cause) {
      console.error(
        `[convocate] budget calculator access: could not read the account — ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return nobody;
    }
  },
);

/**
 * Save the estimate as a tracked budget.
 *
 * The browser sends the eight inputs and a conference, never the figures: the
 * estimate is recomputed here from `lib/budget-estimate.ts`, so what lands in
 * the database is the same arithmetic the page showed, not something a crafted
 * request could put a number into. `normalizeBudgetInputs` holds every input
 * inside the bounds the page offers before the arithmetic runs.
 *
 * The gate is `requireEditor` — the shared example (never writable), then the
 * role, then the plan — so a locked conference is refused with the same
 * `upgrade_required` message the paywall shows, an editor of someone else's
 * unlocked conference is allowed exactly as they are for any other budget write,
 * and a stranger learns nothing about whether the conference is paid for.
 */
export const saveEstimateAsBudgetFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId?: unknown; inputs?: unknown }) => ({
    conferenceId: id(data?.conferenceId),
    inputs: normalizeBudgetInputs(data?.inputs),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditor(user.id, data.conferenceId);
    const estimate = estimateEvent(data.inputs);
    const savedAt = Date.now();
    const lines = budgetLinesFromEstimate(estimate, savedAt);
    const result = await saveEstimateAsBudget(
      user.id,
      data.conferenceId,
      lines.map((line) => ({
        source: line.source,
        category: line.category,
        label: line.label,
        plannedCents: line.plannedCents,
        notes: line.notes,
      })),
      {
        savedAt,
        totalLowCents: estimate.total.low * 100,
        totalMidCents: estimate.total.mid * 100,
        totalHighCents: estimate.total.high * 100,
        inputs: data.inputs,
      },
    );
    if (result === "forbidden") {
      return refuseWrite(await roleForConference(user.id, data.conferenceId));
    }
    const conference = await getConference(user.id, data.conferenceId);
    return {
      ok: true as const,
      conferenceId: data.conferenceId,
      conferenceName: conference?.name ?? "",
      created: result.created,
      updated: result.updated,
      savedAt,
      total: estimate.total,
    };
  });

/* ------------------------------------------------------------ contracts */

const kind = (value: unknown): ContractKind =>
  CONTRACT_KINDS.find((k) => k.key === value)?.key ?? "other";

const contractStatus = (value: unknown): ContractStatus =>
  CONTRACT_STATUSES.find((s) => s.key === value)?.key ?? "not_sent";

const contractInput = (data: ContractInput): ContractInput => ({
  kind: kind(data?.kind),
  name: text(data?.name, 160),
  topic: text(data?.topic, 300),
  feeCents: wholeCents(data?.feeCents),
  honorariumCents: wholeCents(data?.honorariumCents),
  travelCents: wholeCents(data?.travelCents),
  equipmentCents: wholeCents(data?.equipmentCents),
  depositCents: wholeCents(data?.depositCents),
  contractStatus: contractStatus(data?.contractStatus),
  contractDate: text(data?.contractDate, 20),
  contractNote: text(data?.contractNote, 600),
  contactEmail: text(data?.contactEmail, 200),
  stage: stage(data?.stage),
});

/**
 * The agreement terms a save may write. Every field is free text with a hard
 * ceiling, so a forged request cannot park megabytes in the database; an unknown
 * clause key is dropped rather than stored (`normalizeClauses`).
 */
const agreementTermsInput = (data: Partial<AgreementTerms> & Record<string, unknown>): AgreementTerms => ({
  engagement: text(data.engagement, 4000),
  schedule: text(data.schedule, 4000),
  detail: text(data.detail, 8000),
  balanceDue: text(data.balanceDue, 20),
  paymentNote: text(data.paymentNote, 2000),
  inclusions: text(data.inclusions, 4000),
  cancellationNoticeDays: Math.min(3650, Math.max(0, Math.round(Number(data.cancellationNoticeDays) || 0))),
  cancellationDeposit: text(data.cancellationDeposit, 2000),
  additionalTerms: text(data.additionalTerms, 8000),
  governingLaw: text(data.governingLaw, 300),
  clauses: normalizeClauses(data.clauses),
});

export const addContractFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number } & ContractInput) => ({
    conferenceId: id(data?.conferenceId),
    ...contractInput(data),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditor(user.id, data.conferenceId);
    if (!data.name) return { ok: false as const, error: "Add a name for this guest or supplier." };
    const created = await insertContract(user.id, data.conferenceId, data);
    if (!created) return refuseWrite(await roleForConference(user.id, data.conferenceId));
    return { ok: true as const };
  });

export const updateContractFn = createServerFn({ method: "POST" })
  .inputValidator((data: { contractId: number } & ContractInput) => ({
    contractId: id(data?.contractId),
    ...contractInput(data),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditorForContract(user.id, data.contractId);
    const { contractId, ...input } = data;
    const updated = await updateContract(user.id, contractId, input);
    return updated ? { ok: true as const } : refuseWrite(await roleForContract(user.id, contractId));
  });

export const moveContractFn = createServerFn({ method: "POST" })
  .inputValidator((data: { contractId: number; stage: ContractStage }) => ({
    contractId: id(data?.contractId),
    stage: stage(data?.stage),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditorForContract(user.id, data.contractId);
    const moved = await setContractStage(user.id, data.contractId, data.stage);
    return moved ? { ok: true as const } : refuseWrite(await roleForContract(user.id, data.contractId));
  });

export const setContractStatusFn = createServerFn({ method: "POST" })
  .inputValidator((data: { contractId: number; contractStatus: ContractStatus; contractDate: string }) => ({
    contractId: id(data?.contractId),
    contractStatus: contractStatus(data?.contractStatus),
    contractDate: text(data?.contractDate, 20),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditorForContract(user.id, data.contractId);
    const updated = await setContractStatus(
      user.id,
      data.contractId,
      data.contractStatus,
      data.contractDate,
    );
    return updated ? { ok: true as const } : refuseWrite(await roleForContract(user.id, data.contractId));
  });

export const deleteContractFn = createServerFn({ method: "POST" })
  .inputValidator((data: { contractId: number }) => ({ contractId: id(data?.contractId) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditorForContract(user.id, data.contractId);
    const deleted = await deleteContract(user.id, data.contractId);
    return deleted ? { ok: true as const } : refuseWrite(await roleForContract(user.id, data.contractId));
  });

/* --------------------------------------- documents, printed sheets, letters */
/**
 * **Reversal of an earlier rule.** Convocate used to treat a contract entry as
 * status tracking only — not sent / sent / signed — with no document attached
 * and nothing generated from it. The owner has approved documents instead, so
 * this section adds three things:
 *
 *  (C) a printed contract sheet, one contract or the whole board;
 *  (A) attaching a signed PDF or a scan to any entry, downloaded again only
 *      through this file's checks;
 *  (B) a speaker invitation letter, merged from the entry, editable, printable.
 *
 * All three are reads or writes on the same conference data and are gated exactly
 * like it: the example refuses writes (`sample_read_only`), the free plan refuses
 * documents (`upgrade_required`), a Viewer is refused anything that contains an
 * amount, and a stranger gets the same answer as a conference that does not
 * exist.
 */

/** A readable refusal that survives the server-function layer, like `refuseWrite`. */
const refuseRead: (code: string, message: string, status?: number) => never = (code, message, status = 403) => {
  throw new Response(JSON.stringify({ ok: false, code, error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
};

/** A signed-in caller, or a real 403 — so a signed-out request is not a 500. */
const requireUserOrRefuse = async (): Promise<User> => {
  const user = await currentUser();
  if (!user) {
    refuseRead("not_signed_in", "Sign in to your account to open this. Nothing was shown.");
  }
  return user;
};

/**
 * Who may open a printed sheet, download an attached document or build a letter.
 *
 * Owner and editor only, because every one of those carries the amounts — and a
 * committee Viewer is shown no amount anywhere in Convocate, so they are not
 * handed a document full of them either. The shared example is the one
 * exception: its figures are invented for the demo and it is readable by every
 * signed-in account, so its sheet prints for anyone who can already open it.
 */
const requireDocumentReader = async (userId: number, conferenceId: number): Promise<MemberRole> => {
  const role = await roleForConference(userId, conferenceId);
  if (!role) return refuseWrite(null);
  if (await isSampleConference(conferenceId)) return role;
  if (!await canEditRole(role)) {
    if (role === "viewer") {
      refuseRead(
        "viewer_no_documents",
        "Your role on this conference is Viewer. Printed contracts, attached documents and letters carry the fees, so they are for the owner and the editors — ask the owner for Editor access if you need them.",
      );
    }
    return refuseWrite(role);
  }
  return role;
};

/**
 * The plan gate on the printed board and the single printed contract — the two
 * reads that put a conference's contracts (and, on the board, a committee's whole
 * pipeline) onto paper.
 *
 * "Exports" is part of what the $199 unlock promises, so a locked conference must
 * not hand its board out: `UPGRADE_PITCH` is the same 403 `upgrade_required` body
 * every other free-tier refusal uses.
 *
 * Order matters and is deliberate: `requireDocumentReader` runs first, so a
 * signed-out caller is still `not_signed_in`, a Viewer still gets the Viewer
 * message rather than an upgrade pitch about a conference they cannot read, and a
 * stranger still gets the stranger's answer — nobody learns whether a conference
 * they cannot open is paid for. Only then is the plan asked.
 *
 * The shared example is exempt: it comes back from `requireDocumentReader` as a
 * readable conference before this function asks anything, and it is the
 * demonstration — the printed board is one of the things it demonstrates.
 */
const requireSheetReader = async (userId: number, conferenceId: number): Promise<MemberRole> => {
  const role = await requireDocumentReader(userId, conferenceId);
  if (await isSampleConference(conferenceId)) return role;
  if (!await isConferenceUnlocked(conferenceId)) refuseUpgrade();
  return role;
};

/** Money on a print sheet / letter is shown only where the reader may see it. */
const documentsVisibleOn = async (conferenceId: number, role: MemberRole | null): Promise<boolean> =>
  await moneyVisibleOn(conferenceId, role);

const isoToday = (): string => new Date().toISOString().slice(0, 10);

/** The conference fields a sheet or a letter needs — nothing else travels. */
const sheetConference = (conference: {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  expectedAttendance: number;
}) => ({
  id: conference.id,
  name: conference.name,
  startDate: conference.startDate,
  endDate: conference.endDate,
  venue: conference.venue,
  expectedAttendance: conference.expectedAttendance,
});

export type SheetDocument = {
  id: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: number;
};

export type SheetContract = Contract & { documents: SheetDocument[] };

const sheetDocument = (document: ContractDocument): SheetDocument => ({
  id: document.id,
  filename: document.filename,
  mime: document.mime,
  sizeBytes: document.sizeBytes,
  uploadedByName: document.uploadedByName,
  createdAt: document.createdAt,
});

/** Every contract of the conference with its attached documents, for printing. */
const sheetContracts = async (conferenceId: number, role: MemberRole): Promise<SheetContract[]> => {
  const contracts = await listContracts(conferenceId, role);
  const visible = await documentsVisibleOn(conferenceId, role);
  const documents = visible ? await listContractDocuments(conferenceId) : [];
  return contracts.map((contract) => ({
    ...contract,
    documents: documents
      .filter((document) => document.contractId === contract.id)
      .map(sheetDocument),
  }));
};

/**
 * One contract, ready to print: the conference it belongs to, the entry with its
 * amounts and its attached document names, and who printed it when.
 *
 * A read: nothing here writes, on the example or anywhere else. Refused on a
 * free (locked) conference with `upgrade_required` — printing is an export, and
 * exports are part of the $199 unlock.
 */
export const getContractSheetFn = createServerFn({ method: "GET" })
  .inputValidator((data: { contractId: number }) => ({ contractId: id(data?.contractId) }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    const conferenceId = await conferenceIdForContract(data.contractId);
    if (!conferenceId) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
    const role = await requireSheetReader(user.id, conferenceId);
    const conference = await getConference(user.id, conferenceId);
    if (!conference) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
    const contract = (await sheetContracts(conferenceId, role)).find((entry) => entry.id === data.contractId);
    if (!contract) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
    const organizer = await organizerIdentityFor(user.id, conferenceId, role);
    return {
      ok: true as const,
      conference: sheetConference(conference),
      contract,
      printedOn: isoToday(),
      printedBy: user.name || user.email,
      // The organizer's own mark, for the owner of this conference only.
      logo: await organizerLogoFor(user.id, organizer),
      organizerLegalName: organizer?.legalName ?? "",
    };
  });

/**
 * The whole board, for "print all": one entry per contract, each on its own sheet.
 *
 * Gated like the single sheet: the example prints for anyone who can open it, a
 * Viewer and a stranger are refused, and a free (locked) conference is refused
 * with `upgrade_required` — the board is an export.
 */
export const getBoardSheetFn = createServerFn({ method: "GET" })
  .inputValidator((data: { conferenceId: number }) => ({ conferenceId: id(data?.conferenceId) }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    if (!data.conferenceId) refuseRead("not_found", "There is no conference with that id.", 404);
    const role = await requireSheetReader(user.id, data.conferenceId);
    const conference = await getConference(user.id, data.conferenceId);
    if (!conference) refuseRead("not_found", "There is no conference with that id.", 404);
    const contracts = await sheetContracts(data.conferenceId, role);
    const organizer = await organizerIdentityFor(user.id, data.conferenceId, role);
    return {
      ok: true as const,
      conference: sheetConference(conference),
      contracts,
      printedOn: isoToday(),
      printedBy: user.name || user.email,
      // The organizer's own mark, for the owner of this conference only.
      logo: await organizerLogoFor(user.id, organizer),
      organizerLegalName: organizer?.legalName ?? "",
    };
  });

/**
 * Attach a signed contract or a scan to one entry.
 *
 * The bytes arrive base64-encoded in the request and are written to
 * `<data dir>/uploads/<conferenceId>/<contractId>/<uuid>.<ext>`. Nothing the
 * caller sent is used to build a path: the stored name is generated here, and the
 * original filename is kept only as a label.
 *
 * Refused, each with a real 403 and a readable message:
 *   sample_read_only   — the shared example is not writable at any role
 *   (role)             — a Viewer or a stranger cannot upload
 *   upgrade_required   — attaching documents is part of the $199 unlock
 *   unsupported_type   — only PDF, PNG and JPG
 *   file_too_large     — one file may not exceed 10 MB
 *   storage_limit      — one conference may hold at most 100 MB of attachments
 */
export const uploadContractDocumentFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { contractId: number; filename: string; mime: string; dataBase64: string }) => ({
      contractId: id(data?.contractId),
      filename: typeof data?.filename === "string" ? data.filename : "",
      mime: typeof data?.mime === "string" ? data.mime.trim().toLowerCase().slice(0, 100) : "",
      dataBase64: typeof data?.dataBase64 === "string" ? data.dataBase64 : "",
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    const conferenceId = await conferenceIdForContract(data.contractId);
    if (!conferenceId) refuseWrite(await roleForContract(user.id, data.contractId));
    // Same order as every other write: the example first, then the role, then the plan.
    if (await isSampleConference(conferenceId)) refuseSample();
    const role = await roleForConference(user.id, conferenceId);
    if (!await canEditRole(role)) refuseWrite(role);
    if (!await isConferenceUnlocked(conferenceId)) refuseUpgrade();

    // The original name is display metadata only — it is never used to build a
    // path. A name that carries a directory ("../../x.pdf", "a\\b.pdf") is
    // refused outright rather than quietly trimmed: it is not a file name, and a
    // church that sends one should be told, not silently given a different label.
    const rawName = data.filename.trim();
    const originalName = (rawName.split(/[\\/]/).pop() ?? "").trim();
    if (!rawName || rawName !== originalName || rawName.includes("..")) {
      refuseRead(
        "unsafe_filename",
        "That file name contains a path, so it was refused. Attach the file itself (its name alone, without any folders). Nothing was saved.",
      );
    }
    const extension = originalName.includes(".")
      ? originalName.slice(originalName.lastIndexOf(".") + 1).toLowerCase()
      : "";
    const mime =
      data.mime === "image/jpg" || data.mime === "image/pjpeg" ? "image/jpeg" : data.mime;
    const expectedExtension = await extensionForMime(mime);
    if (
      !originalName ||
      !expectedExtension ||
      (extension !== expectedExtension && !(expectedExtension === "jpg" && extension === "jpeg"))
    ) {
      refuseRead(
        "unsupported_type",
        "Only a PDF, a PNG or a JPG can be attached to a contract. Nothing was saved.",
      );
    }
    if (!data.dataBase64) {
      refuseRead("empty_file", "That file is empty, so there was nothing to attach.");
    }
    // Base64 carries 3 bytes per 4 characters; check the size before decoding so
    // an oversized upload is refused instead of held in memory.
    const approximateBytes = Math.floor((data.dataBase64.length * 3) / 4);
    if (approximateBytes > MAX_DOCUMENT_BYTES) {
      refuseRead(
        "file_too_large",
        "That file is larger than 10 MB. Attach a smaller scan or a PDF — nothing was saved.",
      );
    }
    const bytes = Buffer.from(data.dataBase64, "base64");
    if (bytes.byteLength === 0) {
      refuseRead("empty_file", "That file is empty, so there was nothing to attach.");
    }
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      refuseRead(
        "file_too_large",
        "That file is larger than 10 MB. Attach a smaller scan or a PDF — nothing was saved.",
      );
    }
    const used = await conferenceUploadBytes(conferenceId);
    if (used + bytes.byteLength > MAX_CONFERENCE_UPLOAD_BYTES) {
      const megabytes = Math.floor(MAX_CONFERENCE_UPLOAD_BYTES / (1024 * 1024));
      refuseRead(
        "storage_limit",
        `This conference already holds ${String(Math.round(used / (1024 * 1024)))} MB of attached files, and the limit is ${String(megabytes)} MB. Remove a file you no longer need, then attach this one — nothing was saved.`,
      );
    }

    const document = await saveContractDocument({
      conferenceId,
      contractId: data.contractId,
      filename: originalName.slice(0, 200),
      mime,
      uploadedBy: user.id,
      bytes,
    });
    if (!document) {
      refuseRead(
        "upload_failed",
        "The file could not be stored. Nothing was saved — try attaching it again.",
        500,
      );
    }
    return { ok: true as const, document: sheetDocument(document) };
  });

/**
 * Download one attached document. **Every request is checked here** — there is no
 * public path under the data directory, and nothing is served statically, so a
 * URL alone never gets a file: the caller must be signed in and be an owner or
 * editor of the conference the document belongs to, and that conference must be
 * unlocked — an attached contract file is part of the $199 unlock, and a refund
 * that returns a conference to the free plan keeps the row but locks the file.
 */
export const downloadContractDocumentFn = createServerFn({ method: "GET" })
  .inputValidator((data: { documentId: number }) => ({ documentId: id(data?.documentId) }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    const owner = await contractDocumentOwner(data.documentId);
    if (!owner) refuseRead("not_found", "That file is no longer attached.", 404);
    await requireSheetReader(user.id, owner.conferenceId);
    const record = await readContractDocument(data.documentId);
    if (!record) refuseRead("not_found", "That file is no longer attached.", 404);
    return {
      ok: true as const,
      filename: record.document.filename,
      mime: record.document.mime,
      sizeBytes: record.document.sizeBytes,
      dataBase64: record.bytes.toString("base64"),
    };
  });

/** Remove an attached document — the row and the bytes on disk. Owner and editor only. */
export const deleteContractDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((data: { documentId: number }) => ({ documentId: id(data?.documentId) }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    const owner = await contractDocumentOwner(data.documentId);
    if (!owner) return { ok: false as const, error: "That file is no longer attached." };
    if (await isSampleConference(owner.conferenceId)) refuseSample();
    const role = await roleForConference(user.id, owner.conferenceId);
    if (!await canEditRole(role)) return refuseWrite(role);
    if (!await isConferenceUnlocked(owner.conferenceId)) refuseUpgrade();
    const deleted = await deleteContractDocument(data.documentId);
    return deleted
      ? { ok: true as const }
      : { ok: false as const, error: "That file is no longer attached." };
  });

/* ------------------------------------------------ the organizer's identity */
/**
 * The organizer's own details — legal name, postal address, the email notices go
 * to, and who signs — saved once per account at `/app/settings` and merged into
 * the generated agreement and the invitation letter.
 *
 * **Both functions act on the session's account and on nothing else.** Neither
 * one takes a `userId`, in the input validator or anywhere else: the id comes
 * from `currentUser()`, so a forged body that carries `userId` (or a `userId`
 * inside the profile) is dropped before the handler runs and the only row it can
 * touch is the caller's own. There is no plan gate — this is the organizer's own
 * contact card, not a conference feature, so an account on the free plan saves
 * it like any other, and it unlocks nothing: the agreement it appears in is
 * still behind the $199 unlock.
 *
 * Every field is trimmed and capped the way `contractInput` caps its fields, and
 * an empty field stays empty. A value over its cap is refused and named, rather
 * than quietly cut, so an organizer never loses the end of their address to a
 * silent slice.
 */
const ORGANIZER_FIELDS: { key: keyof OrganizerIdentity; label: string; max: number }[] = [
  { key: "legalName", label: "Legal name", max: 200 },
  { key: "addressLine1", label: "Address line 1", max: 200 },
  { key: "addressLine2", label: "Address line 2", max: 200 },
  { key: "city", label: "City", max: 120 },
  { key: "stateRegion", label: "State or region", max: 120 },
  { key: "postalCode", label: "Postal code", max: 40 },
  { key: "country", label: "Country", max: 120 },
  { key: "signerName", label: "Name of the person who signs", max: 160 },
  { key: "signerTitle", label: "Their role", max: 160 },
  { key: "noticesEmail", label: "Email for notices", max: 200 },
  { key: "phone", label: "Phone", max: 60 },
];

const organizerProfileInput = (
  data: Partial<Record<keyof OrganizerIdentity, unknown>> | undefined,
): { profile: OrganizerIdentity; refusal: { field: string; error: string } | null } => {
  const profile: OrganizerIdentity = { ...EMPTY_ORGANIZER };
  for (const field of ORGANIZER_FIELDS) {
    const raw = typeof data?.[field.key] === "string" ? String(data[field.key]).trim() : "";
    if (raw.length > field.max) {
      return {
        profile,
        refusal: {
          field: field.key,
          error: `${field.label} is too long — keep it to ${String(field.max)} characters.`,
        },
      };
    }
    profile[field.key] = raw;
  }
  return { profile, refusal: null };
};

/** The signed-in account's own profile, and never anyone else's. */
export const getOrganizerProfileFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUserOrRefuse();
  return { ok: true as const, profile: await getOrganizerProfile(user.id) };
});

/**
 * Whether this account has a logo, and what kind — never the bytes.
 *
 * The settings page draws the preview from `GET /api/logo`, which reads the same
 * row through the same session, so the image is fetched once and cached nowhere.
 * All this carries is enough to know whether there is one to draw.
 */
export const getOrganizerLogoInfoFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUserOrRefuse();
  const logo = await getOrganizerLogo(user.id);
  return {
    ok: true as const,
    logo: logo
      ? { mime: logo.mime, sizeBytes: logo.bytes.length, updatedAt: logo.updatedAt }
      : null,
  };
});

/**
 * Save the signed-in account's own profile. Anything that is not one of the
 * eleven named fields is ignored, and a refused field is named so the form can
 * put the message on the box that is wrong.
 */
export const saveOrganizerProfileFn = createServerFn({ method: "POST" })
  .inputValidator((data: { profile?: Partial<Record<keyof OrganizerIdentity, unknown>> }) => ({
    profile: data?.profile ?? {},
  }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    const { profile, refusal } = organizerProfileInput(data.profile);
    if (refusal) return { ok: false as const, field: refusal.field, error: refusal.error };
    await saveOrganizerProfile(user.id, profile);
    // Read back what is stored, so the page shows the saved row and not the
    // values it sent — "saved" means saved.
    return { ok: true as const, profile: await getOrganizerProfile(user.id) };
  });

/**
 * Which organizer identity a document should print, for one reader.
 *
 * A profile belongs to an ACCOUNT, and the Organizer on a document is the body
 * running the conference — so it is merged in only when the reader owns this
 * conference. An editor opening the owner's agreement gets no profile: their own
 * organization is not the party to someone else's contract, and printing it
 * there would be worse than printing blanks. The same goes for a Viewer and for
 * the shared example. Anyone who is not the owner therefore gets exactly the
 * document that was produced before profiles existed — blank lines and the
 * account name.
 *
 * It reads nothing belonging to another account: `userId` is the session's, and
 * the answer for anyone who is not the owner is `undefined` without a query.
 */
const organizerIdentityFor = async (
  userId: number,
  conferenceId: number,
  role: MemberRole,
): Promise<OrganizerIdentity | undefined> => {
  if (role !== "owner") return undefined;
  if (await isSampleConference(conferenceId)) return undefined;
  return await getOrganizerProfile(userId);
};

/**
 * The organizer's mark for a document: their saved logo as a `data:` URL, for the
 * SAME reader the profile is merged for and for nobody else.
 *
 * It takes the identity that was already resolved rather than deciding again, so
 * the logo and the legal name beside it can never disagree: an editor, a Viewer,
 * a stranger or the shared example gets `undefined` from `organizerIdentityFor`,
 * and with it no logo — exactly the document those readers got before logos
 * existed. The image is embedded in the page the print route already produces, so
 * no new address exists for it and no second authorization check has to be kept
 * in step with the first.
 */
const organizerLogoFor = async (
  userId: number,
  identity: OrganizerIdentity | undefined,
): Promise<string | null> => {
  if (!identity) return null;
  const logo = await getOrganizerLogo(userId);
  if (!logo) return null;
  return `data:${logo.mime};base64,${Buffer.from(logo.bytes).toString("base64")}`;
};

/**
 * The speaker invitation letter, merged from the entry.
 *
 * A draft, not a message: Convocate sends nothing, so the page offers an editable
 * view and a print button, and no send action exists. The merge itself is in
 * `lib/letter.ts` so the wording is reviewable in one place.
 *
 * Gated as a document (`requireSheetReader`), the same as the printed sheet:
 * signed out → `not_signed_in`; a Viewer → the Viewer refusal; a stranger → the
 * stranger's answer; the shared example → readable; a free (locked) conference →
 * 403 `upgrade_required`, because the letter is one of the things the unlock
 * covers.
 */
export const getInvitationLetterFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: { contractId: number; organiserName?: string }) => ({
      contractId: id(data?.contractId),
      organiserName: text(data?.organiserName, 120),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    const conferenceId = await conferenceIdForContract(data.contractId);
    if (!conferenceId) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
    const role = await requireSheetReader(user.id, conferenceId);
    const conference = await getConference(user.id, conferenceId);
    if (!conference) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
    const contract = (await listContracts(conferenceId, role)).find((entry) => entry.id === data.contractId);
    if (!contract) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
    if (!canHaveInvitationLetter(contract.kind)) {
      refuseRead(
        "wrong_kind",
        "An invitation letter is for a speaker, musician, singer or band. For a venue or a supplier, use the printed contract sheet instead.",
        400,
      );
    }
    const organizer = await organizerIdentityFor(user.id, conferenceId, role);
    const letter = buildInvitationLetter({
      conference: sheetConference(conference),
      contract,
      organizer,
      organiserName: data.organiserName || user.name || user.email,
      today: isoToday(),
    });
    return {
      ok: true as const,
      conference: sheetConference(conference),
      contract,
      subject: letter.subject,
      body: letter.body,
      printedOn: isoToday(),
      organiserName: data.organiserName || user.name || user.email,
      // The organizer's own mark, for the owner of this conference only.
      logo: await organizerLogoFor(user.id, organizer),
      organizerLegalName: organizer?.legalName ?? "",
    };
  });

/* --------------------------------------------------- agreement document */
/**
 * The auto-generated engagement agreement (owner-approved), for one entry.
 *
 * A *draft*, built from the values already on the entry and the conference plus
 * whatever optional terms the organizer saved. It is not e-signature and not legal
 * advice — the document says so in its own footer, and the page that prints it
 * says so too. Nothing is emailed from here; there is no inbox.
 *
 * Authorization is the letter's and the printed sheet's, exactly:
 *   - signed out            → 403 `not_signed_in` (never a 500)
 *   - a stranger            → 403, the same answer as a conference that is absent
 *   - a committee Viewer    → 403 `viewer_no_documents` (it carries the amounts)
 *   - owner / editor        → the document
 *   - the shared example    → readable by anyone who can already open it
 *   - a free (locked) plan  → 403 `upgrade_required`; the generated agreement is
 *                             one of the things the unlock covers, and it locks
 *                             again if a refund returns the conference to free
 * A read: nothing here writes, on the example or anywhere else.
 */
export const getAgreementFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: { contractId: number; organiserName?: string }) => ({
      contractId: id(data?.contractId),
      organiserName: text(data?.organiserName, 120),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    const conferenceId = await conferenceIdForContract(data.contractId);
    if (!conferenceId) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
    const role = await requireSheetReader(user.id, conferenceId);
    const conference = await getConference(user.id, conferenceId);
    if (!conference) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
    const contract = (await listContracts(conferenceId, role)).find((entry) => entry.id === data.contractId);
    if (!contract) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
    const organiserName = data.organiserName || user.name || user.email;
    const stored = await getAgreementTerms(data.contractId);
    // The other party's electronic acceptance, if there is one. The signature
    // block prints it; the rest of the document is unchanged either way.
    const signature = await getContractSignature(data.contractId);
    const organizer = await organizerIdentityFor(user.id, conferenceId, role);
    const document = buildAgreement({
      conference: sheetConference(conference),
      contract,
      terms: stored.terms,
      organizer,
      organiserName,
      acceptance: signature,
      today: isoToday(),
    });
    return await withholdMoneyDeep(
      {
        ok: true as const,
        conference: sheetConference(conference),
        contract,
        terms: stored.terms,
        termsSavedAt: stored.savedAt,
        title: document.title,
        subtitle: document.subtitle,
        body: document.body,
        clauses: document.clauses,
        printedOn: isoToday(),
        signature,
        organiserName,
        // The organizer's own mark, for the owner of this conference only.
        logo: await organizerLogoFor(user.id, organizer),
        organizerLegalName: organizer?.legalName ?? "",
      },
      await documentsVisibleOn(conferenceId, role),
    );
  });

/**
 * The saved agreement terms for one entry, for the organizer's form. A read, and
 * gated like the agreement itself — these fields can mention amounts (caps on
 * travel, a deposit treatment), so a Viewer is not handed them, and a free
 * (locked) conference is refused `upgrade_required` for the same reason the
 * agreement is: the terms build it.
 */
export const getAgreementTermsFn = createServerFn({ method: "GET" })
  .inputValidator((data: { contractId: number }) => ({ contractId: id(data?.contractId) }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    const conferenceId = await conferenceIdForContract(data.contractId);
    if (!conferenceId) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
    await requireSheetReader(user.id, conferenceId);
    const stored = await getAgreementTerms(data.contractId);
    return { ok: true as const, terms: stored.terms, termsSavedAt: stored.savedAt };
  });

/**
 * Save the agreement terms on one entry.
 *
 * The gates are the board's own, in the same order as every other contract write:
 *   - the shared example     → 403 `sample_read_only`, whatever the role or plan
 *   - a Viewer / a stranger  → 403 (readable refusal)
 *   - a free-plan conference → 403 `upgrade_required`
 * Only the agreement columns are written; the card's own values are untouched.
 */
export const saveAgreementTermsFn = createServerFn({ method: "POST" })
  .inputValidator((data: { contractId: number } & Partial<AgreementTerms>) => ({
    contractId: id(data?.contractId),
    terms: agreementTermsInput(data ?? {}),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditorForContract(user.id, data.contractId);
    const saved = await updateAgreementTerms(user.id, data.contractId, data.terms);
    return saved
      ? { ok: true as const, terms: data.terms }
      : refuseWrite(await roleForContract(user.id, data.contractId));
  });

/* ------------------------------------------- electronic signature (slice 1) */
/**
 * Electronic acceptance of the generated agreement by the OTHER party, through a
 * private link — the owner's decision: a typed name, a tick and a timestamp,
 * recorded against the version of the text they were shown.
 *
 * Two halves, with two different gates:
 *
 *   - **The organizer's half** (`getSignatureRequestFn`,
 *     `createSignatureRequestFn`, `revokeSignatureRequestFn`) is gated exactly
 *     like the agreement it signs, through `requireEditor`: signed out →
 *     `not_signed_in`; the shared example → `sample_read_only`; a Viewer or a
 *     stranger → the readable write refusal; a free (locked) conference →
 *     `upgrade_required`. Nothing here emails anything: the organizer copies the
 *     link and sends it themselves.
 *   - **The public half** (`getSignaturePageFn`, `submitSignatureFn`) takes a
 *     token and nothing else — no conference id, no account — exactly like
 *     `getPublicRegistrationFn`. The query is the guard, and every refusal is the
 *     same value, so a wrong, revoked, expired or already-used link is
 *     indistinguishable from outside.
 */

/** Where the signing page lives. The page itself needs nothing but the token. */
const signatureLinkPath = (token: string): string => `/sign/${token}`;

/**
 * The gates on issuing, reading or revoking a link, in the order every other
 * contract write meets them (`requireEditor`: example, then role, then plan).
 */
const requireSignatureIssuer = async (
  contractId: number,
): Promise<{ user: User; conferenceId: number }> => {
  const user = await requireUserOrRefuse();
  if (!contractId) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
  const conferenceId = await conferenceIdForContract(contractId);
  if (!conferenceId) refuseRead("not_found", "There is no guest or supplier with that id.", 404);
  await requireEditor(user.id, conferenceId);
  return { user, conferenceId };
};

/**
 * The organizer's own view: the link (if one was ever issued), its state, and
 * the version of the agreement a new link would carry.
 */
export const getSignatureRequestFn = createServerFn({ method: "GET" })
  .inputValidator((data: { contractId: number }) => ({ contractId: id(data?.contractId) }))
  .handler(async ({ data }) => {
    await requireSignatureIssuer(data.contractId);
    const request = await latestSignatureRequest(data.contractId);
    return {
      ok: true as const,
      request: request ? { ...request, path: signatureLinkPath(request.token) } : null,
      agreementVersion: await signatureAgreementVersion(data.contractId),
    };
  });

/**
 * Issue a link. Re-issuing revokes the previous one rather than deleting it, so
 * a link the organizer believes is dead cannot come back to life — the panel
 * says so, and the old link is refused from that moment.
 */
export const createSignatureRequestFn = createServerFn({ method: "POST" })
  .inputValidator((data: { contractId: number }) => ({ contractId: id(data?.contractId) }))
  .handler(async ({ data }) => {
    const { user } = await requireSignatureIssuer(data.contractId);
    const version = await signatureAgreementVersion(data.contractId);
    const request = await createSignatureRequest(user.id, data.contractId, version);
    if (!request) return refuseWrite(await roleForContract(user.id, data.contractId));
    return {
      ok: true as const,
      request: { ...request, path: signatureLinkPath(request.token) },
      agreementVersion: version,
    };
  });

/** Kill the live link. A link that has already been used cannot be revoked away. */
export const revokeSignatureRequestFn = createServerFn({ method: "POST" })
  .inputValidator((data: { contractId: number }) => ({ contractId: id(data?.contractId) }))
  .handler(async ({ data }) => {
    const { user } = await requireSignatureIssuer(data.contractId);
    const revoked = await revokeSignatureRequest(user.id, data.contractId);
    const request = await latestSignatureRequest(data.contractId);
    return {
      ok: true as const,
      revoked,
      request: request ? { ...request, path: signatureLinkPath(request.token) } : null,
      agreementVersion: await signatureAgreementVersion(data.contractId),
    };
  });

/**
 * One sentence for every unusable link — wrong token, revoked, expired or
 * already used. The person holding it is told what to do next and nothing about
 * which of the four it was, because that distinction is what would let someone
 * probe for links that exist.
 */
const SIGNATURE_LINK_UNUSABLE =
  "This signing link cannot be used. It may have been replaced or revoked, it may have expired, or it may already have been used. Nothing has been recorded — ask the organizer to send you a new link.";

/**
 * The signing page's data, from the token alone. Signed out is the normal case,
 * so there is no session here at all.
 *
 * It shows the agreement — the event, the parties, the terms and the fee, which
 * is what the guest is being asked to accept — and nothing else: no attendee, no
 * budget, no other contract, no committee, no id.
 */
export const getSignaturePageFn = createServerFn({ method: "GET" })
  .inputValidator((data: { token: string }) => ({ token: tokenText(data?.token) }))
  .handler(async ({ data }) => await getSignaturePage(data.token));

/**
 * Take one acceptance.
 *
 * Field refusals are answered before the token is looked at, so a bad link and a
 * good one behave the same until the form is actually complete. The version the
 * page was rendered from travels back with the submission; the server rebuilds
 * the agreement and refuses if it has changed, rather than recording someone as
 * accepting words they never saw.
 */
export const submitSignatureFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      token: string;
      name: string;
      email?: string;
      shownVersion: string;
      accepted?: boolean;
      image?: string;
    }) => ({
      token: tokenText(data?.token),
      name: text(data?.name, 120),
      email: text(data?.email, 200),
      shownVersion: text(data?.shownVersion, 128),
      accepted: data?.accepted === true,
      // Passed through untrimmed and unsliced on purpose: it is base64, and
      // `text()` would corrupt it. `sanitizeSignatureImage` in db.server.ts is
      // what checks it, and it checks length first, then the bytes.
      image: typeof data?.image === "string" ? data.image : "",
    }),
  )
  .handler(async ({ data }) => {
    const refuseField = (field: string, error: string) =>
      ({ ok: false as const, code: "field" as const, field, error });
    if (!data.name) return refuseField("name", "Please type your full name.");
    if (data.email && !looksLikeEmail(data.email)) {
      return refuseField(
        "email",
        "That email address does not look complete — check it. For example: name@example.org.",
      );
    }
    if (!data.accepted) {
      return refuseField(
        "accepted",
        "Please check the box to confirm that you accept this agreement. Nothing is recorded until you do.",
      );
    }
    // A drawn signature is optional and can never block the signature: the
    // image is checked inside `recordSignatureAcceptance`, which stores "" and
    // records the acceptance anyway if it is not a small, real PNG.
    const result = await recordSignatureAcceptance(data.token, {
      name: data.name,
      email: data.email,
      shownVersion: data.shownVersion,
      ip: getRequestIP({ xForwardedFor: true }) ?? "",
      image: data.image,
    });
    if (result.ok) return { ok: true as const, acceptedAt: result.acceptedAt, name: result.name };
    if (result.code === "changed") {
      return {
        ok: false as const,
        code: "changed" as const,
        error:
          "This agreement was changed after this page was opened, so nothing was recorded. Reload the page, read the current version, and accept it if you still agree.",
      };
    }
    return { ok: false as const, code: "unusable" as const, error: SIGNATURE_LINK_UNUSABLE };
  });

/* ------------------------------------------------- committee access */

export const createInviteFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number; role: InviteRole }) => ({
    conferenceId: id(data?.conferenceId),
    role: inviteRole(data?.role),
  }))
  .handler(async ({ data }) => {
    // Nothing on this path may throw: a rejection reaches the browser as an
    // unhandled promise and the panel just goes quiet. Log the real stack
    // server-side and hand the client a message it can render.
    try {
      const user = await requireUser();
      // The example never takes a committee: it is already open to everyone.
      if (await isSampleConference(data.conferenceId)) refuseSample();
      const role = await roleForConference(user.id, data.conferenceId);
      if (role !== "owner") return refuseWrite(role);
      // Committee invites are part of the $199 upgrade on this conference.
      if (!await isConferenceUnlocked(data.conferenceId)) refuseUpgrade();
      const invite = await createInvite(user.id, data.conferenceId, data.role);
      if (!invite) return refuseWrite(role);
      return { ok: true as const, token: invite.token, expiresAt: invite.expiresAt, role: data.role };
    } catch (cause) {
      // A refusal thrown as a Response (see refuseWrite) must keep its 403.
      if (cause instanceof Response) throw cause;
      console.error("[createInviteFn] failed", cause);
      return {
        ok: false as const,
        error:
          cause instanceof Error && cause.message === "Not signed in"
            ? "Your session has ended. Sign in again to create an invite link."
            : "Could not create the invite link. Nothing was saved — try again.",
      };
    }
  });

export const revokeInviteFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => ({ token: tokenText(data?.token) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const found = await findInvite(data.token);
    if (!found) return { ok: false as const, error: "That invite no longer exists." };
    if (await isSampleConference(found.conferenceId)) refuseSample();
    const role = await roleForConference(user.id, found.conferenceId);
    if (role !== "owner") return refuseWrite(role);
    await revokeInvite(user.id, data.token);
    return { ok: true as const };
  });

/**
 * Public preview of a link, so the invite page can say whose conference it is
 * and which role it grants before the visitor signs in. It returns no
 * conference content — only the name and the role being offered.
 */
export const getInviteFn = createServerFn({ method: "GET" })
  .inputValidator((data: { token: string }) => ({ token: tokenText(data?.token) }))
  .handler(async ({ data }) => {
    const invite = await findInvite(data.token);
    if (!invite) return { valid: false as const, reason: "invalid" as const };
    if (invite.revokedAt !== null) return { valid: false as const, reason: "revoked" as const };
    if (invite.expiresAt < Date.now()) return { valid: false as const, reason: "expired" as const };
    const conferenceName = await getConferenceName(invite.conferenceId);
    if (!conferenceName) return { valid: false as const, reason: "invalid" as const };
    const user = await currentUser();
    return {
      valid: true as const,
      token: invite.token,
      conferenceId: invite.conferenceId,
      conferenceName,
      role: invite.role,
      expiresAt: invite.expiresAt,
      signedIn: !!user,
      currentRole: user ? await roleForConference(user.id, invite.conferenceId) : null,
    };
  });

export const acceptInviteFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => ({ token: tokenText(data?.token) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const result = await acceptInvite(user.id, data.token);
    if (!result.ok) {
      return {
        ok: false as const,
        reason: result.reason,
        error:
          result.reason === "revoked"
            ? "This invite link was revoked by the conference owner."
            : result.reason === "expired"
              ? "This invite link has expired."
              : "This invite link is not valid.",
      };
    }
    return { ok: true as const, conferenceId: result.conferenceId, role: result.role };
  });

export const setMemberRoleFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number; userId: number; role: InviteRole }) => ({
    conferenceId: id(data?.conferenceId),
    userId: id(data?.userId),
    role: inviteRole(data?.role),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (await isSampleConference(data.conferenceId)) refuseSample();
    const role = await roleForConference(user.id, data.conferenceId);
    if (role !== "owner") return refuseWrite(role);
    const ok = await setMemberRole(user.id, data.conferenceId, data.userId, data.role);
    return ok
      ? { ok: true as const }
      : { ok: false as const, error: "That person cannot be changed (the owner keeps their role)." };
  });

export const removeMemberFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number; userId: number }) => ({
    conferenceId: id(data?.conferenceId),
    userId: id(data?.userId),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (await isSampleConference(data.conferenceId)) refuseSample();
    const role = await roleForConference(user.id, data.conferenceId);
    if (role !== "owner") return refuseWrite(role);
    const ok = await removeMember(user.id, data.conferenceId, data.userId);
    return ok
      ? { ok: true as const }
      : { ok: false as const, error: "That person cannot be removed (the owner keeps access)." };
  });

/** A member can take themselves off the list. The owner cannot leave. */
export const leaveConferenceFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number }) => ({ conferenceId: id(data?.conferenceId) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (await isSampleConference(data.conferenceId)) refuseSample();
    const role = await roleForConference(user.id, data.conferenceId);
    if (role !== "editor" && role !== "viewer") return refuseWrite(role);
    const ok = await leaveConference(user.id, data.conferenceId);
    return ok ? { ok: true as const } : refuseWrite(role);
  });

/* ------------------------------------------------- event registration */

/**
 * Event registration, phase A — the workspace side only.
 *
 * What a church does here: switch registration on, set a cap, write the words
 * for attendees, offer ticket types, and record who is coming (a walk-up at the
 * door, or a registration taken by hand). What it never does: charge anybody.
 * A fee is 'unpaid' or marked 'paid_by_hand' because the church took cash or a
 * check; Convocate never holds a church's money, and the public registration
 * page that will take registrations itself is phase B.
 *
 * The gates are the app's existing ones, in the app's existing order:
 * signed-out is refused before anything else, a stranger gets the same answer as
 * a conference that does not exist, the shared example is readable and never
 * writable, and a conference that has not been unlocked is refused with
 * `upgrade_required` — registration is part of what the $199 opens.
 */

/**
 * May this caller read a conference's registration at all?
 *
 * Owner and Editor always may. A committee Viewer may read the attendee list —
 * names, emails, tickets and places are not money — but every amount comes back
 * `null` (see `listAttendees`/`listTicketTypes`, which ask `moneyVisibleOn`).
 * A signed-out caller is refused by `requireUserOrRefuse` before this runs.
 */
const requireRegistrationReader = async (userId: number, conferenceId: number): Promise<MemberRole> => {
  const role = await roleForConference(userId, conferenceId);
  if (!role) return refuseWrite(null);
  // The example reads for anyone who can open it; its registration is empty and
  // nothing on it can be changed.
  if (await isSampleConference(conferenceId)) return role;
  if (!await isConferenceUnlocked(conferenceId)) refuseUpgrade(REGISTRATION_LOCKED_MESSAGE);
  return role;
};

/** The same gates for a write addressed by ticket-type id. */
const requireEditorForTicketType = async (userId: number, ticketTypeId: number): Promise<number> => {
  const conferenceId = await conferenceIdForTicketType(ticketTypeId);
  if (!conferenceId) refuseRead("not_found", "There is no ticket type with that id.", 404);
  await requireEditor(userId, conferenceId);
  return conferenceId;
};

/** The same gates for a write addressed by attendee id. */
const requireEditorForAttendee = async (userId: number, attendeeId: number): Promise<number> => {
  const conferenceId = await conferenceIdForAttendee(attendeeId);
  if (!conferenceId) refuseRead("not_found", "There is no registration with that id.", 404);
  await requireEditor(userId, conferenceId);
  return conferenceId;
};

/** An email as typed, only lightly checked: a walk-up may have none at all. */
const looksLikeEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** A whole number of places, floored at 0 and capped so a typo cannot run away. */
const places = (value: unknown, max = 10_000): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
};

/**
 * Everything the registration section needs, in one read: the switch and the
 * cap, the ticket types, the attendee list and the counts.
 *
 * Money is withheld here rather than hidden by the page: a Viewer's payload has
 * no price on any ticket, no amount on any attendee, and a `null` total due —
 * exactly the way the budget and the contracts withhold it. Places, names,
 * tickets and dates are not money and always travel.
 */
export const getRegistrationFn = createServerFn({ method: "GET" })
  .inputValidator((data: { conferenceId: number }) => ({ conferenceId: id(data?.conferenceId) }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    if (!data.conferenceId) refuseRead("not_found", "There is no conference with that id.", 404);
    const role = await requireRegistrationReader(user.id, data.conferenceId);
    const sample = await isSampleConference(data.conferenceId);
    const moneyVisible = await moneyVisibleOn(data.conferenceId, role);
    const settings = await getRegistrationSettings(data.conferenceId);
    const ticketTypes = await listTicketTypes(data.conferenceId, role);
    const attendees = await listAttendees(data.conferenceId, role);
    // The link a church shares with its congregation. Generated once and kept;
    // a Viewer may see it too (a link is not money, and a committee greets
    // attendees), but the read-only example never gets one — nobody registers on
    // a demonstration.
    const publicPath = sample ? null : `/register/${await ensurePublicRegistrationToken(data.conferenceId)}`;
    // Places are not money: a Viewer gets the real headcount and the real
    // places left. `sumMoney` is `null` the moment any amount was withheld, so a
    // Viewer never receives a partial total that could be read as the whole.
    const headcount = attendees.reduce((sum, attendee) => sum + attendee.quantity, 0);
    // A fee counts as paid when it was paid by hand OR by card through the
    // organizer's own Stripe account. 'pending' is not paid: the card page was
    // opened and nothing has come back from Stripe yet.
    const paid = attendees.filter((attendee) => isAttendeePaid(attendee.paymentStatus));
    const unpaid = attendees.filter((attendee) => !isAttendeePaid(attendee.paymentStatus));
    return await withholdMoneyDeep(
      {
        ok: true as const,
        role,
        sample,
        /** What the page may offer. The server refuses regardless. */
        canEdit: role !== "viewer" && !sample,
        settings,
        /** `/register/<token>`, or `null` on the read-only example. */
        publicPath,
        ticketTypes,
        attendees,
        totals: {
          headcount,
          attendeeCount: attendees.length,
          /** `null` when the conference has no cap. */
          placesRemaining: settings.capacity > 0 ? Math.max(0, settings.capacity - headcount) : null,
          totalDueCents: sumMoney(attendees.map((attendee) => attendee.amountDueCents)),
          paidCents: sumMoney(paid.map((attendee) => attendee.amountDueCents)),
          unpaidCents: sumMoney(unpaid.map((attendee) => attendee.amountDueCents)),
          paidCount: paid.reduce((sum, attendee) => sum + attendee.quantity, 0),
          unpaidCount: unpaid.reduce((sum, attendee) => sum + attendee.quantity, 0),
        },
      },
      moneyVisible,
    );
  });

/**
 * The switch, the cap and the words for attendees. One save, so a church can
 * open registration with everything it needs in a single step.
 *
 * The cap may not be set below the places already registered: silently dropping
 * people who have already registered would be the app deciding who is coming.
 */
export const saveRegistrationSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number; isOpen: boolean; capacity: number | string; instructions: string }) => ({
    conferenceId: id(data?.conferenceId),
    isOpen: data?.isOpen === true,
    capacity:
      typeof data?.capacity === "number" || typeof data?.capacity === "string"
        ? String(data.capacity).trim()
        : "",
    instructions: text(data?.instructions, 4000),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditor(user.id, data.conferenceId);
    let capacity = 0;
    if (data.capacity !== "") {
      if (!/^\d+$/.test(data.capacity)) {
        return {
          ok: false as const,
          field: "capacity",
          error: "Enter the cap as a whole number of places, or leave it blank for no cap.",
        };
      }
      capacity = places(data.capacity);
    }
    const headcount = await registrationHeadcount(data.conferenceId);
    if (capacity > 0 && capacity < headcount) {
      return {
        ok: false as const,
        field: "capacity",
        error: `${String(headcount)} places are already registered, so the cap cannot be set below that. Raise it to ${String(headcount)} or more, or leave it blank for no cap — nobody already registered has been removed.`,
      };
    }
    const saved = await saveRegistrationSettings(user.id, data.conferenceId, {
      isOpen: data.isOpen,
      capacity,
      instructions: data.instructions,
    });
    return saved ? { ok: true as const } : refuseWrite(await roleForConference(user.id, data.conferenceId));
  });

/**
 * Create or update one ticket type. `ticketTypeId` 0 means "new".
 *
 * A ticket's own limit can never be set below the places already registered
 * against it — the refusal names the number, and nothing is truncated.
 */
export const saveTicketTypeFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      conferenceId: number;
      ticketTypeId?: number;
      name: string;
      priceCents: number | string;
      quantityLimit: number | string;
      active?: boolean;
    }) => ({
      conferenceId: id(data?.conferenceId),
      ticketTypeId: id(data?.ticketTypeId),
      name: text(data?.name, 120),
      priceCents: wholeCents(data?.priceCents),
      quantityLimit: places(data?.quantityLimit),
      active: data?.active !== false,
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (data.ticketTypeId > 0) {
      // A write addressed by id may not be aimed at another conference: the id's
      // own conference is the one the gates are asked about, and the save is
      // scoped to it below.
      const owner = await requireEditorForTicketType(user.id, data.ticketTypeId);
      if (owner !== data.conferenceId) {
        refuseWrite(await roleForConference(user.id, data.conferenceId));
      }
    } else {
      await requireEditor(user.id, data.conferenceId);
    }
    if (!data.name) return { ok: false as const, field: "name", error: "Give this ticket a name." };
    const result = await saveTicketType(
      user.id,
      data.conferenceId,
      {
        name: data.name,
        priceCents: data.priceCents,
        quantityLimit: data.quantityLimit,
        active: data.active,
      },
      data.ticketTypeId,
    );
    if (result.ok) return { ok: true as const };
    if (result.code === "limit") {
      return {
        ok: false as const,
        field: "quantityLimit",
        error: `${String(result.registered)} places have already been registered on this ticket, so its limit cannot be set to ${String(result.limit)}. Raise the limit to ${String(result.registered)} or more, or leave it blank for no limit — nothing already registered was changed.`,
      };
    }
    if (result.code === "not_found") {
      return refuseRead("not_found", "There is no ticket type with that id.", 404);
    }
    return refuseWrite(await roleForConference(user.id, data.conferenceId));
  });

/**
 * Remove a ticket type nobody has registered against. A ticket with
 * registrations attached is refused, and the answer says how many: switching it
 * off (the `active` flag) is how a church retires a ticket without losing what
 * people registered for.
 */
export const deleteTicketTypeFn = createServerFn({ method: "POST" })
  .inputValidator((data: { ticketTypeId: number }) => ({ ticketTypeId: id(data?.ticketTypeId) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const conferenceId = await requireEditorForTicketType(user.id, data.ticketTypeId);
    const result = await deleteTicketType(user.id, data.ticketTypeId);
    if (result.ok) return { ok: true as const };
    if (result.code === "in_use") {
      return {
        ok: false as const,
        error: `${String(result.attendees)} registration${result.attendees === 1 ? " is" : "s are"} against this ticket, so it was not deleted — deleting it would leave them with no ticket. Switch it off instead to stop offering it.`,
      };
    }
    if (result.code === "not_found") {
      return refuseRead("not_found", "There is no ticket type with that id.", 404);
    }
    return refuseWrite(await roleForConference(user.id, conferenceId));
  });

/**
 * Record one registration by hand — a walk-up at the desk, or a registration
 * taken by phone or on paper.
 *
 * The amount due is the ticket's price at this moment times the places, stored
 * on the row so a later price change never rewrites what this person was told.
 * Capacity and the ticket's limit are checked server-side in one transaction:
 * an add that would go over either is refused with the number that was hit, and
 * never truncated to fit.
 */
export const addAttendeeFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      conferenceId: number;
      ticketTypeId: number;
      name: string;
      email?: string;
      quantity: number | string;
      paidByHand?: boolean;
      paidNote?: string;
    }) => ({
      conferenceId: id(data?.conferenceId),
      ticketTypeId: id(data?.ticketTypeId),
      name: text(data?.name, 160),
      email: text(data?.email, 200),
      quantity:
        typeof data?.quantity === "number" || typeof data?.quantity === "string"
          ? String(data.quantity).trim()
          : "",
      paidByHand: data?.paidByHand === true,
      paidNote: text(data?.paidNote, 300),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditor(user.id, data.conferenceId);
    const refuse = (field: string, error: string) => ({ ok: false as const, field, error });
    if (!data.name) return refuse("name", "Add the name of the person registering.");
    if (data.email && !looksLikeEmail(data.email)) {
      return refuse("email", "That email address does not look complete — check it, or leave it blank.");
    }
    if (!data.ticketTypeId) return refuse("ticketTypeId", "Choose the ticket they are registering on.");
    if (!/^\d+$/.test(data.quantity) || Number(data.quantity) < 1) {
      return refuse("quantity", "Enter how many places as a whole number, 1 or more.");
    }
    const quantity = places(data.quantity, 500);
    if (quantity < 1) return refuse("quantity", "Enter how many places as a whole number, 1 or more.");
    const result = await insertAttendee(user.id, data.conferenceId, {
      ticketTypeId: data.ticketTypeId,
      name: data.name,
      email: data.email,
      quantity,
      paidByHand: data.paidByHand,
      paidNote: data.paidNote,
    });
    if (result.ok) return { ok: true as const };
    if (result.code === "bad_ticket") {
      return refuse(
        "ticketTypeId",
        "That ticket is not on offer on this conference any more. Choose an active ticket type, or add one first.",
      );
    }
    if (result.code === "capacity") {
      const left = Math.max(0, result.capacity - result.headcount);
      return refuse(
        "quantity",
        `This conference is capped at ${String(result.capacity)} places and ${String(result.headcount)} are already registered, so only ${String(left)} ${left === 1 ? "place is" : "places are"} left — not the ${String(result.quantity)} you asked for. Nothing was added. Raise the cap on this page first if the number has changed.`,
      );
    }
    if (result.code === "ticket_limit") {
      const left = Math.max(0, result.limit - result.registered);
      return refuse(
        "quantity",
        `“${result.ticketName}” is limited to ${String(result.limit)} places and ${String(result.registered)} are already taken, so only ${String(left)} ${left === 1 ? "place is" : "places are"} left — not the ${String(result.quantity)} you asked for. Nothing was added. Raise that ticket's limit first if the number has changed.`,
      );
    }
    return refuseWrite(await roleForConference(user.id, data.conferenceId));
  });

/** Mark a fee paid by hand (cash or check), or undo that. No card, no charge. */
export const setAttendeePaidFn = createServerFn({ method: "POST" })
  .inputValidator((data: { attendeeId: number; paid: boolean; note?: string }) => ({
    attendeeId: id(data?.attendeeId),
    paid: data?.paid === true,
    note: text(data?.note, 300),
  }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditorForAttendee(user.id, data.attendeeId);
    const updated = await setAttendeePaid(user.id, data.attendeeId, data.paid, data.note);
    return updated
      ? { ok: true as const }
      : refuseWrite(await roleForConference(user.id, (await conferenceIdForAttendee(data.attendeeId)) ?? 0));
  });

/** Remove a registration. It frees the place it was holding. */
export const deleteAttendeeFn = createServerFn({ method: "POST" })
  .inputValidator((data: { attendeeId: number }) => ({ attendeeId: id(data?.attendeeId) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requireEditorForAttendee(user.id, data.attendeeId);
    const deleted = await deleteAttendee(user.id, data.attendeeId);
    return deleted
      ? { ok: true as const }
      : refuseWrite(await roleForConference(user.id, (await conferenceIdForAttendee(data.attendeeId)) ?? 0));
  });

/**
 * One cell of the CSV, made safe for a spreadsheet.
 *
 * A name or an email is typed by a person, and a spreadsheet treats a cell that
 * starts with `=`, `+`, `-` or `@` as a formula. So such a cell is prefixed with
 * an apostrophe (which a spreadsheet shows as text, not as a formula), and any
 * cell holding a comma, a quote or a newline is quoted, with its quotes doubled.
 */
const csvCell = (value: string | number | null | undefined): string => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * The attendee list as a CSV file, authorized exactly like the other export
 * routes: signed out is refused, a locked conference is refused
 * (`upgrade_required`), a stranger gets the stranger's answer, and a Viewer may
 * download the list but with **no money columns at all** — not a blanked one, an
 * absent one, because a Viewer is shown no amount anywhere in Convocate.
 *
 * The file is plain CSV with a UTF-8 byte-order mark so a spreadsheet opens the
 * accented names correctly, and every cell goes through `csvCell` so nothing in
 * an attendee's name can run as a formula.
 */
export const getAttendeesCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: { conferenceId: number }) => ({ conferenceId: id(data?.conferenceId) }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    if (!data.conferenceId) refuseRead("not_found", "There is no conference with that id.", 404);
    const role = await requireRegistrationReader(user.id, data.conferenceId);
    const moneyVisible = await moneyVisibleOn(data.conferenceId, role);
    const settings = await getRegistrationSettings(data.conferenceId);
    const attendees = await listAttendees(data.conferenceId, role);
    const name = (await getConferenceName(data.conferenceId)) ?? "conference";
    const header = [
      "Name",
      "Email",
      "Ticket",
      "Quantity",
      ...(moneyVisible ? ["Amount due"] : []),
      "Payment status",
      "Registered (UTC)",
    ];
    const rows = attendees.map((attendee) => [
      attendee.name,
      attendee.email,
      attendee.ticketTypeName || "—",
      String(attendee.quantity),
      ...(moneyVisible
        ? [attendee.amountDueCents === null ? "" : (attendee.amountDueCents / 100).toFixed(2)]
        : []),
      attendee.paymentStatus === "paid_by_hand"
        ? attendee.paidNote
          ? `Paid by hand (${attendee.paidNote})`
          : "Paid by hand"
        : attendeePaymentLabel(attendee.paymentStatus),
      new Date(attendee.registeredAt).toISOString().slice(0, 19).replace("T", " "),
    ]);
    const csv = `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "conference";
    const today = new Date().toISOString().slice(0, 10);
    return {
      ok: true as const,
      fileName: `registration-${slug}-${today}.csv`,
      csv,
      rowCount: attendees.length,
      /** Places on file, so the page can say what it exported. */
      headcount: attendees.reduce((sum, attendee) => sum + attendee.quantity, 0),
      moneyIncluded: moneyVisible,
      capacity: settings.capacity,
    };
  });

/* --------------------------------- the attendee-facing page (phase B) */

/**
 * Public event registration: the page a church sends to its congregation.
 *
 * Anyone holding the link can use it — no account, no sign-in — so the two
 * functions below are the only unauthenticated ones in this file that touch a
 * conference. What protects them:
 *
 *  - **The token.** 24 random characters, generated once per conference and
 *    stored; not the numeric id, and not enumerable. A token that does not match
 *    is answered "not found" like any other wrong link.
 *  - **What comes back.** Only the conference's public fields and the tickets on
 *    offer with the places left. No attendee name, no email, no total, no
 *    revenue, no budget, no contract — those are not filtered out, they are
 *    never read.
 *  - **What writes.** Nothing in the app's member/plan gates changes: the write
 *    below refuses a conference the unlock has not opened, a closed
 *    registration, and a full one — inside the same transaction as the insert.
 *  - **Two small guards** against a page being used as a form spammer's target:
 *    a honeypot field no person fills in, and a per-address limit on how often
 *    one address may submit. Deliberately small: this is a guard, not a wall.
 */

/** How many submissions one address may make in one window. */
const PUBLIC_SUBMIT_MAX = 20;
const PUBLIC_SUBMIT_WINDOW_MS = 10 * 60 * 1000;
/** address → the moments it submitted. Trimmed on every request, so it cannot grow. */
const publicSubmitLog = new Map<string, number[]>();

const publicSubmitBlocked = (address: string): boolean => {
  const now = Date.now();
  for (const [key, times] of publicSubmitLog) {
    const recent = times.filter((at) => now - at < PUBLIC_SUBMIT_WINDOW_MS);
    if (recent.length === 0) publicSubmitLog.delete(key);
    else publicSubmitLog.set(key, recent);
  }
  return (publicSubmitLog.get(address) ?? []).length >= PUBLIC_SUBMIT_MAX;
};

const recordPublicSubmit = (address: string): void => {
  const times = publicSubmitLog.get(address) ?? [];
  times.push(Date.now());
  publicSubmitLog.set(address, times);
  // A hard ceiling on the map itself, so a flood of addresses cannot fill memory.
  if (publicSubmitLog.size > 2000) {
    const oldest = [...publicSubmitLog.entries()].sort((a, b) => a[1][0] - b[1][0]).slice(0, 1000);
    for (const [key] of oldest) publicSubmitLog.delete(key);
  }
};


/* -------------------------------------- the pre/post-conference checklist */

/**
 * The checklist panel on an event: "what still has to happen" before the day
 * and after it.
 *
 * The gates are the app's own, in the app's own order (see `requireEditor`):
 * signed out is refused first, a stranger is answered like a conference that
 * does not exist, the shared example is readable and never writable, a Viewer
 * reads and changes nothing, and a conference that has not been unlocked is
 * refused `upgrade_required`. A Viewer's refusal is a real 403 from here, not a
 * hidden button: the panel hides the controls, and the server refuses the
 * request even when the panel is bypassed.
 *
 * The default list is written once per conference, on the first open by
 * someone who may edit it — never up front for every conference in the
 * database, and never a second time (see `seedChecklistOnce`).
 */

/** The gate on the checklist READ: signed out, stranger, sample, then the plan. */
const requireChecklistReader = async (userId: number, conferenceId: number): Promise<MemberRole> => {
  const role = await roleForConference(userId, conferenceId);
  if (!role) return refuseWrite(null);
  // The shared example reads for anyone who can open it. Its checklist is never
  // written: the panel shows the template unsaved and nothing can be ticked.
  if (await isSampleConference(conferenceId)) return role;
  if (!await isConferenceUnlocked(conferenceId)) refuseUpgrade(CHECKLIST_LOCKED_MESSAGE);
  return role;
};

/**
 * The gate on every checklist WRITE. The same three doors as `requireEditor`,
 * with the plan refusal naming the checklist rather than the budget.
 */
const requireChecklistEditor = async (userId: number, conferenceId: number): Promise<void> => {
  if (await isSampleConference(conferenceId)) refuseSample();
  const role = await roleForConference(userId, conferenceId);
  if (!await canEditRole(role)) return refuseWrite(role);
  if (!await isConferenceUnlocked(conferenceId)) refuseUpgrade(CHECKLIST_LOCKED_MESSAGE);
};

/** The same gate for a write addressed by item id; returns the item's conference. */
const requireChecklistEditorForItem = async (userId: number, conferenceId: number, itemId: number): Promise<number> => {
  const owner = await conferenceIdForChecklistItem(itemId);
  if (!owner) refuseRead("not_found", "There is no checklist item with that id.", 404);
  // An id from another conference is answered exactly like an id from another
  // workspace: the caller is refused on the conference they named.
  if (owner !== conferenceId) refuseWrite(await roleForConference(userId, conferenceId));
  await requireChecklistEditor(userId, owner);
  return owner;
};

/** The template as unsaved items — what a Viewer or the example sees before a seed. */
const checklistTemplatePreview = (conferenceId: number): ChecklistItem[] =>
  CHECKLIST_PHASES.flatMap((phase) =>
    CHECKLIST_TEMPLATE[phase].map((label, index) => ({
      id: 0,
      conferenceId,
      phase,
      label,
      position: index + 1,
      doneAt: null,
      doneBy: "",
    })),
  );

/** Done/total for each phase and for the whole list. */
const checklistProgress = (items: ChecklistItem[]) => {
  const count = (phase: ChecklistPhase) => {
    const inPhase = items.filter((item) => item.phase === phase);
    return { done: inPhase.filter((item) => item.doneAt !== null).length, total: inPhase.length };
  };
  return {
    pre: count("pre"),
    post: count("post"),
    overall: { done: items.filter((item) => item.doneAt !== null).length, total: items.length },
  };
};

/**
 * Everything the checklist panel needs: the items, who may change them, and the
 * progress. On a locked conference the read is refused `upgrade_required`; on
 * the shared example it answers with the template, unsaved.
 */
export const getChecklistFn = createServerFn({ method: "GET" })
  .inputValidator((data: { conferenceId: number }) => ({ conferenceId: id(data?.conferenceId) }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    if (!data.conferenceId) refuseRead("not_found", "There is no conference with that id.", 404);
    const role = await requireChecklistReader(user.id, data.conferenceId);
    const sample = await isSampleConference(data.conferenceId);
    const canEdit = canEditRole(role) && !sample;
    let items: ChecklistItem[];
    if (sample) {
      // Nothing is written on the example, ever: it shows the default list with
      // nothing ticked, which is what a brand-new conference looks like.
      items = checklistTemplatePreview(data.conferenceId);
    } else {
      if (canEdit) await seedChecklistOnce(data.conferenceId);
      items = await listChecklistItems(data.conferenceId);
      // A Viewer who opens the panel before the organizer has gets the same
      // default list, unsaved — the labels they will see either way.
      if (items.length === 0) items = checklistTemplatePreview(data.conferenceId);
    }
    return {
      ok: true as const,
      role,
      sample,
      canEdit,
      items,
      progress: checklistProgress(items),
    };
  });

/**
 * Tick or untick one item. Ticking records the moment and the name of the
 * account that ticked it; unticking clears both. Repeating either is not an
 * error and does not move the recorded moment — see `setChecklistItemDone`.
 */
export const setChecklistItemDoneFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number; itemId: number; done: boolean }) => ({
    conferenceId: id(data?.conferenceId),
    itemId: id(data?.itemId),
    done: data?.done === true,
  }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    if (!data.conferenceId || !data.itemId) {
      refuseRead("not_found", "There is no checklist item with that id.", 404);
    }
    await requireChecklistEditorForItem(user.id, data.conferenceId, data.itemId);
    const result = await setChecklistItemDone(user.id, data.conferenceId, data.itemId, data.done, user.name);
    if (result.ok) return { ok: true as const };
    if (result.code === "not_found") {
      return refuseRead("not_found", "There is no checklist item with that id.", 404);
    }
    return refuseWrite(await roleForConference(user.id, data.conferenceId));
  });

/**
 * Add one item of the organizer's own to either phase.
 *
 * A label already on that phase is not added twice: the existing item comes
 * back with `duplicate: true`, which is what makes a double-submitted form
 * leave one row and not two.
 */
export const addChecklistItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number; phase: string; label: string }) => ({
    conferenceId: id(data?.conferenceId),
    phase: (data?.phase === "post" ? "post" : "pre") as ChecklistPhase,
    label: text(data?.label, CHECKLIST_LABEL_MAX),
  }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    if (!data.conferenceId) refuseRead("not_found", "There is no conference with that id.", 404);
    await requireChecklistEditor(user.id, data.conferenceId);
    if (!data.label) {
      return { ok: false as const, field: "label", error: "Give this item a name." };
    }
    const result = await addChecklistItem(user.id, data.conferenceId, data.phase, data.label);
    if (result.ok) return { ok: true as const, id: result.id, duplicate: result.duplicate };
    if (result.code === "limit") {
      return {
        ok: false as const,
        field: "label",
        error: `A checklist holds at most ${String(CHECKLIST_ITEMS_MAX)} items. Remove one before adding another.`,
      };
    }
    return refuseWrite(await roleForConference(user.id, data.conferenceId));
  });

/** Rename one item. Renaming onto a name already on that phase is refused, not merged. */
export const renameChecklistItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number; itemId: number; label: string }) => ({
    conferenceId: id(data?.conferenceId),
    itemId: id(data?.itemId),
    label: text(data?.label, CHECKLIST_LABEL_MAX),
  }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    if (!data.conferenceId || !data.itemId) {
      refuseRead("not_found", "There is no checklist item with that id.", 404);
    }
    await requireChecklistEditorForItem(user.id, data.conferenceId, data.itemId);
    if (!data.label) {
      return { ok: false as const, field: "label", error: "Give this item a name." };
    }
    const result = await renameChecklistItem(user.id, data.conferenceId, data.itemId, data.label);
    if (result.ok) return { ok: true as const };
    if (result.code === "duplicate") {
      return {
        ok: false as const,
        field: "label",
        error: "There is already an item with that name on this list.",
      };
    }
    if (result.code === "not_found") {
      return refuseRead("not_found", "There is no checklist item with that id.", 404);
    }
    return refuseWrite(await roleForConference(user.id, data.conferenceId));
  });

/** Remove one item. The rest of its phase closes up, so move up/down stays one step. */
export const deleteChecklistItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number; itemId: number }) => ({
    conferenceId: id(data?.conferenceId),
    itemId: id(data?.itemId),
  }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    if (!data.conferenceId || !data.itemId) {
      refuseRead("not_found", "There is no checklist item with that id.", 404);
    }
    await requireChecklistEditorForItem(user.id, data.conferenceId, data.itemId);
    const result = await deleteChecklistItem(user.id, data.conferenceId, data.itemId);
    if (result.ok) return { ok: true as const };
    if (result.code === "not_found") {
      return refuseRead("not_found", "There is no checklist item with that id.", 404);
    }
    return refuseWrite(await roleForConference(user.id, data.conferenceId));
  });

/** Move one item one place up or down inside its own phase. */
export const moveChecklistItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: { conferenceId: number; itemId: number; direction: string }) => ({
    conferenceId: id(data?.conferenceId),
    itemId: id(data?.itemId),
    direction: (data?.direction === "up" ? "up" : "down") as "up" | "down",
  }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    if (!data.conferenceId || !data.itemId) {
      refuseRead("not_found", "There is no checklist item with that id.", 404);
    }
    await requireChecklistEditorForItem(user.id, data.conferenceId, data.itemId);
    const result = await moveChecklistItem(user.id, data.conferenceId, data.itemId, data.direction);
    if (result.ok) return { ok: true as const };
    if (result.code === "not_found") {
      return refuseRead("not_found", "There is no checklist item with that id.", 404);
    }
    return refuseWrite(await roleForConference(user.id, data.conferenceId));
  });

const PUBLIC_THROTTLE_MESSAGE =
  "There have been a few submissions from this connection in a short time, so this one was not accepted and nothing was registered. Please wait a few minutes and try again.";

/**
 * Everything the attendee-facing page shows for one link.
 *
 * Deliberately returns a plain `ok: false` result rather than throwing for a
 * link that is wrong, locked or closed: the page is read by a congregation, and
 * it should say "registration is not open" in a sentence, not spill an error.
 */
/**
 * The worked example, for a visitor with no account — `/example`.
 *
 * This is the only server function in the product that answers a signed-out
 * caller with conference data, and it is deliberately narrow:
 *
 *  - **No input at all.** There is no conference id to pass, forged or
 *    otherwise, so no real organizer's conference can be addressed through it.
 *    `sampleConferenceForAnyone` finds the one row whose `is_sample` flag is set
 *    and returns `null` for anything else — and a `null` here is the same 404 an
 *    address that was never a page gives: no detail, no hint that an example
 *    exists.
 *  - **Read-only by construction.** It runs SELECTs and returns a plain object.
 *    Nothing it returns is accepted as the input of a write: every write path
 *    refuses the example outright (`refuseSample`) before it looks at a role, so
 *    the sample is unwritable for a stranger and for its own seeded owner alike.
 *  - **What is left out is as deliberate as what is in.** No attendee rows at
 *    all — no name, no email, no phone, no note, in any shape — only counts per
 *    ticket type and the headcount. No attached documents, no document names, no
 *    contract ids, no member list: this page is a look at the arithmetic, not a
 *    way into the workspace.
 *  - **The figures are invented** and shown on purpose (see `moneyVisibleOn`):
 *    the reader is asked for nothing, and there is a pricing-free banner on the
 *    page that says exactly that.
 */
export const getPublicExampleFn = createServerFn({ method: "GET" }).handler(async () => {
  const conference = await sampleConferenceForAnyone();
  if (!conference) refuseRead("not_found", "There is no page at that address.", 404);
  const [budgetItems, contracts, ticketTypes, settings, headcount] = await Promise.all([
    // The role a signed-out reader actually has is 'viewer'. Money appears only
    // because this row carries the example flag, so if the flag ever stopped
    // matching, this reader would get labels and no amounts — it fails closed.
    listBudgetItems(conference.id, "viewer"),
    listContracts(conference.id, "viewer"),
    listTicketTypes(conference.id, "viewer"),
    getRegistrationSettings(conference.id),
    registrationHeadcount(conference.id),
  ]);
  return {
    ok: true as const,
    name: conference.name,
    startDate: conference.startDate,
    endDate: conference.endDate,
    venue: conference.venue,
    expectedAttendance: conference.expectedAttendance,
    budgetTargetCents: conference.budgetTargetCents,
    budget: budgetItems.map((item) => ({
      category: item.category,
      label: item.label,
      plannedCents: item.plannedCents,
      committedCents: item.committedCents,
    })),
    // Names, kinds, pipeline stage and contract state — never the contact
    // address or a fee total the page did not ask for.
    contracts: contracts.map((contract) => ({
      kind: contract.kind,
      name: contract.name,
      topic: contract.topic,
      stage: contract.stage,
      contractStatus: contract.contractStatus,
      feeCents: contract.feeCents,
      honorariumCents: contract.honorariumCents,
      travelCents: contract.travelCents,
      equipmentCents: contract.equipmentCents,
      depositCents: contract.depositCents,
    })),
    registration: {
      /** 0 = no cap. */
      capacity: settings.capacity,
      placesTaken: headcount,
      ticketTypes: ticketTypes.map((ticket) => ({
        name: ticket.name,
        priceCents: ticket.priceCents,
        quantityLimit: ticket.quantityLimit,
        placesTaken: ticket.registered,
      })),
    },
  };
});

/** The one sentence a wrong link gets: no detail, no name, nothing. */
const PUBLIC_LINK_MESSAGE =
  "This link does not open a registration. Nothing was changed and nothing was charged.";

/**
 * Open a card payment for one registration that has already been recorded.
 *
 * **This is called after the row exists, never before.** The registration is
 * committed first, so a person who closes the tab on the card page, or a Stripe
 * outage, or a missing key, costs the organizer nothing: the attendee is on the
 * list, recorded unpaid, and the page says so in a plain sentence. (Owner
 * decision, 2026-10-22 — the page must never go dark and must never block a
 * registration for a missing Stripe account.)
 *
 * The session is created ON THE ORGANIZER'S ACCOUNT (`Stripe-Account`), with no
 * application fee of any kind: the fee is theirs in full.
 *
 * Every failure is `null`, and every `null` is a registration that stands with
 * nothing charged. Stripe's own error text never reaches the browser.
 */
const startCardPaymentFor = async (input: {
  token: string;
  attendeeId: number;
  conferenceId: number;
  amountCents: number;
  email: string;
  ticketName: string;
  quantity: number;
}): Promise<{ url: string } | null> => {
  // Read back through the token: the id alone is not a handle, and this is the
  // same check the return path makes.
  const target = await getAttendeePaymentTarget(input.token, input.attendeeId);
  if (!target || target.conferenceId !== input.conferenceId) return null;

  const account = await getPayoutAccount(target.ownerUserId);
  if (!isAccountReadyForCharges(account)) return null;

  const origin = requestOrigin();
  const link = `${origin}/register/${encodeURIComponent(input.token)}`;
  const places = input.quantity === 1 ? "1 place" : `${String(input.quantity)} places`;
  const description = `${input.ticketName || "Registration"} — ${places}`;

  const created = await createAttendeeCheckout({
    accountId: account.stripeAccountId,
    amountCents: input.amountCents,
    currency: "usd",
    description,
    attendeeId: input.attendeeId,
    conferenceId: input.conferenceId,
    email: input.email,
    // Stripe fills `{CHECKOUT_SESSION_ID}` in when it sends the browser back.
    // The attendee id in the query string is NOT trusted on its own: the return
    // handler checks the session id against the one stored on the row, then asks
    // Stripe whether it was paid.
    successUrl: `${link}?paid=${String(input.attendeeId)}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${link}?canceled=${String(input.attendeeId)}`,
  });
  if (!created.ok) {
    console.error(
      `[convocate] card payment not started for registration ${String(input.attendeeId)} (${created.code}) — the registration stands, unpaid`,
    );
    return null;
  }

  // Store the session on the row BEFORE the browser leaves for Stripe: the return
  // path compares the session id it is handed against this one, so a forged or
  // borrowed session id matches nothing.
  const stored = await startAttendeeCardPayment(input.attendeeId, {
    sessionId: created.checkout.id,
    amountCents: created.checkout.amountCents,
    currency: created.checkout.currency,
  });
  if (!stored) {
    // The row was paid, refunded or deleted between the insert and this moment.
    // Nothing is sent to Stripe and nobody is charged.
    console.error(
      `[convocate] card payment for registration ${String(input.attendeeId)} was created but could not be recorded — not redirecting`,
    );
    return null;
  }
  return { url: created.checkout.url };
};

/**
 * Come back from Stripe and find out what actually happened.
 *
 * The rule this function exists to keep: **a query parameter is never proof of
 * payment.** The browser hands us a session id; we compare it with the one stored
 * on that attendee row, ask Stripe directly (on the organizer's account), and only
 * mark the row `paid` when Stripe says the session is paid AND the session's own
 * metadata names this registration and this conference. Anything else — a made-up
 * session id, another attendee's session, a session that is still open, Stripe
 * being unreachable — changes nothing and answers with the status the row already
 * had.
 *
 * Signed out is the normal case: this is called from the public registration page
 * by the attendee who just paid.
 */
export const confirmPublicPaymentFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { token: string; attendeeId: number; sessionId?: string }) => ({
      token: tokenText(data?.token),
      attendeeId: id(data?.attendeeId),
      sessionId: text(data?.sessionId, 200),
    }),
  )
  .handler(async ({ data }) => {
    if (!data.token || !data.attendeeId) {
      return { ok: false as const, code: "not_found" as const, error: PUBLIC_LINK_MESSAGE };
    }
    const target = await getAttendeePaymentTarget(data.token, data.attendeeId);
    // A wrong link and a guessed id are answered the same way, with nothing in
    // them: no conference name, no name, no status.
    if (!target) {
      return { ok: false as const, code: "not_found" as const, error: PUBLIC_LINK_MESSAGE };
    }
    /** What the page is told. `amountCents` is what the row says was charged. */
    const nothingToDo = (paymentStatus: AttendeePaymentStatus, verified: boolean) => ({
      ok: true as const,
      verified,
      paymentStatus,
      amountCents: target.amountCents,
      currency: target.currency,
    });

    // Nothing was ever started for this registration — no card was offered.
    if (!target.sessionId) return nothingToDo(target.paymentStatus, false);
    // Already confirmed: no need to ask Stripe again.
    if (target.paymentStatus === "paid") return nothingToDo("paid", true);
    // The session id must be the one stored on THIS row. A hand-edited id, an
    // invented one, or another attendee's never reaches Stripe.
    if (!data.sessionId || data.sessionId !== target.sessionId) {
      return nothingToDo(target.paymentStatus, false);
    }

    const account = await getPayoutAccount(target.ownerUserId);
    if (!account) return nothingToDo(target.paymentStatus, false);

    const answer = await retrieveCheckoutSession(account.stripeAccountId, target.sessionId);
    if (!answer.ok) return nothingToDo(target.paymentStatus, false);
    const verdict = answer.verdict;

    // Stripe's word, plus the session's own claim about which registration it is
    // for. Both must line up with the row we are about to change.
    const belongsHere =
      verdict.id === target.sessionId &&
      verdict.attendeeId === String(target.attendeeId) &&
      verdict.conferenceId === String(target.conferenceId) &&
      verdict.amountCents > 0;
    if (verdict.paymentStatus !== "paid" || !belongsHere) {
      return nothingToDo(target.paymentStatus, true);
    }

    const changed = await confirmAttendeeCardPaid(target.attendeeId, {
      sessionId: verdict.id,
      paymentIntentId: verdict.paymentIntentId,
      amountCents: verdict.amountCents,
      currency: verdict.currency,
    });
    // `changed` is false only when the row no longer matched the session (a
    // refund, a delete, a race). Either way, what the page is told is what the
    // row now says.
    return nothingToDo(changed ? "paid" : target.paymentStatus, true);
  });

/**
 * Re-open a card page for a registration that already exists.
 *
 * This is the "try the card payment again" button, shown to someone who came back
 * from Stripe without paying. It never creates a second registration: it finds
 * the row through the link's token, checks that it is not already paid, and opens
 * a fresh Checkout Session on the organizer's account for the same amount.
 *
 * Every refusal is a sentence and none of them block anybody: the registration is
 * already recorded, and the organizer follows up about the fee either way.
 */
export const startPublicPaymentFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; attendeeId: number }) => ({
    token: tokenText(data?.token),
    attendeeId: id(data?.attendeeId),
  }))
  .handler(async ({ data }) => {
    if (!data.token || !data.attendeeId) {
      return { ok: false as const, code: "not_found" as const, error: PUBLIC_LINK_MESSAGE };
    }
    const target = await getAttendeePaymentTarget(data.token, data.attendeeId);
    if (!target) {
      return { ok: false as const, code: "not_found" as const, error: PUBLIC_LINK_MESSAGE };
    }
    if (isAttendeePaid(target.paymentStatus)) {
      return {
        ok: false as const,
        code: "already_paid" as const,
        error: "This registration is already paid, so there is nothing to pay.",
      };
    }
    if (target.amountCents <= 0) {
      return {
        ok: false as const,
        code: "no_amount" as const,
        error: "There is no fee to pay on this registration. The organizer will be in touch if anything changes.",
      };
    }
    const payment = await startCardPaymentFor({
      token: data.token,
      attendeeId: target.attendeeId,
      conferenceId: target.conferenceId,
      amountCents: target.amountCents,
      email: target.email,
      ticketName: target.ticketName,
      quantity: target.quantity,
    });
    if (!payment) {
      return {
        ok: false as const,
        code: "unavailable" as const,
        error:
          "Card payment isn't available for this event right now. Your place is still recorded — the organizer will follow up about the fee.",
      };
    }
    return { ok: true as const, payment };
  });

export const getPublicRegistrationFn = createServerFn({ method: "GET" })
  .inputValidator((data: { token: string }) => ({ token: tokenText(data?.token) }))
  .handler(async ({ data }) => await getPublicRegistrationPage(data.token));

/**
 * Take one registration from the attendee-facing page.
 *
 * Signed out is the normal case, so there is no session here at all. Every
 * refusal carries a sentence written for the person filling the form: never the
 * plan, never a price for Convocate, never urgency.
 */
export const submitPublicRegistrationFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      token: string;
      ticketTypeId: number;
      name: string;
      email: string;
      phone?: string;
      notes?: string;
      quantity: number | string;
      /** The honeypot. A person never sees it, so anything in it is a machine. */
      website?: string;
    }) => ({
      token: tokenText(data?.token),
      ticketTypeId: id(data?.ticketTypeId),
      name: text(data?.name, 160),
      email: text(data?.email, 200),
      phone: text(data?.phone, 40),
      notes: text(data?.notes, 500),
      quantity:
        typeof data?.quantity === "number" || typeof data?.quantity === "string"
          ? String(data.quantity).trim()
          : "",
      website: text(data?.website, 200),
    }),
  )
  .handler(async ({ data }) => {
    const address = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    // The honeypot is answered with the throttling sentence: it tells a machine
    // nothing about which field gave it away, and a person never reaches it.
    if (data.website) return { ok: false as const, code: "throttled" as const, error: PUBLIC_THROTTLE_MESSAGE };
    if (publicSubmitBlocked(address)) {
      return { ok: false as const, code: "throttled" as const, error: PUBLIC_THROTTLE_MESSAGE };
    }
    recordPublicSubmit(address);

    const refuse = (field: string, error: string) => ({ ok: false as const, code: "field" as const, field, error });
    if (!data.name) return refuse("name", "Please enter your name.");
    if (!data.email) {
      return refuse("email", "Please enter an email address so the organizer can reach you about your registration.");
    }
    if (!looksLikeEmail(data.email)) {
      return refuse("email", "That email address does not look complete — check it. For example: name@example.org.");
    }
    if (!data.ticketTypeId) return refuse("ticketTypeId", "Please choose one of the registration options listed.");
    if (!/^\d+$/.test(data.quantity) || Number(data.quantity) < 1) {
      return refuse("quantity", "Enter how many places you would like as a whole number, 1 or more.");
    }
    const quantity = places(data.quantity, 500);
    if (quantity < 1) return refuse("quantity", "Enter how many places you would like as a whole number, 1 or more.");

    const result = await insertPublicAttendee(data.token, {
      ticketTypeId: data.ticketTypeId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      notes: data.notes,
      quantity,
    });
    if (result.ok) {
      // The registration is committed by the time this returns: the transaction
      // closed inside `insertPublicAttendee`. Only now is a confirmation emailed,
      // because a message must never describe a registration that did not happen.
      //
      // The send is awaited — not left running in the background — for one
      // honest reason: the confirmation page tells the attendee whether an email
      // went out, and a page cannot report the truth about work it did not wait
      // for. It is safe to await because `sendRegistrationConfirmation` cannot
      // throw and returns a status for every outcome, so the worst case is a
      // registration that succeeds while the page says the email could not be
      // sent. It is bounded (8s) so a slow provider cannot hold the page open.
      const emailStatus = await sendRegistrationConfirmation({
        event: result.event,
        registration: result.registration,
        cardPayment: result.cardPayment,
      });

      // A card payment is opened only now — after the row is committed — so the
      // person is on the list whether or not they finish at Stripe's page. A
      // `null` here is not an error: the registration stands, unpaid, and the
      // page says the organizer will follow up about the fee.
      const payment =
        result.cardPayment && result.attendeeId > 0
          ? await startCardPaymentFor({
              token: data.token,
              attendeeId: result.attendeeId,
              conferenceId: result.event.id,
              amountCents: result.registration.amountDueCents,
              email: result.registration.email,
              ticketName: result.registration.ticketName,
              quantity: result.registration.quantity,
            })
          : null;

      return {
        ok: true as const,
        registration: result.registration,
        emailStatus,
        /** The row just written — the page needs it to ask about the payment. */
        attendeeId: result.attendeeId,
        /** Whether a card page is being offered for this event at all. */
        cardPayment: result.cardPayment,
        /** Where to send the browser, or `null` when nothing was charged here. */
        payment,
      };
    }
    if (result.code === "bad_ticket") {
      return refuse("ticketTypeId", "That registration option is not available any more. Please choose one of the options listed.");
    }
    if (result.code === "capacity") {
      const left = result.placesLeft;
      return {
        ok: false as const,
        code: "capacity" as const,
        field: "quantity",
        placesLeft: left,
        error:
          left === 0
            ? "Every place at this conference has now been registered. Nothing was registered for you."
            : `There ${left === 1 ? "is" : "are"} ${String(left)} ${left === 1 ? "place" : "places"} left, so ${String(quantity)} could not be registered. Nothing was registered — choose ${String(left)} or fewer.`,
      };
    }
    if (result.code === "ticket_limit") {
      const left = result.placesLeft;
      return {
        ok: false as const,
        code: "ticket_limit" as const,
        field: "quantity",
        placesLeft: left,
        error:
          left === 0
            ? `Every place on “${result.ticketName}” has now been registered. Nothing was registered for you.`
            : `Only ${String(left)} ${left === 1 ? "place is" : "places are"} left on “${result.ticketName}”, so ${String(quantity)} could not be registered. Nothing was registered — choose ${String(left)} or fewer, or another option.`,
      };
    }
    // The page-level refusals (link wrong, not open, closed, sold out) are the
    // same sentences the page already shows for a read; the page decides how to
    // word them.
    return { ok: false as const, code: result.code, error: "Registration could not be completed." };
  });

/* ------------------------------------------------------------------ admin */

/**
 * The owner's read-only admin view: who has signed up and what conferences exist.
 *
 * Why it is a server function and not a page that reads the database: the gate has
 * to hold against a request that never touched a link. Both refusals happen HERE,
 * before a single row is read, and both are thrown the way the rest of this file
 * throws (`refuseRead`), so the status and the body survive the server-function
 * layer:
 *
 *   - signed out            → 403 `not_signed_in` ("Sign in …"), the same answer
 *                             every other read in this file gives a stranger;
 *   - signed in, not admin  → 404 `not_found`, the SAME answer an address that
 *                             does not exist gives. Not a "you need permission"
 *                             page: a normal church account learns nothing about
 *                             whether /admin exists, because the answer to
 *                             "is there an admin view?" is indistinguishable from
 *                             "no such page".
 *
 * Read-only: `adminOverview` runs SELECTs only, this handler takes no input, and
 * no other server function in the product accepts the types it returns. No
 * password hash is ever selected (see `adminOverview`).
 *
 * The role comes from `isAdminUser`, read per request — the flag in `users.is_admin`
 * AND the owner's own address (see `ADMIN_ACCOUNT_EMAILS`) — never from anything
 * the browser sends.
 */
export const getAdminOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUserOrRefuse();
  if (!await isAdminUser(user.id)) {
    refuseRead("not_found", "There is no page at that address.", 404);
  }
  return await adminOverview();
});

/**
 * The visit counter's readout for `/admin/traffic` — "did anyone arrive, and where
 * did they land". Two refusals, both HERE on the server, both before a single row
 * is read:
 *
 *   - signed out            → 403 `not_signed_in`;
 *   - signed in, not admin  → 404 `not_found`, the same answer a URL that never
 *                             existed gives (see `getAdminOverviewFn` for why the
 *                             two must be indistinguishable).
 *
 * The gate is `isAdminUser`, read from the row on every request — the flag plus
 * the owner's own address (see `ADMIN_ACCOUNT_EMAILS`), never a check the browser
 * could skip. A signed-in
 * non-admin who calls this server function directly gets nothing: the check runs
 * before `trafficReport()`.
 *
 * What comes back is aggregate counts only. There is nothing per-visitor to
 * return: the table has no address, no cookie, no user-agent string and no
 * identifier of any kind (see `page_views` in db.server.ts).
 */
export const getTrafficFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUserOrRefuse();
  if (!await isAdminUser(user.id)) {
    refuseRead("not_found", "There is no page at that address.", 404);
  }
  return await trafficReport();
});

/**
 * The help assistant's one door.
 *
 * What it takes from the browser: a question, and nothing else. The account is
 * the session's own — a request that carries a `userId` in its body is ignored,
 * because nothing here reads one. The size check runs on the server too: the
 * card limits the box, but a crafted request gets the same plain refusal.
 *
 * Signed out is the standard `not_signed_in` 403 every other guarded server
 * function throws — never an answer, and never a hint that the assistant exists.
 * What comes back is the result `askHelp` returns: an answer, or a reason and a
 * sentence. No organizer's event data is read or written on this path.
 */
export const askHelpFn = createServerFn({ method: "POST" })
  .inputValidator((data: { question?: unknown }) => ({
    question: typeof data?.question === "string" ? data.question : "",
  }))
  .handler(async ({ data }) => {
    const user = await requireUserOrRefuse();
    const question = data.question.trim();
    if (!question) return { ok: false as const, reason: "error" as const, message: AI_EMPTY_MESSAGE };
    if (question.length > AI_QUESTION_MAX) {
      return {
        ok: false as const,
        reason: "error" as const,
        message: "That question is too long — keep it under 1,000 characters and ask again.",
      };
    }
    return await askHelp({ userId: user.id, question });
  });

/* --------------------------------------------------------------- payouts */

/**
 * Who may set up payouts: **the account that runs an event of its own.**
 *
 * The money rule (owner decision, 2026-10-21) is that registration fees and
 * donations belong to the organizer, so the Stripe account a conference pays
 * into is the ORGANIZER ACCOUNT's own — one connection per organizer, however
 * many events they run. That makes the rule simple and checkable on the server:
 * the signed-in account must own at least one conference.
 *
 *  - signed out          → 403 `not_signed_in` (the standard refusal);
 *  - signed in, editor or
 *    viewer on someone
 *    else's event        → 403 `not_event_owner`. A committee member never sees
 *                          the payouts card and cannot reach the functions that
 *                          create or read a Stripe account: the check runs before
 *                          anything is created, read or stored.
 *
 * Nothing about the decision comes from the request body — there is no id to
 * pass, because the account is always the session's own.
 */
const PAYOUTS_OWNER_ONLY =
  "Payouts are set up by the account that runs the event. Your role on this event does not include them, so nothing was changed.";

const requirePayoutsOwner = async (): Promise<User> => {
  const user = await requireUserOrRefuse();
  if (!await ownsAnyConference(user.id)) refuseRead("not_event_owner", PAYOUTS_OWNER_ONLY);
  return user;
};

/** Where this request came from, for Stripe's return/refresh links. */
const PUBLIC_SITE_ORIGIN = "https://www.getconvocate.com";

/**
 * The origin Stripe should send the organizer back to.
 *
 * Taken from the request itself — the platform serves the site on more than one
 * hostname (the owner's own domain and the platform's preview address) — with
 * the public domain as the fallback. A local origin is never handed to Stripe:
 * an onboarding link that returns to a machine only we can see would strand the
 * organizer on a dead page, so `localhost`, `127.0.0.1`, `0.0.0.0` and `::1` are
 * replaced by the public site.
 */
const requestOrigin = (): string => {
  try {
    const url = getRequestUrl({ xForwardedHost: true, xForwardedProto: true });
    const hostname = url.hostname.toLowerCase();
    // An IPv6 literal arrives in brackets: "[::1]".
    const host = hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return PUBLIC_SITE_ORIGIN;
    const origin = url.origin;
    return origin.startsWith("https://") || origin.startsWith("http://") ? origin : PUBLIC_SITE_ORIGIN;
  } catch {
    return PUBLIC_SITE_ORIGIN;
  }
};

/**
 * What the Payouts card on `/app/settings` reads: the stored state of THIS
 * account's Stripe connection, and no call to Stripe.
 *
 * A caller who does not run an event gets `visible: false` and nothing else —
 * not a refusal, because the card simply is not part of their settings page and
 * refusing would break the page for them. The two functions that actually touch
 * Stripe (`connectPayoutsStartFn`, `connectPayoutsStatusFn`) do refuse such a
 * caller outright; see `requirePayoutsOwner`.
 *
 * The full `acct_...` id never appears in this result — only its last four
 * characters, which is enough for an organizer to recognize the account in
 * Stripe's dashboard and useless to anyone else.
 */
export const getPayoutsCardFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUserOrRefuse();
  if (!await ownsAnyConference(user.id)) {
    return {
      visible: false as const,
      configured: false,
      connected: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      last4: null as string | null,
    };
  }
  return { visible: true as const, ...(await payoutsCardState(user.id)) };
});

/**
 * "Connect payouts" / "Finish setting up payouts" / "Update payout details" —
 * all three are this one function, because all three mean "give me a fresh
 * Stripe onboarding link".
 *
 * A Stripe account is created the first time (US, Stripe liable for negative
 * balances, the organizer paying Stripe's own fees) and its id is stored against
 * the organizer account; every later call reuses it and only mints a new link,
 * since onboarding links expire. Convocate requests no platform fee and no
 * application fee anywhere: the money is the organizer's.
 *
 * Every failure comes back as `{ ok: false, code, error }` with a sentence — a
 * missing key, Stripe refusing, or Stripe being unreachable — so the card can
 * say what happened instead of showing a broken button. Nothing throws, and
 * Stripe's own error text is never repeated to the browser.
 */
export const connectPayoutsStartFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requirePayoutsOwner();
  return await startPayoutOnboarding({
    userId: user.id,
    email: user.email,
    origin: requestOrigin(),
  });
});

/**
 * Ask Stripe how the account is doing and store the answer — run when the
 * organizer comes back from Stripe (`?connect=return`) and by the "Check again"
 * button.
 *
 * The row updated is the session account's own; there is no id in the request to
 * forge. The answer is the four flags and the id's last four characters, never
 * the id itself.
 */
export const connectPayoutsStatusFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requirePayoutsOwner();
  return await refreshPayoutStatus(user.id);
});

/* ------------------------------------------------------------ lead magnets */
/**
 * The opt-in behind the free guides at /resources/<guide>.
 *
 * The guide itself is delivered **by the page**, not by this function: the
 * browser already has the text (it ships with the page), and submitting only
 * unlocks it. No email is sent here and none is sent later today — list email is
 * not built, which is exactly why the pages promise the guide on the page. The
 * address is stored for what comes after the download, with the consent wording
 * the person was shown and the version it belonged to.
 *
 * Refusals come back as `{ ok: false, field, error }` with a sentence the form
 * prints under the field. The server runs the same `emailProblem` the browser
 * runs, so a browser that skips validation changes nothing.
 */
export const subscribeLeadMagnetFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { email?: unknown; guide?: unknown; sourcePath?: unknown; website?: unknown }) => ({
      email: text(data?.email, 254),
      guide: text(data?.guide, 80),
      sourcePath: text(data?.sourcePath, 200),
      // The honeypot: off-screen, never filled in by a person. Anything here
      // means a machine, and a machine gets a friendly answer and no row.
      website: text(data?.website, 100),
    }),
  )
  .handler(async ({ data }) => {
    const magnet = leadMagnet(data.guide);
    if (!magnet) {
      return {
        ok: false as const,
        field: "guide",
        error: "That guide is not one of ours. Pick one from the resources page.",
      };
    }
    if (data.website !== "") {
      // Silent as far as the visitor is concerned; nothing is written.
      return { ok: true as const, token: "", stored: false };
    }
    const email = normaliseEmail(data.email);
    const problem = emailProblem(email);
    if (problem) return { ok: false as const, field: "email", error: problem };
    // The page the form was on is recorded as evidence of consent, so it is
    // checked against our own three paths rather than stored as sent. Anything
    // else falls back to this guide's canonical page.
    const sourcePath =
      data.sourcePath === `/resources/${magnet.slug}` ? data.sourcePath : `/resources/${magnet.slug}`;
    try {
      const { signup, created } = await recordLeadSignup({
        email,
        guide: magnet.slug,
        sourcePath,
        context: "notes",
        consentVersion: CONSENT_VERSION,
        consentText: CONSENT_TEXT,
        token: randomBytes(24).toString("base64url"),
        nowMs: Date.now(),
      });
      return { ok: true as const, token: signup.unsubscribeToken, stored: true, created };
    } catch (cause) {
      console.error(
        `[convocate] lead signup: could not store the opt-in — ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return {
        ok: false as const,
        field: "email",
        error: "We could not save that just now. Please try again in a moment.",
      };
    }
  });

/**
 * Who may read the whole of a paid guide, decided on the server and nowhere
 * else.
 *
 * Three answers, and the page renders differently for each:
 *  - `full: false` and `signedIn: false` — a stranger. They get the opening
 *    section and the wall.
 *  - `full: false` and `signedIn: true` — a real account that has never
 *    unlocked an event. They get the opening section, the wall, and a line that
 *    says plainly that their account has not unlocked an event yet.
 *  - `full: true` — the whole guide, in the HTML, printable.
 *
 * `full` is true for the owner's own account (the same flag-and-address rule as
 * everywhere else) and for any account that has ever unlocked an event — see
 * `hasEverUnlockedAnEvent`, which keeps access after a refund.
 *
 * The guide slug comes from the caller, so it is checked against our own list
 * first: an unknown slug is refused rather than looked up. Nothing here writes.
 */
export const guideAccessFn = createServerFn({ method: "GET" })
  .inputValidator((data: { slug?: unknown }) => ({ slug: text(data?.slug, 80) }))
  .handler(async ({ data }) => {
    const magnet = leadMagnet(data.slug);
    if (!magnet) return { ok: false as const, signedIn: false, full: false };
    if (magnet.access === "free") {
      return { ok: true as const, signedIn: false, full: true };
    }
    const user = await currentUser();
    if (!user) return { ok: true as const, signedIn: false, full: false };
    try {
      const admin = await isAdminUser(user.id);
      if (admin) return { ok: true as const, signedIn: true, full: true };
      const unlocked = await hasEverUnlockedAnEvent(user.id);
      return { ok: true as const, signedIn: true, full: unlocked };
    } catch (cause) {
      // A database that cannot answer is not a reason to hand out the guide.
      // The reader gets the teaser and the wall, which is what a stranger gets.
      console.error(
        `[convocate] guide access: could not read the unlock state — ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return { ok: true as const, signedIn: true, full: false };
    }
  });

/**
 * The printable one-page sheet, and the gate in front of it.
 *
 * Called by the loader of `/print/guide/<slug>`, which runs on the server for a
 * direct request. A browser that has unlocked this guide with a valid email gets
 * the sheet's Markdown back, and the loader renders it into the HTML. Anything
 * else gets `unlocked: false` and no guide text at all — so a `curl` of the
 * printable URL with no cookie contains the gate, not the sheet. That is the
 * whole point: the gate is a server decision, never a client-side flag.
 *
 * The unlock lives in a signed cookie (`server/printable.server.ts`), not in a
 * session, because the printable has to work for someone who has no account.
 */
export const printableSheetFn = createServerFn({ method: "GET" })
  .inputValidator((data: { slug?: unknown }) => ({ slug: text(data?.slug, 80) }))
  .handler(async ({ data }) => {
    const magnet = leadMagnet(data.slug);
    if (!magnet || magnet.access !== "free" || !magnet.printableHeading) {
      return { ok: false as const, unlocked: false as const, title: "", markdown: "" };
    }
    const unlocked = decodePrintableUnlock(getCookie(PRINTABLE_COOKIE), Date.now()).includes(
      magnet.slug,
    );
    if (!unlocked) {
      return {
        ok: true as const,
        unlocked: false as const,
        title: magnet.title,
        markdown: "",
      };
    }
    const sheet = printableSection(magnet.markdown, magnet.printableHeading);
    if (!sheet) {
      // A guide whose printable section was renamed: say so rather than print a
      // blank page. This is a content bug, not a reader's mistake.
      console.error(`[convocate] printable: no "${magnet.printableHeading}" section in ${magnet.slug}`);
      return { ok: false as const, unlocked: false as const, title: magnet.title, markdown: "" };
    }
    return { ok: true as const, unlocked: true as const, title: magnet.title, markdown: sheet };
  });

/**
 * The email form on a free guide: validate, store, unlock, hand back the URL.
 *
 * The order matters and it is the promise the form makes. The address is
 * validated with the same function the browser used, written to `lead_signups`
 * through `recordLeadSignup` — the one path every address on this site takes —
 * and only then is the cookie set and the printable URL returned. So the person
 * gets the sheet immediately; nothing is sent, and nothing has to arrive, for
 * the sheet to open.
 *
 * `context` is 'printable', which is how a row says it came from this form
 * rather than the planning-notes one. The consent text stored with the row is
 * the printable form's own line, not the notes line, because that is the
 * sentence the person was shown.
 *
 * A honeypot that is filled in is answered exactly like a success — the machine
 * learns nothing — but no row is written and no cookie is set, so a bot cannot
 * farm unlocks either.
 */
export const unlockPrintableFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { email?: unknown; guide?: unknown; website?: unknown }) => ({
      email: text(data?.email, 254),
      guide: text(data?.guide, 80),
      website: text(data?.website, 100),
    }),
  )
  .handler(async ({ data }) => {
    const magnet = leadMagnet(data.guide);
    if (!magnet || magnet.access !== "free" || !magnet.printableHeading) {
      return {
        ok: false as const,
        field: "guide",
        error: "There is no printable version of that guide.",
      };
    }
    const url = printablePath(magnet.slug);
    if (data.website !== "") {
      return { ok: true as const, url, stored: false };
    }
    const email = normaliseEmail(data.email);
    const problem = emailProblem(email);
    if (problem) return { ok: false as const, field: "email", error: problem };
    try {
      await recordLeadSignup({
        email,
        guide: magnet.slug,
        sourcePath: leadMagnetPath(magnet.slug),
        context: "printable",
        consentVersion: PRINTABLE_CONSENT_VERSION,
        consentText: PRINTABLE_CONSENT_TEXT,
        token: randomBytes(24).toString("base64url"),
        nowMs: Date.now(),
      });
    } catch (cause) {
      console.error(
        `[convocate] printable unlock: could not store the address — ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return {
        ok: false as const,
        field: "email",
        error: "We could not save that just now. Please try again in a moment.",
      };
    }
    // Add this guide to whatever this browser has already unlocked, so a reader
    // who unlocks both free guides keeps both.
    const already = decodePrintableUnlock(getCookie(PRINTABLE_COOKIE), Date.now());
    setCookie(PRINTABLE_COOKIE, encodePrintableUnlock([...already, magnet.slug], Date.now()), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: PRINTABLE_COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
    return { ok: true as const, url, stored: true };
  });

/**
 * What an unsubscribe link points at: whether we issued it, and whether the
 * address behind it has already left. Used by the /unsubscribe page's loader so
 * the page can say plainly that a link is not one of ours instead of showing a
 * button that would do nothing.
 *
 * It deliberately does not return the email address: the page never prints it,
 * so there is no reason to send it to a browser.
 */
export const getUnsubscribeStatusFn = createServerFn({ method: "GET" })
  .inputValidator((data: { token?: unknown }) => ({ token: tokenText(data?.token) }))
  .handler(async ({ data }) => {
    if (data.token === "") return { ok: false as const, code: "invalid_token" as const };
    const row = await findLeadSignupByToken(data.token);
    if (!row) return { ok: false as const, code: "invalid_token" as const };
    return {
      ok: true as const,
      unsubscribed: row.unsubscribedAt !== null,
      guide: row.guide,
    };
  });

/**
 * Leave the list. One token, one address, every guide that address opted in for
 * — see `unsubscribeLeadSignupByToken`. Nothing is deleted and nothing is
 * emailed; the row keeps its history and gains a timestamp.
 */
export const unsubscribeLeadMagnetFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token?: unknown }) => ({ token: tokenText(data?.token) }))
  .handler(async ({ data }) => {
    if (data.token === "") {
      return {
        ok: false as const,
        code: "invalid_token" as const,
        error: "That unsubscribe link is not one we issued.",
      };
    }
    try {
      const result = await unsubscribeLeadSignupByToken(data.token, Date.now());
      if (!result.ok) {
        return {
          ok: false as const,
          code: "invalid_token" as const,
          error: "That unsubscribe link is not one we issued.",
        };
      }
      return { ok: true as const, alreadyUnsubscribed: result.alreadyUnsubscribed };
    } catch (cause) {
      console.error(
        `[convocate] unsubscribe: could not write the request — ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return {
        ok: false as const,
        code: "unavailable" as const,
        error: "We could not reach the list just now. Please try again in a moment.",
      };
    }
  });
