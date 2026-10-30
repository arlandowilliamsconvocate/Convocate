/**
 * Single data-access module for Convocate.
 *
 * Everything that touches storage lives here: schema, queries, and the shaping
 * of rows into plain JSON-safe objects. Nothing outside this file imports
 * `bun:sqlite`. Moving to a hosted Postgres later means rewriting this file
 * (and the session store in auth.server.ts) — no route or component changes.
 *
 * Money is stored as integer cents in every table; the UI converts to whole
 * currency units at the edges.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type {
  Attendee,
  BudgetItem,
  Contract,
  ContractKind,
  ContractStage,
  ContractStatus,
  Money,
  RegistrationSettings,
  TicketType,
} from "../lib/types";
import { attendeePaymentStatus, type AttendeePaymentStatus } from "../lib/types";
import { PAYMENT_RETRY_AFTER_MINUTES, isPaymentAttemptStale } from "../lib/plan";
import {
  EMPTY_AGREEMENT_TERMS,
  EMPTY_ORGANIZER,
  buildAgreement,
  normalizeClauses,
  partyNoun,
  termsFromRow,
  type AgreementTerms,
  type OrganizerIdentity,
} from "../lib/agreement";
// The free plan's budget-line limit is one number, owned by `lib/plan.ts`, so the
// storage guard and the copy a church reads can never disagree.
import { FREE_PLAN_BUDGET_LINES } from "../lib/plan";
import {
  CHECKLIST_ITEMS_MAX,
  CHECKLIST_PHASES,
  CHECKLIST_SEED_MARKER,
  CHECKLIST_TEMPLATE,
  type ChecklistItem,
  type ChecklistPhase,
} from "../lib/checklist";
import { dataLayout } from "./data-dir.server";
import {
  databaseTarget,
  ensureSchema,
  getDb,
  importLocalDatabaseIfEmpty,
  rawDb,
  registerBootHook,
  type Db,
} from "./db-client.server";

/**
 * The connection and the schema live in `db-client.server.ts` now. `getDb()` is
 * re-exported from here so every caller keeps importing it from this module, and
 * nothing outside this file has to know which module owns the client.
 */
export { getDb };

/**
 * Which directory holds the database, the uploads and the snapshots is decided
 * in exactly one place: `data-dir.server.ts`. It reads `CONVOCATE_DATA_DIR`
 * (then the per-path overrides), copies `<site>/.data` into a configured
 * directory once on first boot, and falls back to `.data` with a loud error if
 * the configured directory is unusable. This module only reads that decision.
 *
 * Why it matters: `.data` sits inside the project checkout, and a publish
 * replaces the checkout — so a database kept there is silently thrown away on
 * the next publish. `CONVOCATE_DATA_DIR` is how the live site keeps its data.
 */
const DB_PATH = dataLayout().dbPath;

/**
 * The tables themselves, kept apart from `migrate`.
 *
 * Why apart: the first boot against an EMPTY remote database has to create the
 * tables, copy an existing local file's rows in, and only then write the
 * one-time migration markers. An import that ran after the markers were written
 * would collide with them — `schema_migrations` keeps one row per name, and the
 * local file brings its own. So boot runs: create the tables, import, migrate,
 * seed the example.
 */
const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      -- 0 for everyone who signs up; 1 only for the owner's own account, set by
      -- hand in the database (see ensureUserAdminColumn). A real column, never an
      -- email check in code: who is an admin is a fact about the row, so it can
      -- be changed without shipping a new build and it is enforced like any other
      -- row-level fact.
      is_admin      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

    -- Password reset: one row per link issued, and the row is the whole record.
    --
    -- The token itself is NEVER stored. The link carries 32 random bytes
    -- (base64url); what lands in 'token_hash' is the SHA-256 of that string, hex.
    -- A database copy therefore cannot be used to reset anybody's password - the
    -- only places the token exists are the email and the browser it is opened in.
    --
    -- 'user_id' is a real foreign key, so deleting an account takes its reset
    -- history with it. Only an address with an account ever gets a row: a request
    -- for an address that has no account writes nothing at all, because there is
    -- nothing to write it for.
    --
    -- 'expires_at' is 60 minutes after 'created_at' (see PASSWORD_RESET_TTL_MS).
    -- 'used_at' is NULL until the link is spent, and the UPDATE that spends it is
    -- conditional on it still being NULL, so one link takes exactly one password
    -- change. A newer request stamps the older unused rows with 'used_at' too,
    -- which is what makes "the last link you were sent is the only one that
    -- works" true rather than hopeful.
    --
    -- 'request_ip' is the address the request came from, kept for the per-IP
    -- rate limit (10 an hour) and for nothing else. It is never shown in the
    -- product and never leaves the server.
    CREATE TABLE IF NOT EXISTS password_resets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at    INTEGER,
      created_at INTEGER NOT NULL,
      request_ip TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);
    CREATE INDEX IF NOT EXISTS password_resets_ip_idx ON password_resets(request_ip, created_at);
    CREATE INDEX IF NOT EXISTS password_resets_created_idx ON password_resets(created_at);

    CREATE TABLE IF NOT EXISTS conferences (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name                TEXT NOT NULL,
      start_date          TEXT NOT NULL DEFAULT '',
      end_date            TEXT NOT NULL DEFAULT '',
      venue               TEXT NOT NULL DEFAULT '',
      expected_attendance INTEGER NOT NULL DEFAULT 0,
      budget_target_cents INTEGER NOT NULL DEFAULT 0,
      is_sample           INTEGER NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conferences_user_idx ON conferences(user_id);

    CREATE TABLE IF NOT EXISTS budget_items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      conference_id  INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      category       TEXT NOT NULL,
      label          TEXT NOT NULL,
      planned_cents  INTEGER NOT NULL DEFAULT 0,
      committed_cents INTEGER NOT NULL DEFAULT 0,
      notes          TEXT NOT NULL DEFAULT '',
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS budget_items_conf_idx ON budget_items(conference_id);

    CREATE TABLE IF NOT EXISTS contracts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      conference_id    INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      kind             TEXT NOT NULL DEFAULT 'speaker',
      name             TEXT NOT NULL,
      topic            TEXT NOT NULL DEFAULT '',
      fee_cents        INTEGER NOT NULL DEFAULT 0,
      honorarium_cents INTEGER NOT NULL DEFAULT 0,
      travel_cents     INTEGER NOT NULL DEFAULT 0,
      equipment_cents  INTEGER NOT NULL DEFAULT 0,
      deposit_cents    INTEGER NOT NULL DEFAULT 0,
      contract_status  TEXT NOT NULL DEFAULT 'not_sent',
      contract_date    TEXT NOT NULL DEFAULT '',
      contract_note    TEXT NOT NULL DEFAULT '',
      contact_email    TEXT NOT NULL DEFAULT '',
      stage            TEXT NOT NULL DEFAULT 'invited',
      created_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS contracts_conf_idx ON contracts(conference_id);
    -- Attached contract documents: a signed PDF or a scan of a signed page,
    -- against one contract entry.
    --
    -- The bytes are NEVER in this table. They live on disk under
    -- <data dir>/uploads/<conferenceId>/<contractId>/<stored_name> and only this
    -- metadata row is in SQLite, so the database stays small enough to copy and a
    -- 10 MB scan does not turn every backup of convocate.db into a 10 MB one.
    --
    -- filename is what the person who uploaded it called the file - display
    -- metadata only, never used to build a path. stored_name is generated by us
    -- (a UUID plus a vetted extension) and is the only thing that ever names a
    -- file on disk.
    CREATE TABLE IF NOT EXISTS contract_documents (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      conference_id INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      contract_id   INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      filename      TEXT NOT NULL,
      stored_name   TEXT NOT NULL,
      mime          TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      uploaded_by   INTEGER NOT NULL REFERENCES users(id),
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS contract_documents_contract_idx
      ON contract_documents(contract_id);
    CREATE INDEX IF NOT EXISTS contract_documents_conf_idx
      ON contract_documents(conference_id);

    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    -- Committee access. The conference owner is always conferences.user_id;
    -- this table holds everyone else who was let in, and with which role.
    CREATE TABLE IF NOT EXISTS conference_members (
      conference_id INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role          TEXT NOT NULL DEFAULT 'viewer',
      created_at    INTEGER NOT NULL,
      PRIMARY KEY (conference_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS conference_members_user_idx ON conference_members(user_id);

    -- One row per invite link. A link is reusable until it expires or is revoked.
    CREATE TABLE IF NOT EXISTS conference_invites (
      token         TEXT PRIMARY KEY,
      conference_id INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      role          TEXT NOT NULL DEFAULT 'viewer',
      created_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      revoked_at    INTEGER,
      uses          INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS conference_invites_conf_idx ON conference_invites(conference_id);

    -- The money path. One row per attempt to unlock a conference: 'pending' when
    -- the owner has been sent to pay, 'confirmed' only when a payment has been
    -- seen in the payment account and checked by hand. Nothing else in the
    -- database moves a conference from 'free' to 'unlocked'.
    CREATE TABLE IF NOT EXISTS conference_payments (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      conference_id       INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      amount_cents        INTEGER NOT NULL DEFAULT 0,
      stripe_price        TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL DEFAULT 'pending',
      client_reference_id TEXT NOT NULL DEFAULT '',
      note                TEXT NOT NULL DEFAULT '',
      created_at          INTEGER NOT NULL,
      confirmed_at        INTEGER
    );
    CREATE INDEX IF NOT EXISTS conference_payments_conf_idx ON conference_payments(conference_id);
    CREATE INDEX IF NOT EXISTS conference_payments_status_idx ON conference_payments(status);

    -- Event registration (phase A: the workspace side only — no money moves).
    --
    -- One row per conference, created the first time the church saves a setting;
    -- an absent row means "registration closed, no capacity, no instructions",
    -- which is exactly what a conference that has never opened registration
    -- should say. 'capacity' of 0 means no cap; 'is_open' is 0/1.
    --
    -- 'instructions' is the church's own wording for attendees, shown to them on
    -- the public registration page.
    --
    -- 'public_token' is the unguessable part of the attendee-facing link
    -- (/register/<token>): generated once, 24 random characters, never the
    -- numeric conference id and never enumerable. Empty means "no link yet"; the
    -- unique index over it is created in ensurePublicRegistrationColumns, once
    -- the column is guaranteed to exist on an older database.
    CREATE TABLE IF NOT EXISTS conference_registration (
      conference_id INTEGER PRIMARY KEY REFERENCES conferences(id) ON DELETE CASCADE,
      is_open       INTEGER NOT NULL DEFAULT 0,
      capacity      INTEGER NOT NULL DEFAULT 0,
      instructions  TEXT NOT NULL DEFAULT '',
      public_token  TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    -- The tickets on offer. 'quantity_limit' 0 means unlimited; 'sort_order' is
    -- the order the church arranged them in; 'active' is 0/1 so a retired ticket
    -- stays attached to past attendees without being offered again.
    --
    -- The price is integer cents like every other amount in this database, and it
    -- is a *snapshot source only*: each attendee row keeps the amount it was
    -- registered at (see 'attendees.amount_due_cents'), so changing a price later
    -- never rewrites history.
    CREATE TABLE IF NOT EXISTS ticket_types (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      conference_id  INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      price_cents    INTEGER NOT NULL DEFAULT 0,
      quantity_limit INTEGER NOT NULL DEFAULT 0,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ticket_types_conf_idx ON ticket_types(conference_id);

    -- One row per registration: a person (or a group of 'quantity') against a
    -- ticket type.
    --
    -- Payment. 'payment_status' is one of:
    --   'unpaid'       — nobody has paid: either the organizer takes the fee by
    --                    hand, or their Stripe account was not ready to take a
    --                    card when this person registered (the page stays open
    --                    and records them anyway — that is an owner decision).
    --   'pending'      — a Stripe Checkout Session was created for this row and
    --                    has not been confirmed. The registration is already
    --                    committed, so closing the tab loses nobody.
    --   'paid'         — Stripe said the session was paid. Only the server sets
    --                    this, and only after asking Stripe directly.
    --   'paid_by_hand' — the organizer marked it paid: cash, a check, a comp.
    --   'refunded'     — the organizer refunded it (no flow sets this yet).
    --
    -- 'amount_cents' is what the card payment was created for, kept apart from
    -- 'amount_due_cents' (what this person owed when they registered) so a later
    -- price change cannot rewrite either. 'currency' is Stripe's own lower-case
    -- code, 'paid_at' the moment Stripe confirmed it.
    --
    -- Attendee money belongs to the organizer and is never held by Convocate: a
    -- charge is created ON THE ORGANIZER'S OWN Stripe account (the
    -- Stripe-Account header), and no application fee is ever sent.
    --
    -- 'phone' and 'notes' are what an attendee chose to add on the public form;
    -- both are optional and both stay empty for a registration entered by hand.
    CREATE TABLE IF NOT EXISTS attendees (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      conference_id    INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      ticket_type_id   INTEGER REFERENCES ticket_types(id) ON DELETE SET NULL,
      name             TEXT NOT NULL,
      email            TEXT NOT NULL DEFAULT '',
      phone            TEXT NOT NULL DEFAULT '',
      notes            TEXT NOT NULL DEFAULT '',
      quantity         INTEGER NOT NULL DEFAULT 1,
      amount_due_cents INTEGER NOT NULL DEFAULT 0,
      payment_status   TEXT NOT NULL DEFAULT 'unpaid',
      paid_note        TEXT NOT NULL DEFAULT '',
      amount_cents     INTEGER NOT NULL DEFAULT 0,
      currency         TEXT NOT NULL DEFAULT 'usd',
      stripe_session_id        TEXT NOT NULL DEFAULT '',
      stripe_payment_intent_id TEXT NOT NULL DEFAULT '',
      paid_at          INTEGER,
      registered_at    INTEGER NOT NULL,
      source           TEXT NOT NULL DEFAULT 'workspace'
    );
    CREATE INDEX IF NOT EXISTS attendees_conf_idx ON attendees(conference_id);
    CREATE INDEX IF NOT EXISTS attendees_ticket_idx ON attendees(ticket_type_id);

    -- Every Stripe webhook event Convocate has already dealt with, by Stripe's
    -- own event id. Stripe delivers at least once, and a redelivery of an event
    -- we already applied must change nothing: the row is the receipt that says
    -- "seen", and 'outcome' says what came of it. No card data and no signature
    -- is stored here -- only which event, which type, which session, what we did.
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id    TEXT PRIMARY KEY,
      event_type  TEXT NOT NULL DEFAULT '',
      account_id  TEXT NOT NULL DEFAULT '',
      session_id  TEXT NOT NULL DEFAULT '',
      outcome     TEXT NOT NULL DEFAULT 'received',
      note        TEXT NOT NULL DEFAULT '',
      received_at INTEGER NOT NULL,
      settled_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS stripe_webhook_events_received_idx
      ON stripe_webhook_events(received_at);

    -- Small server-side settings that must not live in the client bundle.
    -- Today: the admin token that alone can confirm a payment.
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    -- One row per snapshot taken, whatever took it: a token-gated export pulled
    -- off the machine ('export'), or the once-a-day copy kept on the live disk
    -- ('daily'). It is the history of what was backed up and when — a snapshot
    -- nobody wrote down is a snapshot nobody can vouch for. No database bytes
    -- live here, only the hash, the size and the moment.
    CREATE TABLE IF NOT EXISTS backup_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      sha256     TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      source     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS backup_log_created_idx ON backup_log(created_at);

    -- First-party page views: one row per public page the server served, written
    -- by the request middleware in src/start.ts (see
    -- src/server/analytics.server.ts). Only the public marketing pages are
    -- counted -- never an app page, an API route, a print route or an asset.
    --
    -- A row says four things and nothing else: which page, when (epoch ms and its
    -- UTC day), which HOST referred it (google.com, never the full URL), and
    -- whether the user agent looked like a machine. There is NO IP address column,
    -- no cookie, no user-agent string, no account id and no identifier of any
    -- kind -- not even a hash of one -- so no row can be tied back to a person, and
    -- nothing in this table is written by JavaScript in the browser.
    -- Raw rows older than 90 days are pruned; the owner's readout reads aggregates.
    CREATE TABLE IF NOT EXISTS page_views (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    INTEGER NOT NULL,
      day           TEXT NOT NULL,
      path          TEXT NOT NULL,
      referrer_host TEXT NOT NULL DEFAULT '',
      is_bot        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS page_views_day_idx ON page_views(day);
    CREATE INDEX IF NOT EXISTS page_views_created_idx ON page_views(created_at);

    -- Every attempt to send an email, whatever became of it. This table exists to
    -- answer one support question — "did the attendee actually get it?" — so a
    -- row is written for a send that succeeded AND for one that did not:
    --
    --   status 'sent'     accepted by the provider; 'resend_id' is its message id
    --   status 'failed'   attempted and refused or timed out; 'error' says why
    --   status 'skipped'  nothing was attempted because mail is not configured
    --
    -- 'recipient_email' is the only place a full address is kept: it is not in
    -- any log line by design (see src/server/mail.server.ts), so this row is what
    -- makes "we told them" checkable after the fact.
    --
    -- 'event_id' is the conference the message was about. It is deliberately NOT
    -- a foreign key: deleting a conference must not delete the record of what we
    -- emailed about it, and the history has to survive the thing it describes.
    -- 'kind' names the message ('registration_confirmation'), so a second kind
    -- needs no schema change.
    CREATE TABLE IF NOT EXISTS email_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      kind            TEXT NOT NULL,
      recipient_email TEXT NOT NULL DEFAULT '',
      event_id        INTEGER,
      resend_id       TEXT,
      status          TEXT NOT NULL,
      error           TEXT,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_log_event_idx ON email_log(event_id);
    CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log(created_at);

    -- One row per person who asked for one of the two free guides at
    -- /resources/<guide>, and said yes to the occasional planning note.
    --
    -- Why this table exists at all: the guides are delivered ON THE PAGE, not by
    -- email (list email is not built yet), so the address is collected for what
    -- comes after the download — and consent has to be provable. Each row keeps
    -- the exact consent wording and its version, the page the form was on, and
    -- the moment it happened. That is the record that answers "what was this
    -- person actually promised?", which a boolean flag could not.
    --
    -- email is stored normalised (trimmed, lowercased — see normaliseEmail in
    -- lib/lead-magnets.ts), and UNIQUE(email, guide) means a second submit of the
    -- same address for the same guide is recorded, never duplicated: the row's
    -- request_count goes up and last_requested_at moves. A different guide is a
    -- different row, because "which guide did they want" is a fact about the
    -- download, not about the person.
    --
    -- unsubscribe_token is stored in the clear, on purpose: it IS the link, and
    -- every stored row has to be able to produce its own working unsubscribe URL
    -- without sending anyone an email first. It is a random opaque string with no
    -- information in it, so reading it grants nothing except the ability to leave
    -- a list. unsubscribed_at is the moment they did; the token keeps working
    -- afterwards, and the page says so plainly.
    CREATE TABLE IF NOT EXISTS lead_signups (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      email             TEXT NOT NULL,
      guide             TEXT NOT NULL,
      source_path       TEXT NOT NULL DEFAULT '',
      -- What the address was given for: 'printable' on the two free guides
      -- whose one-page sheet asks for an email first, 'notes' for the
      -- planning-notes form. Empty on rows written before the column existed.
      context           TEXT NOT NULL DEFAULT '',
      consent_version   TEXT NOT NULL,
      consent_text      TEXT NOT NULL DEFAULT '',
      unsubscribe_token TEXT NOT NULL UNIQUE,
      created_at        INTEGER NOT NULL,
      request_count     INTEGER NOT NULL DEFAULT 1,
      last_requested_at INTEGER NOT NULL,
      unsubscribed_at   INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS lead_signups_email_guide_idx
      ON lead_signups(email, guide);
    CREATE INDEX IF NOT EXISTS lead_signups_created_idx ON lead_signups(created_at);

    -- The organizer's own details, filled in at /app/settings and merged into the
    -- generated agreement and the invitation letter: the legal name and postal
    -- address on the parties line, the notices email in the notices clause, and
    -- the signer's name and role in the signature block.
    --
    -- One row per ACCOUNT, keyed by users.id, and there is no other key: the
    -- server function that reads or writes it takes the account id from the
    -- session and from nowhere else, so no request can name somebody else's row.
    -- No row at all means "never filled in", which every reader treats exactly
    -- like a row of empty strings — the document prints a blank line, never a
    -- guess. Every column is TEXT NOT NULL DEFAULT '' so a half-filled profile
    -- is a plain row of strings with no nulls to special-case at the edges.
    CREATE TABLE IF NOT EXISTS organizer_profiles (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      legal_name    TEXT NOT NULL DEFAULT '',
      address_line1 TEXT NOT NULL DEFAULT '',
      address_line2 TEXT NOT NULL DEFAULT '',
      city          TEXT NOT NULL DEFAULT '',
      state_region  TEXT NOT NULL DEFAULT '',
      postal_code   TEXT NOT NULL DEFAULT '',
      country       TEXT NOT NULL DEFAULT '',
      signer_name   TEXT NOT NULL DEFAULT '',
      signer_title  TEXT NOT NULL DEFAULT '',
      notices_email TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      updated_at    INTEGER NOT NULL
    );

    -- Electronic signature, slice 1: a private link that lets the OTHER party to
    -- one engagement agreement accept it by typing their name.
    --
    -- The row IS the record, not a boolean. It says who asked (created_by), what
    -- the agreement said when the link was issued (agreement_hash), and — once
    -- the other party accepts — the name they typed, the address they chose to
    -- give, the UTC moment, the version of the document they were actually shown
    -- (accepted_version) and the address the request came from.
    --
    -- Slice 2 (a drawn signature) stores its image against THIS SAME ROW, in a
    -- column added later; nothing here has to change for it.
    --
    -- 'token' is the whole guard: 24 random bytes, base64url, and the signing
    -- page takes nothing else — no conference id, no account. 'revoked_at' and
    -- 'expires_at' end a link early; 'accepted_at' ends it for good, because one
    -- link takes one acceptance and the UPDATE that writes it is conditional on
    -- it still being NULL.
    -- The organization's own logo, printed at the top of the documents that
    -- organizer generates: the agreement, the invitation letter, the printed
    -- contract and the print-all board.
    --
    -- One row per ACCOUNT, keyed by 'users.id', exactly like organizer_profiles,
    -- and the account always comes from the session at the call site. The image
    -- lives IN the database, not in the uploads directory: the daily database
    -- dump is what leaves this machine, and a logo kept beside the uploads would
    -- be the one thing a restore could not bring back.
    --
    -- 'bytes' holds the file exactly as uploaded -- at most 1 MB, and only PNG or
    -- JPEG, both decided on the SERVER from the file's own magic bytes and never
    -- from a filename or a browser-sent content type. No row means "no logo
    -- saved", which every document treats as "print what you printed before".
    CREATE TABLE IF NOT EXISTS organizer_logos (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      mime       TEXT NOT NULL,
      bytes      BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signature_requests (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id      INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      token            TEXT NOT NULL UNIQUE,
      created_by       INTEGER NOT NULL,
      created_at       INTEGER NOT NULL,
      expires_at       INTEGER,
      revoked_at       INTEGER,
      agreement_hash   TEXT NOT NULL DEFAULT '',
      signed_name      TEXT NOT NULL DEFAULT '',
      signed_email     TEXT NOT NULL DEFAULT '',
      accepted_at      INTEGER,
      accepted_version TEXT NOT NULL DEFAULT '',
      signer_ip        TEXT NOT NULL DEFAULT '',
      -- Slice 2: the signature the guest DREW, as a data:image/png;base64 URL,
      -- or '' when they drew nothing (the typed name and the tick remain the
      -- legal act). Added to a live table by ensureSignatureImageColumn.
      signature_image  TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS signature_requests_contract_idx
      ON signature_requests(contract_id);

    -- The pre- and post-conference checklist: the "what still has to happen"
    -- panel for a one-off event.
    --
    -- One row per item. 'phase' is 'pre' or 'post' -- before the day and after
    -- it -- and 'position' orders the items inside a phase (1, 2, 3 ...), so a
    -- reorder is two updates and nothing else.
    --
    -- The row is the record of the tick, not a boolean: 'done_at' is the UTC
    -- moment it was ticked and 'done_by' is the name of the account that ticked
    -- it. Unticking clears both back to NULL. Nothing here carries a due date:
    -- the list does not know when the conference is and must not pretend to.
    --
    -- The default list is written once per conference from a template in code
    -- (see seedChecklistOnce), never for every conference up front, and a
    -- one-time marker in schema_migrations makes sure an organizer who removes
    -- every item does not get the template back on the next open.
    --
    -- Deleting a conference takes its checklist with it (ON DELETE CASCADE).
    -- A conference that drops back to the free plan keeps every row: the panel
    -- is refused on the server, and nothing is deleted.
    CREATE TABLE IF NOT EXISTS checklist_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      conference_id INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
      phase         TEXT NOT NULL,
      label         TEXT NOT NULL,
      position      INTEGER NOT NULL DEFAULT 1,
      done_at       INTEGER,
      done_by       TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS checklist_items_conf_idx
      ON checklist_items(conference_id, phase, position);

    -- Questions asked of the in-app help assistant.
    --
    -- This table is the rate limit, not a transcript: the question text and the
    -- moment it was asked, and nothing else -- no answer is stored, and no row
    -- ever holds an organizer's event data (the assistant is never given any).
    -- Both guards count rows here, on the server, so the browser cannot decide
    -- whether it is over the limit:
    --   * 20 questions per account per hour (user_id, asked_at);
    --   * at most 4 questions site-wide in any 60 seconds -- what keeps a small
    --     free-tier key from being hammered by the whole site at once.
    -- A row is written only when a call to the model is actually attempted.
    -- Rows older than a day are deleted on the next question (see
    -- recordAiQuestion), which is all the history either guard needs.
    CREATE TABLE IF NOT EXISTS ai_usage (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL,
      question  TEXT NOT NULL,
      asked_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON ai_usage(user_id, asked_at);

    -- The organizer's own Stripe account, for taking registration fees.
    --
    -- ONE ROW PER ORGANIZER ACCOUNT, not per conference: an organizer running
    -- three events connects their Stripe account once and every event of theirs
    -- pays into it (the owner's decision is that attendee money belongs to the
    -- organizer, so Convocate takes no cut and never holds a balance).
    --
    -- 'stripe_account_id' is the Connect account id (acct_...). It lives here and
    -- nowhere else, and it is never returned to a browser in full -- the settings
    -- page only ever sees its last four characters.
    --
    -- The three flags are Stripe's own answer, copied here so the settings card
    -- can be read without calling Stripe on every page load. They are refreshed by
    -- connectPayoutsStatusFn, which asks Stripe directly; nothing in this table
    -- is ever assumed to be current.
    --
    -- 'connected_at' is when the account was created at Stripe, 'updated_at' the
    -- last time a flag was written. No card number, no bank detail and no token is
    -- stored: Stripe holds all of that, and this row is only the pointer to it.
    CREATE TABLE IF NOT EXISTS payout_accounts (
      user_id           INTEGER PRIMARY KEY,
      stripe_account_id TEXT,
      country           TEXT,
      charges_enabled   INTEGER NOT NULL DEFAULT 0,
      payouts_enabled   INTEGER NOT NULL DEFAULT 0,
      details_submitted INTEGER NOT NULL DEFAULT 0,
      connected_at      INTEGER,
      updated_at        INTEGER
    );
    CREATE INDEX IF NOT EXISTS payout_accounts_stripe_idx
      ON payout_accounts(stripe_account_id);
    -- The Convocate Facebook Page's credentials: page id, page name, the page
    -- access token and the long-lived user token it is re-minted from. One row
    -- per name so a refreshed token replaces its own row and nothing else.
    --
    -- Why here and not in the environment or a file: a page token can post as
    -- the Page, so it is kept where the rest of the business's server-side state
    -- lives - the live database - and read only by facebook.server.ts. It is
    -- never sent to a browser, never logged, and never written to the shared
    -- team folder.
    CREATE TABLE IF NOT EXISTS facebook_page_credentials (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    -- Every DM the Convocate Page receives, as Meta's Messenger webhook delivers
    -- it. Written by messenger.server.ts only; read by the reply path.
    --
    -- 'mid' is Meta's own message id and the UNIQUE key on purpose: Meta retries
    -- a delivery it did not see answered, and the same message must never become
    -- two rows. A second insert of the same mid is ignored, not an error.
    --
    -- What is deliberately NOT stored: our own outgoing messages (echoes), read
    -- receipts, delivery receipts and postbacks. They are counted in the webhook
    -- response and dropped -- none of them is a message from a person, and a
    -- table of read receipts would grow forever for no answer it could give.
    --
    -- 'text' is the message body as Meta sent it (empty for a sticker or a photo
    -- with no caption); 'attachment_count' says how many files came with it
    -- without keeping a URL that expires. 'sent_at' is Meta's millisecond
    -- timestamp, 'received_at' ours in milliseconds.
    --
    -- 'replied_at' / 'reply_mid' are NULL until a reply is actually accepted by
    -- Meta, and both are written together: a row with a timestamp and no id
    -- would be a reply we cannot point at.
    --
    -- The watcher's columns (needs_human, needs_human_reason, replied_by,
    -- reply_claimed_at) reached an existing table through
    -- ensureMessengerWatcherColumns; they are written here too so a fresh
    -- database is born with them.
    CREATE TABLE IF NOT EXISTS messenger_messages (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      mid                TEXT NOT NULL UNIQUE,
      sender_id          TEXT NOT NULL,
      recipient_id       TEXT NOT NULL,
      sent_at            INTEGER NOT NULL,
      text               TEXT NOT NULL DEFAULT '',
      attachment_count   INTEGER NOT NULL DEFAULT 0,
      received_at        INTEGER NOT NULL,
      replied_at         INTEGER,
      reply_mid          TEXT,
      reply_text         TEXT NOT NULL DEFAULT '',
      replied_by         TEXT NOT NULL DEFAULT '',
      needs_human        INTEGER NOT NULL DEFAULT 0,
      needs_human_reason TEXT NOT NULL DEFAULT '',
      reply_claimed_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS messenger_messages_received_idx
      ON messenger_messages(received_at);
    -- The last draft this server wrote for a message, kept only so the send can
    -- tell a person's own words from the model's wording they edited: a reply
    -- still mostly made of the draft gets the automated-assistant line, a reply
    -- typed from scratch does not. One row per message, overwritten each time a
    -- draft is asked for. See messenger-disclosure.ts.
    CREATE TABLE IF NOT EXISTS messenger_drafts (
      mid        TEXT PRIMARY KEY,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    -- The Messenger answering settings, key/value, written from
    -- /admin/messenger and read by the watcher on every run.
    --
    -- Why the database and not the environment: the owner does not paste
    -- environment values, and the team has to be able to switch answering on or
    -- off, and change the voice or the model, without a deploy. MESSENGER_AUTO_REPLY
    -- stays as an override when it is set; this row is what counts otherwise.
    --
    -- Keys: auto_reply_enabled ('1'/'0'), system_prompt, model,
    -- watcher_secret (the shared secret the cron job presents), last_check_at,
    -- last_reply_at, last_failure_at, last_failure. The timestamps are
    -- milliseconds. Nothing here is ever sent to a browser except the first four
    -- of those, and never the secret.
    CREATE TABLE IF NOT EXISTS messenger_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;

/**
 * The drawn signature (slice 2), added to `signature_requests` on an existing
 * database.
 *
 * `CREATE TABLE IF NOT EXISTS` never alters a table that already exists, and
 * this one exists in every live database, so the column has to arrive as an
 * ALTER. PRAGMA is read first and the ALTER runs only when the column is
 * missing: safe on every boot, safe on a fresh database (where the CREATE above
 * has already made it), and it never rewrites or drops a row. A plain ADD COLUMN
 * with a constant default, which SQLite and libSQL both accept on a table that
 * already holds rows.
 */
const ensureSignatureImageColumn = async (instance: Db): Promise<void> => {
  const existing = new Set(
    (await instance
      .query<{ name: string }, []>(`PRAGMA table_info(signature_requests)`)
      .all())
      .map((column) => column.name),
  );
  if (!existing.has("signature_image")) {
    await instance.exec(
      `ALTER TABLE signature_requests ADD COLUMN signature_image TEXT NOT NULL DEFAULT ''`,
    );
  }
};
/**
 * The `password_resets` table, for a database that already existed when the
 * password-reset feature shipped.
 *
 * Written as plain `CREATE TABLE IF NOT EXISTS` statements rather than an ALTER:
 * the table is new, so there is nothing to widen, and running this on a fresh
 * database (where SCHEMA_SQL has just made the table) is a no-op. Safe on every
 * boot, and it never touches a row.
 */
const ensurePasswordResetTable = async (instance: Db): Promise<void> => {
  await instance.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at    INTEGER,
      created_at INTEGER NOT NULL,
      request_ip TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);
    CREATE INDEX IF NOT EXISTS password_resets_ip_idx ON password_resets(request_ip, created_at);
    CREATE INDEX IF NOT EXISTS password_resets_created_idx ON password_resets(created_at);
  `);
};

/**
 * The `stripe_webhook_events` table, for a database that already existed when the
 * webhook shipped.
 *
 * A plain `CREATE TABLE IF NOT EXISTS`, like `ensurePasswordResetTable`: the
 * table is new, so there is nothing to widen, and on a fresh database (where
 * SCHEMA_SQL has just made it) this is a no-op. Safe on every boot; it never
 * touches a row of any other table.
 */
const ensureStripeWebhookTable = async (instance: Db): Promise<void> => {
  await instance.exec(`
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id    TEXT PRIMARY KEY,
      event_type  TEXT NOT NULL DEFAULT '',
      account_id  TEXT NOT NULL DEFAULT '',
      session_id  TEXT NOT NULL DEFAULT '',
      outcome     TEXT NOT NULL DEFAULT 'received',
      note        TEXT NOT NULL DEFAULT '',
      received_at INTEGER NOT NULL,
      settled_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS stripe_webhook_events_received_idx
      ON stripe_webhook_events(received_at);
  `);
};

/**
 * `page_views` as it first shipped carried a `visitor` column -- a one-way hash
 * of (salt | day | address | user agent) -- and called its timestamp `ts`.
 *
 * Neither survives this build. The rule for the visit counter is that it stores
 * nothing derived from an IP address at all, so the hash is gone, and the
 * timestamp is called `created_at` like every other table here. An older
 * database is rebuilt in one transaction: the counts it already holds are copied
 * across, the identifier column is not, and the old table is replaced. The check
 * is PRAGMA table_info, so a database already in the new shape is never touched,
 * and the rebuild runs at most once per database.
 */
const ensurePageViewShape = async (instance: Db): Promise<void> => {
  const columns = await instance
    .query<{ name: string }, []>(`PRAGMA table_info(page_views)`)
    .all();
  const names = new Set(columns.map((column) => column.name));
  if (names.size === 0) return; // no table yet; SCHEMA_SQL just made the new one
  if (names.has("created_at") && !names.has("visitor") && !names.has("ts")) return;
  // A database from the old build has `ts`; the column that is copied across.
  const stamp = names.has("created_at") ? "created_at" : "ts";
  const before = Number(
    (await instance.query<{ c: number }, []>(`SELECT COUNT(*) AS c FROM page_views`).get())?.c ?? 0,
  );
  await instance.transaction(async (tx: Db) => {
    await tx.exec(`
      DROP TABLE IF EXISTS page_views_next;
      CREATE TABLE page_views_next (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at    INTEGER NOT NULL,
        day           TEXT NOT NULL,
        path          TEXT NOT NULL,
        referrer_host TEXT NOT NULL DEFAULT '',
        is_bot        INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO page_views_next (id, created_at, day, path, referrer_host, is_bot)
        SELECT id, ${stamp}, day, path, referrer_host, is_bot FROM page_views;
      DROP TABLE page_views;
      ALTER TABLE page_views_next RENAME TO page_views;
      CREATE INDEX IF NOT EXISTS page_views_day_idx ON page_views(day);
      CREATE INDEX IF NOT EXISTS page_views_created_idx ON page_views(created_at);
    `);
  });
  const after = Number(
    (await instance.query<{ c: number }, []>(`SELECT COUNT(*) AS c FROM page_views`).get())?.c ?? 0,
  );
  console.log(`[convocate] page_views: rebuilt without the visitor hash, ${after}/${before} rows kept`);
};

/**
 * The watcher's four columns on `messenger_messages`, for a database that
 * already existed when the watcher shipped.
 *
 * `CREATE TABLE IF NOT EXISTS` never alters a table that already exists, so they
 * arrive as ALTERs. PRAGMA is read first and each ALTER runs only when its
 * column is missing: safe on every boot, safe on a fresh database (where the
 * CREATE above has already made them), and it never rewrites a row. Each added
 * column has a constant default, which SQLite and libSQL both accept on a table
 * that already holds rows.
 *
 * What they are for:
 *   - `replied_by` — "auto" when the watcher answered, "human" when a person
 *     did. It is how the three-in-a-row guard counts automated replies.
 *   - `needs_human` / `needs_human_reason` — set when the watcher deliberately
 *     did not answer: the 24-hour window closed, the model failed, or this
 *     conversation has had three automated replies with no person in it.
 *   - `reply_claimed_at` — an atomic claim taken before a reply is sent, so two
 *     watcher runs can never both send for the same row.
 */
const ensureMessengerWatcherColumns = async (instance: Db): Promise<void> => {
  const existing = new Set(
    (await instance
      .query<{ name: string }, []>(`PRAGMA table_info(messenger_messages)`)
      .all())
      .map((column) => column.name),
  );
  const wanted: [string, string][] = [
    ["replied_by", `ALTER TABLE messenger_messages ADD COLUMN replied_by TEXT NOT NULL DEFAULT ''`],
    [
      "needs_human",
      `ALTER TABLE messenger_messages ADD COLUMN needs_human INTEGER NOT NULL DEFAULT 0`,
    ],
    [
      "needs_human_reason",
      `ALTER TABLE messenger_messages ADD COLUMN needs_human_reason TEXT NOT NULL DEFAULT ''`,
    ],
    [
      "reply_claimed_at",
      `ALTER TABLE messenger_messages ADD COLUMN reply_claimed_at INTEGER`,
    ],
    // The words we sent, so the next reply can read the thread it is part of.
    // A constant default, which SQLite and libSQL both accept on a table that
    // already holds rows; rows answered before this column existed keep "" and
    // are read as "answered, wording not recorded".
    ["reply_text", `ALTER TABLE messenger_messages ADD COLUMN reply_text TEXT NOT NULL DEFAULT ''`],
  ];
  for (const [name, statement] of wanted) {
    if (!existing.has(name)) await instance.exec(statement);
  }
};

/**
 * The `messenger_settings` table, for a database created before the watcher.
 *
 * A plain `CREATE TABLE IF NOT EXISTS`, like `ensurePasswordResetTable`: the
 * table is new, so there is nothing to widen, and on a fresh database (where
 * SCHEMA_SQL has just made it) this is a no-op. It never touches another table.
 */
const ensureMessengerSettingsTable = async (instance: Db): Promise<void> => {
  await instance.exec(`
    CREATE TABLE IF NOT EXISTS messenger_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
};

/** Create any missing table. Idempotent; never alters or rewrites an existing one. */
const createTables = async (instance: Db): Promise<void> => {
  await instance.exec(SCHEMA_SQL);
};

/**
 * Every migration that is not a plain "CREATE TABLE IF NOT EXISTS": added
 * columns, the speakers→contracts copy, and the one-time markers. Runs on every
 * boot and is idempotent — each step checks before it writes.
 */
const migrate = async (instance: Db): Promise<void> => {
  await createTables(instance);

  // Free tier: `conferences.plan` ('free' | 'unlocked'), plus the audit columns
  // for when a conference was unlocked and what was paid for it.
  await ensureConferencePlanColumns(instance);
  await grandfatherPreFreeTierConferences(instance);
  // The owner's admin flag on an account (the read-only admin view at /admin).
  await ensureUserAdminColumn(instance);
  // Event registration, phase B: the public link's token and the two optional
  // fields the public form takes.
  await ensurePublicRegistrationColumns(instance);
  // Stripe Connect, slice B: the payment columns on an attendee row.
  await ensureAttendeePaymentColumns(instance);
  // Electronic signature, slice 2: the drawn signature image, on the signing
  // row that already exists in every live database.
  await ensureSignatureImageColumn(instance);
  // Password reset: the `password_resets` table, for a database that was created
  // before this build. A plain CREATE TABLE IF NOT EXISTS, safe on every boot.
  await ensurePasswordResetTable(instance);
  // Stripe webhook receipts: the `stripe_webhook_events` table, for a database
  // created before the webhook shipped. Also a plain CREATE TABLE IF NOT EXISTS.
  await ensureStripeWebhookTable(instance);
  // The Messenger watcher: its settings table, and the four columns on
  // `messenger_messages` that say who answered and what was left for a person.
  await ensureMessengerSettingsTable(instance);
  await ensureMessengerWatcherColumns(instance);
  // Visit counter: drop the old `visitor` hash column from `page_views` and
  // rename `ts` to `created_at`, keeping every count already recorded.
  await ensurePageViewShape(instance);
  // Older builds kept a `speakers` table. Widen it into `contracts` by copying
  // rows across once, inside a transaction, guarded by a migration marker so a
  // restart never re-imports rows the user has since edited or deleted.
  await ensureContractColumns(instance);
  // Lead capture: the `context` column, which says whether an address was
  // given for a printable sheet or for planning notes.
  await ensureLeadSignupContextColumn(instance);
  // The budget calculator's save: `budget_items.source` (which line came from
  // the estimator) and `conferences.budget_estimate` (the inputs behind it).
  await ensureBudgetEstimateColumns(instance);
  const alreadyMigrated = await instance
    .query<{ name: string }, [string]>(`SELECT name FROM schema_migrations WHERE name = ?`)
    .get(MIGRATION_SPEAKERS_TO_CONTRACTS);
  const hasSpeakersTable = await instance
    .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'speakers'`)
    .get();
  if (!alreadyMigrated && hasSpeakersTable) {
    await instance.transaction(async (instance: Db) => {
      await instance.exec(`
        INSERT OR IGNORE INTO contracts
          (id, conference_id, kind, name, topic, fee_cents, honorarium_cents,
           travel_cents, equipment_cents, contract_status, contract_date,
           contract_note, contact_email, stage, created_at)
        SELECT id, conference_id, 'speaker', name, topic, fee_cents, honorarium_cents,
               travel_cents, 0, 'not_sent', '',
               contract_note, contact_email, stage, created_at
          FROM speakers;
      `);
      await instance
        .query<unknown, [string, number]>(
          `INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`,
        )
        .run(MIGRATION_SPEAKERS_TO_CONTRACTS, Date.now());
    });
  }
  // Keep AUTOINCREMENT above any copied ids so new rows never collide.
  const maxId = await instance
    .query<{ m: number | null }, []>(`SELECT MAX(id) AS m FROM contracts`)
    .get();
  if (Number(maxId?.m ?? 0) > 0) {
    const seq = await instance
      .query<{ name: string; seq: number }, [string]>(
        `SELECT name, seq FROM sqlite_sequence WHERE name = ?`,
      )
      .get("contracts");
    if (!seq) {
      await instance
        .query<unknown, [string, number]>(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`)
        .run("contracts", Number(maxId?.m));
    }
  }

  // The example conference is seeded by `bootDatabase`, after an import: on an
  // empty remote database it has to be attached to the first real account, which
  // may be arriving from the local file.
};

const MIGRATION_SPEAKERS_TO_CONTRACTS = "2024_speakers_to_contracts_v1";
const MIGRATION_CONFERENCE_PLAN = "2026_conference_plan_v1";
const MIGRATION_SAMPLE_CONFERENCE = "2026_sample_conference_v1";

/**
 * The shared, read-only example conference.
 *
 * Why it exists: on the free plan a director sees only their own empty
 * conference, which proves nothing about what Convocate does. This one is a
 * fully worked conference — a real budget with planned and committed amounts
 * and an over-budget flag, a signed venue, a signed speaker and two
 * negotiations in progress — that any signed-in account can open and read, and
 * nobody can change.
 *
 * Every amount here is invented for the example. It is nobody's real church's
 * figures, which is why money is *shown* on it to every reader (see
 * `moneyVisibleOn`) while a real conference keeps hiding money from a Viewer.
 *
 * The figures are the owner's, exact: do not round or rebalance them.
 */
const SAMPLE_CONFERENCE = {
  name: "Bridgeway Conference 2027",
  startDate: "2027-03-12",
  endDate: "2027-03-14",
  venue: "Riverside Conference Center",
  expectedAttendance: 260,
  /** $75,000 target. Planned $80,300 — over by $5,300 on purpose. */
  budgetTargetCents: 7_500_000,
  budgetItems: [
    // category | label | planned | committed (whole currency units)
    ["Venue", "Hall + 4 breakout rooms, 3 days", 18000, 18000],
    ["Speaker fees", "Keynote honoraria", 8000, 6400],
    ["Music / worship", "Band and vocalists", 4500, 2000],
    ["Equipment / backline", "PA, mics, staging, lighting", 5500, 0],
    ["Travel", "Speakers' and band travel + rooms", 3800, 1100],
    ["Hospitality", "Catering, 260 × 3 days", 27000, 9000],
    ["Production", "Livestream and recording", 8000, 0],
    ["Other", "Printing, signage, bursaries", 5500, 600],
  ] as const,
  contracts: [
    // kind | name | detail | stage | contract status | fee, honorarium, travel, equipment, deposit
    ["venue", "Riverside Conference Center", "Main hall plus four breakout rooms, Fri–Sun", "contracted", "signed", 18000, 0, 0, 0, 4500],
    ["speaker", "Dr. Anne Mbeki", "Opening and closing keynote", "contracted", "signed", 4000, 1500, 900, 0, 0],
    ["speaker", "James Oyelaran", "Breakout track, two sessions", "negotiating", "not_sent", 1000, 0, 600, 0, 0],
    ["musician", "Northgate Brass", "Saturday evening", "negotiating", "sent", 2800, 200, 400, 0, 0],
    ["singer", "Lydia Boateng", "Lead vocalist, Sunday", "invited", "not_sent", 900, 0, 250, 0, 0],
    ["backline", "Stagecraft Rentals", "PA, mics, staging, lighting", "invited", "sent", 0, 0, 0, 3200, 0],
  ] as const,
};

/**
 * Seeds the example exactly once, guarded by a `schema_migrations` marker.
 *
 * One shared row for the whole product: it is owned by the first account in the
 * database (so it can live under the foreign keys without inventing an account)
 * and it is *not* counted as that account's conference. The marker is the whole
 * point: a reboot re-runs `migrate`, and without it every restart would add
 * another copy — or overwrite edits made to it, which is why nothing else in this
 * file writes to a sample row either.
 *
 * If no account exists yet there is nothing to attach the example to, so the
 * seed is skipped without writing the marker and runs on the next boot.
 */
const seedSampleConference = async (instance: Db): Promise<void> => {
  const done = await instance
    .query<{ name: string }, [string]>(`SELECT name FROM schema_migrations WHERE name = ?`)
    .get(MIGRATION_SAMPLE_CONFERENCE);
  if (done) return;
  const owner = await instance
    .query<{ id: number }, []>(`SELECT id FROM users ORDER BY id ASC LIMIT 1`)
    .get();
  if (!owner) return;
  const stamp = Date.now();
  await instance.transaction(async (instance: Db) => {
    const conference = await instance
      .query<{ id: number }, (string | number)[]>(
        `INSERT INTO conferences
           (user_id, name, start_date, end_date, venue, expected_attendance,
            budget_target_cents, plan, unlocked_at, paid_cents, is_sample, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unlocked', ?, 0, 1, ?)
         RETURNING id`,
      )
      .get(
        Number(owner.id),
        SAMPLE_CONFERENCE.name,
        SAMPLE_CONFERENCE.startDate,
        SAMPLE_CONFERENCE.endDate,
        SAMPLE_CONFERENCE.venue,
        SAMPLE_CONFERENCE.expectedAttendance,
        SAMPLE_CONFERENCE.budgetTargetCents,
        stamp,
        stamp,
      );
    const conferenceId = Number(conference?.id);
    if (!conferenceId) throw new Error("sample conference seed: insert returned no id");

    for (const [category, label, planned, committed] of SAMPLE_CONFERENCE.budgetItems) {
      await instance
        .query<unknown, (string | number)[]>(
          `INSERT INTO budget_items
             (conference_id, category, label, planned_cents, committed_cents, notes, created_at)
           VALUES (?, ?, ?, ?, ?, '', ?)`,
        )
        .run(conferenceId, category, label, planned * 100, committed * 100, stamp);
    }

    for (const [kind, name, detail, stage, status, fee, honorarium, travel, equipment, deposit] of
      SAMPLE_CONFERENCE.contracts) {
      await instance
        .query<unknown, (string | number)[]>(
          `INSERT INTO contracts
             (conference_id, kind, name, topic, fee_cents, honorarium_cents, travel_cents,
              equipment_cents, deposit_cents, contract_status, contract_date, contract_note,
              contact_email, stage, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', ?, ?)`,
        )
        .run(
          conferenceId,
          kind,
          name,
          detail,
          fee * 100,
          honorarium * 100,
          travel * 100,
          equipment * 100,
          deposit * 100,
          status,
          stage,
          stamp,
        );
    }

    await instance
      .query<unknown, [string, number]>(
        `INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`,
      )
      .run(MIGRATION_SAMPLE_CONFERENCE, stamp);
  });
};

/**
 * Is this the shared example conference? One question, asked by every write path
 * (and by the money gate), so the answer cannot drift between them.
 */
export const isSampleConference = async (conferenceId: number): Promise<boolean> => {
  if (!Number.isInteger(conferenceId) || conferenceId <= 0) return false;
  const row = await getDb()
    .query<{ is_sample: number }, [number]>(`SELECT is_sample FROM conferences WHERE id = ?`)
    .get(conferenceId);
  return Number(row?.is_sample ?? 0) === 1;
};

/**
 * The shared example, found by its flag and by nothing else.
 *
 * This is the only read path in the product that a signed-out visitor can
 * reach, so the guard is the query itself: `is_sample = 1` is in the WHERE
 * clause and the caller passes no identifier at all (see `getPublicExampleFn`,
 * which takes no input). A conference that is not the example cannot come back
 * from here — it is `null`, exactly like a conference that does not exist.
 *
 * The role is `viewer`, which on any *real* conference would withhold every
 * amount. Money appears here only because `moneyVisibleOn` sees the sample flag:
 * the figures are invented, and showing them is the whole point of the example.
 * If this ever stopped matching a sample row, the reader would get labels only —
 * it fails closed, never open.
 */
export const sampleConferenceForAnyone = async (): Promise<Conference | null> => {
  const row = await getDb()
    .query<ConferenceRow, []>(
      `SELECT c.*, 'viewer' AS role
         FROM conferences c
        WHERE c.is_sample = 1
        ORDER BY c.id ASC
        LIMIT 1`,
    )
    .get();
  return row ? toConference(row, "viewer") : null;
};

/**
 * The example's second pass: its registration side, and the two guest lines that
 * read as church-specific.
 *
 * Why a second migration instead of editing the first seed: the example row
 * already exists in every database that has ever booted, guarded by its own
 * marker, so the first seed will never run again. This one adds what the example
 * was missing — ticket types and a partly-filled room, so a visitor can see what
 * registration looks like on a real 260-person conference — and rewords the two
 * titles that carried church-specific language, because the example is now the
 * one page a stranger reads without an account.
 *
 * The budget category "Music / worship" is deliberately left exactly as it is:
 * that is an owner decision and neither this migration nor anything else renames
 * it.
 *
 * Every statement is scoped to this database's single `is_sample = 1` row, so no
 * real organizer's conference is touched. With no example row yet it returns
 * without writing its marker and runs on a later boot.
 */
const MIGRATION_SAMPLE_ENRICH = "2026_sample_conference_v2";

/** Invented for the example — nobody's real conference, nobody's real attendees. */
const SAMPLE_REGISTRATION = {
  /** 280 seats; 221 places taken, which is what a 260-person conference looks like on the way in. */
  capacity: 280,
  instructions:
    "Doors open at 8:15 a.m. on Friday, and the desk in the main hall lobby has your badge and program under your name. Tell us about any dietary requirements when you register, and we will pass them to the caterer.",
  ticketTypes: [
    // name | price per place (whole dollars) | limit (0 = no limit)
    ["Full conference — 3 days", 149, 0],
    ["Single day", 65, 0],
    ["Student / volunteer", 35, 0],
    ["Team of 5", 625, 0],
  ],
  // ticket index | name | email | places | paid by hand
  groups: [
    [0, "Dana Whitfield", "dana.whitfield@example.org", 12, true],
    [0, "Meridian School District", "district@example.org", 24, true],
    [0, "Ravi Chandra", "ravi.chandra@example.org", 8, true],
    [0, "Northline University events office", "events@example.org", 16, false],
    [0, "Priya Ramanathan", "priya.ramanathan@example.org", 30, true],
    [0, "Cole Fairbanks", "cole.fairbanks@example.org", 9, false],
    [0, "Sana Iqbal", "sana.iqbal@example.org", 6, true],
    [1, "Tomas Eriksen", "tomas.eriksen@example.org", 6, true],
    [1, "Greta Lund", "greta.lund@example.org", 4, false],
    [1, "Westbrook Teachers Association", "westbrook@example.org", 12, true],
    [1, "Malik Obeng", "malik.obeng@example.org", 8, true],
    [1, "Ruth Achebe", "ruth.achebe@example.org", 5, false],
    [2, "Beacon College student group", "beacon@example.org", 18, false],
    [2, "Yara Haddad", "yara.haddad@example.org", 14, true],
    [2, "Ellis Park volunteers", "ellispark@example.org", 9, false],
    [3, "Ferndale Middle School", "ferndale@example.org", 5, true],
    [3, "Hollis Regional Office", "hollis@example.org", 5, true],
    [3, "Community Trust volunteers", "trust@example.org", 5, false],
    [3, "Arden Academy", "arden@example.org", 5, false],
    [3, "Lakeside Arts Council", "lakeside@example.org", 5, true],
    [3, "Quarry Row PTA", "quarryrow@example.org", 5, false],
    [3, "Summit Debate Society", "summit.debate@example.org", 5, true],
    [3, "Taunton Chorale committee", "taunton@example.org", 5, false],
  ],
} as const;

const enrichSampleConference = async (instance: Db): Promise<void> => {
  const done = await instance
    .query<{ name: string }, [string]>(`SELECT name FROM schema_migrations WHERE name = ?`)
    .get(MIGRATION_SAMPLE_ENRICH);
  if (done) return;
  const sample = await instance
    .query<{ id: number }, []>(
      `SELECT id FROM conferences WHERE is_sample = 1 ORDER BY id ASC LIMIT 1`,
    )
    .get();
  if (!sample) return;
  const conferenceId = Number(sample.id);
  const stamp = Date.now();
  await instance.transaction(async (instance: Db) => {
    // Matched on the conference id AND the exact old text: a guest the owner has
    // since renamed does not exist under these names any more, and is left alone.
    await instance
      .query<unknown, [number]>(
        `UPDATE contracts SET name = 'Dr. Anne Mbeki'
          WHERE conference_id = ? AND name = 'Rev. Dr. Anne Mbeki'`,
      )
      .run(conferenceId);
    await instance
      .query<unknown, [number]>(
        `UPDATE contracts SET name = 'James Oyelaran'
          WHERE conference_id = ? AND name = 'Pastor James Oyelaran'`,
      )
      .run(conferenceId);
    await instance
      .query<unknown, [number]>(
        `UPDATE contracts SET topic = 'Breakout track, two sessions'
          WHERE conference_id = ? AND topic = 'Bible study track'`,
      )
      .run(conferenceId);

    await instance
      .query<unknown, [number, number, string, number, number]>(
        `INSERT INTO conference_registration
           (conference_id, is_open, capacity, instructions, public_token, created_at, updated_at)
         VALUES (?, 1, ?, ?, '', ?, ?)
         ON CONFLICT(conference_id) DO UPDATE SET
           is_open = excluded.is_open,
           capacity = excluded.capacity,
           instructions = excluded.instructions,
           updated_at = excluded.updated_at`,
      )
      .run(conferenceId, SAMPLE_REGISTRATION.capacity, SAMPLE_REGISTRATION.instructions, stamp, stamp);

    const ticketIds: number[] = [];
    for (const [index, ticket] of SAMPLE_REGISTRATION.ticketTypes.entries()) {
      const [name, price, limit] = ticket;
      const row = await instance
        .query<{ id: number }, (string | number)[]>(
          `INSERT INTO ticket_types
             (conference_id, name, price_cents, quantity_limit, sort_order, active, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)
           RETURNING id`,
        )
        .get(conferenceId, name, price * 100, limit, index, stamp);
      ticketIds.push(Number(row?.id));
    }

    for (const [position, group] of SAMPLE_REGISTRATION.groups.entries()) {
      const [ticketIndex, name, email, quantity, paid] = group;
      const ticketTypeId = ticketIds[ticketIndex];
      // Spread the registrations over the weeks before the conference rather
      // than stamping them all at one instant.
      const registeredAt = stamp - (SAMPLE_REGISTRATION.groups.length - position) * 86_400_000;
      await instance
        .query<unknown, (string | number)[]>(
          `INSERT INTO attendees
             (conference_id, ticket_type_id, name, email, quantity, amount_due_cents,
              payment_status, paid_note, registered_at, source, phone, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'workspace', '', '')`,
        )
        .run(
          conferenceId,
          ticketTypeId ?? null,
          name,
          email,
          quantity,
          quantity * SAMPLE_REGISTRATION.ticketTypes[ticketIndex][1] * 100,
          paid ? "paid_by_hand" : "unpaid",
          paid ? "Check received" : "",
          registeredAt,
        );
    }

    await instance
      .query<unknown, [string, number]>(
        `INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`,
      )
      .run(MIGRATION_SAMPLE_ENRICH, stamp);
  });
};



/**
 * Free tier columns, added additively: a conference is either on the free plan
 * (`plan = 'free'`, the default for anything created from now on) or unlocked
 * (`plan = 'unlocked'`, every working feature open on it). `unlocked_at` and
 * `paid_cents` record how it was unlocked; nothing reads them for authorization
 * — `plan` alone decides that.
 *
 * Idempotent: PRAGMA table_info is checked first, so this is safe on every boot
 * and never rewrites an existing row.
 */
const ensureConferencePlanColumns = async (instance: Db): Promise<void> => {
  const existing = new Set(
    (await instance
      .query<{ name: string }, []>(`PRAGMA table_info(conferences)`)
      .all())
      .map((column) => column.name),
  );
  const additions: { name: string; ddl: string }[] = [
    { name: "plan", ddl: `ALTER TABLE conferences ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'` },
    { name: "unlocked_at", ddl: `ALTER TABLE conferences ADD COLUMN unlocked_at INTEGER` },
    { name: "paid_cents", ddl: `ALTER TABLE conferences ADD COLUMN paid_cents INTEGER NOT NULL DEFAULT 0` },
    // The read-only example conference. Seeded once, never writable, and
    // excluded from the free plan's one-conference limit.
    { name: "is_sample", ddl: `ALTER TABLE conferences ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0` },
  ];
  for (const column of additions) {
    if (!existing.has(column.name)) await instance.exec(column.ddl);
  }
};

/**
 * `lead_signups.context`, added to a database that already exists.
 *
 * The printable sheets on the two free guides ask for an email address, and so
 * does the planning-notes form; without this column a row could not say which
 * one it came from. `guide` already says which guide. Forward-only and
 * non-destructive: `ADD COLUMN ... NOT NULL DEFAULT ''` gives every existing row
 * an empty context, which reads as "before the column existed". The PRAGMA check
 * is the guard, so running it again on a later boot is a no-op.
 */
const ensureLeadSignupContextColumn = async (instance: Db): Promise<void> => {
  const existing = new Set(
    (await instance
      .query<{ name: string }, []>(`PRAGMA table_info(lead_signups)`)
      .all())
      .map((column) => column.name),
  );
  if (!existing.has("context")) {
    await instance.exec(`ALTER TABLE lead_signups ADD COLUMN context TEXT NOT NULL DEFAULT ''`);
  }
};

/**
 * The two columns the budget calculator's save writes into, added to a database
 * that already exists.
 *
 *  - `budget_items.source` — where a line came from. `''` is a line an organizer
 *    typed themselves; `calculator:venue` (and so on) is a line the estimator
 *    saved. It is what makes a second save *update* the line the first save made
 *    instead of putting a duplicate beside it, and it is never shown to anyone.
 *  - `conferences.budget_estimate` — the last estimate saved onto that
 *    conference, as JSON: the inputs, the totals and when it was saved. Without
 *    it the figures in the budget could not be traced back to the estimate that
 *    produced them.
 *
 * Forward-only and non-destructive: `ADD COLUMN ... NOT NULL DEFAULT ''` gives
 * every existing row an empty value, which reads as "before the column existed"
 * — no budget line becomes an estimate line, and no conference claims to have a
 * saved estimate. The PRAGMA check is the guard, so a later boot is a no-op.
 */
const ensureBudgetEstimateColumns = async (instance: Db): Promise<void> => {
  const columnsOf = async (table: string): Promise<Set<string>> =>
    new Set(
      (await instance.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all()).map(
        (column) => column.name,
      ),
    );
  const budget = await columnsOf("budget_items");
  if (!budget.has("source")) {
    await instance.exec(`ALTER TABLE budget_items ADD COLUMN source TEXT NOT NULL DEFAULT ''`);
  }
  const conferences = await columnsOf("conferences");
  if (!conferences.has("budget_estimate")) {
    await instance.exec(`ALTER TABLE conferences ADD COLUMN budget_estimate TEXT NOT NULL DEFAULT ''`);
  }
};
/**
 * `users.is_admin`, added to a database that already exists.
 *
 * Forward-only and non-destructive: `ADD COLUMN ... NOT NULL DEFAULT 0` gives
 * every row that is already there the value 0, so no existing account becomes an
 * admin by this migration and nothing is rewritten or dropped. The PRAGMA check
 * is the guard (not a `schema_migrations` marker): running it again on a later
 * boot is a no-op, and a marker would be wrong on a database where the column
 * arrived with the CREATE TABLE instead.
 *
 * Who is an admin is decided by this column together with the owner's address
 * (see `ADMIN_ACCOUNT_EMAILS`), read by `isAdminUser`, and enforced on the server
 * by `getAdminOverviewFn`. A flag alone grants nothing.
 */
const ensureUserAdminColumn = async (instance: Db): Promise<void> => {
  const existing = new Set(
    (await instance
      .query<{ name: string }, []>(`PRAGMA table_info(users)`)
      .all())
      .map((column) => column.name),
  );
  if (!existing.has("is_admin")) {
    await instance.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
  }
};

/**
 * The columns the attendee-facing registration page needs, added to an existing
 * database. Plain `ADD COLUMN` with a constant default, so SQLite and libSQL
 * both accept it on a table that already holds rows.
 *
 * After the token column exists, a *partial* unique index is created over it:
 * unique across real tokens (`WHERE public_token <> ''`) so two conferences can
 * never share a link, while every conference that has not been given a token yet
 * keeps the empty string without colliding.
 */
const ensurePublicRegistrationColumns = async (instance: Db): Promise<void> => {
  const existingRegistration = new Set(
    (await instance
      .query<{ name: string }, []>(`PRAGMA table_info(conference_registration)`)
      .all())
      .map((column) => column.name),
  );
  if (!existingRegistration.has("public_token")) {
    await instance.exec(`ALTER TABLE conference_registration ADD COLUMN public_token TEXT NOT NULL DEFAULT ''`);
  }
  const existingAttendees = new Set(
    (await instance
      .query<{ name: string }, []>(`PRAGMA table_info(attendees)`)
      .all())
      .map((column) => column.name),
  );
  if (!existingAttendees.has("phone")) {
    await instance.exec(`ALTER TABLE attendees ADD COLUMN phone TEXT NOT NULL DEFAULT ''`);
  }
  if (!existingAttendees.has("notes")) {
    await instance.exec(`ALTER TABLE attendees ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
  }
  await instance.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS conference_registration_token_idx
       ON conference_registration(public_token) WHERE public_token <> ''`,
  );
};

/**
 * The attendee payment columns (Stripe Connect, slice B), added to an existing
 * database.
 *
 * `CREATE TABLE IF NOT EXISTS` never alters a table that already exists, and
 * `attendees` exists in every live database, so these arrive as ALTERs. Every one
 * is a plain `ADD COLUMN` with a constant default — accepted by SQLite and libSQL
 * on a table that already holds rows — and nothing is dropped, renamed or
 * rewritten: an existing attendee keeps its status and gains an empty payment
 * history, which is the truth about a row taken before cards were possible.
 *
 * `stripe_session_id` gets a *partial* unique index (`WHERE ... <> ''`) so two
 * registrations can never share one Checkout Session — the empty string that
 * every unpaid row carries does not collide with itself.
 */
const ensureAttendeePaymentColumns = async (instance: Db): Promise<void> => {
  const existing = new Set(
    (await instance
      .query<{ name: string }, []>(`PRAGMA table_info(attendees)`)
      .all())
      .map((column) => column.name),
  );
  const columns: { name: string; sql: string }[] = [
    { name: "amount_cents", sql: `ALTER TABLE attendees ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0` },
    { name: "currency", sql: `ALTER TABLE attendees ADD COLUMN currency TEXT NOT NULL DEFAULT 'usd'` },
    { name: "stripe_session_id", sql: `ALTER TABLE attendees ADD COLUMN stripe_session_id TEXT NOT NULL DEFAULT ''` },
    {
      name: "stripe_payment_intent_id",
      sql: `ALTER TABLE attendees ADD COLUMN stripe_payment_intent_id TEXT NOT NULL DEFAULT ''`,
    },
    { name: "paid_at", sql: `ALTER TABLE attendees ADD COLUMN paid_at INTEGER` },
  ];
  for (const column of columns) {
    if (!existing.has(column.name)) await instance.exec(column.sql);
  }
  await instance.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS attendees_session_idx
       ON attendees(stripe_session_id) WHERE stripe_session_id <> ''`,
  );
};

/**
 * Grandfathering, run exactly once (guarded by a migration marker).
 *
 * Every conference that existed before the free tier was enforced was sold as a
 * working conference, and churches have already built budgets and contracts on
 * them. Those rows are switched to `unlocked` so nothing anyone was already
 * using goes dark. Rows created after this point get the column default
 * ('free'). The marker is what makes it one-time: it must never run again, or a
 * future locked conference would be unlocked for free on the next boot.
 */
const grandfatherPreFreeTierConferences = async (instance: Db): Promise<void> => {
  const done = await instance
    .query<{ name: string }, [string]>(`SELECT name FROM schema_migrations WHERE name = ?`)
    .get(MIGRATION_CONFERENCE_PLAN);
  if (done) return;
  const stamp = Date.now();
  await instance.transaction(async (instance: Db) => {
    await instance
      .query<unknown, [number]>(`UPDATE conferences SET plan = 'unlocked', unlocked_at = ? WHERE plan <> 'unlocked'`)
      .run(stamp);
    await instance
      .query<unknown, [string, number]>(
        `INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`,
      )
      .run(MIGRATION_CONFERENCE_PLAN, stamp);
  });
};

/**
 * Additive column migrations. `CREATE TABLE IF NOT EXISTS` never alters a table
 * that already exists, so columns added after a table's first release are added
 * here. Every step is idempotent: it checks PRAGMA table_info first, so it is
 * safe to run on every boot and never rewrites or drops existing rows.
 */
const ensureContractColumns = async (instance: Db): Promise<void> => {
  const existing = new Set(
    (await instance
      .query<{ name: string }, []>(`PRAGMA table_info(contracts)`)
      .all())
      .map((column) => column.name),
  );
  const additions: { name: string; ddl: string }[] = [
    { name: "kind", ddl: `ALTER TABLE contracts ADD COLUMN kind TEXT NOT NULL DEFAULT 'speaker'` },
    { name: "equipment_cents", ddl: `ALTER TABLE contracts ADD COLUMN equipment_cents INTEGER NOT NULL DEFAULT 0` },
    { name: "deposit_cents", ddl: `ALTER TABLE contracts ADD COLUMN deposit_cents INTEGER NOT NULL DEFAULT 0` },
    { name: "contract_status", ddl: `ALTER TABLE contracts ADD COLUMN contract_status TEXT NOT NULL DEFAULT 'not_sent'` },
    { name: "contract_date", ddl: `ALTER TABLE contracts ADD COLUMN contract_date TEXT NOT NULL DEFAULT ''` },
    /* ---- agreement terms (see src/lib/agreement.ts) ----------------------
     * The auto-generated agreement is built from these. Every one is optional:
     * an empty value means the clause prints with a blank line to complete by
     * hand, never invented content. Existing rows keep empty values, so every
     * contract written before this migration still renders a full agreement. */
    { name: "agreement_engagement", ddl: `ALTER TABLE contracts ADD COLUMN agreement_engagement TEXT NOT NULL DEFAULT ''` },
    { name: "agreement_schedule", ddl: `ALTER TABLE contracts ADD COLUMN agreement_schedule TEXT NOT NULL DEFAULT ''` },
    { name: "agreement_detail", ddl: `ALTER TABLE contracts ADD COLUMN agreement_detail TEXT NOT NULL DEFAULT ''` },
    { name: "agreement_balance_due", ddl: `ALTER TABLE contracts ADD COLUMN agreement_balance_due TEXT NOT NULL DEFAULT ''` },
    { name: "agreement_payment_note", ddl: `ALTER TABLE contracts ADD COLUMN agreement_payment_note TEXT NOT NULL DEFAULT ''` },
    { name: "agreement_inclusions", ddl: `ALTER TABLE contracts ADD COLUMN agreement_inclusions TEXT NOT NULL DEFAULT ''` },
    { name: "agreement_cancellation_notice", ddl: `ALTER TABLE contracts ADD COLUMN agreement_cancellation_notice INTEGER NOT NULL DEFAULT 0` },
    { name: "agreement_cancellation_deposit", ddl: `ALTER TABLE contracts ADD COLUMN agreement_cancellation_deposit TEXT NOT NULL DEFAULT ''` },
    { name: "agreement_additional_terms", ddl: `ALTER TABLE contracts ADD COLUMN agreement_additional_terms TEXT NOT NULL DEFAULT ''` },
    { name: "agreement_governing_law", ddl: `ALTER TABLE contracts ADD COLUMN agreement_governing_law TEXT NOT NULL DEFAULT ''` },
    { name: "agreement_clauses", ddl: `ALTER TABLE contracts ADD COLUMN agreement_clauses TEXT NOT NULL DEFAULT ''` },
    { name: "agreement_saved_at", ddl: `ALTER TABLE contracts ADD COLUMN agreement_saved_at INTEGER NOT NULL DEFAULT 0` },
  ];
  for (const column of additions) {
    if (!existing.has(column.name)) await instance.exec(column.ddl);
  }
};

/* ------------------------------------------------------------------ types */

export type User = { id: number; email: string; name: string };

/**
 * What a signed-in user may do on one conference.
 *  owner  — everything, including invites and removing people.
 *  editor — read and write the budget and the contracts board.
 *  viewer — read only; the server refuses every write.
 */
export type MemberRole = "owner" | "editor" | "viewer";

/** Roles a person can be *granted* — the owner is derived, never assigned. */
export type InviteRole = "editor" | "viewer";

export const canEditRole = (role: MemberRole | null): boolean =>
  role === "owner" || role === "editor";

/**
 * The one money gate for the whole app: may this reader see any amount at all?
 *
 * A committee Viewer holds no money on a conference — no fee, honorarium,
 * travel, equipment, deposit, contract total, budget planned/committed figure,
 * budget target or rollup. This is enforced *here*, at the read layer: the
 * shaping functions below return `null` in place of every amount before the
 * payload leaves the server, so a viewer's response never contains a figure to
 * hide, and a forged request gets the same empty answer as the page does.
 *
 * Anything that hides a number only in the page is a bug: the page cannot know
 * an amount the server never sent.
 */
export const moneyVisibleTo = (role: MemberRole | null): boolean =>
  role === "owner" || role === "editor";

/**
 * The same question for one conference: may this reader see its amounts?
 *
 * The shared example conference is the one exception, and it is deliberate. Its
 * figures are invented for the example — they are nobody's church's real money —
 * and showing the arithmetic (planned vs. committed, over budget, signed vs.
 * unsigned) is the entire reason it exists. So every signed-in reader sees money
 * on the example, whatever their role. A real conference is unaffected: a Viewer
 * there still gets nothing but labels and stages.
 */
export const moneyVisibleOn = async (conferenceId: number, role: MemberRole | null): Promise<boolean> =>
  await isSampleConference(conferenceId) || moneyVisibleTo(role);

/** One amount, or `null` when this reader is not shown money. */
const money = (visible: boolean, cents: number | null | undefined): number | null =>
  visible ? Number(cents ?? 0) : null;

/**
 * Belt-and-braces: a final pass over a whole response before it leaves the
 * server, blanking every field whose name ends in `Cents` for a reader who is
 * not shown money — including any amount a future read path forgets to gate.
 *
 * The shaping functions above are the real gate; this catches the field someone
 * adds next month and does not yet know about `moneyVisibleTo`.
 */
export const withholdMoneyDeep = <T>(value: T, visible: boolean): T => {
  if (visible) return value;
  const scrub = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(scrub);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        out[key] = /cents$/i.test(key) ? null : scrub(child);
      }
      return out;
    }
    return node;
  };
  return scrub(value) as T;
};

const asInviteRole = (value: unknown): InviteRole => (value === "editor" ? "editor" : "viewer");

/* --------------------------------------------------------------- free tier */

/**
 * The free tier, in one place.
 *
 * Free = one conference per account, and that conference is the frame only: its
 * name, dates, venue, attendance and target, read by its owner alone. No budget
 * lines, no contracts, no committee invites, no exports.
 *
 * $199, per conference, unlocks all of it on *that* conference. The unlock is
 * paid for through the Stripe payment link in `src/lib/plan.ts`; `plan` moves
 * from 'free' to 'unlocked' only in `confirmPaymentForConference`, i.e. only
 * after a payment has been seen in the payment account and confirmed with the
 * admin token. There is no user-reachable path that unlocks anything.
 */
export type ConferencePlan = "free" | "unlocked";

/** One conference per account while the free tier is the only tier on offer. */
export const FREE_CONFERENCE_LIMIT = 1;

/**
 * What a conference is entitled to, and why.
 *
 * `plan` is the stored column ('free' until $199 is confirmed). `ownerIsAdmin`
 * is the *owner's* admin status (flag AND the owner's address, see
 * `ADMIN_ACCOUNT_EMAILS`), read from the database on every call — never from the
 * request, and never from the caller's own account when the caller is merely an
 * editor or a viewer. `unlocked` is the one answer
 * every feature asks for: paid for, or owned by an admin account.
 */
export type ConferenceEntitlement = {
  plan: ConferencePlan;
  ownerIsAdmin: boolean;
  unlocked: boolean;
};

/**
 * The whole decision, in one pure function, so the SQL path here and the
 * row-based path on the public registration page cannot drift apart. Anything
 * that is not exactly 1 is not an admin, so a strange value can only ever lose
 * access, never grant it.
 */
const decideEntitlement = (
  plan: string | null | undefined,
  ownerIsAdmin: number | null | undefined,
): ConferenceEntitlement => {
  const paid = plan === "unlocked";
  const admin = Number(ownerIsAdmin ?? 0) === 1;
  return { plan: paid ? "unlocked" : "free", ownerIsAdmin: admin, unlocked: paid || admin };
};

/**
 * **The entitlement entry point.** Every feature that is part of the unlock —
 * budget lines beyond the free one, contracts, attached documents, exports,
 * printing, invites, registration — asks `isConferenceUnlocked`, and that asks
 * this. There is no second answer anywhere in the app.
 *
 * A missing or unreadable row answers 'free' — the safe direction, exactly like
 * the role fallback above.
 */
export const conferenceEntitlement = async (conferenceId: number): Promise<ConferenceEntitlement> => {
  if (!Number.isInteger(conferenceId) || conferenceId <= 0) return decideEntitlement("free", 0);
  const row = await getDb()
    .query<{ plan: string | null; is_admin: number | null }, [number]>(
      `SELECT c.plan, ${adminOwnerFlagSql("u")} AS is_admin
         FROM conferences c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = ?`,
    )
    .get(conferenceId);
  return decideEntitlement(row?.plan, row?.is_admin);
};

/** The effective plan: 'unlocked' for a paid conference and for an admin's own. */
export const conferencePlan = async (conferenceId: number): Promise<ConferencePlan> =>
  (await conferenceEntitlement(conferenceId)).unlocked ? "unlocked" : "free";

export const isConferenceUnlocked = async (conferenceId: number): Promise<boolean> =>
  (await conferenceEntitlement(conferenceId)).unlocked;

/**
 * How many conferences this account owns (invited-to ones are not theirs).
 *
 * The shared example is excluded: it is owned by a real account only because it
 * has to sit under the foreign keys, and it must never consume anyone's free
 * conference — the example is there to show what Convocate does, not to be a
 * slot taken. `canCreateConference` inherits that exemption from this count.
 */
export const countOwnedConferences = async (userId: number): Promise<number> => {
  if (!Number.isInteger(userId) || userId <= 0) return Number.MAX_SAFE_INTEGER;
  const row = await getDb()
    .query<{ n: number }, [number]>(
      `SELECT COUNT(*) AS n FROM conferences WHERE user_id = ? AND is_sample = 0`,
    )
    .get(userId);
  return Number(row?.n ?? 0);
};

/**
 * May this account create another conference? One conference per account, and
 * that is the limit even once that conference has been unlocked for $199: the
 * payment opens that conference's work, it does not buy a second conference. A
 * second one is refused rather than silently created.
 */
export const canCreateConference = async (userId: number): Promise<boolean> => {
  // An admin account runs as many conferences as it needs: the one-conference
  // cap is a free-tier limit, and an admin's conferences are never on the free
  // tier (see `conferenceEntitlement`). Read from the database, per account —
  // a browser cannot claim it.
  if (await isAdminUser(userId)) return true;
  return await countOwnedConferences(userId) < FREE_CONFERENCE_LIMIT;
};

/* --------------------------------------------------------- the money path */

/**
 * One attempt to unlock a conference.
 *
 *   pending   — the owner has been sent to the payment link; nothing is open yet
 *   confirmed — a payment for this conference was seen in the payment account and
 *               recorded by hand; the conference is unlocked
 *   failed    — a payment that will never be confirmed (kept for the record)
 *
 * A row is never deleted: it is the audit trail for why a conference is open.
 */
export type PaymentStatus = "pending" | "confirmed" | "failed" | "abandoned";

export type ConferencePayment = {
  id: number;
  conferenceId: number;
  amountCents: number;
  stripePrice: string;
  status: PaymentStatus;
  clientReferenceId: string;
  note: string;
  createdAt: number;
  confirmedAt: number | null;
};

type PaymentRow = {
  id: number;
  conference_id: number;
  amount_cents: number;
  stripe_price: string;
  status: string;
  client_reference_id: string;
  note: string;
  created_at: number;
  confirmed_at: number | null;
};

const shapePayment = (row: PaymentRow): ConferencePayment => ({
  id: Number(row.id),
  conferenceId: Number(row.conference_id),
  amountCents: Number(row.amount_cents),
  stripePrice: row.stripe_price ?? "",
  status:
    row.status === "confirmed"
      ? "confirmed"
      : row.status === "failed"
        ? "failed"
        : row.status === "abandoned"
          ? "abandoned"
          : "pending",
  clientReferenceId: row.client_reference_id ?? "",
  note: row.note ?? "",
  createdAt: Number(row.created_at),
  confirmedAt: row.confirmed_at === null ? null : Number(row.confirmed_at),
});

/** The most recent payment attempt on a conference, or null if there is none. */
export const latestPaymentFor = async (conferenceId: number): Promise<ConferencePayment | null> => {
  if (!Number.isInteger(conferenceId) || conferenceId <= 0) return null;
  const row = await getDb()
    .query<PaymentRow, [number]>(
      `SELECT * FROM conference_payments WHERE conference_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(conferenceId);
  return row ? shapePayment(row) : null;
};

/** Every payment row for a conference, newest first (audit / admin use). */
export const paymentsFor = async (conferenceId: number): Promise<ConferencePayment[]> => {
  if (!Number.isInteger(conferenceId) || conferenceId <= 0) return [];
  return (await getDb()
    .query<PaymentRow, [number]>(
      `SELECT * FROM conference_payments WHERE conference_id = ? ORDER BY id DESC`,
    )
    .all(conferenceId))
    .map(shapePayment);
};

export type StartPaymentResult =
  | { ok: true; paymentId: number }
  | { ok: false; reason: "sample" | "missing" | "unlocked" | "pending" };

/**
 * Record that the owner is being sent to pay for this conference.
 *
 * One *live* pending row per conference at a time: while an attempt is fresh the
 * caller is refused (`reason: "pending"`) rather than given a second payment
 * link, because paying twice for one conference is the failure mode that would
 * actually hurt an organizer. The checks, the abandonment and the insert are one
 * transaction, so two simultaneous clicks cannot both get through.
 *
 * An attempt that was never confirmed and is older than
 * `PAYMENT_RETRY_AFTER_MINUTES` (one number, in `lib/plan.ts`) is marked
 * `abandoned` — kept on record, never deleted — and a fresh attempt is recorded
 * in its place. That is a retry, not an unlock: the conference's plan is not
 * touched anywhere in this function, and `confirmPaymentForConference` is still
 * the only code in the product that opens a conference.
 *
 * We cannot ask Stripe whether the old attempt was paid: no Checkout Session id
 * is stored for it, and the saved key is test-mode while the payment link is
 * live. So the rule is the clock plus "never confirmed" — and the paywall says
 * plainly not to pay again if the card was charged.
 */
export const recordPendingPayment = async (
  conferenceId: number,
  amountCents: number,
  clientReferenceId: string,
): Promise<StartPaymentResult> => {
  if (!Number.isInteger(conferenceId) || conferenceId <= 0) return { ok: false, reason: "missing" };
  return await getDb().transaction(async (db): Promise<StartPaymentResult> => {
    const conference = await db
      .query<{ plan: string | null; is_sample: number | null }, [number]>(
        `SELECT plan, is_sample FROM conferences WHERE id = ?`,
      )
      .get(conferenceId);
    if (!conference) return { ok: false, reason: "missing" };
    if (Number(conference.is_sample ?? 0) === 1) return { ok: false, reason: "sample" };
    if (conference.plan === "unlocked") return { ok: false, reason: "unlocked" };

    const now = Date.now();
    const open = await db
      .query<{ id: number; created_at: number }, [number]>(
        `SELECT id, created_at FROM conference_payments
          WHERE conference_id = ? AND status = 'pending'`,
      )
      .all(conferenceId);
    // A fresh attempt may genuinely be in flight — a card being typed, a bank
    // challenge — so this is refused exactly as before.
    if (open.some((row) => !isPaymentAttemptStale(Number(row.created_at), now))) {
      return { ok: false, reason: "pending" };
    }
    // Every open attempt is stale and none of them was ever confirmed (a
    // confirmed row is never `pending`). Set them aside and start a fresh one.
    if (open.length > 0) {
      await db
        .query<unknown, [string, number]>(
          `UPDATE conference_payments
              SET status = 'abandoned',
                  note = TRIM(note || ' ' || ?)
            WHERE conference_id = ? AND status = 'pending'`,
        )
        .run(
          `abandoned ${new Date(now).toISOString()} — no confirmed payment after ${PAYMENT_RETRY_AFTER_MINUTES} minutes; a new attempt was started.`,
          conferenceId,
        );
    }
    const row = await db
      .query<{ id: number }, [number, number, string, number]>(
        `INSERT INTO conference_payments
           (conference_id, amount_cents, stripe_price, status, client_reference_id, note, created_at)
         VALUES (?, ?, '', 'pending', ?, '', ?)
         RETURNING id`,
      )
      .get(conferenceId, amountCents, clientReferenceId, now);
    return { ok: true, paymentId: Number(row?.id) };
  });
};

export type ConfirmPaymentResult =
  | { ok: true; alreadyUnlocked: boolean; paidCents: number }
  | { ok: false; reason: "missing" | "sample" | "no_pending" };

/**
 * Confirming a payment: the only code in the product that moves a conference
 * from `free` to `unlocked`.
 *
 * Called by hand (see `confirmPaymentFn`, which is behind the admin token) after
 * the payment has been seen in the payment account. It refuses unless the
 * conference is a real conference, still on the free plan, and holds a `pending`
 * payment row — so no stray call can open a conference that was never paid for.
 *
 * Everything happens in one transaction: the plan, the unlock stamp, what was
 * paid, and the payment row's own status. An already-unlocked conference is a
 * no-op, not an error, so a repeated confirmation is harmless.
 *
 * The example conference is refused here as well as in the API: it is not for
 * sale at any price.
 */
export const confirmPaymentForConference = async (
  conferenceId: number,
  amountCents: number,
  reference: string,
): Promise<ConfirmPaymentResult> => {
  if (!Number.isInteger(conferenceId) || conferenceId <= 0) return { ok: false, reason: "missing" };
  return await getDb().transaction(async (db): Promise<ConfirmPaymentResult> => {
    const conference = await db
      .query<{ plan: string | null; paid_cents: number | null; is_sample: number | null }, [number]>(
        `SELECT plan, paid_cents, is_sample FROM conferences WHERE id = ?`,
      )
      .get(conferenceId);
    if (!conference) return { ok: false, reason: "missing" };
    if (Number(conference.is_sample ?? 0) === 1) return { ok: false, reason: "sample" };
    if (conference.plan === "unlocked") {
      return { ok: true, alreadyUnlocked: true, paidCents: Number(conference.paid_cents ?? 0) };
    }
    const pending = await db
      .query<PaymentRow, [number]>(
        `SELECT * FROM conference_payments
          WHERE conference_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
      )
      .get(conferenceId);
    if (!pending) return { ok: false, reason: "no_pending" };

    const stamp = Date.now();
    const note = reference
      ? `${pending.note ? `${pending.note} ` : ""}confirmed against ${reference}`.slice(0, 600)
      : pending.note;
    await db.query<unknown, [number, number, number]>(
      `UPDATE conferences SET plan = 'unlocked', unlocked_at = ?, paid_cents = ?
        WHERE id = ? AND plan <> 'unlocked' AND is_sample = 0`,
    ).run(stamp, amountCents, conferenceId);
    await db.query<unknown, [number, number, string, number]>(
      `UPDATE conference_payments SET status = 'confirmed', confirmed_at = ?, amount_cents = ?, note = ?
        WHERE id = ?`,
    ).run(stamp, amountCents, note, Number(pending.id));
    return { ok: true, alreadyUnlocked: false, paidCents: amountCents };
  });
};

/* ------------------------------------------------------------ admin token */

/**
 * The credential that alone can confirm a payment.
 *
 * 32 random bytes, generated once on first boot, kept in `app_settings` (never
 * in the client bundle) and mirrored to a 0600 file outside the site directory
 * so the team can read it to confirm a payment. No read path returns it and no
 * page shows it — `checkAdminToken` is the only code that touches its value.
 */
export const ADMIN_TOKEN_FILE = "/home/team/shared/convocate-admin-token.txt";

/** Rewrite the token file only when it is missing or stale, always 0600. */
const mirrorAdminTokenFile = (token: string): void => {
  try {
    const current = existsSync(ADMIN_TOKEN_FILE)
      ? readFileSync(ADMIN_TOKEN_FILE, "utf8").trim()
      : "";
    if (current !== token) writeFileSync(ADMIN_TOKEN_FILE, `${token}\n`, { mode: 0o600 });
    chmodSync(ADMIN_TOKEN_FILE, 0o600);
  } catch (cause) {
    // A read-only or missing directory must not stop the app: the token is still
    // in the database, and the team can be told the file could not be written.
    console.error("[convocate] could not write the admin token file", cause);
  }
};

/** The admin token, created on first use and stable afterwards. */
export const adminToken = async (): Promise<string> => {
  // rawDb(), not getDb(): boot itself asks for this token (to mirror it to its
  // file), and waiting for boot from inside boot would never return.
  const db = rawDb();
  const row = await db
    .query<{ value: string }, [string]>(`SELECT value FROM app_settings WHERE key = ?`)
    .get("admin_token");
  if (row?.value) {
    mirrorAdminTokenFile(row.value);
    return row.value;
  }
  const token = randomBytes(32).toString("hex");
  await db.query<unknown, [string, number]>(
    `INSERT INTO app_settings (key, value, created_at) VALUES ('admin_token', ?, ?)`,
  ).run(token, Date.now());
  mirrorAdminTokenFile(token);
  return token;
};

/** Timing-safe comparison, so a wrong token cannot be guessed byte by byte. */
export const checkAdminToken = async (candidate: string): Promise<boolean> => {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  // This is the first thing the admin routes call, and it works on the raw
  // handle (see adminToken): make sure the schema step has finished.
  await ensureSchema();
  const expected = Buffer.from(await adminToken(), "utf8");
  const given = Buffer.from(candidate.trim(), "utf8");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
};

/* --------------------------------------------------------------- backups */
/**
 * Backing the live database up.
 *
 * `VACUUM INTO '<file>'` is the whole technique: SQLite writes a complete,
 * defragmented copy of the database into a new file, folding in everything still
 * sitting in the WAL, from a single read transaction. The live file is only read
 * — never copied byte-for-byte, which with WAL mode would miss recent commits or
 * catch a torn page — and nothing is written into it.
 *
 * There are two ways a snapshot leaves the machine:
 *
 *   1. `createSnapshot()` — the bytes, in memory, for the token-gated export in
 *      `api.ts` that the team pulls off the box. This is the real backup.
 *   2. `dailySnapshot()` — a copy kept in `<data dir>/backups/`, at most one per
 *      UTC day, newest 30 kept. THIS IS EXPRESSLY THE SECOND LINE OF DEFENSE: it
 *      sits on the same disk as the data, so it survives a bad deploy, a bad
 *      migration or a mistaken delete, and nothing else. A lost or wiped machine
 *      takes these copies with it. They are a convenience for a quick restore,
 *      NOT an off-site backup — do not mistake them for one.
 *
 * Neither path touches `.data/uploads/` (the attached contract files): a
 * snapshot is the database only. See BACKUP-RESTORE.md.
 */
export const BACKUPS_DIR = dataLayout().backupsDir;
export const backupsDir = (): string => BACKUPS_DIR;
/** The file a restore replaces. Exported so the runbook and tests name one path. */
export const databasePath = (): string => DB_PATH;
// How many daily snapshots are kept on the live disk. Must match the retention we promise.
export const SNAPSHOT_KEEP = 30;
const SNAPSHOT_FILE = /^convocate-(\d{4})-(\d{2})-(\d{2})\.db$/;
export type BackupLogEntry = {
  id: number;
  createdAt: number;
  sha256: string;
  sizeBytes: number;
  source: string;
};
export type Snapshot = {
  bytes: Buffer;
  sha256: string;
  sizeBytes: number;
  createdAt: number;
  fileName: string;
};
const stampFor = (ms: number): string => new Date(ms).toISOString().replace(/[:.]/g, "-");
const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/**
 * A consistent copy of the whole database, in memory.
 *
 * The copy is written to a fresh directory under the OS temp dir, read back, and
 * the directory is removed in a `finally` — whether the read worked or not. So a
 * snapshot never leaves a half-written file behind, and the temp file never
 * outlives the call.
 */
/**
 * A snapshot cannot be taken: `VACUUM INTO` writes a file on this machine, and
 * the database this site is using is not a file on this machine.
 *
 * Thrown rather than returning something empty, so a caller can never mistake
 * "no backup happened" for "the backup is here" — `api.ts` turns it into an
 * honest refusal on the export route the daily pull relies on.
 */
export class SnapshotUnavailableError extends Error {
  readonly code = "snapshot_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "SnapshotUnavailableError";
  }
}

export const createSnapshot = async (): Promise<Snapshot> => {
  if (databaseTarget().kind !== "file") {
    throw new SnapshotUnavailableError(
      "This conference's data lives in a remote libSQL database, not in a file on " +
        "this machine, so \"VACUUM INTO\" has nothing to copy. The remote database's " +
        "own backups cover it; this export route is file-database only.",
    );
  }
  const db = rawDb();
  const createdAt = Date.now();
  const fileName = `convocate-${stampFor(createdAt)}.db`;
  const dir = mkdtempSync(join(tmpdir(), "convocate-snapshot-"));
  const file = join(dir, fileName);
  try {
    // The path is one we generated; the quote escape is belt and braces so a
    // CONVOCATE_DB_PATH with an apostrophe in it cannot break the statement.
    await db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const bytes = readFileSync(file);
    return {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.length,
      createdAt,
      fileName,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
/** Write the history row for a snapshot that was actually taken. */
export const recordBackup = async (input: {
  sha256: string;
  sizeBytes: number;
  source: string;
  createdAt?: number;
}): Promise<BackupLogEntry> => {
  const createdAt = Number(input.createdAt ?? Date.now());
  const result = await rawDb()
    .query<unknown, [number, string, number, string]>(
      `INSERT INTO backup_log (created_at, sha256, size_bytes, source) VALUES (?, ?, ?, ?)`,
    )
    .run(createdAt, input.sha256, Math.trunc(input.sizeBytes), input.source);
  return {
    id: Number(result.lastInsertRowid ?? 0),
    createdAt,
    sha256: input.sha256,
    sizeBytes: Math.trunc(input.sizeBytes),
    source: input.source,
  };
};
/** The backup history, newest first. */
export const listBackups = async (limit = 20): Promise<BackupLogEntry[]> =>
  (await getDb()
    .query<
      { id: number; created_at: number; sha256: string; size_bytes: number; source: string },
      [number]
    >(
      `SELECT id, created_at, sha256, size_bytes, source
         FROM backup_log ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.trunc(limit))))
    .map((row) => ({
      id: Number(row.id),
      createdAt: Number(row.created_at),
      sha256: String(row.sha256),
      sizeBytes: Number(row.size_bytes),
      source: String(row.source),
    }));
/** When the last token-gated export was taken, or 0 if never. */
export const lastExportAt = async (): Promise<number> => {
  const row = await getDb()
    .query<{ created_at: number }, [string]>(
      `SELECT created_at FROM backup_log WHERE source = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get("export");
  return row ? Number(row.created_at) : 0;
};
/**
 * Delete everything but the newest `SNAPSHOT_KEEP` daily files. Names are
 * `convocate-YYYY-MM-DD.db`, so sorting the names sorts the days. Returns the
 * names removed, so a test (and the log) can see the pruning happened.
 */
export const pruneSnapshots = (keep = SNAPSHOT_KEEP): string[] => {
  if (!existsSync(BACKUPS_DIR)) return [];
  const files = readdirSync(BACKUPS_DIR)
    .filter((name) => SNAPSHOT_FILE.test(name))
    .sort();
  const stale = files.slice(0, Math.max(0, files.length - keep));
  for (const name of stale) rmSync(join(BACKUPS_DIR, name), { force: true });
  return stale;
};
/**
 * The once-a-day copy kept on the live disk (second line of defense — same disk,
 * see the note at the top of this section).
 *
 * At most one per UTC day: if today's file is already there, this does nothing
 * and returns null. The copy is written to a temp name and renamed into place,
 * so an interrupted write never leaves a truncated file where a good one should
 * be. Pruning runs after every successful take.
 *
 * Throws on failure — the callers (boot, export) catch and log it, because a
 * backup that fails must never take the site down with it.
 */
export const dailySnapshot = async (
  source: "boot" | "export" | "manual",
): Promise<BackupLogEntry | null> => {
  // A copy kept on the live disk only means anything when the database is a file
  // on that disk. With a remote database the remote's own backups cover it, and
  // pretending otherwise would log a snapshot that was never taken.
  if (databaseTarget().kind !== "file") {
    console.log("[convocate] daily snapshot skipped: the database is remote, not a local file");
    return null;
  }
  mkdirSync(BACKUPS_DIR, { recursive: true });
  const day = utcDay(Date.now());
  const target = join(BACKUPS_DIR, `convocate-${day}.db`);
  if (existsSync(target)) {
    pruneSnapshots();
    return null;
  }
  const snapshot = await createSnapshot();
  const temp = join(BACKUPS_DIR, `.${snapshot.fileName}.tmp`);
  try {
    writeFileSync(temp, snapshot.bytes, { mode: 0o600 });
    renameSync(temp, target);
  } finally {
    rmSync(temp, { force: true });
  }
  const pruned = pruneSnapshots();
  const log = await recordBackup({
    sha256: snapshot.sha256,
    sizeBytes: snapshot.sizeBytes,
    source: `daily:${source}`,
    createdAt: snapshot.createdAt,
  });
  console.log(
    `[convocate] daily snapshot ${target} bytes=${String(snapshot.sizeBytes)} sha256=${snapshot.sha256}${
      pruned.length ? ` pruned=${pruned.join(",")}` : ""
    }`,
  );
  return log;
};

/** The conference a budget line belongs to, or null when the line is gone. */
export const conferenceIdForBudgetItem = async (itemId: number): Promise<number | null> => {
  if (!Number.isInteger(itemId) || itemId <= 0) return null;
  const row = await getDb()
    .query<{ conference_id: number }, [number]>(
      `SELECT conference_id FROM budget_items WHERE id = ?`,
    )
    .get(itemId);
  return row ? Number(row.conference_id) : null;
};

/** The conference a contract belongs to, or null when the entry is gone. */
export const conferenceIdForContract = async (contractId: number): Promise<number | null> => {
  if (!Number.isInteger(contractId) || contractId <= 0) return null;
  const row = await getDb()
    .query<{ conference_id: number }, [number]>(`SELECT conference_id FROM contracts WHERE id = ?`)
    .get(contractId);
  return row ? Number(row.conference_id) : null;
};


export type Conference = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  expectedAttendance: number;
  /** `null` for a Viewer — the target is money like any other figure. */
  budgetTargetCents: Money;
  createdAt: number;
  /** The current user's role on this conference. */
  role: MemberRole;
  /** Free tier: the *effective* plan — 'unlocked' once paid for, or for an admin's own. */
  plan: ConferencePlan;
  /**
   * True when the reason it is open is that its owner's account is an admin,
   * not a payment. It says nothing about the reader: the role gates (Viewer,
   * stranger) still apply to whoever is looking.
   */
  adminUnlocked: boolean;
  unlockedAt: number | null;
  paidCents: number;
  /** The shared read-only example. Never writable, visible to every account. */
  isSample: boolean;
};

export type ConferenceMember = {
  userId: number;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: number;
};

export type ConferenceInvite = {
  token: string;
  role: InviteRole;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  uses: number;
  createdByName: string;
};


/* --------------------------------------------------- event registration */

/**
 * Event registration, phase A: the workspace side. A church switches
 * registration on, offers ticket types, and records who is coming. No money
 * moves here — a fee is either 'unpaid' or marked 'paid_by_hand' because the
 * church took cash or a check. (Phase B is the attendee-facing page; the
 * `attendees.source` column already carries 'public' for it.)
 *
 * Every amount is integer cents, like the rest of this database, and the amount
 * an attendee owes is snapshotted onto their row when they register, so
 * changing a ticket's price later never rewrites what somebody was told.
 *
 * A Viewer is given the registration list — names, emails, tickets and places —
 * but no amount anywhere: `moneyVisibleOn` decides that, exactly as it does for
 * the budget and the contracts.
 */

type RegistrationSettingsRow = {
  conference_id: number;
  is_open: number;
  capacity: number;
  instructions: string;
  created_at: number;
  updated_at: number;
};

type TicketTypeRow = {
  id: number;
  conference_id: number;
  name: string;
  price_cents: number;
  quantity_limit: number;
  sort_order: number;
  active: number;
};

type AttendeeRow = {
  id: number;
  conference_id: number;
  ticket_type_id: number | null;
  name: string;
  email: string;
  phone: string;
  notes: string;
  quantity: number;
  amount_due_cents: number;
  payment_status: string;
  paid_note: string;
  amount_cents: number;
  currency: string;
  stripe_session_id: string;
  stripe_payment_intent_id: string;
  paid_at: number | null;
  registered_at: number;
  source: string;
};

/** The settings row, or the honest defaults when registration was never set up. */
export const getRegistrationSettings = async (conferenceId: number): Promise<RegistrationSettings> => {
  const row = Number.isInteger(conferenceId) && conferenceId > 0
    ? await getDb()
      .query<RegistrationSettingsRow, [number]>(
        `SELECT * FROM conference_registration WHERE conference_id = ?`,
      )
      .get(conferenceId)
    : null;
  return {
    conferenceId,
    isOpen: Number(row?.is_open ?? 0) === 1,
    capacity: Number(row?.capacity ?? 0),
    instructions: String(row?.instructions ?? ""),
    updatedAt: Number(row?.updated_at ?? 0),
  };
};

export type RegistrationSettingsInput = {
  isOpen: boolean;
  /** 0 = no cap. */
  capacity: number;
  instructions: string;
};

/**
 * Save the switch, the cap and the words for attendees. One statement, so a
 * conference that has never opened registration gets its row on the first save
 * and a conference that has one is updated — never two rows, never a race
 * between an insert and an update.
 */
export const saveRegistrationSettings = async (
  userId: number,
  conferenceId: number,
  input: RegistrationSettingsInput,
): Promise<boolean> => {
  if (!await editConferenceOf(userId, conferenceId)) return false;
  const stamp = Date.now();
  // A brand-new row gets its public link token here; an existing one keeps the
  // token it already has (the update half never touches `public_token`), so the
  // link a church has already shared does not change under it.
  await getDb()
    .query<unknown, [number, number, number, string, string, number, number]>(
      `INSERT INTO conference_registration
         (conference_id, is_open, capacity, instructions, public_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conference_id) DO UPDATE SET
         is_open = excluded.is_open,
         capacity = excluded.capacity,
         instructions = excluded.instructions,
         updated_at = excluded.updated_at`,
    )
    .run(
      conferenceId,
      input.isOpen ? 1 : 0,
      input.capacity,
      input.instructions,
      newPublicToken(),
      stamp,
      stamp,
    );
  return true;
};

/* --------------------------------------------- the attendee-facing link */

/**
 * The token in `/register/<token>`: 24 characters from 18 random bytes, base64url
 * alphabet. Unguessable (144 bits), never the numeric conference id, and not
 * enumerable — the only way to reach a conference's page is to be given its link.
 */
const newPublicToken = (): string => randomBytes(18).toString("base64url");

/** The token shape a link may carry; anything else is not looked up at all. */
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * The conference's public token, generating and storing one the first time it is
 * asked for. Two callers racing each other converge: the update half only writes
 * while the column is still empty, and the token is re-read afterwards, so the
 * one that won the write is the one everybody gets.
 */
export const ensurePublicRegistrationToken = async (conferenceId: number): Promise<string> => {
  const db = getDb();
  const read = async (): Promise<string> =>
    String(
      (await db
        .query<{ public_token: string }, [number]>(
          `SELECT public_token FROM conference_registration WHERE conference_id = ?`,
        )
        .get(conferenceId))?.public_token ?? "",
    );
  const existing = await read();
  if (existing) return existing;
  const stamp = Date.now();
  await db
    .query<unknown, [number, string, number, number]>(
      `INSERT INTO conference_registration
         (conference_id, is_open, capacity, instructions, public_token, created_at, updated_at)
       VALUES (?, 0, 0, '', ?, ?, ?)
       ON CONFLICT(conference_id) DO UPDATE SET
         public_token = excluded.public_token,
         updated_at = excluded.updated_at
       WHERE conference_registration.public_token = ''`,
    )
    .run(conferenceId, newPublicToken(), stamp, stamp);
  return await read();
};

/** Places taken per ticket type, as a lookup. Counts, never money. */
const placesByTicketType = async (conferenceId: number): Promise<Map<number, number>> => {
  const rows = await getDb()
    .query<{ ticket_type_id: number | null; places: number }, [number]>(
      `SELECT ticket_type_id, COALESCE(SUM(quantity), 0) AS places
         FROM attendees WHERE conference_id = ?
        GROUP BY ticket_type_id`,
    )
    .all(conferenceId);
  const map = new Map<number, number>();
  for (const row of rows) {
    if (row.ticket_type_id !== null) map.set(Number(row.ticket_type_id), Number(row.places));
  }
  return map;
};

/**
 * The ticket types on offer, for a reader. `priceCents` is `null` for a Viewer:
 * the price is money, and a Viewer is never shown money. Names, limits and how
 * many places each ticket has taken are not money and always travel.
 */
export const listTicketTypes = async (
  conferenceId: number,
  role: MemberRole | null,
): Promise<TicketType[]> => {
  const visible = await moneyVisibleOn(conferenceId, role);
  const [rows, places] = await Promise.all([
    getDb()
      .query<TicketTypeRow, [number]>(
        `SELECT * FROM ticket_types WHERE conference_id = ? ORDER BY sort_order ASC, id ASC`,
      )
      .all(conferenceId),
    placesByTicketType(conferenceId),
  ]);
  return rows.map((row) => ({
    id: Number(row.id),
    conferenceId: Number(row.conference_id),
    name: String(row.name),
    priceCents: money(visible, row.price_cents),
    quantityLimit: Number(row.quantity_limit),
    sortOrder: Number(row.sort_order),
    active: Number(row.active) === 1,
    registered: places.get(Number(row.id)) ?? 0,
  }));
};

/** How many places one ticket type has taken (sum of quantities). */
export const ticketTypePlaces = async (conferenceId: number, ticketTypeId: number): Promise<number> => {
  const row = await getDb()
    .query<{ places: number }, [number, number]>(
      `SELECT COALESCE(SUM(quantity), 0) AS places FROM attendees
        WHERE conference_id = ? AND ticket_type_id = ?`,
    )
    .get(conferenceId, ticketTypeId);
  return Number(row?.places ?? 0);
};

/** Every place taken on the conference — the number the capacity cap is measured against. */
export const registrationHeadcount = async (conferenceId: number): Promise<number> => {
  const row = await getDb()
    .query<{ places: number }, [number]>(
      `SELECT COALESCE(SUM(quantity), 0) AS places FROM attendees WHERE conference_id = ?`,
    )
    .get(conferenceId);
  return Number(row?.places ?? 0);
};

export type TicketTypeInput = {
  name: string;
  priceCents: number;
  /** 0 = no limit. */
  quantityLimit: number;
  active: boolean;
};

/**
 * What a ticket-type save did. `limit` is not an error in the request: it is the
 * church trying to set a limit below the places already registered, which is
 * refused rather than silently truncating a limit people have already bought
 * against.
 */
export type SaveTicketTypeResult =
  | { ok: true; id: number }
  | { ok: false; code: "forbidden" | "not_found" }
  | { ok: false; code: "limit"; limit: number; registered: number };

/** Create (id 0) or update one ticket type. */
export const saveTicketType = async (
  userId: number,
  conferenceId: number,
  input: TicketTypeInput,
  ticketTypeId = 0,
): Promise<SaveTicketTypeResult> => {
  if (!await editConferenceOf(userId, conferenceId)) return { ok: false, code: "forbidden" };
  const db = getDb();
  const existing = ticketTypeId > 0
    ? await db
      .query<TicketTypeRow, [number, number]>(
        `SELECT * FROM ticket_types WHERE id = ? AND conference_id = ?`,
      )
      .get(ticketTypeId, conferenceId)
    : null;
  if (ticketTypeId > 0 && !existing) return { ok: false, code: "not_found" };
  // A limit may never be lowered under the places already sold.
  if (input.quantityLimit > 0) {
    const registered = await ticketTypePlaces(conferenceId, ticketTypeId);
    if (input.quantityLimit < registered) {
      return { ok: false, code: "limit", limit: input.quantityLimit, registered };
    }
  }
  if (existing) {
    await db
      .query<unknown, [string, number, number, number, number, number]>(
        `UPDATE ticket_types
            SET name = ?, price_cents = ?, quantity_limit = ?, active = ?
          WHERE id = ? AND conference_id = ?`,
      )
      .run(input.name, input.priceCents, input.quantityLimit, input.active ? 1 : 0, ticketTypeId, conferenceId);
    return { ok: true, id: ticketTypeId };
  }
  const next = await db
    .query<{ next: number }, [number]>(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM ticket_types WHERE conference_id = ?`,
    )
    .get(conferenceId);
  const inserted = await db
    .query<unknown, [number, string, number, number, number, number, number]>(
      `INSERT INTO ticket_types
         (conference_id, name, price_cents, quantity_limit, sort_order, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      conferenceId,
      input.name,
      input.priceCents,
      input.quantityLimit,
      Number(next?.next ?? 1),
      input.active ? 1 : 0,
      Date.now(),
    );
  return { ok: true, id: Number(inserted.lastInsertRowid ?? 0) };
};

/**
 * Delete a ticket type. Refused while registrations are attached: deleting it
 * would leave those rows with no ticket (`ON DELETE SET NULL`) and lose what
 * people registered for. The answer says how many are attached and points at
 * the `active` flag, which is how a church retires a ticket properly.
 */
export type DeleteTicketTypeResult =
  | { ok: true }
  | { ok: false; code: "forbidden" | "not_found" }
  | { ok: false; code: "in_use"; attendees: number };

export const deleteTicketType = async (
  userId: number,
  ticketTypeId: number,
): Promise<DeleteTicketTypeResult> => {
  const db = getDb();
  const row = await db
    .query<TicketTypeRow, [number]>(`SELECT * FROM ticket_types WHERE id = ?`)
    .get(ticketTypeId);
  if (!row) return { ok: false, code: "not_found" };
  const conferenceId = Number(row.conference_id);
  if (!await editConferenceOf(userId, conferenceId)) return { ok: false, code: "forbidden" };
  const attached = await db
    .query<{ n: number }, [number]>(
      `SELECT COUNT(*) AS n FROM attendees WHERE ticket_type_id = ?`,
    )
    .get(ticketTypeId);
  const attendees = Number(attached?.n ?? 0);
  if (attendees > 0) return { ok: false, code: "in_use", attendees };
  await db.query<unknown, [number]>(`DELETE FROM ticket_types WHERE id = ?`).run(ticketTypeId);
  return { ok: true };
};

/** The conference a ticket type belongs to, or null. */
export const conferenceIdForTicketType = async (ticketTypeId: number): Promise<number | null> => {
  const row = await getDb()
    .query<{ conference_id: number }, [number]>(`SELECT conference_id FROM ticket_types WHERE id = ?`)
    .get(ticketTypeId);
  return row ? Number(row.conference_id) : null;
};

/** The conference an attendee row belongs to, or null. */
export const conferenceIdForAttendee = async (attendeeId: number): Promise<number | null> => {
  const row = await getDb()
    .query<{ conference_id: number }, [number]>(`SELECT conference_id FROM attendees WHERE id = ?`)
    .get(attendeeId);
  return row ? Number(row.conference_id) : null;
};

/**
 * The attendee list, newest registration last. Names, emails, ticket and
 * quantity always travel; `amountDueCents` is `null` for a Viewer.
 */
export const listAttendees = async (
  conferenceId: number,
  role: MemberRole | null,
): Promise<Attendee[]> => {
  const visible = await moneyVisibleOn(conferenceId, role);
  return (await getDb()
    .query<AttendeeRow & { ticket_name: string | null }, [number]>(
      `SELECT a.*, t.name AS ticket_name
         FROM attendees a
         LEFT JOIN ticket_types t ON t.id = a.ticket_type_id
        WHERE a.conference_id = ?
        ORDER BY a.registered_at ASC, a.id ASC`,
    )
    .all(conferenceId))
    .map((row) => ({
      id: Number(row.id),
      conferenceId: Number(row.conference_id),
      ticketTypeId: row.ticket_type_id === null ? null : Number(row.ticket_type_id),
      ticketTypeName: String(row.ticket_name ?? ""),
      name: String(row.name),
      email: String(row.email),
      phone: String(row.phone ?? ""),
      notes: String(row.notes ?? ""),
      quantity: Number(row.quantity),
      amountDueCents: money(visible, row.amount_due_cents),
      paymentStatus: attendeePaymentStatus(row.payment_status),
      // What a card payment was created for, withheld from a Viewer exactly like
      // every other amount. `0` means no card payment was ever started.
      amountPaidCents: money(visible, row.amount_cents),
      currency: String(row.currency ?? "usd") || "usd",
      paidAt: row.paid_at === null || row.paid_at === undefined ? null : Number(row.paid_at),
      paidNote: String(row.paid_note ?? ""),
      registeredAt: Number(row.registered_at),
      source: row.source === "public" ? "public" as const : "workspace" as const,
    }));
};

export type AttendeeInput = {
  ticketTypeId: number;
  name: string;
  email: string;
  quantity: number;
  /** A walk-up who paid cash or a check at the desk. */
  paidByHand: boolean;
  paidNote: string;
};

/**
 * What adding an attendee did. The two limit answers carry the numbers behind
 * the refusal, so the caller can name *which* limit was hit and by how much —
 * never a silent truncation, and never a vague "not allowed".
 */
export type InsertAttendeeResult =
  | { ok: true; id: number }
  | { ok: false; code: "forbidden" | "bad_ticket" }
  | { ok: false; code: "capacity"; capacity: number; headcount: number; quantity: number }
  | {
    ok: false;
    code: "ticket_limit";
    ticketName: string;
    limit: number;
    registered: number;
    quantity: number;
  };

/** Everything one attendee row is written from, whoever is writing it. */
type AttendeeWrite = {
  ticketTypeId: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
  quantity: number;
  paymentStatus: "unpaid" | "paid_by_hand";
  paidNote: string;
  source: "workspace" | "public";
};

/** What the one insert path did, with the numbers behind a limit refusal. */
type AttendeeWriteResult =
  | { ok: true; id: number; ticketName: string; amountDueCents: number }
  | { ok: false; code: "bad_ticket" }
  | { ok: false; code: "capacity"; capacity: number; headcount: number; quantity: number }
  | {
    ok: false;
    code: "ticket_limit";
    ticketName: string;
    limit: number;
    registered: number;
    quantity: number;
  };

/**
 * The one place a registration row is written, for both the workspace and the
 * public page.
 *
 * It runs inside the caller's write transaction and checks, in that same
 * transaction: the ticket belongs to this conference and is still on offer, the
 * conference cap is not exceeded, and the ticket's own limit is not exceeded.
 * Because the check and the insert commit together, two simultaneous
 * registrations cannot both slip past a cap — the second sees the first.
 *
 * The amount due is the ticket's price at this moment multiplied by the number of
 * places — a snapshot on the row, so a later price change does not rewrite what
 * this person was told they owed.
 */
const insertAttendeeRow = async (
  tx: Db,
  conferenceId: number,
  input: AttendeeWrite,
): Promise<AttendeeWriteResult> => {
  const ticket = await tx
    .query<TicketTypeRow, [number, number]>(
      `SELECT * FROM ticket_types WHERE id = ? AND conference_id = ?`,
    )
    .get(input.ticketTypeId, conferenceId);
  if (!ticket || Number(ticket.active) !== 1) return { ok: false, code: "bad_ticket" };

  const settings = await tx
    .query<RegistrationSettingsRow, [number]>(
      `SELECT * FROM conference_registration WHERE conference_id = ?`,
    )
    .get(conferenceId);
  const capacity = Number(settings?.capacity ?? 0);
  const headcountRow = await tx
    .query<{ places: number }, [number]>(
      `SELECT COALESCE(SUM(quantity), 0) AS places FROM attendees WHERE conference_id = ?`,
    )
    .get(conferenceId);
  const headcount = Number(headcountRow?.places ?? 0);
  if (capacity > 0 && headcount + input.quantity > capacity) {
    return { ok: false, code: "capacity", capacity, headcount, quantity: input.quantity };
  }

  const limit = Number(ticket.quantity_limit);
  const takenRow = await tx
    .query<{ places: number }, [number, number]>(
      `SELECT COALESCE(SUM(quantity), 0) AS places FROM attendees
        WHERE conference_id = ? AND ticket_type_id = ?`,
    )
    .get(conferenceId, input.ticketTypeId);
  const taken = Number(takenRow?.places ?? 0);
  if (limit > 0 && taken + input.quantity > limit) {
    return {
      ok: false,
      code: "ticket_limit",
      ticketName: String(ticket.name),
      limit,
      registered: taken,
      quantity: input.quantity,
    };
  }

  const amountDueCents = Number(ticket.price_cents) * input.quantity;
  const inserted = await tx
    .query<
      unknown,
      [number, number, string, string, string, string, number, number, string, string, number, string]
    >(
      `INSERT INTO attendees
         (conference_id, ticket_type_id, name, email, phone, notes, quantity, amount_due_cents,
          payment_status, paid_note, registered_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      conferenceId,
      input.ticketTypeId,
      input.name,
      input.email,
      input.phone,
      input.notes,
      input.quantity,
      amountDueCents,
      input.paymentStatus,
      input.paidNote,
      Date.now(),
      input.source,
    );
  return { ok: true, id: Number(inserted.lastInsertRowid ?? 0), ticketName: String(ticket.name), amountDueCents };
};

/**
 * Add one registration from the workspace. The gates are the caller's role and
 * the plan; the capacity and ticket limits are checked by `insertAttendeeRow` in
 * the same transaction as the insert.
 */
export const insertAttendee = async (
  userId: number,
  conferenceId: number,
  input: AttendeeInput,
): Promise<InsertAttendeeResult> => {
  if (!await editConferenceOf(userId, conferenceId)) return { ok: false, code: "forbidden" };
  return await getDb().transaction(async (tx): Promise<InsertAttendeeResult> => {
    const result = await insertAttendeeRow(tx, conferenceId, {
      ticketTypeId: input.ticketTypeId,
      name: input.name,
      email: input.email,
      phone: "",
      notes: "",
      quantity: input.quantity,
      paymentStatus: input.paidByHand ? "paid_by_hand" : "unpaid",
      paidNote: input.paidNote,
      source: "workspace",
    });
    if (result.ok) return { ok: true, id: result.id };
    return result;
  });
};

/**
 * Mark a fee paid by hand (cash or check), or undo that. It records how it was
 * paid and nothing else: no card is charged, and nothing leaves Convocate.
 */
export const setAttendeePaid = async (
  userId: number,
  attendeeId: number,
  paid: boolean,
  note: string,
): Promise<boolean> => {
  const db = getDb();
  const row = await db
    .query<{ conference_id: number }, [number]>(`SELECT conference_id FROM attendees WHERE id = ?`)
    .get(attendeeId);
  if (!row || !await editConferenceOf(userId, Number(row.conference_id))) return false;
  await db
    .query<unknown, [string, string, number]>(`UPDATE attendees SET payment_status = ?, paid_note = ? WHERE id = ?`)
    .run(paid ? "paid_by_hand" : "unpaid", paid ? note : "", attendeeId);
  return true;
};

export const deleteAttendee = async (userId: number, attendeeId: number): Promise<boolean> => {
  const db = getDb();
  const row = await db
    .query<{ conference_id: number }, [number]>(`SELECT conference_id FROM attendees WHERE id = ?`)
    .get(attendeeId);
  if (!row || !await editConferenceOf(userId, Number(row.conference_id))) return false;
  await db.query<unknown, [number]>(`DELETE FROM attendees WHERE id = ?`).run(attendeeId);
  return true;
};

/* --------------------------------- the pre- and post-conference checklist */

/**
 * The checklist behind the "what still has to happen" panel on an event.
 *
 * Three rules shape everything here:
 *
 *  - **The default list is written once, per conference, on the first open.**
 *    Not for every conference up front (a database full of checklists nobody
 *    asked for), and never twice: `seedChecklistOnce` takes a one-time marker
 *    in `schema_migrations`, so an organizer who deletes every item does not
 *    get the template back on the next open.
 *  - **Every write is safe to repeat.** Ticking a ticked item keeps the first
 *    moment and the first name; unticking an unticked one is a no-op; adding a
 *    label that is already on that phase returns the item that is already
 *    there instead of a second row (a double-submitted form cannot make two);
 *    moving the first item up does nothing and is not an error.
 *  - **The conference is always the scope.** Every statement is filtered by
 *    `conference_id`, so an id from another organizer's conference matches no
 *    row at all and is answered `not_found`.
 */

type ChecklistItemRow = {
  id: number;
  conference_id: number;
  phase: string;
  label: string;
  position: number;
  done_at: number | null;
  done_by: string | null;
  created_at: number;
};

const phaseOf = (value: unknown): ChecklistPhase => (value === "post" ? "post" : "pre");

const checklistItem = (row: ChecklistItemRow): ChecklistItem => ({
  id: Number(row.id),
  conferenceId: Number(row.conference_id),
  phase: phaseOf(row.phase),
  label: String(row.label),
  position: Number(row.position),
  doneAt: row.done_at === null || row.done_at === undefined ? null : Number(row.done_at),
  doneBy: String(row.done_by ?? ""),
});

/** The conference one checklist item belongs to — the scope every write is checked against. */
export const conferenceIdForChecklistItem = async (itemId: number): Promise<number | null> => {
  const row = await getDb()
    .query<{ conference_id: number }, [number]>(`SELECT conference_id FROM checklist_items WHERE id = ?`)
    .get(itemId);
  return row ? Number(row.conference_id) : null;
};

/** Every item on one conference, in phase order and then position order. */
export const listChecklistItems = async (conferenceId: number): Promise<ChecklistItem[]> => {
  const rows = await getDb()
    .query<ChecklistItemRow, [number]>(
      `SELECT * FROM checklist_items WHERE conference_id = ?
        ORDER BY CASE phase WHEN 'pre' THEN 0 ELSE 1 END ASC, position ASC, id ASC`,
    )
    .all(conferenceId);
  return rows.map(checklistItem);
};

/**
 * Write the default list onto one conference, once.
 *
 * The marker and the insert happen in one transaction, so two people opening
 * the panel at the same moment cannot both seed it: whichever commits first
 * writes the marker, and the other sees it and writes nothing. A conference
 * that already holds items is never topped up either — the marker covers that
 * too, but the count is checked as well so an event that predates the marker
 * still cannot be doubled.
 */
export const seedChecklistOnce = async (conferenceId: number): Promise<void> => {
  const marker = `${CHECKLIST_SEED_MARKER}:${String(conferenceId)}`;
  const db = getDb();
  await db.transaction(async (tx) => {
    const seeded = await tx
      .query<{ name: string }, [string]>(`SELECT name FROM schema_migrations WHERE name = ?`)
      .get(marker);
    if (seeded) return;
    const held = await tx
      .query<{ n: number }, [number]>(`SELECT COUNT(*) AS n FROM checklist_items WHERE conference_id = ?`)
      .get(conferenceId);
    if (Number(held?.n ?? 0) === 0) {
      const now = Date.now();
      for (const phase of CHECKLIST_PHASES) {
        const labels = CHECKLIST_TEMPLATE[phase];
        for (let index = 0; index < labels.length; index += 1) {
          await tx
            .query<unknown, [number, string, string, number, number]>(
              `INSERT INTO checklist_items (conference_id, phase, label, position, created_at)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(conferenceId, phase, labels[index], index + 1, now);
        }
      }
    }
    await tx
      .query<unknown, [string, number]>(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`)
      .run(marker, Date.now());
  });
};

/**
 * What a checklist write did. `duplicate` is not a refusal to fix by retrying:
 * it is the item that is already on the list, handed back so the panel can show
 * it instead of adding a second one. `limit` is the per-conference guard.
 */
export type ChecklistWriteResult =
  | { ok: true; id: number; duplicate: boolean }
  | { ok: false; code: "forbidden" | "not_found" | "duplicate" | "limit" };

/** The item with this label in this phase, if there is one (case and spacing ignored). */
const checklistItemByLabel = async (
  conferenceId: number,
  phase: ChecklistPhase,
  label: string,
  exceptId = 0,
): Promise<number | null> => {
  const row = await getDb()
    .query<{ id: number }, [number, string, string, number]>(
      `SELECT id FROM checklist_items
        WHERE conference_id = ? AND phase = ? AND lower(trim(label)) = lower(trim(?)) AND id <> ?
        ORDER BY id ASC LIMIT 1`,
    )
    .get(conferenceId, phase, label, exceptId);
  return row ? Number(row.id) : null;
};

/**
 * Tick or untick one item.
 *
 * Ticking is idempotent: `COALESCE` keeps the first moment and the first name,
 * so a double submit (or a page that re-sends after a dropped response) cannot
 * move the tick to a later time or claim it was someone else. Unticking clears
 * both fields; unticking something already open changes nothing.
 */
export const setChecklistItemDone = async (
  userId: number,
  conferenceId: number,
  itemId: number,
  done: boolean,
  doneBy: string,
): Promise<ChecklistWriteResult> => {
  const db = getDb();
  const row = await db
    .query<{ id: number }, [number, number]>(
      `SELECT id FROM checklist_items WHERE id = ? AND conference_id = ?`,
    )
    .get(itemId, conferenceId);
  if (!row) return { ok: false, code: "not_found" };
  if (!await editConferenceOf(userId, conferenceId)) return { ok: false, code: "forbidden" };
  if (done) {
    await db
      .query<unknown, [number, string, number, number]>(
        `UPDATE checklist_items
            SET done_at = COALESCE(done_at, ?), done_by = COALESCE(done_by, ?)
          WHERE id = ? AND conference_id = ?`,
      )
      .run(Date.now(), doneBy, itemId, conferenceId);
  } else {
    await db
      .query<unknown, [number, number]>(
        `UPDATE checklist_items SET done_at = NULL, done_by = NULL WHERE id = ? AND conference_id = ?`,
      )
      .run(itemId, conferenceId);
  }
  return { ok: true, id: itemId, duplicate: false };
};

/**
 * Add one item of the organizer's own to the end of a phase.
 *
 * A label already on that phase is not added twice: the existing item is
 * returned with `duplicate: true`. That is what makes a double-submitted form
 * safe — the second submit finds the first row and adds nothing.
 */
export const addChecklistItem = async (
  userId: number,
  conferenceId: number,
  phase: ChecklistPhase,
  label: string,
): Promise<ChecklistWriteResult> => {
  const db = getDb();
  if (!await editConferenceOf(userId, conferenceId)) return { ok: false, code: "forbidden" };
  const existing = await checklistItemByLabel(conferenceId, phase, label);
  if (existing !== null) return { ok: true, id: existing, duplicate: true };
  const count = await db
    .query<{ n: number }, [number]>(`SELECT COUNT(*) AS n FROM checklist_items WHERE conference_id = ?`)
    .get(conferenceId);
  if (Number(count?.n ?? 0) >= CHECKLIST_ITEMS_MAX) return { ok: false, code: "limit" };
  const next = await db
    .query<{ next: number }, [number, string]>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM checklist_items WHERE conference_id = ? AND phase = ?`,
    )
    .get(conferenceId, phase);
  const inserted = await db
    .query<unknown, [number, string, string, number, number]>(
      `INSERT INTO checklist_items (conference_id, phase, label, position, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(conferenceId, phase, label, Number(next?.next ?? 1), Date.now());
  return { ok: true, id: Number(inserted.lastInsertRowid ?? 0), duplicate: false };
};

/** Rename one item. Renaming onto a label already on that phase is refused, not merged. */
export const renameChecklistItem = async (
  userId: number,
  conferenceId: number,
  itemId: number,
  label: string,
): Promise<ChecklistWriteResult> => {
  const db = getDb();
  const row = await db
    .query<{ phase: string }, [number, number]>(
      `SELECT phase FROM checklist_items WHERE id = ? AND conference_id = ?`,
    )
    .get(itemId, conferenceId);
  if (!row) return { ok: false, code: "not_found" };
  if (!await editConferenceOf(userId, conferenceId)) return { ok: false, code: "forbidden" };
  const phase = phaseOf(row.phase);
  if (await checklistItemByLabel(conferenceId, phase, label, itemId) !== null) {
    return { ok: false, code: "duplicate" };
  }
  await db
    .query<unknown, [string, number, number]>(
      `UPDATE checklist_items SET label = ? WHERE id = ? AND conference_id = ?`,
    )
    .run(label, itemId, conferenceId);
  return { ok: true, id: itemId, duplicate: false };
};

/** The positions in a phase, renumbered 1..n after a removal so no gap is left. */
const renumberChecklistPhase = async (db: Db, conferenceId: number, phase: ChecklistPhase): Promise<void> => {
  const rows = await db
    .query<{ id: number }, [number, string]>(
      `SELECT id FROM checklist_items WHERE conference_id = ? AND phase = ? ORDER BY position ASC, id ASC`,
    )
    .all(conferenceId, phase);
  for (let index = 0; index < rows.length; index += 1) {
    await db
      .query<unknown, [number, number, number]>(
        `UPDATE checklist_items SET position = ? WHERE id = ? AND conference_id = ?`,
      )
      .run(index + 1, rows[index].id, conferenceId);
  }
};

/** Remove one item. Its phase is renumbered, so move up/down stays one step. */
export const deleteChecklistItem = async (
  userId: number,
  conferenceId: number,
  itemId: number,
): Promise<ChecklistWriteResult> => {
  const db = getDb();
  const row = await db
    .query<{ phase: string }, [number, number]>(
      `SELECT phase FROM checklist_items WHERE id = ? AND conference_id = ?`,
    )
    .get(itemId, conferenceId);
  if (!row) return { ok: false, code: "not_found" };
  if (!await editConferenceOf(userId, conferenceId)) return { ok: false, code: "forbidden" };
  const phase = phaseOf(row.phase);
  await db
    .query<unknown, [number, number]>(`DELETE FROM checklist_items WHERE id = ? AND conference_id = ?`)
    .run(itemId, conferenceId);
  await renumberChecklistPhase(db, conferenceId, phase);
  return { ok: true, id: itemId, duplicate: false };
};

/**
 * Move one item one place up or down inside its own phase.
 *
 * Moving past the end of a phase is not an error: there is nothing to swap with
 * and nothing is written, which is what makes a repeated click harmless.
 */
export const moveChecklistItem = async (
  userId: number,
  conferenceId: number,
  itemId: number,
  direction: "up" | "down",
): Promise<ChecklistWriteResult> => {
  const db = getDb();
  const row = await db
    .query<{ phase: string; position: number }, [number, number]>(
      `SELECT phase, position FROM checklist_items WHERE id = ? AND conference_id = ?`,
    )
    .get(itemId, conferenceId);
  if (!row) return { ok: false, code: "not_found" };
  if (!await editConferenceOf(userId, conferenceId)) return { ok: false, code: "forbidden" };
  const phase = phaseOf(row.phase);
  const position = Number(row.position);
  const neighbour = direction === "up"
    ? await db
      .query<{ id: number; position: number }, [number, string, number]>(
        `SELECT id, position FROM checklist_items
          WHERE conference_id = ? AND phase = ? AND position < ?
          ORDER BY position DESC LIMIT 1`,
      )
      .get(conferenceId, phase, position)
    : await db
      .query<{ id: number; position: number }, [number, string, number]>(
        `SELECT id, position FROM checklist_items
          WHERE conference_id = ? AND phase = ? AND position > ?
          ORDER BY position ASC LIMIT 1`,
      )
      .get(conferenceId, phase, position);
  if (!neighbour) return { ok: true, id: itemId, duplicate: false };
  await db.transaction(async (tx) => {
    await tx
      .query<unknown, [number, number, number]>(
        `UPDATE checklist_items SET position = ? WHERE id = ? AND conference_id = ?`,
      )
      .run(Number(neighbour.position), itemId, conferenceId);
    await tx
      .query<unknown, [number, number, number]>(
        `UPDATE checklist_items SET position = ? WHERE id = ? AND conference_id = ?`,
      )
      .run(position, Number(neighbour.id), conferenceId);
  });
  return { ok: true, id: itemId, duplicate: false };
};

/* --------------------------------------- the attendee-facing page (phase B) */

/**
 * Event registration, phase B: the public page.
 *
 * A church shares one link — `/register/<token>` — and anyone holding it can
 * register without an account. Two things follow from that, and both are
 * enforced here rather than by the page:
 *
 *  - **What the page may know.** Only the conference's public fields (name,
 *    dates, venue), the church's own words for attendees, and the tickets on
 *    offer with the places left on each. The attendee list, other people's names
 *    and emails, the totals, the revenue, the contracts and the budget are never
 *    part of this payload — not withheld, absent.
 *
 *  - **What a registration may do.** Record who is coming, unpaid, with the
 *    amount due snapshotted exactly the way the workspace does it. No card is
 *    charged and no money moves.
 *
 * A conference the $199 unlock has not opened gets the same quiet answer as a
 * link that matches nothing useful: "registration is not open for this
 * conference", with no conference detail and no mention of price or plans — an
 * attendee is not the person who decides to pay for Convocate.
 */

/** One ticket as an attendee sees it: what it costs and how many places are left. */
export type PublicTicketOption = {
  id: number;
  name: string;
  /** Price per place, in cents. Attendees are told the price; it is not revenue. */
  priceCents: number;
  /** Places still available on this ticket, or `null` when it has no limit. */
  placesLeft: number | null;
};

/** Everything the attendee-facing page is allowed to render. */
export type PublicRegistrationPage = {
  conferenceName: string;
  startDate: string;
  endDate: string;
  venue: string;
  /** The church's own words for attendees; empty when they wrote none. */
  instructions: string;
  /** Places left across the whole conference, or `null` when there is no cap. */
  placesLeft: number | null;
  /** Active tickets only, in the organizer's own order. */
  ticketTypes: PublicTicketOption[];
  /**
   * Whether this page will take a card. True only when the organizer's Stripe
   * account is ready to take a charge and be paid out. False is not an error: the
   * page stays open and records the attendee as unpaid.
   */
  cardPayment: boolean;
};

/**
 * What the public page may show. The `code` is all a refusal carries: a page
 * that says "not open" must not also say which conference it is not.
 */
export type PublicRegistrationResult =
  | { ok: true; page: PublicRegistrationPage }
  | { ok: false; code: "not_found" | "not_open" | "closed" | "sold_out" };

type PublicConferenceRow = {
  conference_id: number;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  plan: string | null;
  /** The conference owner's `users.is_admin` — an admin's event is never locked. */
  owner_is_admin: number | null;
  is_sample: number | null;
  is_open: number;
  capacity: number;
  instructions: string;
  /**
   * The organizer's own Stripe account, as the payouts card last stored it. Both
   * flags must be set before a card can be taken (see `cardPaymentsReady`); the
   * account id itself is never selected here, because this row ends up on a page
   * a stranger reads.
   */
  owner_charges_enabled: number | null;
  owner_payouts_enabled: number | null;
};

/** The conference a public token belongs to, with the registration settings. */
const publicConferenceFor = async (db: Db, token: string): Promise<PublicConferenceRow | null> =>
  await db
    .query<PublicConferenceRow, [string]>(
      `SELECT c.id AS conference_id, c.name, c.start_date, c.end_date, c.venue,
              c.plan, ${adminOwnerFlagSql("u")} AS owner_is_admin, c.is_sample,
              r.is_open, r.capacity, r.instructions,
              COALESCE(pa.charges_enabled, 0) AS owner_charges_enabled,
              COALESCE(pa.payouts_enabled, 0) AS owner_payouts_enabled
         FROM conference_registration r
         JOIN conferences c ON c.id = r.conference_id
         LEFT JOIN users u ON u.id = c.user_id
         LEFT JOIN payout_accounts pa ON pa.user_id = c.user_id
        WHERE r.public_token = ?`,
    )
    .get(token);

/**
 * May the public page offer this conference at all? Unlocked by the church, and
 * never the read-only example (which is a demonstration, not a conference taking
 * registrations).
 */
const conferenceIsPubliclyOpen = (row: PublicConferenceRow): boolean =>
  decideEntitlement(row.plan, row.owner_is_admin).unlocked && Number(row.is_sample ?? 0) !== 1;

/**
 * May this conference take a card on its registration page?
 *
 * Only when the organizer's own Stripe account is READY — Stripe says it can
 * take charges AND pay the organizer out. Anything less (no account, onboarding
 * half finished, a Stripe restriction) means no card, and the page records the
 * attendee as unpaid instead. That is the owner's decision of 2026-10-22: an
 * event page must never go dark because a Stripe form is unfinished.
 *
 * The flags are the ones the payouts card last stored, not a live call to
 * Stripe: this runs on every page load of a public page, and a Stripe round trip
 * there would be a latency and an outage risk on someone else's registration
 * form. `connectPayoutsStatusFn` refreshes them from Stripe whenever the
 * organizer looks at their payouts card.
 */
const cardPaymentsReady = (row: PublicConferenceRow): boolean =>
  Number(row.owner_charges_enabled ?? 0) === 1 && Number(row.owner_payouts_enabled ?? 0) === 1;

/**
 * Everything the attendee-facing page shows, from one token. Never throws for a
 * link that is wrong, locked or closed: the caller renders a polite page.
 */
export const getPublicRegistrationPage = async (token: string): Promise<PublicRegistrationResult> => {
  if (!PUBLIC_TOKEN_PATTERN.test(token)) return { ok: false, code: "not_found" };
  const db = getDb();
  const row = await publicConferenceFor(db, token);
  if (!row) return { ok: false, code: "not_found" };
  if (!conferenceIsPubliclyOpen(row)) return { ok: false, code: "not_open" };
  const conferenceId = Number(row.conference_id);
  if (Number(row.is_open) !== 1) return { ok: false, code: "closed" };

  const capacity = Number(row.capacity ?? 0);
  const [headcount, tickets, taken] = await Promise.all([
    registrationHeadcount(conferenceId),
    db
      .query<TicketTypeRow, [number]>(
        `SELECT * FROM ticket_types
          WHERE conference_id = ? AND active = 1
          ORDER BY sort_order ASC, id ASC`,
      )
      .all(conferenceId),
    placesByTicketType(conferenceId),
  ]);
  // Nothing on offer is not a full hall — it is a registration page with nothing
  // to register on, so it is answered the same way a closed one is.
  if (tickets.length === 0) return { ok: false, code: "closed" };

  const placesLeft = capacity > 0 ? Math.max(0, capacity - headcount) : null;
  const ticketTypes: PublicTicketOption[] = tickets.map((ticket) => {
    const limit = Number(ticket.quantity_limit);
    const used = taken.get(Number(ticket.id)) ?? 0;
    const own = limit > 0 ? Math.max(0, limit - used) : null;
    const left = own === null ? placesLeft : placesLeft === null ? own : Math.min(own, placesLeft);
    return {
      id: Number(ticket.id),
      name: String(ticket.name),
      priceCents: Number(ticket.price_cents),
      placesLeft: left,
    };
  });
  const soldOut = ticketTypes.every((ticket) => ticket.placesLeft !== null && ticket.placesLeft <= 0);
  if (soldOut) return { ok: false, code: "sold_out" };

  return {
    ok: true,
    page: {
      conferenceName: String(row.name),
      startDate: String(row.start_date ?? ""),
      endDate: String(row.end_date ?? ""),
      venue: String(row.venue ?? ""),
      instructions: String(row.instructions ?? ""),
      placesLeft,
      ticketTypes,
      cardPayment: cardPaymentsReady(row),
    },
  };
};

/** What an attendee typed on the public form, after the server has checked it. */
export type PublicAttendeeInput = {
  ticketTypeId: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
  quantity: number;
};

/**
 * What a public registration did. A refusal is either about the page (not
 * open / closed / sold out) or about one field, and it always carries the word
 * for the person reading it — never a bare "not allowed".
 */
export type PublicSubmitResult =
  | {
    ok: true;
    /**
     * The row just written. The page needs the id to come back and ask whether a
     * card payment went through, and `cardPayment` to know whether to offer one
     * at all. Neither is a secret: the id is only ever honoured together with the
     * link's own token, and checked against that token's conference.
     */
    attendeeId: number;
    cardPayment: boolean;
    registration: {
      name: string;
      email: string;
      ticketName: string;
      quantity: number;
      amountDueCents: number;
    };
    /**
     * The event facts the confirmation email is built from. They are already
     * public (the same fields the registration page shows), and they are returned
     * here rather than read again in a second query, so the email can only ever
     * describe the conference this row was actually written against — even if the
     * organizer renames it a second later.
     */
    event: {
      id: number;
      name: string;
      startDate: string;
      endDate: string;
      venue: string;
    };
  }
  | { ok: false; code: "not_found" | "not_open" | "closed" | "sold_out" | "bad_ticket" }
  | { ok: false; code: "capacity"; placesLeft: number }
  | { ok: false; code: "ticket_limit"; ticketName: string; placesLeft: number };

/**
 * Record one registration from the public page.
 *
 * The whole decision — is the link real, is the conference unlocked, is
 * registration open, is the ticket this conference's, is there room on the
 * conference and on the ticket — is made inside the same write transaction as
 * the insert. Two people submitting at the same instant cannot both take the last
 * place: the second transaction sees the first one's row and is refused.
 *
 * The row is written `unpaid` with `source = 'public'`. No card is charged here.
 */
export const insertPublicAttendee = async (
  token: string,
  input: PublicAttendeeInput,
): Promise<PublicSubmitResult> => {
  if (!PUBLIC_TOKEN_PATTERN.test(token)) return { ok: false, code: "not_found" };
  return await getDb().transaction(async (tx): Promise<PublicSubmitResult> => {
    const row = await publicConferenceFor(tx, token);
    if (!row) return { ok: false, code: "not_found" };
    if (!conferenceIsPubliclyOpen(row)) return { ok: false, code: "not_open" };
    if (Number(row.is_open) !== 1) return { ok: false, code: "closed" };
    const conferenceId = Number(row.conference_id);

    const result = await insertAttendeeRow(tx, conferenceId, {
      ticketTypeId: input.ticketTypeId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      notes: input.notes,
      quantity: input.quantity,
      // A public registration is always unpaid: the church arranges payment with
      // the attendee itself, and Convocate never holds a church's money.
      paymentStatus: "unpaid",
      paidNote: "",
      source: "public",
    });
    if (result.ok) {
      return {
        ok: true,
        attendeeId: result.id,
        cardPayment: cardPaymentsReady(row) && result.amountDueCents > 0,
        registration: {
          name: input.name,
          email: input.email,
          ticketName: result.ticketName,
          quantity: input.quantity,
          amountDueCents: result.amountDueCents,
        },
        event: {
          id: conferenceId,
          name: String(row.name ?? ""),
          startDate: String(row.start_date ?? ""),
          endDate: String(row.end_date ?? ""),
          venue: String(row.venue ?? ""),
        },
      };
    }
    if (result.code === "bad_ticket") return { ok: false, code: "bad_ticket" };
    if (result.code === "capacity") {
      return { ok: false, code: "capacity", placesLeft: Math.max(0, result.capacity - result.headcount) };
    }
    return {
      ok: false,
      code: "ticket_limit",
      ticketName: result.ticketName,
      placesLeft: Math.max(0, result.limit - result.registered),
    };
  });
};

/* --------------------------------- the card payment on one registration */

/**
 * One registration's payment state, as the server may see it when a browser comes
 * back from Stripe.
 *
 * **The attendee id is not a handle on its own.** This is only answered for an id
 * that belongs to the conference the link's own token opens: a guessed id from
 * another organizer's event matches no row at all, so the token and the id have
 * to arrive together and agree. That is the whole authorization model for the
 * return path, and it is why nothing here is keyed on the id alone.
 *
 * `ownerUserId` is the organizer account whose Stripe account the charge was
 * created on — read from `conferences.user_id`, never from the request.
 */
export type AttendeePaymentTarget = {
  attendeeId: number;
  conferenceId: number;
  ownerUserId: number;
  paymentStatus: AttendeePaymentStatus;
  /** What the card payment was created for, in cents. 0 before one was started. */
  amountCents: number;
  currency: string;
  /** The Checkout Session stored on the row, or "" when none was created. */
  sessionId: string;
  name: string;
  email: string;
  ticketName: string;
  quantity: number;
};

type AttendeePaymentRow = {
  id: number;
  conference_id: number;
  owner_user_id: number;
  name: string;
  email: string;
  quantity: number;
  payment_status: string;
  amount_cents: number;
  currency: string;
  stripe_session_id: string;
  ticket_name: string | null;
};

export const getAttendeePaymentTarget = async (
  token: string,
  attendeeId: number,
): Promise<AttendeePaymentTarget | null> => {
  if (!PUBLIC_TOKEN_PATTERN.test(token)) return null;
  if (!Number.isInteger(attendeeId) || attendeeId <= 0) return null;
  const row = await getDb()
    .query<AttendeePaymentRow, [string, number]>(
      `SELECT a.id, a.conference_id, c.user_id AS owner_user_id, a.name, a.email,
              a.quantity, a.payment_status, a.amount_cents, a.currency,
              a.stripe_session_id, t.name AS ticket_name
         FROM attendees a
         JOIN conference_registration r ON r.conference_id = a.conference_id
         JOIN conferences c ON c.id = a.conference_id
         LEFT JOIN ticket_types t ON t.id = a.ticket_type_id
        WHERE r.public_token = ? AND a.id = ?`,
    )
    .get(token, attendeeId);
  if (!row) return null;
  return {
    attendeeId: Number(row.id),
    conferenceId: Number(row.conference_id),
    ownerUserId: Number(row.owner_user_id),
    paymentStatus: attendeePaymentStatus(row.payment_status),
    amountCents: Number(row.amount_cents ?? 0),
    currency: String(row.currency ?? "usd") || "usd",
    sessionId: String(row.stripe_session_id ?? ""),
    name: String(row.name),
    email: String(row.email),
    ticketName: String(row.ticket_name ?? ""),
    quantity: Number(row.quantity),
  };
};

/**
 * Record that a card payment was started for this registration.
 *
 * Called only after Stripe has actually returned a Checkout Session, and only for
 * a row that has not already been paid: a second attempt on a paid row must never
 * turn it back into `pending`. The registration itself is untouched — the person
 * stays on the list whether or not they finish at the card page.
 */
export const startAttendeeCardPayment = async (
  attendeeId: number,
  input: { sessionId: string; amountCents: number; currency: string },
): Promise<boolean> => {
  const result = await getDb()
    .query<unknown, [string, number, string, number]>(
      `UPDATE attendees
          SET payment_status = 'pending',
              stripe_session_id = ?,
              amount_cents = ?,
              currency = ?
        WHERE id = ?
          AND payment_status IN ('unpaid', 'pending')`,
    )
    .run(input.sessionId, input.amountCents, input.currency, attendeeId);
  return Number(result.changes) > 0;
};

/**
 * Mark a registration paid, on Stripe's word and nothing else.
 *
 * The `AND stripe_session_id = ?` is the guard that makes this safe to call from a
 * URL: a session id that was never stored on this row (a forged one, or another
 * attendee's) matches nothing and changes nothing. A refunded row is left alone.
 * Returns whether a row actually changed.
 */
export const confirmAttendeeCardPaid = async (
  attendeeId: number,
  input: { sessionId: string; paymentIntentId: string; amountCents: number; currency: string },
): Promise<boolean> => {
  const result = await getDb()
    .query<unknown, [string, number, string, number, number, string]>(
      `UPDATE attendees
          SET payment_status = 'paid',
              stripe_payment_intent_id = ?,
              amount_cents = ?,
              currency = ?,
              paid_at = ?
        WHERE id = ?
          AND stripe_session_id = ?
          AND payment_status <> 'refunded'`,
    )
    .run(
      input.paymentIntentId,
      input.amountCents,
      input.currency,
      Date.now(),
      attendeeId,
      input.sessionId,
    );
  return Number(result.changes) > 0;
};

/* ------------------------------------------------------------------- email */

/** The kinds of message the product sends. A column, not a code path. */
export type EmailKind = "registration_confirmation" | "password_reset";

export type EmailLogEntry = {
  kind: EmailKind;
  recipientEmail: string;
  /** The conference the message was about, or `null` when it was about nothing in particular. */
  eventId: number | null;
  /** The provider's message id, when the send was accepted. */
  resendId: string | null;
  status: "sent" | "failed" | "skipped";
  /** Why it failed, or why it was skipped. Already scrubbed of secrets. */
  error: string | null;
};

/**
 * Write down one attempt to send an email.
 *
 * This is the only record that a message was (or was not) sent — the server log
 * is not one, because it deliberately carries no full address. Support reads this
 * table to answer "did they get it?".
 *
 * It never throws and returns whether the row was written. A registration has
 * already been committed by the time this runs; a database that will not take a
 * log row must not turn a successful registration into a failed one, so the
 * failure is logged and swallowed.
 */
export const recordEmailLog = async (entry: EmailLogEntry): Promise<boolean> => {
  try {
    await getDb()
      .query<
        unknown,
        [string, string, number | null, string | null, string, string | null, number]
      >(
        `INSERT INTO email_log (kind, recipient_email, event_id, resend_id, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.kind,
        entry.recipientEmail,
        entry.eventId,
        entry.resendId,
        entry.status,
        entry.error === null ? null : entry.error.slice(0, 500),
        Date.now(),
      );
    return true;
  } catch (cause) {
    console.error(
      `[convocate] ERROR: could not write the email_log row for ${entry.kind} (status ${entry.status}) — ` +
        `${cause instanceof Error ? cause.message : String(cause)}. The registration is unaffected.`,
    );
    return false;
  }
};

/* ------------------------------------------------------------------ users */

type UserRow = { id: number; email: string; name: string; password_hash: string };

export const createUser = async (email: string, name: string, passwordHash: string): Promise<User> => {
  const db = getDb();
  const row = await db
    .query<{ id: number }, [string, string, string, number]>(
      `INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get(email.toLowerCase().trim(), name.trim(), passwordHash, Date.now());
  return { id: Number(row?.id), email: email.toLowerCase().trim(), name: name.trim() };
};

export const findUserByEmail = async (
  email: string,
): Promise<(User & { passwordHash: string }) | null> => {
  const row = await getDb()
    .query<UserRow, [string]>(`SELECT * FROM users WHERE email = ?`)
    .get(email.toLowerCase().trim());
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, passwordHash: row.password_hash };
};

export const findUserById = async (id: number): Promise<User | null> => {
  const row = await getDb()
    .query<UserRow, [number]>(`SELECT * FROM users WHERE id = ?`)
    .get(id);
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name };
};

/**
 * **The owner's own account, and nobody else's.**
 *
 * Admin is granted only when an account holds BOTH `users.is_admin = 1` AND one of
 * these addresses — the owner's decision on 2026-10-22: "this is only for my
 * account, administration@trcatbethesda.org". The flag alone is NOT enough, so a
 * mistaken UPDATE that flags another row can never hand anyone every feature; it
 * would also have to name the owner's address. Compared trimmed and
 * case-insensitively, because an address is not a password.
 */
export const ADMIN_ACCOUNT_EMAILS = ["administration@trcatbethesda.org"];

/** The addresses above as a SQL `IN (...)` list. Literals are fixed in code. */
const ADMIN_EMAIL_SQL_LIST = ADMIN_ACCOUNT_EMAILS.map(
  (email) => `'${email.replace(/'/g, "''")}'`,
).join(", ");

/**
 * The two-condition admin rule as SQL, for the queries that must answer it
 * without a second round trip (the conference reads and the public registration
 * page). Always yields exactly 1 or 0, so every existing caller of
 * `decideEntitlement` keeps its meaning: `owner_is_admin = 1` now means "the
 * owner's account", not "some row somewhere has a flag".
 */
const adminOwnerFlagSql = (userAlias: string): string =>
  `(CASE WHEN ${userAlias}.is_admin = 1 AND LOWER(TRIM(${userAlias}.email)) IN (${ADMIN_EMAIL_SQL_LIST}) THEN 1 ELSE 0 END)`;

/**
 * The same two-condition rule in TypeScript, for rows already in hand, so the
 * badge, the panel gate and the entitlement cannot disagree. Defaults to `false`:
 * a missing row, a NULL, or anything that is not exactly 1 is not an admin, so a
 * strange value can only ever lose access, never grant it.
 */
export const isAdminAccount = (
  isAdmin: number | null | undefined,
  email: string | null | undefined,
): boolean =>
  Number(isAdmin ?? 0) === 1 &&
  ADMIN_ACCOUNT_EMAILS.includes(String(email ?? "").trim().toLowerCase());

/**
 * Whether an account is an admin — the single fact the owner's admin view is
 * gated on, and the only place the rule is decided in TypeScript.
 *
 * Reads the flag and the address from the database on every call and asks
 * `isAdminAccount`; see `ADMIN_ACCOUNT_EMAILS` for why a flag alone is not
 * enough. The `is_admin` column arrives on an existing database through
 * `ensureUserAdminColumn`.
 */
export const isAdminUser = async (userId: number): Promise<boolean> => {
  const row = await getDb()
    .query<{ is_admin: number | null; email: string | null }, [number]>(
      `SELECT is_admin, email FROM users WHERE id = ?`,
    )
    .get(userId);
  return isAdminAccount(row?.is_admin, row?.email);
};

/* ------------------------------------------------------------------ admin */

/**
 * Everything the owner's read-only admin view shows, and nothing else.
 *
 * What is here: headline counts, one row per account, one row per conference with
 * three counts against it, and the twenty most recent sign-ups.
 *
 * What is deliberately NOT here, because the view is for "who signed up and what
 * exists" and not for reading over anyone's shoulder:
 *   - no password hash (never selected at all, in this whole file),
 *   - no budget amounts, contract fees, document names or attendee names: only
 *     `COUNT(*)` per conference,
 *   - no session tokens,
 *   - no other church's conference content of any kind.
 *
 * Read-only by construction: every query below is a SELECT and the API exposes no
 * write that takes these types.
 */
export type AdminAccount = {
  id: number;
  name: string;
  email: string;
  createdAt: number;
  /** How many conferences this account owns (shared-in ones are not counted). */
  conferenceCount: number;
  /** Is this account an admin (see `isAdminUser`). */
  isAdmin: boolean;
};

export type AdminConference = {
  id: number;
  name: string;
  ownerEmail: string;
  ownerName: string;
  plan: "free" | "unlocked";
  /** The shared, read-only example conference — nobody's own work. */
  isSample: boolean;
  createdAt: number;
  budgetLineCount: number;
  contractCount: number;
  attendeeCount: number;
};

export type AdminSignup = {
  id: number;
  name: string;
  email: string;
  createdAt: number;
};

export type AdminOverview = {
  counts: {
    accounts: number;
    conferences: number;
    /** Conferences whose plan is 'unlocked' (paid for), including the example. */
    unlocked: number;
    /** Conferences still on the free plan. */
    freePlan: number;
    /** How many of the conferences above are the shared example conference. */
    sample: number;
    /** Registration rows across every conference (one row per registration). */
    attendeeRegistrations: number;
    /** People across those rows (a group registration counts its quantity). */
    attendeePlaces: number;
    /** Unlock payments recorded but not yet confirmed — the money still owed us. */
    pendingPayments: number;
    /** Unlock payments confirmed by hand. */
    confirmedPayments: number;
  };
  accounts: AdminAccount[];
  conferences: AdminConference[];
  /** The twenty most recent sign-ups, newest first. */
  recentSignups: AdminSignup[];
  /** When this snapshot was read (ms since the epoch). */
  generatedAt: number;
};

export const adminOverview = async (): Promise<AdminOverview> => {
  const db = getDb();

  const accountRows = await db
    .query<
      { id: number; name: string; email: string; created_at: number; is_admin: number | null; conference_count: number },
      []
    >(
      `SELECT u.id, u.name, u.email, u.created_at, u.is_admin,
              (SELECT COUNT(*) FROM conferences c WHERE c.user_id = u.id) AS conference_count
         FROM users u
        ORDER BY u.created_at ASC, u.id ASC`,
    )
    .all();

  const conferenceRows = await db
    .query<
      {
        id: number;
        name: string;
        created_at: number;
        plan: string | null;
        is_sample: number | null;
        owner_email: string;
        owner_name: string;
        budget_line_count: number;
        contract_count: number;
        attendee_count: number;
      },
      []
    >(
      `SELECT c.id, c.name, c.created_at, c.plan, c.is_sample,
              u.email AS owner_email, u.name AS owner_name,
              (SELECT COUNT(*) FROM budget_items b WHERE b.conference_id = c.id) AS budget_line_count,
              (SELECT COUNT(*) FROM contracts k WHERE k.conference_id = c.id) AS contract_count,
              (SELECT COUNT(*) FROM attendees a WHERE a.conference_id = c.id) AS attendee_count
         FROM conferences c
         JOIN users u ON u.id = c.user_id
        ORDER BY c.created_at DESC, c.id DESC`,
    )
    .all();

  const attendeeTotals = await db
    .query<{ registration_count: number; place_count: number | null }, []>(
      `SELECT COUNT(*) AS registration_count, COALESCE(SUM(quantity), 0) AS place_count FROM attendees`,
    )
    .get();

  const paymentTotals = await db
    .query<{ pending_count: number; confirmed_count: number }, []>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
         COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed_count
       FROM conference_payments`,
    )
    .get();

  const conferences: AdminConference[] = conferenceRows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    ownerEmail: row.owner_email,
    ownerName: row.owner_name,
    plan: String(row.plan ?? "free") === "unlocked" ? "unlocked" : "free",
    isSample: Number(row.is_sample ?? 0) === 1,
    createdAt: Number(row.created_at ?? 0),
    budgetLineCount: Number(row.budget_line_count ?? 0),
    contractCount: Number(row.contract_count ?? 0),
    attendeeCount: Number(row.attendee_count ?? 0),
  }));

  const accounts: AdminAccount[] = accountRows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    email: row.email,
    createdAt: Number(row.created_at ?? 0),
    conferenceCount: Number(row.conference_count ?? 0),
    isAdmin: isAdminAccount(row.is_admin, row.email),
  }));

  const recentSignups: AdminSignup[] = [...accounts]
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
    .slice(0, 20)
    .map((account) => ({
      id: account.id,
      name: account.name,
      email: account.email,
      createdAt: account.createdAt,
    }));

  return {
    counts: {
      accounts: accounts.length,
      conferences: conferences.length,
      unlocked: conferences.filter((conference) => conference.plan === "unlocked").length,
      freePlan: conferences.filter((conference) => conference.plan === "free").length,
      sample: conferences.filter((conference) => conference.isSample).length,
      attendeeRegistrations: Number(attendeeTotals?.registration_count ?? 0),
      attendeePlaces: Number(attendeeTotals?.place_count ?? 0),
      pendingPayments: Number(paymentTotals?.pending_count ?? 0),
      confirmedPayments: Number(paymentTotals?.confirmed_count ?? 0),
    },
    accounts,
    conferences,
    recentSignups,
    generatedAt: Date.now(),
  };
};

/* --------------------------------------------------------------- sessions */

export const createSession = async (userId: number, token: string, expiresAt: number): Promise<void> => {
  await getDb()
    .query<unknown, [string, number, number, number]>(
      `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(token, userId, expiresAt, Date.now());
};

export const findSessionUser = async (token: string): Promise<User | null> => {
  const row = await getDb()
    .query<{ user_id: number; expires_at: number }, [string]>(
      `SELECT user_id, expires_at FROM sessions WHERE token = ?`,
    )
    .get(token);
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    await deleteSession(token);
    return null;
  }
  return await findUserById(Number(row.user_id));
};

export const deleteSession = async (token: string): Promise<void> => {
  await getDb().query<unknown, [string]>(`DELETE FROM sessions WHERE token = ?`).run(token);
};

/**
 * End every session this account holds, on every device.
 *
 * Used by a password reset and by nothing else: once a password has been
 * changed, a browser that is still signed in with the old one is exactly what an
 * attacker who had the account would be using. Signing out everywhere is the
 * honest consequence of "I changed my password", and the person simply signs in
 * again with the new one.
 */
export const deleteSessionsForUser = async (userId: number): Promise<number> => {
  const result = await getDb()
    .query<unknown, [number]>(`DELETE FROM sessions WHERE user_id = ?`)
    .run(userId);
  return result.changes;
};

/* ---------------------------------------------------------- password reset */

/**
 * How long a reset link lives: 60 minutes from the moment it was asked for.
 *
 * Long enough for someone to find the email, short enough that a link sitting in
 * an inbox months later is worthless.
 */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * How long a `password_resets` row is kept. The rate limiter counts the last
 * hour, so a day of history is more than either guard reads; older rows are
 * deleted on the next request rather than by a cron job.
 */
export const PASSWORD_RESET_RETENTION_MS = 24 * 60 * 60 * 1000;

/** One issued link, as the server uses it. The token itself is not here — only its hash. */
export type PasswordResetRow = {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
  requestIp: string;
};

type PasswordResetDbRow = {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
  request_ip: string;
};

const toPasswordReset = (row: PasswordResetDbRow): PasswordResetRow => ({
  id: Number(row.id),
  userId: Number(row.user_id),
  tokenHash: String(row.token_hash),
  expiresAt: Number(row.expires_at),
  usedAt: row.used_at === null || row.used_at === undefined ? null : Number(row.used_at),
  createdAt: Number(row.created_at),
  requestIp: String(row.request_ip ?? ""),
});

/** Drop rows too old to matter. Called on each request; never awaited by a page. */
export const prunePasswordResets = async (olderThanMs: number): Promise<void> => {
  try {
    await getDb()
      .query<unknown, [number]>(`DELETE FROM password_resets WHERE created_at < ?`)
      .run(olderThanMs);
  } catch (cause) {
    // Housekeeping must never be the reason a reset request fails.
    console.error(
      `[convocate] password reset: could not prune old rows — ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
};

/**
 * How many links have been issued for this address since `sinceMs` — the
 * per-address half of the rate limit.
 *
 * Counted in SQL from the rows themselves, so the limit is a fact about the
 * database and not a claim the browser makes about itself. Rows only exist for
 * addresses that have an account, which is fine: an address with no account is
 * never emailed, so there is nothing for a limit to protect.
 */
export const countPasswordResetsForEmailSince = async (
  email: string,
  sinceMs: number,
): Promise<number> => {
  const row = await getDb()
    .query<{ n: number }, [string, number]>(
      `SELECT COUNT(*) AS n FROM password_resets
         JOIN users ON users.id = password_resets.user_id
        WHERE LOWER(TRIM(users.email)) = ? AND password_resets.created_at >= ?`,
    )
    .get(email.toLowerCase().trim(), sinceMs);
  return Number(row?.n ?? 0);
};

/** How many links have been issued from this address since `sinceMs`. */
export const countPasswordResetsForIpSince = async (
  ip: string,
  sinceMs: number,
): Promise<number> => {
  if (!ip) return 0;
  const row = await getDb()
    .query<{ n: number }, [string, number]>(
      `SELECT COUNT(*) AS n FROM password_resets WHERE request_ip = ? AND created_at >= ?`,
    )
    .get(ip, sinceMs);
  return Number(row?.n ?? 0);
};

/**
 * Issue a link: retire every unused link this account already holds, then write
 * the new row — in one transaction, so there is never a moment when two links
 * work or when the old one still works after the new one was sent.
 */
export const createPasswordReset = async (input: {
  userId: number;
  tokenHash: string;
  expiresAt: number;
  requestIp: string;
  nowMs: number;
}): Promise<number> => {
  return await getDb().transaction(async (tx): Promise<number> => {
    await tx
      .query<unknown, [number, number]>(
        `UPDATE password_resets SET used_at = ?
          WHERE user_id = ? AND used_at IS NULL`,
      )
      .run(input.nowMs, input.userId);
    const row = await tx
      .query<{ id: number }, [number, string, number, number, string]>(
        `INSERT INTO password_resets (user_id, token_hash, expires_at, created_at, request_ip)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(input.userId, input.tokenHash, input.expiresAt, input.nowMs, input.requestIp);
    return Number(row?.id ?? 0);
  });
};

/** The row a link's hash points at, or `null` when no such link was ever issued. */
export const findPasswordResetByHash = async (
  tokenHash: string,
): Promise<PasswordResetRow | null> => {
  const row = await getDb()
    .query<PasswordResetDbRow, [string]>(`SELECT * FROM password_resets WHERE token_hash = ?`)
    .get(tokenHash);
  return row ? toPasswordReset(row) : null;
};

/**
 * Spend a link. Returns false when it was already spent — the UPDATE is
 * conditional on `used_at IS NULL`, so two requests racing the same link cannot
 * both win.
 */
export const spendPasswordReset = async (id: number, nowMs: number): Promise<boolean> => {
  const result = await getDb()
    .query<unknown, [number, number]>(
      `UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL`,
    )
    .run(nowMs, id);
  return result.changes > 0;
};

/**
 * The new password, written where `authenticate` will read it. Takes the hash,
 * never the password: the plaintext exists only inside the server function that
 * validated it.
 */
export const setUserPasswordHash = async (userId: number, passwordHash: string): Promise<void> => {
  await getDb()
    .query<unknown, [string, number]>(`UPDATE users SET password_hash = ? WHERE id = ?`)
    .run(passwordHash, userId);
};

/* ------------------------------------------------------------ conferences */

type ConferenceRow = {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  expected_attendance: number;
  budget_target_cents: number;
  created_at: number;
  plan?: string | null;
  /** The owner's `users.is_admin`, selected alongside every conference read. */
  owner_is_admin?: number | null;
  unlocked_at?: number | null;
  paid_cents?: number | null;
  is_sample?: number | null;
  role?: string;
};

/**
 * The fallback role is the *weakest* role on purpose: a row whose role could
 * not be read must lose its money rather than leak it.
 */
const toConference = (r: ConferenceRow, fallbackRole: MemberRole = "viewer"): Conference => {
  const role = (r.role as MemberRole | undefined) ?? fallbackRole;
  const isSample = Number(r.is_sample ?? 0) === 1;
  // The same decision every feature asks (`conferenceEntitlement`), applied to
  // the row already in hand — so a card and a page can never disagree.
  const entitlement = decideEntitlement(r.plan, r.owner_is_admin);
  return {
    id: Number(r.id),
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    venue: r.venue,
    expectedAttendance: Number(r.expected_attendance),
    budgetTargetCents: money(isSample || moneyVisibleTo(role), r.budget_target_cents),
    createdAt: Number(r.created_at),
    role,
    plan: entitlement.plan,
    adminUnlocked: entitlement.ownerIsAdmin && entitlement.plan === "free",
    unlockedAt: r.unlocked_at === null || r.unlocked_at === undefined ? null : Number(r.unlocked_at),
    paidCents: Number(r.paid_cents ?? 0),
    isSample,
  };
};

export type NewConference = {
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  expectedAttendance: number;
  budgetTargetCents: number;
};

/**
 * The single authorization primitive for the whole app: what does this user get
 * to do on this conference? Everything else — every read and every write — is
 * decided from this, so there is exactly one place to get it wrong.
 *
 * Returns null when the conference does not exist *or* the user is not on its
 * member list; callers must treat both the same way ("not found").
 *
 * The shared example is the one exception to the member list: every signed-in
 * account may read it, as a Viewer — unless it is theirs (the seed's owner
 * account), in which case they are its owner like any other. Reading as Viewer
 * is honest: it is exactly what they are, and every write path refuses the
 * example before it ever consults the role.
 */
export const roleForConference = async (userId: number, conferenceId: number): Promise<MemberRole | null> => {
  if (!Number.isInteger(userId) || !Number.isInteger(conferenceId)) return null;
  const row = await getDb()
    .query<{ user_id: number; is_sample: number; role: string | null }, [number, number]>(
      `SELECT c.user_id, c.is_sample, m.role
         FROM conferences c
         LEFT JOIN conference_members m
           ON m.conference_id = c.id AND m.user_id = ?
        WHERE c.id = ?`,
    )
    .get(userId, conferenceId);
  if (!row) return null;
  if (Number(row.user_id) === userId) return "owner";
  if (Number(row.is_sample ?? 0) === 1) return "viewer";
  if (!row.role) return null;
  return row.role === "editor" ? "editor" : "viewer";
};

/** Convenience for the write paths: owner or editor only. */
export const canEditConference = async (userId: number, conferenceId: number): Promise<boolean> =>
  canEditRole(await roleForConference(userId, conferenceId));

/**
 * Every conference the user can open — their own, any they were invited to, and
 * the shared example (which every account can read). Owned conferences are
 * listed first so an owner's workspace never appears smaller than it was before
 * committee access existed; the example sorts last so it never crowds out a real
 * conference.
 */
export const listConferences = async (userId: number) =>
  (await getDb()
    .query<ConferenceRow, number[]>(
      `SELECT c.*,
              (SELECT ${adminOwnerFlagSql("u")} FROM users u WHERE u.id = c.user_id) AS owner_is_admin,
              CASE
                WHEN c.user_id = ? THEN 'owner'
                WHEN c.is_sample = 1 THEN 'viewer'
                ELSE m.role
              END AS role
         FROM conferences c
         LEFT JOIN conference_members m
           ON m.conference_id = c.id AND m.user_id = ?
        WHERE c.user_id = ? OR m.user_id = ? OR c.is_sample = 1
        ORDER BY (c.user_id = ?) DESC, c.is_sample ASC, c.start_date = '',
                 c.start_date ASC, c.id DESC`,
    )
    .all(userId, userId, userId, userId, userId))
    .map((row) => toConference(row, "viewer"));

export const getConference = async (userId: number, id: number): Promise<Conference | null> => {
  const row = await getDb()
    .query<ConferenceRow, number[]>(
      `SELECT c.*,
              (SELECT ${adminOwnerFlagSql("u")} FROM users u WHERE u.id = c.user_id) AS owner_is_admin,
              CASE
                WHEN c.user_id = ? THEN 'owner'
                WHEN c.is_sample = 1 THEN 'viewer'
                ELSE m.role
              END AS role
         FROM conferences c
         LEFT JOIN conference_members m
           ON m.conference_id = c.id AND m.user_id = ?
        WHERE c.id = ? AND (c.user_id = ? OR m.user_id = ? OR c.is_sample = 1)`,
    )
    .get(userId, userId, id, userId, userId);
  return row ? toConference(row, "viewer") : null;
};

export const insertConference = async (userId: number, input: NewConference): Promise<number> => {
  // `plan` is written explicitly, not left to the column default: a conference
  // created today starts on the free plan and only $199 opens it.
  const row = await getDb()
    .query<{ id: number }, [number, string, string, string, string, number, number, string, number]>(
      `INSERT INTO conferences
         (user_id, name, start_date, end_date, venue, expected_attendance, budget_target_cents,
          plan, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(
      userId,
      input.name,
      input.startDate,
      input.endDate,
      input.venue,
      input.expectedAttendance,
      input.budgetTargetCents,
      "free",
      Date.now(),
    );
  return Number(row?.id);
};

export const updateConferenceTarget = async (
  userId: number,
  id: number,
  budgetTargetCents: number,
): Promise<boolean> => {
  // The budget target is part of the budget, so an editor may move it too — but
  // never on the shared example, and the example's frame is never renamed because
  // there is no rename path at all: only the target is editable here.
  if (await isSampleConference(id)) return false;
  if (!await canEditConference(userId, id)) return false;
  await getDb()
    .query<unknown, [number, number]>(
      `UPDATE conferences SET budget_target_cents = ? WHERE id = ?`,
    )
    .run(budgetTargetCents, id);
  return true;
};

/**
 * Deleting a whole conference stays with its owner — and never happens to the
 * shared example: it belongs to everyone, so it belongs to no one. The
 * `is_sample = 0` clause is the last line of defense behind the API's refusal.
 */
export const deleteConference = async (userId: number, id: number): Promise<void> => {
  if (await isSampleConference(id)) return;
  await getDb()
    .query<unknown, [number, number]>(
      `DELETE FROM conferences WHERE id = ? AND user_id = ? AND is_sample = 0`,
    )
    .run(id, userId);
  // The conference's attached documents are cascaded out of SQLite by the
  // foreign key; the bytes on disk are not, so the directory goes with it.
  rmSync(join(UPLOADS_DIR, String(Math.trunc(Number(id)))), { recursive: true, force: true });
};

/** Name only — used by the invite page, which must not leak any conference data. */
export const getConferenceName = async (id: number): Promise<string | null> => {
  const row = await getDb()
    .query<{ name: string }, [number]>(`SELECT name FROM conferences WHERE id = ?`)
    .get(id);
  return row ? row.name : null;
};

/* --------------------------------------------------------- budget items */

type BudgetRow = {
  id: number;
  conference_id: number;
  category: string;
  label: string;
  planned_cents: number;
  committed_cents: number;
  notes: string;
};

const toBudgetItem = (r: BudgetRow, visible: boolean): BudgetItem => ({
  id: Number(r.id),
  conferenceId: Number(r.conference_id),
  category: r.category,
  label: r.label,
  plannedCents: money(visible, r.planned_cents),
  committedCents: money(visible, r.committed_cents),
  notes: r.notes,
});

/**
 * Every budget write is gated on the caller's role on the owning conference:
 * owners and editors may write, viewers may not, non-members do not even know
 * the row exists. The shared example refuses every one of them, whatever the
 * caller's role — it is a demonstration, not a workspace.
 */
const editConferenceOf = async (userId: number, conferenceId: number): Promise<boolean> =>
  await canEditConference(userId, conferenceId) && !await isSampleConference(conferenceId);

/** The role a user has via a budget line's conference (null = no access). */
export const roleForBudgetItem = async (userId: number, itemId: number): Promise<MemberRole | null> => {
  const row = await getDb()
    .query<{ conference_id: number }, [number]>(
      `SELECT conference_id FROM budget_items WHERE id = ?`,
    )
    .get(itemId);
  if (!row) return null;
  return await roleForConference(userId, Number(row.conference_id));
};

/**
 * Budget lines for a reader. The caller must pass the reader's role on the
 * conference — the labels and categories always come back, the amounts only
 * when `moneyVisibleOn` says so (a Viewer loses them on a real conference; on
 * the example, whose figures are invented, everyone sees them).
 */
export const listBudgetItems = async (conferenceId: number, role: MemberRole | null): Promise<BudgetItem[]> => {
  const visible = await moneyVisibleOn(conferenceId, role);
  return (await getDb()
    .query<BudgetRow, [number]>(
      `SELECT * FROM budget_items WHERE conference_id = ? ORDER BY category ASC, id ASC`,
    )
    .all(conferenceId))
    .map((row) => toBudgetItem(row, visible));
};

export type BudgetInput = {
  category: string;
  label: string;
  plannedCents: number;
  committedCents: number;
  notes: string;
};

/**
 * How many budget lines a conference holds, counted straight from the table —
 * no money, so no role is needed and a Viewer's withheld amounts can never
 * affect the number the free-tier limit is measured against.
 */
export const countBudgetItems = async (conferenceId: number): Promise<number> => {
  const row = await getDb()
    .query<{ n: number }, [number]>(
      `SELECT COUNT(*) AS n FROM budget_items WHERE conference_id = ?`,
    )
    .get(conferenceId);
  return Number(row?.n ?? 0);
};

/**
 * What an insert did. `limit` is the free plan's answer, kept separate from
 * `forbidden` so the caller can say *why* rather than "not allowed".
 */
export type InsertBudgetResult = "ok" | "forbidden" | "limit";

/**
 * Add a budget line.
 *
 * The free-plan limit is enforced *here* as well as in `addBudgetItemFn`, so a
 * future caller that forgets the check cannot write a second line on a locked
 * conference: the count and the insert happen in the same synchronous step, so
 * nothing is half-written and two lines cannot slip through together.
 */
export const insertBudgetItem = async (
  userId: number,
  conferenceId: number,
  input: BudgetInput,
  freePlanLineLimit: number | null = null,
): Promise<InsertBudgetResult> => {
  if (!await editConferenceOf(userId, conferenceId)) return "forbidden";
  if (!await isConferenceUnlocked(conferenceId)) {
    const limit = freePlanLineLimit ?? FREE_PLAN_BUDGET_LINES;
    if (await countBudgetItems(conferenceId) >= limit) return "limit";
  }
  await getDb()
    .query<unknown, [number, string, string, number, number, string, number]>(
      `INSERT INTO budget_items
         (conference_id, category, label, planned_cents, committed_cents, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      conferenceId,
      input.category,
      input.label,
      input.plannedCents,
      input.committedCents,
      input.notes,
      Date.now(),
    );
  return "ok";
};

export const updateBudgetItem = async (
  userId: number,
  itemId: number,
  input: BudgetInput,
): Promise<boolean> => {
  const db = getDb();
  const row = await db
    .query<{ conference_id: number }, [number]>(`SELECT conference_id FROM budget_items WHERE id = ?`)
    .get(itemId);
  if (!row || !await editConferenceOf(userId, Number(row.conference_id))) return false;
  await db.query<unknown, [string, string, number, number, string, number]>(
    `UPDATE budget_items
        SET category = ?, label = ?, planned_cents = ?, committed_cents = ?, notes = ?
      WHERE id = ?`,
  ).run(input.category, input.label, input.plannedCents, input.committedCents, input.notes, itemId);
  return true;
};

export const deleteBudgetItem = async (userId: number, itemId: number): Promise<boolean> => {
  const db = getDb();
  const row = await db
    .query<{ conference_id: number }, [number]>(`SELECT conference_id FROM budget_items WHERE id = ?`)
    .get(itemId);
  if (!row || !await editConferenceOf(userId, Number(row.conference_id))) return false;
  await db.query<unknown, [number]>(`DELETE FROM budget_items WHERE id = ?`).run(itemId);
  return true;
};

/* ------------------------------------- the budget calculator's save */

/**
 * The estimator's line, as the database takes it. The estimator's own
 * `EstimateBudgetLine` (`lib/budget-estimate.ts`) is the source; this is the
 * subset that is stored, so the write path does not depend on the page's view
 * of a line.
 */
export type EstimateSaveLine = {
  /** `calculator:venue` — the line's identity, stored in `budget_items.source`. */
  source: string;
  category: string;
  label: string;
  plannedCents: number;
  notes: string;
};

/** What one estimate save did, or why it did nothing. */
export type EstimateSaveResult = { created: number; updated: number } | "forbidden";

/** The estimate kept on a conference: the inputs, the totals, and when. */
export type SavedEstimate = {
  conferenceId: number;
  savedAt: number;
  totalLowCents: number;
  totalMidCents: number;
  totalHighCents: number;
  inputs: unknown;
};

/**
 * Save an estimate as budget lines on a conference.
 *
 * **It is an upsert, and that is the point.** Each line carries `source`
 * (`calculator:venue`, `calculator:catering`, …). A line with that source that
 * is already on the conference has its category, label, planned figure and note
 * replaced; a line that is not there yet is inserted. So an organizer can move
 * the sliders and save again all afternoon and still hold seven lines, not
 * seventy — and every line they typed themselves (`source = ''`) is untouched,
 * because this only ever looks at rows the estimator made.
 *
 * **`committed_cents` is never written on an update.** Planned is the
 * estimator's figure and moves with it; committed is what the organizer agreed
 * with a supplier, and a re-save must not wipe it. A new line starts at 0
 * committed, because nothing is committed yet.
 *
 * The whole thing — the seven upserts and the estimate JSON — is one
 * transaction, so a failure halfway cannot leave a conference with four of the
 * seven lines and no record of what produced them.
 *
 * Gated exactly like every other budget write: owner or editor, never the shared
 * example, and only on an unlocked conference (the free plan holds one line, and
 * an estimate is seven).
 */
export const saveEstimateAsBudget = async (
  userId: number,
  conferenceId: number,
  lines: EstimateSaveLine[],
  estimate: Omit<SavedEstimate, "conferenceId">,
): Promise<EstimateSaveResult> => {
  if (!await editConferenceOf(userId, conferenceId)) return "forbidden";
  if (!await isConferenceUnlocked(conferenceId)) return "forbidden";
  let created = 0;
  let updated = 0;
  await getDb().transaction(async (instance: Db) => {
    for (const line of lines) {
      const existing = await instance
        .query<{ id: number }, [number, string]>(
          `SELECT id FROM budget_items WHERE conference_id = ? AND source = ? ORDER BY id ASC LIMIT 1`,
        )
        .get(conferenceId, line.source);
      if (existing) {
        await instance
          .query<unknown, [string, string, number, string, number]>(
            `UPDATE budget_items
                SET category = ?, label = ?, planned_cents = ?, notes = ?
              WHERE id = ?`,
          )
          .run(line.category, line.label, line.plannedCents, line.notes, Number(existing.id));
        updated += 1;
      } else {
        await instance
          .query<unknown, [number, string, string, number, string, string, number]>(
            `INSERT INTO budget_items
               (conference_id, category, label, planned_cents, committed_cents, notes, source, created_at)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
          )
          .run(
            conferenceId,
            line.category,
            line.label,
            line.plannedCents,
            line.notes,
            line.source,
            estimate.savedAt,
          );
        created += 1;
      }
    }
    await instance
      .query<unknown, [string, number]>(
        `UPDATE conferences SET budget_estimate = ? WHERE id = ?`,
      )
      .run(JSON.stringify({ ...estimate, conferenceId }), conferenceId);
  });
  return { created, updated };
};

/**
 * The last estimate saved onto a conference, or null.
 *
 * A row that cannot be parsed is treated as no estimate at all: a page must
 * never fail to render because of a stored figure it cannot read.
 */
export const savedEstimateFor = async (conferenceId: number): Promise<SavedEstimate | null> => {
  if (!Number.isInteger(conferenceId) || conferenceId <= 0) return null;
  const row = await getDb()
    .query<{ budget_estimate: string }, [number]>(
      `SELECT budget_estimate FROM conferences WHERE id = ?`,
    )
    .get(conferenceId);
  const raw = row?.budget_estimate;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedEstimate>;
    const savedAt = Number(parsed.savedAt);
    if (!Number.isFinite(savedAt) || savedAt <= 0) return null;
    return {
      conferenceId,
      savedAt,
      totalLowCents: Number(parsed.totalLowCents ?? 0),
      totalMidCents: Number(parsed.totalMidCents ?? 0),
      totalHighCents: Number(parsed.totalHighCents ?? 0),
      inputs: parsed.inputs ?? null,
    };
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------ contracts */

type ContractRow = {
  id: number;
  conference_id: number;
  kind: ContractKind;
  name: string;
  topic: string;
  fee_cents: number;
  honorarium_cents: number;
  travel_cents: number;
  equipment_cents: number;
  deposit_cents: number;
  contract_status: ContractStatus;
  contract_date: string;
  contract_note: string;
  contact_email: string;
  stage: ContractStage;
};

const toContract = (r: ContractRow, visible: boolean): Contract => ({
  id: Number(r.id),
  conferenceId: Number(r.conference_id),
  kind: r.kind,
  name: r.name,
  topic: r.topic,
  feeCents: money(visible, r.fee_cents),
  honorariumCents: money(visible, r.honorarium_cents),
  travelCents: money(visible, r.travel_cents),
  equipmentCents: money(visible, r.equipment_cents),
  depositCents: money(visible, r.deposit_cents),
  contractStatus: r.contract_status,
  contractDate: r.contract_date,
  contractNote: r.contract_note,
  contactEmail: r.contact_email,
  stage: r.stage,
});

/**
 * The contracts board for a reader. Name, kind, stage, contract status, dates,
 * notes and contact stay for everyone; every amount is withheld from a Viewer on
 * a real conference, and shown to every reader on the example (invented figures,
 * shown on purpose — see `moneyVisibleOn`).
 */
export const listContracts = async (conferenceId: number, role: MemberRole | null): Promise<Contract[]> => {
  const visible = await moneyVisibleOn(conferenceId, role);
  return (await getDb()
    .query<ContractRow, [number]>(`SELECT * FROM contracts WHERE conference_id = ? ORDER BY id ASC`)
    .all(conferenceId))
    .map((row) => toContract(row, visible));
};

export type ContractInput = {
  kind: ContractKind;
  name: string;
  topic: string;
  feeCents: number;
  honorariumCents: number;
  travelCents: number;
  equipmentCents: number;
  depositCents: number;
  contractStatus: ContractStatus;
  contractDate: string;
  contractNote: string;
  contactEmail: string;
  stage: ContractStage;
};

/** The role a user has via a contract entry's conference (null = no access). */
export const roleForContract = async (userId: number, contractId: number): Promise<MemberRole | null> => {
  const row = await getDb()
    .query<{ conference_id: number }, [number]>(
      `SELECT conference_id FROM contracts WHERE id = ?`,
    )
    .get(contractId);
  if (!row) return null;
  return await roleForConference(userId, Number(row.conference_id));
};

/** Every contract write goes through here: owner or editor, never a viewer, never the example. */
const canEditContract = async (userId: number, contractId: number): Promise<boolean> => {
  const role = await roleForContract(userId, contractId);
  if (!canEditRole(role)) return false;
  const conferenceId = await conferenceIdForContract(contractId);
  return conferenceId !== null && !await isSampleConference(conferenceId);
};

export const insertContract = async (
  userId: number,
  conferenceId: number,
  input: ContractInput,
): Promise<boolean> => {
  if (!await editConferenceOf(userId, conferenceId)) return false;
  await getDb()
    .query<unknown, (string | number)[]>(
      `INSERT INTO contracts
         (conference_id, kind, name, topic, fee_cents, honorarium_cents, travel_cents,
          equipment_cents, deposit_cents, contract_status, contract_date, contract_note,
          contact_email, stage, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      conferenceId,
      input.kind,
      input.name,
      input.topic,
      input.feeCents,
      input.honorariumCents,
      input.travelCents,
      input.equipmentCents,
      input.depositCents,
      input.contractStatus,
      input.contractDate,
      input.contractNote,
      input.contactEmail,
      input.stage,
      Date.now(),
    );
  return true;
};

export const updateContract = async (
  userId: number,
  contractId: number,
  input: ContractInput,
): Promise<boolean> => {
  if (!await canEditContract(userId, contractId)) return false;
  await getDb()
    .query<unknown, (string | number)[]>(
      `UPDATE contracts
          SET kind = ?, name = ?, topic = ?, fee_cents = ?, honorarium_cents = ?,
              travel_cents = ?, equipment_cents = ?, deposit_cents = ?, contract_status = ?,
              contract_date = ?, contract_note = ?, contact_email = ?, stage = ?
        WHERE id = ?`,
    )
    .run(
      input.kind,
      input.name,
      input.topic,
      input.feeCents,
      input.honorariumCents,
      input.travelCents,
      input.equipmentCents,
      input.depositCents,
      input.contractStatus,
      input.contractDate,
      input.contractNote,
      input.contactEmail,
      input.stage,
      contractId,
    );
  return true;
};

/* --------------------------------------------------- agreement terms */
/**
 * The optional agreement terms on one entry — everything the auto-generated
 * agreement adds beyond the card's own values. A read: no gate here, because
 * every caller has already been checked (and these fields may mention amounts,
 * so only an owner/editor ever reaches them — see `getAgreementFn`).
 */
export const getAgreementTerms = async (
  contractId: number,
): Promise<{ terms: AgreementTerms; savedAt: number }> => {
  const row = await getDb()
    .query<Record<string, unknown>, [number]>(
      `SELECT agreement_engagement, agreement_schedule, agreement_detail,
              agreement_balance_due, agreement_payment_note, agreement_inclusions,
              agreement_cancellation_notice, agreement_cancellation_deposit,
              agreement_additional_terms, agreement_governing_law, agreement_clauses,
              agreement_saved_at
         FROM contracts WHERE id = ?`,
    )
    .get(contractId);
  if (!row) return { terms: EMPTY_AGREEMENT_TERMS, savedAt: 0 };
  return { terms: termsFromRow(row), savedAt: Number(row.agreement_saved_at ?? 0) || 0 };
};

/**
 * Save the agreement terms on one entry. Same guard as every other contract
 * write (`canEditContract`: owner or editor, never a viewer, never the shared
 * example), and it touches nothing but the agreement columns — the card's own
 * values, the stage and the contract status are left exactly as they were.
 */
export const updateAgreementTerms = async (
  userId: number,
  contractId: number,
  terms: AgreementTerms,
): Promise<boolean> => {
  if (!await canEditContract(userId, contractId)) return false;
  await getDb()
    .query<unknown, (string | number)[]>(
      `UPDATE contracts
          SET agreement_engagement = ?, agreement_schedule = ?, agreement_detail = ?,
              agreement_balance_due = ?, agreement_payment_note = ?, agreement_inclusions = ?,
              agreement_cancellation_notice = ?, agreement_cancellation_deposit = ?,
              agreement_additional_terms = ?, agreement_governing_law = ?,
              agreement_clauses = ?, agreement_saved_at = ?
        WHERE id = ?`,
    )
    .run(
      terms.engagement,
      terms.schedule,
      terms.detail,
      terms.balanceDue,
      terms.paymentNote,
      terms.inclusions,
      Math.max(0, Math.round(terms.cancellationNoticeDays)),
      terms.cancellationDeposit,
      terms.additionalTerms,
      terms.governingLaw,
      normalizeClauses(terms.clauses).join(","),
      Date.now(),
      contractId,
    );
  return true;
};

/* ------------------------------------------- electronic signature (slice 1) */
/**
 * Typed acceptance through a private link — the owner's decision: a typed name,
 * a tick, and a timestamp, recorded against the version of the agreement the
 * other party was actually shown.
 *
 * What this is NOT, here and in the document itself: it is not a notarized
 * signature, and not a qualified or otherwise regulated electronic signature
 * (eIDAS or equivalent). Convocate records what happened — a link was issued, a
 * page was opened with that link, a name was typed and a box ticked at a known
 * moment against a known version of the text — and it claims nothing more.
 *
 * Slice 2 (a drawn signature image) hangs off this same row; see the table.
 */

/** How long a link stays usable: long enough for a week of email and a reply. */
export const SIGNATURE_LINK_DAYS = 30;

/** The token's shape — the same alphabet and length band as a registration link. */
const SIGNATURE_TOKEN_PATTERN = PUBLIC_TOKEN_PATTERN;

const newSignatureToken = (): string => randomBytes(24).toString("base64url");

export type SignatureState = "none" | "waiting" | "signed" | "expired" | "revoked";

/**
 * One signing link as the organizer sees it. `token` travels with it because the
 * organizer is the one who copies the link and sends it — it is theirs to hold.
 */
export type SignatureRequestView = {
  id: number;
  contractId: number;
  token: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  signedName: string;
  signedEmail: string;
  acceptedAt: number | null;
  acceptedVersion: string;
  state: SignatureState;
};

type SignatureRow = {
  id: number;
  contract_id: number;
  token: string;
  created_by: number;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  agreement_hash: string;
  signed_name: string;
  signed_email: string;
  accepted_at: number | null;
  accepted_version: string;
  signer_ip: string;
  /** `data:image/png;base64,…`, or ''. Never sent to the public signing page. */
  signature_image: string;
};

const SIGNATURE_COLUMNS = `id, contract_id, token, created_by, created_at, expires_at,
  revoked_at, agreement_hash, signed_name, signed_email, accepted_at,
  accepted_version, signer_ip, signature_image`;

/** Which of the five states a row is in, from the row itself and the clock. */
const signatureStateOf = (
  row: { accepted_at: number | null; revoked_at: number | null; expires_at: number | null },
  now = Date.now(),
): SignatureState =>
  row.accepted_at
    ? "signed"
    : row.revoked_at
      ? "revoked"
      : row.expires_at && Number(row.expires_at) <= now
        ? "expired"
        : "waiting";

const toSignatureView = (row: SignatureRow): SignatureRequestView => ({
  id: Number(row.id),
  contractId: Number(row.contract_id),
  token: String(row.token),
  createdAt: Number(row.created_at),
  expiresAt: row.expires_at === null ? null : Number(row.expires_at),
  revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
  signedName: String(row.signed_name ?? ""),
  signedEmail: String(row.signed_email ?? ""),
  acceptedAt: row.accepted_at === null ? null : Number(row.accepted_at),
  acceptedVersion: String(row.accepted_version ?? ""),
  state: signatureStateOf(row),
});

/**
 * What the other party is accepting, as a hash.
 *
 * The document's terms and figures — everything it states — and nothing else.
 * The "Signatures" section is left out on purpose: it is the one part that
 * changes when the document is signed, and the record has to survive that. The
 * printed-on date is left out too, because it is not a term and hashing it would
 * make the same agreement hash differently tomorrow. Any saved term that changes
 * the document at all changes this value, which is exactly the point: the guest
 * accepts a version, and a later edit cannot quietly become what they signed.
 */
export const agreementFingerprint = (document: {
  title: string;
  subtitle: string;
  sections: { key: string; heading: string; paragraphs: string[] }[];
}): string =>
  createHash("sha256")
    .update(
      [
        document.title,
        document.subtitle,
        ...document.sections
          .filter((section) => section.key !== "signatures")
          .flatMap((section) => [section.heading, ...section.paragraphs]),
      ].join("\n"),
    )
    .digest("hex");

/** The link an organizer has, if any: the newest row for this contract. */
export const latestSignatureRequest = async (
  contractId: number,
): Promise<SignatureRequestView | null> => {
  const row = await getDb()
    .query<SignatureRow, [number]>(
      `SELECT ${SIGNATURE_COLUMNS} FROM signature_requests
        WHERE contract_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(contractId);
  return row ? toSignatureView(row) : null;
};

/**
 * Issue a signing link.
 *
 * Re-issuing REVOKES the link it replaces rather than deleting it, so a link the
 * organizer believes is dead can never come back to life, and the record of what
 * was sent and when is kept. One live link per contract is therefore the rule,
 * and it is the old one that gives way.
 *
 * `agreementHash` is the version the agreement had at the moment the link was
 * issued (see `agreementFingerprint`). The guest is shown the current text and
 * accepts *that*; the hash here is the organizer's baseline.
 */
export const createSignatureRequest = async (
  userId: number,
  contractId: number,
  agreementHash: string,
): Promise<SignatureRequestView | null> => {
  if (!await canEditContract(userId, contractId)) return null;
  const db = getDb();
  const now = Date.now();
  await db
    .query<unknown, [number, number]>(
      `UPDATE signature_requests SET revoked_at = ?
        WHERE contract_id = ? AND revoked_at IS NULL AND accepted_at IS NULL`,
    )
    .run(now, contractId);
  await db
    .query<unknown, (string | number)[]>(
      `INSERT INTO signature_requests
         (contract_id, token, created_by, created_at, expires_at, agreement_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      contractId,
      newSignatureToken(),
      userId,
      now,
      now + SIGNATURE_LINK_DAYS * 24 * 60 * 60 * 1000,
      agreementHash,
    );
  return await latestSignatureRequest(contractId);
};

/** Kill the live link, if there is one. False when there was nothing to revoke. */
export const revokeSignatureRequest = async (
  userId: number,
  contractId: number,
): Promise<boolean> => {
  if (!await canEditContract(userId, contractId)) return false;
  const result = await getDb()
    .query<unknown, [number, number]>(
      `UPDATE signature_requests SET revoked_at = ?
        WHERE contract_id = ? AND revoked_at IS NULL AND accepted_at IS NULL`,
    )
    .run(Date.now(), contractId);
  return Number(result.changes) > 0;
};

/** One acceptance, as the printed agreement and the organizer need it. */
export type ContractSignature = {
  name: string;
  email: string;
  acceptedAt: number;
  version: string;
  /**
   * The signature they drew, as a PNG data URL, or "" if they drew none.
   *
   * Only ever returned on the ORGANIZER's side (`getAgreementFn` and the print
   * route). The public signing page never carries it: once a link is signed it
   * is dead, and a dead link must not become a way to read what was drawn.
   */
  signatureImage: string;
};

/**
 * The acceptance on this contract, or null. A read with no gate of its own: the
 * only callers are the agreement builder (already gated) and the signing page
 * (which reached the contract through a live token).
 */
export const getContractSignature = async (
  contractId: number,
): Promise<ContractSignature | null> => {
  const row = await getDb()
    .query<SignatureRow, [number]>(
      `SELECT ${SIGNATURE_COLUMNS} FROM signature_requests
        WHERE contract_id = ? AND accepted_at IS NOT NULL
        ORDER BY accepted_at DESC, id DESC LIMIT 1`,
    )
    .get(contractId);
  if (!row || row.accepted_at === null) return null;
  return {
    name: String(row.signed_name ?? ""),
    email: String(row.signed_email ?? ""),
    acceptedAt: Number(row.accepted_at),
    version: String(row.accepted_version ?? ""),
    signatureImage: String(row.signature_image ?? ""),
  };
};

/* ------------------------------------------ the signing page (public) */

/**
 * What the signing page shows. Deliberately narrow: the agreement itself (the
 * event, the parties, the terms and the fee — the guest is signing that), and
 * nothing else. No conference id, no contract id, no attendee, no budget, no
 * other contract, no committee, no account.
 */
export type SignaturePage = {
  eventName: string;
  startDate: string;
  endDate: string;
  venue: string;
  /** The other party, as the contract names them. */
  guestName: string;
  /** "Speaker", "Venue", "Supplier" — neutral, from the kind alone. */
  guestRole: string;
  /** The organizer's legal name as they stated it, or "" (never a guess). */
  organizerName: string;
  title: string;
  subtitle: string;
  body: string;
  /** The version of the text on this page — sent back on submit. */
  fingerprint: string;
  expiresAt: number | null;
};

/**
 * Every refusal is this one value. A wrong token, a revoked one, an expired one
 * and one already used are indistinguishable from outside: they say nothing
 * about whether the link ever existed, and the page that renders this says the
 * same sentence for all four.
 */
export type SignaturePageResult = { ok: true; page: SignaturePage } | { ok: false };

export type SignatureSubmitResult =
  | { ok: true; acceptedAt: number; name: string }
  /** The text changed between the page being opened and the box being ticked. */
  | { ok: false; code: "changed" }
  | { ok: false; code: "unusable" };

type SignatureLinkRow = {
  request_id: number;
  contract_id: number;
  expires_at: number | null;
  revoked_at: number | null;
  accepted_at: number | null;
  conference_id: number;
  owner_user_id: number;
  owner_name: string;
  owner_email: string;
};

/** The contract, its conference and its owner, from the token alone. */
const signatureLinkFor = async (token: string): Promise<SignatureLinkRow | null> =>
  await getDb()
    .query<SignatureLinkRow, [string]>(
      `SELECT s.id AS request_id, s.contract_id, s.expires_at, s.revoked_at, s.accepted_at,
              c.conference_id, conf.user_id AS owner_user_id,
              COALESCE(u.name, '') AS owner_name, COALESCE(u.email, '') AS owner_email
         FROM signature_requests s
         JOIN contracts c   ON c.id = s.contract_id
         JOIN conferences conf ON conf.id = c.conference_id
         LEFT JOIN users u  ON u.id = conf.user_id
        WHERE s.token = ?`,
    )
    .get(token);

/** Live = not revoked, not expired, not already accepted. */
const signatureLinkUsable = (link: SignatureLinkRow): boolean =>
  !link.accepted_at && !link.revoked_at && (!link.expires_at || Number(link.expires_at) > Date.now());

/**
 * Build the agreement a link points at, exactly as the printed one is built —
 * same builder, same saved terms, same organizer profile, so what the guest
 * reads is what the organizer's print shows.
 *
 * The plan is NOT asked here: a link was issued on an unlocked conference, and
 * if that conference later returns to the free plan (a refund) the person who
 * was already sent a link must still be able to finish accepting what they were
 * given. Creating a new link is where the $199 gate lives.
 */
const signatureDocumentFor = async (
  link: SignatureLinkRow,
): Promise<{
  page: Omit<SignaturePage, "expiresAt">;
  contractId: number;
} | null> => {
  const db = getDb();
  const [contractRow, conference, stored, organizer] = await Promise.all([
    db
      .query<ContractRow, [number]>(`SELECT * FROM contracts WHERE id = ?`)
      .get(link.contract_id),
    db
      .query<
        { id: number; name: string; start_date: string; end_date: string; venue: string; expected_attendance: number },
        [number]
      >(
        `SELECT id, name, start_date, end_date, venue, expected_attendance
           FROM conferences WHERE id = ?`,
      )
      .get(link.conference_id),
    getAgreementTerms(link.contract_id),
    getOrganizerProfile(link.owner_user_id),
  ]);
  if (!contractRow || !conference) return null;
  const contract = toContract(contractRow, true);
  const document = buildAgreement({
    conference: {
      id: Number(conference.id),
      name: conference.name,
      startDate: conference.start_date,
      endDate: conference.end_date,
      venue: conference.venue,
      expectedAttendance: Number(conference.expected_attendance ?? 0),
    },
    contract,
    terms: stored.terms,
    organizer,
    organiserName: String(link.owner_name || "").trim() || String(link.owner_email || ""),
    today: new Date().toISOString().slice(0, 10),
  });
  return {
    contractId: contract.id,
    page: {
      eventName: conference.name,
      startDate: conference.start_date,
      endDate: conference.end_date,
      venue: conference.venue,
      guestName: contract.name,
      guestRole: partyNoun(contract.kind),
      organizerName: organizer.legalName.trim(),
      title: document.title,
      subtitle: document.subtitle,
      body: document.body,
      fingerprint: agreementFingerprint(document),
    },
  };
};

/** Everything the signing page shows, from the token alone. */
export const getSignaturePage = async (token: string): Promise<SignaturePageResult> => {
  if (!SIGNATURE_TOKEN_PATTERN.test(token)) return { ok: false };
  const link = await signatureLinkFor(token);
  if (!link || !signatureLinkUsable(link)) return { ok: false };
  const built = await signatureDocumentFor(link);
  if (!built) return { ok: false };
  return {
    ok: true,
    page: { ...built.page, expiresAt: link.expires_at === null ? null : Number(link.expires_at) },
  };
};

/** The contract and its conference owner, with no link involved (organizer's side). */
const signatureLinkForContract = async (contractId: number): Promise<SignatureLinkRow | null> =>
  await getDb()
    .query<SignatureLinkRow, [number]>(
      `SELECT 0 AS request_id, c.id AS contract_id, NULL AS expires_at,
              NULL AS revoked_at, NULL AS accepted_at, c.conference_id,
              conf.user_id AS owner_user_id,
              COALESCE(u.name, '') AS owner_name, COALESCE(u.email, '') AS owner_email
         FROM contracts c
         JOIN conferences conf ON conf.id = c.conference_id
         LEFT JOIN users u ON u.id = conf.user_id
        WHERE c.id = ?`,
    )
    .get(contractId);

/**
 * The version of the agreement a link for this contract would carry — the
 * organizer's baseline when a link is issued, computed by the same builder the
 * signing page uses so the two can never disagree about what was sent.
 */
export const signatureAgreementVersion = async (contractId: number): Promise<string> => {
  const link = await signatureLinkForContract(contractId);
  if (!link) return "";
  const built = await signatureDocumentFor(link);
  return built ? built.page.fingerprint : "";
};

export type SignatureSubmitInput = {
  name: string;
  email: string;
  /** The fingerprint the page was rendered from — what the guest actually saw. */
  shownVersion: string;
  /** The address the request came from, or "". Kept as evidence, not as identity. */
  ip: string;
  /**
   * The signature the guest drew, as a PNG data URL, or "". Optional by design:
   * it is checked here (see `sanitizeSignatureImage`) and a refusal stores
   * nothing but never blocks the signature.
   */
  image?: string;
};

/**
 * The largest decoded PNG a signature may be: 150 KB. A drawn line on a 1000px
 * pad is a few KB; anything at this size is not a signature.
 */
export const MAX_SIGNATURE_IMAGE_BYTES = 150 * 1024;

/** The most characters a `data:image/png;base64,` URL of that size can be. */
const MAX_SIGNATURE_IMAGE_CHARS = Math.ceil((MAX_SIGNATURE_IMAGE_BYTES * 4) / 3) + 64;

const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Check the drawn signature the browser sent, before it is stored.
 *
 * Only a PNG data URL is accepted — the pad produces one, and nothing else has
 * any business here. SVG is refused on purpose: it can carry script, and this
 * string is rendered as an image on the organizer's own pages. The size is
 * measured on the DECODED bytes, never on the client's word for it, and the PNG
 * magic number has to be there, so the stored value really is an image.
 *
 * A refusal returns "" — it is never an error. The signature is the typed name
 * and the tick; a drawing that cannot be trusted must not be able to stop
 * somebody signing. Refusals are logged with a reason, never with the payload.
 */
export const sanitizeSignatureImage = (raw: unknown): string => {
  if (typeof raw !== "string" || !raw) return "";
  if (raw.length > MAX_SIGNATURE_IMAGE_CHARS) {
    console.warn(`[signature] drawn signature refused: ${raw.length} chars is over the cap`);
    return "";
  }
  const match = PNG_DATA_URL_PATTERN.exec(raw);
  if (!match) {
    console.warn(`[signature] drawn signature refused: not a PNG data URL (${raw.slice(0, 24)})`);
    return "";
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[1], "base64");
  } catch {
    console.warn("[signature] drawn signature refused: base64 did not decode");
    return "";
  }
  if (bytes.length > MAX_SIGNATURE_IMAGE_BYTES) {
    console.warn(`[signature] drawn signature refused: ${bytes.length} bytes decoded`);
    return "";
  }
  if (bytes.length < 8 || PNG_MAGIC.some((byte, index) => bytes[index] !== byte)) {
    console.warn("[signature] drawn signature refused: not PNG bytes");
    return "";
  }
  // Canonical form, rebuilt from the bytes that were actually checked.
  return `data:image/png;base64,${bytes.toString("base64")}`;
};

/**
 * Record one acceptance.
 *
 * One per link, and the check that makes it one is inside the UPDATE itself
 * (`accepted_at IS NULL` and the same revoke/expiry conditions), so two racing
 * submissions cannot both write: the loser changes no rows and is refused like
 * any other unusable link.
 *
 * The text is rebuilt here and its fingerprint compared with the one the page
 * sent back. A mismatch means the organizer saved different terms while the page
 * was open, and the guest must not be recorded as accepting words they never
 * saw — the page is told to reload and look again.
 */
export const recordSignatureAcceptance = async (
  token: string,
  input: SignatureSubmitInput,
): Promise<SignatureSubmitResult> => {
  if (!SIGNATURE_TOKEN_PATTERN.test(token)) return { ok: false, code: "unusable" };
  const link = await signatureLinkFor(token);
  if (!link || !signatureLinkUsable(link)) return { ok: false, code: "unusable" };
  const built = await signatureDocumentFor(link);
  if (!built) return { ok: false, code: "unusable" };
  if (built.page.fingerprint !== input.shownVersion) return { ok: false, code: "changed" };
  // The drawing is optional and checked before the write: a refused one is
  // stored as '' and the signature still goes through.
  const signatureImage = sanitizeSignatureImage(input.image);
  const now = Date.now();
  const result = await getDb()
    .query<unknown, (string | number | null)[]>(
      `UPDATE signature_requests
          SET signed_name = ?, signed_email = ?, accepted_at = ?, accepted_version = ?,
              signer_ip = ?, signature_image = ?
        WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .run(
      input.name,
      input.email,
      now,
      built.page.fingerprint,
      input.ip,
      signatureImage,
      Number(link.request_id),
      now,
    );
  if (Number(result.changes) !== 1) return { ok: false, code: "unusable" };
  return { ok: true, acceptedAt: now, name: input.name };
};

/* -------------------------------------------- the organizer's own details */
/**
 * The organizer's profile for ONE account: their legal name and postal address,
 * the email notices should go to, and who signs. One row per account, keyed by
 * `users.id`.
 *
 * `userId` always comes from the session at the call site (`getOrganizerProfileFn`,
 * `saveOrganizerProfileFn`) — never from a request body — so this module has no
 * way to be asked for somebody else's row. There is no authorization gate here
 * for the same reason: the only account this can ever describe is the caller's.
 *
 * No row reads as `EMPTY_ORGANIZER`, not as an error: an account that has never
 * opened the settings page is not missing anything, it simply has nothing stated
 * yet, and every document prints a blank line for it.
 */
export const getOrganizerProfile = async (userId: number): Promise<OrganizerIdentity> => {
  if (!userId) return EMPTY_ORGANIZER;
  const row = await getDb()
    .query<Record<string, unknown>, [number]>(
      `SELECT legal_name, address_line1, address_line2, city, state_region,
              postal_code, country, signer_name, signer_title, notices_email, phone
         FROM organizer_profiles WHERE user_id = ?`,
    )
    .get(userId);
  if (!row) return EMPTY_ORGANIZER;
  const field = (name: string): string => String(row[name] ?? "").trim();
  return {
    legalName: field("legal_name"),
    addressLine1: field("address_line1"),
    addressLine2: field("address_line2"),
    city: field("city"),
    stateRegion: field("state_region"),
    postalCode: field("postal_code"),
    country: field("country"),
    signerName: field("signer_name"),
    signerTitle: field("signer_title"),
    noticesEmail: field("notices_email"),
    phone: field("phone"),
  };
};

/**
 * Save one account's profile — and only ever its own, for the reason above.
 *
 * A profile with nothing in it is DELETED rather than stored as a row of empty
 * strings, so "never filled in" and "emptied again" are one state and not two:
 * a row only exists when the organizer has stated something. Upsert, so the
 * first save and every later save are the same statement.
 */
export const saveOrganizerProfile = async (
  userId: number,
  profile: OrganizerIdentity,
): Promise<void> => {
  if (!userId) return;
  const stated = [
    profile.legalName,
    profile.addressLine1,
    profile.addressLine2,
    profile.city,
    profile.stateRegion,
    profile.postalCode,
    profile.country,
    profile.signerName,
    profile.signerTitle,
    profile.noticesEmail,
    profile.phone,
  ].some((value) => value.trim().length > 0);
  if (!stated) {
    await getDb()
      .query<unknown, [number]>(`DELETE FROM organizer_profiles WHERE user_id = ?`)
      .run(userId);
    return;
  }
  await getDb()
    .query<unknown, (string | number)[]>(
      `INSERT INTO organizer_profiles
         (user_id, legal_name, address_line1, address_line2, city, state_region,
          postal_code, country, signer_name, signer_title, notices_email, phone,
          updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         legal_name = excluded.legal_name,
         address_line1 = excluded.address_line1,
         address_line2 = excluded.address_line2,
         city = excluded.city,
         state_region = excluded.state_region,
         postal_code = excluded.postal_code,
         country = excluded.country,
         signer_name = excluded.signer_name,
         signer_title = excluded.signer_title,
         notices_email = excluded.notices_email,
         phone = excluded.phone,
         updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      profile.legalName.trim(),
      profile.addressLine1.trim(),
      profile.addressLine2.trim(),
      profile.city.trim(),
      profile.stateRegion.trim(),
      profile.postalCode.trim(),
      profile.country.trim(),
      profile.signerName.trim(),
      profile.signerTitle.trim(),
      profile.noticesEmail.trim(),
      profile.phone.trim(),
      Date.now(),
    );
};

/* --------------------------------------------------- the organizer's logo */
/**
 * One account's saved logo, exactly as it was uploaded.
 *
 * The image lives in the database rather than in the uploads directory on
 * purpose: the uploads directory is not in the database dump, and a logo that a
 * restore could not bring back would be the one piece of an organizer's document
 * missing after a recovery. It is one small image per account, so a BLOB is the
 * right size of answer.
 *
 * `userId` comes from the session at the call site and from nowhere else, so this
 * function cannot be asked for somebody else's mark. No row reads as `null`:
 * "no logo" is a normal state, not an error, and every document then prints
 * exactly what it printed before this existed.
 */
export type OrganizerLogo = { mime: string; bytes: Uint8Array; updatedAt: number };

/** libSQL hands a BLOB back as an ArrayBuffer; older drivers used a Buffer. */
const asBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
};

export const getOrganizerLogo = async (userId: number): Promise<OrganizerLogo | null> => {
  if (!userId) return null;
  const row = await getDb()
    .query<{ mime: unknown; bytes: unknown; updated_at: unknown }, [number]>(
      `SELECT mime, bytes, updated_at FROM organizer_logos WHERE user_id = ?`,
    )
    .get(userId);
  if (!row) return null;
  const bytes = asBytes(row.bytes);
  const mime = String(row.mime ?? "");
  if (!bytes || bytes.length === 0 || !mime) return null;
  return { mime, bytes, updatedAt: Number(row.updated_at ?? 0) };
};

/**
 * Save one account's logo. Upsert: the first upload and every replacement are
 * the same statement, so there is never more than one mark per account.
 *
 * The type and the size are NOT decided here — they are decided on the server by
 * the caller (`api/logo.ts`) from the file's magic bytes, and this function only
 * writes what it is handed. Keeping the decision in one place means a second
 * caller cannot invent a looser rule.
 */
export const saveOrganizerLogo = async (
  userId: number,
  mime: string,
  bytes: Uint8Array,
): Promise<void> => {
  if (!userId) return;
  await getDb()
    .query<unknown, [number, string, Uint8Array, number]>(
      `INSERT INTO organizer_logos (user_id, mime, bytes, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         mime = excluded.mime,
         bytes = excluded.bytes,
         updated_at = excluded.updated_at`,
    )
    .run(userId, mime, bytes, Date.now());
};

/** Remove one account's logo. Removing one that is not there changes nothing. */
export const deleteOrganizerLogo = async (userId: number): Promise<void> => {
  if (!userId) return;
  await getDb()
    .query<unknown, [number]>(`DELETE FROM organizer_logos WHERE user_id = ?`)
    .run(userId);
};

export const setContractStage = async (
  userId: number,
  contractId: number,
  stage: ContractStage,
): Promise<boolean> => {
  if (!await canEditContract(userId, contractId)) return false;
  await getDb()
    .query<unknown, [string, number]>(`UPDATE contracts SET stage = ? WHERE id = ?`)
    .run(stage, contractId);
  return true;
};

export const setContractStatus = async (
  userId: number,
  contractId: number,
  status: ContractStatus,
  date: string,
): Promise<boolean> => {
  if (!await canEditContract(userId, contractId)) return false;
  await getDb()
    .query<unknown, [string, string, number]>(
      `UPDATE contracts SET contract_status = ?, contract_date = ? WHERE id = ?`,
    )
    .run(status, date, contractId);
  return true;
};

export const deleteContract = async (userId: number, contractId: number): Promise<boolean> => {
  if (!await canEditContract(userId, contractId)) return false;
  await getDb().query<unknown, [number]>(`DELETE FROM contracts WHERE id = ?`).run(contractId);
  // The attached documents of that entry go with it: the rows cascade on the
  // foreign key, and the bytes — which SQLite knows nothing about — are removed
  // with the entry's own directory.
  const conferenceId = await conferenceIdForContract(contractId);
  if (conferenceId !== null) {
    rmSync(documentDir(conferenceId, contractId), { recursive: true, force: true });
  }
  return true;
};

/* ------------------------------------------------- contract documents */
/**
 * Attached contract documents, printable contract sheets and the speaker
 * invitation letter.
 *
 * **This reverses the earlier rule that a contract entry here is status tracking
 * only** — "not sent / sent / signed" and no document of any kind. The owner has
 * approved documents: a conference now keeps the signed PDF (or a scan of the
 * signed page) beside the entry it belongs to, prints a clean sheet for a guest,
 * a supplier or the venue, and builds an invitation letter for a speaker,
 * musician, singer or band from the amounts already on the entry.
 *
 * What the old rule was protecting still holds:
 *  - the bytes are never stored in SQLite; only metadata is (see the schema);
 *  - no document is ever served from a public static path — every download goes
 *    back through the same role and plan checks as the board (see api.ts);
 *  - nothing here writes on the shared example, and nothing here is a way round
 *    the money gate: a document is only readable by someone who may see the
 *    amounts it contains.
 */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CONFERENCE_UPLOAD_BYTES = 100 * 1024 * 1024;

/** What may be attached, and the extension each type is stored under. */
export const DOCUMENT_TYPES: readonly { mime: string; ext: string }[] = [
  { mime: "application/pdf", ext: "pdf" },
  { mime: "image/png", ext: "png" },
  { mime: "image/jpeg", ext: "jpg" },
];

/**
 * Where the bytes live: a directory *beside* the database (`.data/uploads/…` by
 * default), laid out `<conferenceId>/<contractId>/<stored_name>`. Both id
 * segments are integers we generated, so they cannot carry a path, and the file
 * name is one we generate. `CONVOCATE_DATA_DIR` / `CONVOCATE_UPLOADS_DIR` move it.
 */
const UPLOADS_DIR = dataLayout().uploadsDir;
export const uploadsDir = (): string => UPLOADS_DIR;

const documentDir = (conferenceId: number, contractId: number): string =>
  join(UPLOADS_DIR, String(Math.trunc(Number(conferenceId))), String(Math.trunc(Number(contractId))));

/**
 * The absolute path of one stored file, or `null` when the name or the resolved
 * path could escape the uploads directory.
 *
 * The stored name is generated by us, so this *should* never fail — which is
 * exactly why it is checked here, at the single point between a database row and
 * a read or a write. No separators, no `..`, only the three vetted extensions,
 * and the resolved path must still sit inside the uploads root.
 */
const documentPath = (
  conferenceId: number,
  contractId: number,
  storedName: string,
): string | null => {
  if (!/^[A-Za-z0-9-]+\.(pdf|png|jpg)$/.test(storedName)) return null;
  const root = resolve(UPLOADS_DIR);
  const path = resolve(documentDir(conferenceId, contractId), storedName);
  if (path !== root && !path.startsWith(root + sep)) return null;
  return path;
};

export type ContractDocument = {
  id: number;
  conferenceId: number;
  contractId: number;
  /** The name the uploader's file had. Metadata only — never used as a path. */
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedBy: number;
  uploadedByName: string;
  createdAt: number;
};

type DocumentRow = {
  id: number;
  conference_id: number;
  contract_id: number;
  filename: string;
  stored_name: string;
  mime: string;
  size_bytes: number;
  uploaded_by: number;
  created_at: number;
  uploaded_by_name: string | null;
  uploaded_by_email: string | null;
};

const SELECT_DOCUMENT = `SELECT d.id, d.conference_id, d.contract_id, d.filename, d.stored_name,
         d.mime, d.size_bytes, d.uploaded_by, d.created_at,
         u.name AS uploaded_by_name, u.email AS uploaded_by_email
    FROM contract_documents d
    LEFT JOIN users u ON u.id = d.uploaded_by`;

const toDocument = (r: DocumentRow): ContractDocument => ({
  id: Number(r.id),
  conferenceId: Number(r.conference_id),
  contractId: Number(r.contract_id),
  filename: r.filename,
  mime: r.mime,
  sizeBytes: Number(r.size_bytes),
  uploadedBy: Number(r.uploaded_by),
  uploadedByName: String(r.uploaded_by_name || r.uploaded_by_email || ""),
  createdAt: Number(r.created_at),
});

/** Every attached document on one conference — the caller applies the role gate. */
export const listContractDocuments = async (conferenceId: number): Promise<ContractDocument[]> =>
  (await getDb()
    .query<DocumentRow, [number]>(`${SELECT_DOCUMENT} WHERE d.conference_id = ? ORDER BY d.id ASC`)
    .all(conferenceId))
    .map(toDocument);

/** The extension a stored file is written under, from its mime type. */
export const extensionForMime = (mime: string): string | null =>
  DOCUMENT_TYPES.find((type) => type.mime === mime)?.ext ?? null;

/**
 * What one conference's attachments weigh, read from the rows rather than from
 * the disk, so an orphaned file left by a crashed upload does not count against
 * a church's allowance.
 */
export const conferenceUploadBytes = async (conferenceId: number): Promise<number> => {
  const row = await getDb()
    .query<{ total: number | null }, [number]>(
      `SELECT SUM(size_bytes) AS total FROM contract_documents WHERE conference_id = ?`,
    )
    .get(conferenceId);
  return Number(row?.total ?? 0);
};

/**
 * Write the bytes and record the row. The stored name is generated here
 * (`<uuid>.<ext>`); nothing the uploader sent is ever part of a path.
 */
export const saveContractDocument = async (input: {
  conferenceId: number;
  contractId: number;
  filename: string;
  mime: string;
  uploadedBy: number;
  bytes: Uint8Array;
}): Promise<ContractDocument | null> => {
  const ext = extensionForMime(input.mime);
  if (!ext) return null;
  const storedName = `${randomUUID()}.${ext}`;
  const path = documentPath(input.conferenceId, input.contractId, storedName);
  if (!path) return null;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, input.bytes);
  const inserted = await getDb()
    .query<unknown, (string | number)[]>(
      `INSERT INTO contract_documents
         (conference_id, contract_id, filename, stored_name, mime, size_bytes, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.conferenceId,
      input.contractId,
      input.filename,
      storedName,
      input.mime,
      input.bytes.byteLength,
      input.uploadedBy,
      Date.now(),
    );
  const created = await getDb()
    .query<DocumentRow, [number]>(`${SELECT_DOCUMENT} WHERE d.id = ?`)
    .get(Number(inserted.lastInsertRowid));
  return created ? toDocument(created) : null;
};

/**
 * One document with its bytes, for a download. Callers must already have checked
 * the role and the plan — this function deliberately knows nothing about who is
 * asking: the check belongs next to the session, not next to the file.
 */
export const readContractDocument = async (
  documentId: number,
): Promise<{ document: ContractDocument; bytes: Buffer } | null> => {
  const row = await getDb()
    .query<DocumentRow, [number]>(`${SELECT_DOCUMENT} WHERE d.id = ?`)
    .get(documentId);
  if (!row) return null;
  const path = documentPath(Number(row.conference_id), Number(row.contract_id), row.stored_name);
  if (!path || !existsSync(path)) return null;
  return { document: toDocument(row), bytes: readFileSync(path) };
};

/** The conference and contract a document belongs to; `null` when it is gone. */
export const contractDocumentOwner = async (
  documentId: number,
): Promise<{ conferenceId: number; contractId: number } | null> => {
  const row = await getDb()
    .query<{ conference_id: number; contract_id: number }, [number]>(
      `SELECT conference_id, contract_id FROM contract_documents WHERE id = ?`,
    )
    .get(documentId);
  if (!row) return null;
  return { conferenceId: Number(row.conference_id), contractId: Number(row.contract_id) };
};

/** Delete the row and the bytes. Returns false when there was nothing to delete. */
export const deleteContractDocument = async (documentId: number): Promise<boolean> => {
  const row = await getDb()
    .query<DocumentRow, [number]>(`${SELECT_DOCUMENT} WHERE d.id = ?`)
    .get(documentId);
  if (!row) return false;
  const path = documentPath(Number(row.conference_id), Number(row.contract_id), row.stored_name);
  if (path) rmSync(path, { force: true });
  await getDb().query<unknown, [number]>(`DELETE FROM contract_documents WHERE id = ?`).run(documentId);
  return true;
};

/* ------------------------------------------------- committee access */

/**
 * An invite link is a bearer credential for one conference and one role. It is
 * reusable until it expires or is revoked — it is a link, not a one-shot code —
 * and because it grants exactly one role, reuse never makes authorization
 * ambiguous. Re-joining never downgrades someone who already holds a higher role.
 */
const INVITE_TTL_DAYS = 30;

const now = () => Date.now();

const roleRank = (role: MemberRole): number =>
  role === "owner" ? 3 : role === "editor" ? 2 : 1;

export const listMembers = async (conferenceId: number): Promise<ConferenceMember[]> =>
  (await getDb()
    .query<
      { user_id: number; name: string; email: string; role: string; joined_at: number },
      [number]
    >(
      `SELECT u.id AS user_id, u.name, u.email,
              CASE WHEN c.user_id = u.id THEN 'owner' ELSE m.role END AS role,
              COALESCE(m.created_at, c.created_at) AS joined_at
         FROM conferences c
         JOIN users u ON u.id = c.user_id OR u.id IN (
              SELECT user_id FROM conference_members WHERE conference_id = c.id
         )
         LEFT JOIN conference_members m
                ON m.conference_id = c.id AND m.user_id = u.id
        WHERE c.id = ?
        ORDER BY (u.id = c.user_id) DESC, joined_at ASC, u.id ASC`,
    )
    .all(conferenceId))
    .map((row) => ({
      userId: Number(row.user_id),
      name: row.name,
      email: row.email,
      role: (row.role === "owner" ? "owner" : row.role === "editor" ? "editor" : "viewer") as MemberRole,
      joinedAt: Number(row.joined_at),
    }));

export type RawInvite = {
  token: string;
  conferenceId: number;
  role: InviteRole;
  expiresAt: number;
  revokedAt: number | null;
  uses: number;
};

export const findInvite = async (token: string): Promise<RawInvite | null> => {
  if (!token || token.length > 128) return null;
  const row = await getDb()
    .query<
      { token: string; conference_id: number; role: string; expires_at: number; revoked_at: number | null; uses: number },
      [string]
    >(`SELECT token, conference_id, role, expires_at, revoked_at, uses FROM conference_invites WHERE token = ?`)
    .get(token);
  if (!row) return null;
  return {
    token: row.token,
    conferenceId: Number(row.conference_id),
    role: asInviteRole(row.role),
    expiresAt: Number(row.expires_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    uses: Number(row.uses),
  };
};

/** Only the owner of the conference may mint links into it — and never into the example. */
export const createInvite = async (
  actorId: number,
  conferenceId: number,
  role: InviteRole,
): Promise<{ token: string; expiresAt: number } | null> => {
  if (await roleForConference(actorId, conferenceId) !== "owner") return null;
  if (await isSampleConference(conferenceId)) return null;
  const token = randomBytes(24).toString("hex");
  const expiresAt = now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
  await getDb()
    .query<unknown, [string, number, string, number, number, number]>(
      `INSERT INTO conference_invites (token, conference_id, role, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(token, conferenceId, asInviteRole(role), actorId, now(), expiresAt);
  return { token, expiresAt };
};

export const listInvites = async (actorId: number, conferenceId: number): Promise<ConferenceInvite[]> => {
  if (await roleForConference(actorId, conferenceId) !== "owner") return [];
  return (await getDb()
    .query<
      {
        token: string;
        role: string;
        created_at: number;
        expires_at: number;
        revoked_at: number | null;
        uses: number;
        created_by_name: string;
      },
      [number]
    >(
      `SELECT i.token, i.role, i.created_at, i.expires_at, i.revoked_at, i.uses,
              COALESCE(u.name, u.email) AS created_by_name
         FROM conference_invites i
         LEFT JOIN users u ON u.id = i.created_by
        WHERE i.conference_id = ?
        ORDER BY i.created_at DESC
        LIMIT 25`,
    )
    .all(conferenceId))
    .map((row) => ({
      token: row.token,
      role: asInviteRole(row.role),
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
      uses: Number(row.uses),
      createdByName: row.created_by_name ?? "",
    }));
};

export const revokeInvite = async (actorId: number, token: string): Promise<boolean> => {
  const invite = await findInvite(token);
  if (!invite) return false;
  if (await roleForConference(actorId, invite.conferenceId) !== "owner") return false;
  if (invite.revokedAt !== null) return true;
  await getDb()
    .query<unknown, [number, string]>(
      `UPDATE conference_invites SET revoked_at = ? WHERE token = ?`,
    )
    .run(now(), token);
  return true;
};

export type AcceptResult =
  | { ok: true; conferenceId: number; role: MemberRole }
  | { ok: false; reason: "invalid" | "revoked" | "expired" };

/** Redeems a link for the signed-in user. Idempotent: re-opening it is fine. */
export const acceptInvite = async (userId: number, token: string): Promise<AcceptResult> => {
  const invite = await findInvite(token);
  if (!invite) return { ok: false, reason: "invalid" };
  if (invite.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (invite.expiresAt < now()) return { ok: false, reason: "expired" };
  const db = getDb();
  const conference = await db
    .query<{ user_id: number; is_sample: number }, [number]>(
      `SELECT user_id, is_sample FROM conferences WHERE id = ?`,
    )
    .get(invite.conferenceId);
  if (!conference) return { ok: false, reason: "invalid" };
  // The example takes no members: it is already open to every account.
  if (Number(conference.is_sample ?? 0) === 1) return { ok: false, reason: "invalid" };

  if (Number(conference.user_id) === userId) {
    return { ok: true, conferenceId: invite.conferenceId, role: "owner" };
  }
  const existing = await db
    .query<{ role: string }, [number, number]>(
      `SELECT role FROM conference_members WHERE conference_id = ? AND user_id = ?`,
    )
    .get(invite.conferenceId, userId);
  const current: MemberRole | null = existing
    ? existing.role === "editor"
      ? "editor"
      : "viewer"
    : null;
  // Never downgrade: opening a viewer link must not strip editor rights.
  const next = current && roleRank(current) >= roleRank(invite.role) ? current : invite.role;
  if (next !== current) {
    await db.query<unknown, [number, number, string, number]>(
      `INSERT INTO conference_members (conference_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(conference_id, user_id) DO UPDATE SET role = excluded.role`,
    ).run(invite.conferenceId, userId, next, now());
  }
  await db.query<unknown, [string]>(`UPDATE conference_invites SET uses = uses + 1 WHERE token = ?`).run(
    token,
  );
  return { ok: true, conferenceId: invite.conferenceId, role: next };
};

/** Owner-only. The owner's own row is never stored here, so it can never be changed. */
export const setMemberRole = async (
  actorId: number,
  conferenceId: number,
  targetUserId: number,
  role: InviteRole,
): Promise<boolean> => {
  if (await roleForConference(actorId, conferenceId) !== "owner") return false;
  if (await isSampleConference(conferenceId)) return false;
  if (await roleForConference(targetUserId, conferenceId) === "owner") return false;
  await getDb()
    .query<unknown, [string, number, number]>(
      `UPDATE conference_members SET role = ? WHERE conference_id = ? AND user_id = ?`,
    )
    .run(asInviteRole(role), conferenceId, targetUserId);
  return true;
};

/** Owner-only. Removing the owner is impossible: their access is conferences.user_id. */
export const removeMember = async (actorId: number, conferenceId: number, targetUserId: number): Promise<boolean> => {
  if (await roleForConference(actorId, conferenceId) !== "owner") return false;
  if (await isSampleConference(conferenceId)) return false;
  if (await roleForConference(targetUserId, conferenceId) === "owner") return false;
  await getDb()
    .query<unknown, [number, number]>(
      `DELETE FROM conference_members WHERE conference_id = ? AND user_id = ?`,
    )
    .run(conferenceId, targetUserId);
  return true;
};

/** A member may leave; the owner cannot abandon a conference without deleting it. */
export const leaveConference = async (userId: number, conferenceId: number): Promise<boolean> => {
  const role = await roleForConference(userId, conferenceId);
  if (role !== "editor" && role !== "viewer") return false;
  if (await isSampleConference(conferenceId)) return false;
  await getDb()
    .query<unknown, [number, number]>(
      `DELETE FROM conference_members WHERE conference_id = ? AND user_id = ?`,
    )
    .run(conferenceId, userId);
  return true;
};

export { BUDGET_CATEGORIES, CONTRACT_KINDS, CONTRACT_STAGES, CONTRACT_STATUSES } from "../lib/types";
export type {
  BudgetItem,
  Contract,
  ContractKind,
  ContractStage,
  ContractStatus,
} from "../lib/types";

/**
 * First-boot side effects, server-only.
 *
 * 1. The admin token (the credential that confirms a payment) is created now if
 *    it does not exist yet, and mirrored to its 0600 file, so the team can always
 *    find it without a running app.
 * 2. The state of the payment credentials is logged as `set`/`unset` — never the
 *    value — so whether the automatic Stripe path is available is visible in the
 *    server log rather than guessed at.
 * 3. Today's copy of the database is taken into `<data dir>/backups/`, if one has
 *    not been taken today already.
 *
 * None of these can throw into a request: each is wrapped, and a database that
 * cannot open here will fail just as loudly on the first request.
 */
const bootSideEffects = async (): Promise<void> => {
  const state = (name: string): string => (process.env[name] ? "set" : "unset");
  try {
    console.log(
      `[convocate] payment credentials — STRIPE_SECRET_KEY: ${state("STRIPE_SECRET_KEY")}, STRIPE_WEBHOOK_SECRET: ${state("STRIPE_WEBHOOK_SECRET")}; unlock path: ${
        process.env.STRIPE_SECRET_KEY ? "stripe-checkout-session" : "payment-link + manual confirmation"
      }`,
    );
  } catch {
    /* logging must never break boot */
  }
  try {
    await adminToken();
  } catch (cause) {
    console.error("[convocate] could not prepare the admin token", cause);
  }
  // 3. Today's copy of the database, kept beside it (second line of defense —
  //    same disk as the data; the real backup is the token-gated export). At most
  //    one per UTC day, so a restart loop cannot fill the disk. Wrapped, because
  //    a failed backup must never stop the site from booting: the log line is the
  //    alarm, and the next boot tries again.
  try {
    await dailySnapshot("boot");
  } catch (cause) {
    console.error("[convocate] daily snapshot failed — the site continues without it", cause);
  }
};

/**
 * Boot, in one place, in the order that makes each step safe:
 *
 *   1. the tables (CREATE TABLE IF NOT EXISTS),
 *   2. ONLY when the target is remote and empty of users: copy the local file's
 *      rows in — one time, ids intact, the local file untouched,
 *   3. the migrations (added columns, one-time markers),
 *   4. the shared example conference (needs a real account to hang off),
 *   5. the side effects: the admin token, then today's copy (file targets only).
 *
 * Nothing here throws into a request: the boot hook's promise is cleared on
 * failure, so the next request retries and the site recovers on its own once the
 * database answers.
 */
const bootDatabase = async (): Promise<void> => {
  const instance = rawDb();
  // Foreign keys are a per-connection setting; it must be on before any write.
  await instance.execute("PRAGMA foreign_keys = ON");
  await createTables(instance);
  if (databaseTarget().kind === "remote") {
    try {
      const report = await importLocalDatabaseIfEmpty(instance, DB_PATH);
      if (!report.ran) console.log(`[convocate] local import skipped: ${report.reason}`);
    } catch (cause) {
      console.error(
        "[convocate] ERROR: importing the local database into the remote one failed — the remote was left as it was",
        cause,
      );
    }
  }
  await migrate(instance);
  await seedSampleConference(instance);
  // The example's second pass — its registration side, and two guest titles —
  // runs after the seed, because it edits the row the seed creates.
  await enrichSampleConference(instance);
  await bootSideEffects();
};

registerBootHook(bootDatabase);

/* ------------------------------------------------------- the help assistant */

/**
 * How many questions an account has asked since `sinceMs`.
 *
 * Counted from `ai_usage` on the server, so the limit is a fact about the
 * database and not a claim the browser makes about itself.
 */
export const countAiQuestionsForUserSince = async (
  userId: number,
  sinceMs: number,
): Promise<number> => {
  const row = await getDb()
    .query<{ n: number }, [number, number]>(
      `SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND asked_at >= ?`,
    )
    .get(userId, sinceMs);
  return Number(row?.n ?? 0);
};

/** How many questions the whole site has asked since `sinceMs` — the busy guard. */
export const countAiQuestionsSince = async (sinceMs: number): Promise<number> => {
  const row = await getDb()
    .query<{ n: number }, [number]>(
      `SELECT COUNT(*) AS n FROM ai_usage WHERE asked_at >= ?`,
    )
    .get(sinceMs);
  return Number(row?.n ?? 0);
};

/** Rows older than this are of no use to either guard, and are deleted. */
export const AI_USAGE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Record one question, at the moment the call is attempted.
 *
 * The question text is kept (truncated by the caller) and the answer never is:
 * the row exists to count, and the text is what lets an owner see what people
 * ask. Old rows are dropped here rather than by a cron job, because a day of
 * history is all either guard reads.
 */
export const recordAiQuestion = async (
  userId: number,
  question: string,
  askedAtMs: number,
): Promise<void> => {
  const db = getDb();
  await db
    .query<unknown, [number, string, number]>(
      `INSERT INTO ai_usage (user_id, question, asked_at) VALUES (?, ?, ?)`,
    )
    .run(userId, question, askedAtMs);
  await db
    .query<unknown, [number]>(`DELETE FROM ai_usage WHERE asked_at < ?`)
    .run(askedAtMs - AI_USAGE_RETENTION_MS);
};

/* ------------------------------------------------------------- payouts (Stripe) */

/**
 * The organizer's own Stripe account, as stored in `payout_accounts`.
 *
 * One row per ACCOUNT, not per conference: an organizer running three events
 * connects Stripe once, and every event of theirs pays into that one account.
 * `stripeAccountId` is the full `acct_...` id and never leaves the server; the
 * settings card is shown only its last four characters (see `payouts.server.ts`).
 */
export type PayoutAccount = {
  userId: number;
  stripeAccountId: string;
  country: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  connectedAt: number;
  updatedAt: number;
};

type PayoutAccountRow = {
  user_id: number;
  stripe_account_id: string | null;
  country: string | null;
  charges_enabled: number | null;
  payouts_enabled: number | null;
  details_submitted: number | null;
  connected_at: number | null;
  updated_at: number | null;
};

const toPayoutAccount = (row: PayoutAccountRow): PayoutAccount => ({
  userId: Number(row.user_id),
  stripeAccountId: String(row.stripe_account_id ?? ""),
  country: String(row.country ?? ""),
  chargesEnabled: Number(row.charges_enabled ?? 0) === 1,
  payoutsEnabled: Number(row.payouts_enabled ?? 0) === 1,
  detailsSubmitted: Number(row.details_submitted ?? 0) === 1,
  connectedAt: Number(row.connected_at ?? 0),
  updatedAt: Number(row.updated_at ?? 0),
});

/** This account's Stripe row, or null when it has never connected one. */
export const getPayoutAccount = async (userId: number): Promise<PayoutAccount | null> => {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const row = await getDb()
    .query<PayoutAccountRow, [number]>(
      `SELECT user_id, stripe_account_id, country, charges_enabled, payouts_enabled,
              details_submitted, connected_at, updated_at
         FROM payout_accounts
        WHERE user_id = ?`,
    )
    .get(userId);
  if (!row) return null;
  const account = toPayoutAccount(row);
  // A row with no account id is the same as no row: nothing is connected yet.
  return account.stripeAccountId ? account : null;
};

/**
 * Remember the Stripe account created for this organizer.
 *
 * Upsert, so a second call (or a row that already exists from an earlier
 * attempt) updates the id instead of failing on the primary key. The flags are
 * written by `savePayoutAccountStatus`, not here: a brand-new Express account
 * has submitted nothing and enabled nothing, which is exactly the default.
 */
export const savePayoutAccount = async (
  userId: number,
  stripeAccountId: string,
  country: string,
  now: number,
): Promise<void> => {
  await getDb()
    .query<unknown, [number, string, string, number, number]>(
      `INSERT INTO payout_accounts (user_id, stripe_account_id, country, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         stripe_account_id = excluded.stripe_account_id,
         country           = excluded.country,
         connected_at      = COALESCE(payout_accounts.connected_at, excluded.connected_at),
         updated_at        = excluded.updated_at`,
    )
    .run(userId, stripeAccountId, country, now, now);
};

/** Copy Stripe's answer about an existing account back onto the row. */
export const savePayoutAccountStatus = async (
  userId: number,
  status: { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean },
  now: number,
): Promise<void> => {
  await getDb()
    .query<unknown, [number, number, number, number, number]>(
      `UPDATE payout_accounts
          SET charges_enabled = ?, payouts_enabled = ?, details_submitted = ?, updated_at = ?
        WHERE user_id = ?`,
    )
    .run(
      status.chargesEnabled ? 1 : 0,
      status.payoutsEnabled ? 1 : 0,
      status.detailsSubmitted ? 1 : 0,
      now,
      userId,
    );
};

/**
 * Does this account run an event of its own?
 *
 * This is the gate on the payouts card: an account that has never created a
 * conference is a committee member on someone else's (an editor or a viewer),
 * and payouts are not theirs to set up. It reads `conferences.user_id` — the
 * owning account — and nothing from the request body.
 */
export const ownsAnyConference = async (userId: number): Promise<boolean> => {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const row = await getDb()
    .query<{ one: number }, [number]>(
      `SELECT 1 AS one FROM conferences WHERE user_id = ? LIMIT 1`,
    )
    .get(userId);
  return Boolean(row);
};

/**
 * Forget this organizer's Stripe pointer. Used by tests and by hand; nothing in
 * the product calls it. The Stripe account itself is NOT closed — that is a
 * Stripe-side act, and deleting our row only stops Convocate pointing at it.
 */
export const deletePayoutAccount = async (userId: number): Promise<void> => {
  await getDb()
    .query<unknown, [number]>(`DELETE FROM payout_accounts WHERE user_id = ?`)
    .run(userId);
};


/* --------------------------------------------------- the Stripe webhook path */

/**
 * One registration, as the webhook needs to see it.
 *
 * Deliberately small: the id, the event it belongs to, what the row says now and
 * which Checkout Session is on it. No name, no email — the webhook never needs
 * them, so it never reads them.
 */
export type StripePaymentAttendee = {
  attendeeId: number;
  conferenceId: number;
  paymentStatus: AttendeePaymentStatus;
  /** The session stored on the row, or "" when none was ever started. */
  sessionId: string;
  amountCents: number;
  currency: string;
};

type StripePaymentAttendeeRow = {
  id: number;
  conference_id: number;
  payment_status: string;
  stripe_session_id: string;
  amount_cents: number;
  currency: string;
};

const toStripePaymentAttendee = (row: StripePaymentAttendeeRow): StripePaymentAttendee => ({
  attendeeId: Number(row.id),
  conferenceId: Number(row.conference_id),
  paymentStatus: attendeePaymentStatus(row.payment_status),
  sessionId: String(row.stripe_session_id ?? ""),
  amountCents: Number(row.amount_cents ?? 0),
  currency: String(row.currency ?? "usd") || "usd",
});

/**
 * Find the registration a Checkout Session was created for.
 *
 * Two ways, in this order, and both of them are facts about the database rather
 * than claims from the request:
 *
 *  1. **By the session id stored on the row.** `startAttendeeCardPayment` writes
 *     it before the browser is sent to Stripe, and a partial unique index keeps
 *     two rows from claiming the same session. This is the normal path.
 *  2. **By the attendee id Stripe carried in the session's metadata.** Used when
 *     the row's stored session id is a *different* one — the organizer's
 *     "try again" button opens a fresh session, and an older session that was
 *     still paid at Stripe must not be lost. The caller still checks that the
 *     conference matches and that the row is not already paid or refunded.
 *
 * A session id that matches no row returns `null`; so does a guessed attendee id.
 */
export const findAttendeeForStripePayment = async (input: {
  sessionId: string;
  attendeeId: number;
}): Promise<{ attendee: StripePaymentAttendee; matchedBy: "session" | "attendee" } | null> => {
  const columns = `id, conference_id, payment_status, stripe_session_id, amount_cents, currency`;
  if (input.sessionId) {
    const bySession = await getDb()
      .query<StripePaymentAttendeeRow, [string]>(
        `SELECT ${columns} FROM attendees WHERE stripe_session_id = ?`,
      )
      .get(input.sessionId);
    if (bySession) {
      return { attendee: toStripePaymentAttendee(bySession), matchedBy: "session" };
    }
  }
  if (Number.isInteger(input.attendeeId) && input.attendeeId > 0) {
    const byId = await getDb()
      .query<StripePaymentAttendeeRow, [number]>(
        `SELECT ${columns} FROM attendees WHERE id = ?`,
      )
      .get(input.attendeeId);
    if (byId) {
      return { attendee: toStripePaymentAttendee(byId), matchedBy: "attendee" };
    }
  }
  return null;
};

/**
 * Mark a registration paid because Stripe said the money arrived.
 *
 * This is the webhook's write, and it is the only one the webhook makes. The
 * `WHERE` is the whole safety story:
 *
 *  - `payment_status NOT IN ('paid', 'paid_by_hand', 'refunded')` — a row that is
 *    already paid is left exactly as it is (no write at all, so `paid_at` keeps
 *    the first time we learned), and a refunded row is never quietly re-paid.
 *  - `stripe_session_id = ? OR stripe_session_id = ''` — either the session on the
 *    row is the one Stripe just confirmed, or no session was ever recorded on it.
 *    A row carrying a *different* session id is not touched by a webhook for
 *    another session.
 *  - **unless `allowOtherSession` is set.** That is the one fallback: Stripe's own
 *    metadata named this registration, and the row holds a newer session (the
 *    organizer pressed "try again", then the attendee paid the older tab). The
 *    paying session then becomes the one on the row, because that is the session
 *    the money actually came from.
 *
 * `paid_at` is only set when it is still empty. Returns whether a row changed.
 */
export const markAttendeePaidFromStripe = async (input: {
  attendeeId: number;
  conferenceId: number;
  sessionId: string;
  paymentIntentId: string;
  amountCents: number;
  currency: string;
  paidAt: number;
  /** Reach the row through Stripe's metadata rather than the session id on it. */
  allowOtherSession?: boolean;
}): Promise<boolean> => {
  if (!Number.isInteger(input.attendeeId) || input.attendeeId <= 0) return false;
  if (!Number.isInteger(input.conferenceId) || input.conferenceId <= 0) return false;
  if (!input.sessionId) return false;
  const other = input.allowOtherSession ? 1 : 0;
  const result = await getDb()
    .query<
      unknown,
      [number, string, string, number, string, number, number, number, string, number]
    >(
      `UPDATE attendees
          SET payment_status = 'paid',
              stripe_session_id = CASE WHEN stripe_session_id = '' OR ? = 1 THEN ? ELSE stripe_session_id END,
              stripe_payment_intent_id = ?,
              amount_cents = ?,
              currency = ?,
              paid_at = COALESCE(paid_at, ?)
        WHERE id = ?
          AND conference_id = ?
          AND payment_status NOT IN ('paid', 'paid_by_hand', 'refunded')
          AND (stripe_session_id = ? OR stripe_session_id = '' OR ? = 1)`,
    )
    .run(
      other,
      input.sessionId,
      input.paymentIntentId,
      input.amountCents,
      input.currency,
      input.paidAt,
      input.attendeeId,
      input.conferenceId,
      input.sessionId,
      other,
    );
  return Number(result.changes) > 0;
};

/* ------------------------------------------------- the webhook's own receipts */

/**
 * What came of one Stripe event. Terminal outcomes never re-apply; 'received'
 * means a delivery reached us and did not finish, so the next one may try again.
 */
export type StripeWebhookOutcome =
  | "received"
  | "applied"
  | "already_paid"
  | "ignored"
  | "unmatched";

export type StripeWebhookReceipt = {
  eventId: string;
  outcome: StripeWebhookOutcome;
  note: string;
  receivedAt: number;
};

type StripeWebhookRow = {
  event_id: string;
  outcome: string;
  note: string;
  received_at: number;
};

const toOutcome = (value: unknown): StripeWebhookOutcome =>
  value === "applied" || value === "already_paid" || value === "ignored" || value === "unmatched"
    ? value
    : "received";

/**
 * Write down that this event arrived, and say whether we had already seen it.
 *
 * `INSERT OR IGNORE` on the primary key is the whole idempotency mechanism: two
 * simultaneous deliveries of the same event cannot both insert, so only one of
 * them gets `isNew: true` and goes on to change a row. Returns the row as it
 * stands, whatever happened.
 */
export const claimStripeWebhookEvent = async (input: {
  eventId: string;
  eventType: string;
  accountId: string;
  sessionId: string;
  receivedAt: number;
}): Promise<{ isNew: boolean; receipt: StripeWebhookReceipt }> => {
  const insert = await getDb()
    .query<unknown, [string, string, string, string, number]>(
      `INSERT OR IGNORE INTO stripe_webhook_events
         (event_id, event_type, account_id, session_id, outcome, note, received_at)
       VALUES (?, ?, ?, ?, 'received', '', ?)`,
    )
    .run(input.eventId, input.eventType, input.accountId, input.sessionId, input.receivedAt);
  const row = await getDb()
    .query<StripeWebhookRow, [string]>(
      `SELECT event_id, outcome, note, received_at FROM stripe_webhook_events WHERE event_id = ?`,
    )
    .get(input.eventId);
  return {
    isNew: Number(insert.changes) > 0,
    receipt: {
      eventId: input.eventId,
      outcome: toOutcome(row?.outcome),
      note: String(row?.note ?? ""),
      receivedAt: Number(row?.received_at ?? input.receivedAt),
    },
  };
};

/** Settle a receipt: what we did with the event, and when. */
export const settleStripeWebhookEvent = async (input: {
  eventId: string;
  outcome: StripeWebhookOutcome;
  note: string;
  settledAt: number;
}): Promise<void> => {
  await getDb()
    .query<unknown, [string, string, number, string]>(
      `UPDATE stripe_webhook_events
          SET outcome = ?, note = ?, settled_at = ?
        WHERE event_id = ?`,
    )
    .run(input.outcome, input.note.slice(0, 500), input.settledAt, input.eventId);
};

/** How many receipts this table holds. Used by tests and by the admin panel. */
export const countStripeWebhookEvents = async (): Promise<number> => {
  const row = await getDb()
    .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM stripe_webhook_events`)
    .get();
  return Number(row?.n ?? 0);
};

/* ------------------------------------------------------------ lead magnets */
/**
 * The free guides at /resources/<guide> are delivered on the page, and the
 * address behind each download is stored here — see the `lead_signups` block in
 * SCHEMA_SQL for what each column is for and why the consent wording is kept
 * with the row.
 *
 * Nothing in this section sends email. There is no welcome message, no
 * confirmation and no list send: list email does not exist yet, and the pages
 * say so in as many words ("the guide is on this page"). When sending arrives it
 * will read these rows; it must also honour `unsubscribed_at`.
 */
export type LeadSignupRow = {
  id: number;
  email: string;
  guide: string;
  sourcePath: string;
  consentVersion: string;
  consentText: string;
  unsubscribeToken: string;
  createdAt: number;
  requestCount: number;
  lastRequestedAt: number;
  unsubscribedAt: number | null;
};

type LeadSignupDbRow = {
  id: number;
  email: string;
  guide: string;
  source_path: string;
  consent_version: string;
  consent_text: string;
  unsubscribe_token: string;
  created_at: number;
  request_count: number;
  last_requested_at: number;
  unsubscribed_at: number | null;
};

const toLeadSignup = (row: LeadSignupDbRow): LeadSignupRow => ({
  id: Number(row.id),
  email: String(row.email),
  guide: String(row.guide),
  sourcePath: String(row.source_path ?? ""),
  consentVersion: String(row.consent_version ?? ""),
  consentText: String(row.consent_text ?? ""),
  unsubscribeToken: String(row.unsubscribe_token),
  createdAt: Number(row.created_at),
  requestCount: Number(row.request_count),
  lastRequestedAt: Number(row.last_requested_at),
  unsubscribedAt:
    row.unsubscribed_at === null || row.unsubscribed_at === undefined
      ? null
      : Number(row.unsubscribed_at),
});

const selectLeadSignupByEmailAndGuide = async (
  tx: Db,
  email: string,
  guide: string,
): Promise<LeadSignupRow | null> => {
  const row = await tx
    .query<LeadSignupDbRow, [string, string]>(
      `SELECT * FROM lead_signups WHERE email = ? AND guide = ?`,
    )
    .get(email, guide);
  return row ? toLeadSignup(row) : null;
};

/**
 * Record one opt-in and hand back the row, including its unsubscribe token.
 *
 * The rule the whole thing rests on: **one row per address per guide.** A second
 * submit of the same address for the same guide is not a second person and does
 * not become a second row — the existing row's `request_count` goes up and
 * `last_requested_at` moves, and the token it already had is returned unchanged,
 * so every unsubscribe link ever handed out for that row keeps working. The
 * consent wording is re-stamped on the second submit, because that is the
 * wording the person was shown the second time.
 *
 * A fresh opt-in is fresh consent: if this address had unsubscribed, submitting
 * the form again clears `unsubscribed_at` on every row it holds — the person has
 * just asked, in so many words, for the guide and the notes. Nothing else can
 * clear that column.
 *
 * The insert can lose a race with an identical insert (two clicks, one address).
 * UNIQUE(email, guide) refuses the second, and the catch below runs the same
 * transaction again, which now finds the row the winner wrote. The caller never
 * sees an error for doing the right thing twice.
 */
export const recordLeadSignup = async (input: {
  email: string;
  guide: string;
  sourcePath: string;
  /** 'printable' or 'notes' — what the address was given for. */
  context?: string;
  consentVersion: string;
  consentText: string;
  /** A fresh token, used only if this address has no row for this guide yet. */
  token: string;
  nowMs: number;
}): Promise<{ signup: LeadSignupRow; created: boolean }> => {
  const write = async (): Promise<{ signup: LeadSignupRow; created: boolean }> =>
    await getDb().transaction(async (tx): Promise<{ signup: LeadSignupRow; created: boolean }> => {
      const existing = await selectLeadSignupByEmailAndGuide(tx, input.email, input.guide);
      if (existing) {
        await tx
          .query<unknown, [number, string, string, string, number]>(
            `UPDATE lead_signups
                SET request_count = request_count + 1,
                    last_requested_at = ?,
                    source_path = ?,
                    context = ?,
                    consent_version = ?,
                    consent_text = ?
              WHERE id = ?`,
          )
          .run(
            input.nowMs,
            input.sourcePath.slice(0, 200),
            (input.context ?? "notes").slice(0, 40),
            input.consentVersion,
            input.consentText,
            existing.id,
          );
        // Fresh consent restores the whole address, not just this guide: leaving
        // one row unsubscribed while another is subscribed would make the
        // unsubscribe link's meaning depend on which page they used.
        await tx
          .query<unknown, [string]>(
            `UPDATE lead_signups SET unsubscribed_at = NULL
              WHERE email = ? AND unsubscribed_at IS NOT NULL`,
          )
          .run(input.email);
        const updated = await selectLeadSignupByEmailAndGuide(tx, input.email, input.guide);
        return { signup: updated ?? existing, created: false };
      }
      const row = await tx
        .query<
          LeadSignupDbRow,
          [string, string, string, string, string, string, string, number, number]
        >(
          `INSERT INTO lead_signups
             (email, guide, source_path, context, consent_version, consent_text,
              unsubscribe_token, created_at, last_requested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING *`,
        )
        .get(
          input.email,
          input.guide,
          input.sourcePath.slice(0, 200),
          (input.context ?? "notes").slice(0, 40),
          input.consentVersion,
          input.consentText,
          input.token,
          input.nowMs,
          input.nowMs,
        );
      if (!row) throw new Error("lead signup: the row was not written");
      return { signup: toLeadSignup(row), created: true };
    });

  try {
    return await write();
  } catch (cause) {
    // The only expected failure is the UNIQUE(email, guide) race described
    // above. Anything else is rethrown untouched.
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!/UNIQUE|constraint/i.test(message)) throw cause;
    return await write();
  }
};

/** The row an unsubscribe token points at, or `null` when no such token exists. */
export const findLeadSignupByToken = async (token: string): Promise<LeadSignupRow | null> => {
  if (token === "") return null;
  const row = await getDb()
    .query<LeadSignupDbRow, [string]>(`SELECT * FROM lead_signups WHERE unsubscribe_token = ?`)
    .get(token);
  return row ? toLeadSignup(row) : null;
};

/**
 * Leave the list: set `unsubscribed_at` on every row this token's address holds.
 *
 * One click, one address, all of its guides — the consent line promises "you can
 * leave any time with one click", and a reader who opted in for two guides has
 * one inbox. Conditional on `unsubscribed_at IS NULL`, so the moment recorded is
 * the first time they asked, and a second click is harmless.
 *
 * The token is never deleted, so the link in an old message keeps working and
 * keeps meaning the same thing.
 */
export const unsubscribeLeadSignupByToken = async (
  token: string,
  nowMs: number,
): Promise<{ ok: boolean; alreadyUnsubscribed: boolean }> => {
  const row = await findLeadSignupByToken(token);
  if (!row) return { ok: false, alreadyUnsubscribed: false };
  const result = await getDb()
    .query<unknown, [number, string]>(
      `UPDATE lead_signups SET unsubscribed_at = ?
        WHERE email = ? AND unsubscribed_at IS NULL`,
    )
    .run(nowMs, row.email);
  return { ok: true, alreadyUnsubscribed: result.changes === 0 };
};

/** How many addresses have opted in, and how many have left. Used by tests. */
export const countLeadSignups = async (): Promise<{ total: number; subscribed: number }> => {
  const row = await getDb()
    .query<{ total: number; subscribed: number }, []>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN unsubscribed_at IS NULL THEN 1 ELSE 0 END), 0) AS subscribed
         FROM lead_signups`,
    )
    .get();
  return { total: Number(row?.total ?? 0), subscribed: Number(row?.subscribed ?? 0) };
};

/* ------------------------------------------------- paid guides: who may read */
/**
 * Whether this account has **ever** unlocked an event — the rule the five paid
 * guides are readable by, decided once here.
 *
 * "Ever", not "now": the owner's decision of 2026-10-23 was that an organizer
 * whose event later drops back to the free plan keeps guide access. So this asks
 * whether any conference this account owns has ever carried the unlock, and it
 * answers yes for a conference whose plan is 'unlocked' **or** whose
 * `unlocked_at` stamp is set. Nothing in the codebase clears `unlocked_at`, so a
 * refund that flips `plan` back to 'free' does not take the guides away from
 * someone who already paid for them.
 *
 * The example conference is excluded (`is_sample = 1`): it is unlocked so that
 * anyone can look through a filled-in event, and that is not a payment. Without
 * the exclusion, opening the example would hand out every paid guide.
 *
 * Owner only, deliberately: the account that unlocked the event is the account
 * that paid. A committee editor on someone else's paid event is not included,
 * because they are not the account that unlocked anything.
 */
export const hasEverUnlockedAnEvent = async (userId: number): Promise<boolean> => {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const row = await getDb()
    .query<{ n: number }, [number]>(
      `SELECT COUNT(*) AS n FROM conferences
        WHERE user_id = ? AND is_sample = 0
          AND (plan = 'unlocked' OR unlocked_at IS NOT NULL)`,
    )
    .get(userId);
  return Number(row?.n ?? 0) > 0;
};

/* --------------------------------------------------- the Page's Messenger inbox */

/**
 * One stored DM, as the reply path and any later screen read it.
 *
 * Times are milliseconds: `sentAt` is Meta's own `timestamp`, `receivedAt` ours.
 * `repliedAt` and `replyMid` are both null until Meta has accepted a reply.
 */
export type MessengerMessageRow = {
  id: number;
  mid: string;
  senderId: string;
  recipientId: string;
  sentAt: number;
  text: string;
  attachmentCount: number;
  receivedAt: number;
  repliedAt: number | null;
  replyMid: string | null;
  /**
   * The words we actually sent back, as they left. Empty when nobody has
   * answered, and empty on rows answered before this column existed.
   *
   * Why it is kept: the drafter reads the thread, and a reply is only half of a
   * thread. Without our own words in the row, every answer is written by
   * something that cannot see what it already told the person -- which is how
   * the Page once told a reader "I don't have visibility into your previous
   * inquiry". It is also the yardstick the repeat guard measures a new draft
   * against (see messenger-repeat.server.ts).
   */
  replyText: string;
  /** Who answered it: "auto" for the watcher, "human" for a person, "" for nobody yet. */
  repliedBy: string;
  /** True when the watcher stopped and left this one for a person. */
  needsHuman: boolean;
  /** Why it was left: `window_closed`, `ai_unavailable`, `loop_limit`, `repeat_draft`, ... */
  needsHumanReason: string;
};

type MessengerMessageDbRow = {
  id: number;
  mid: string;
  sender_id: string;
  recipient_id: string;
  sent_at: number;
  text: string;
  attachment_count: number;
  received_at: number;
  replied_at: number | null;
  reply_mid: string | null;
  reply_text: string | null;
  replied_by: string | null;
  needs_human: number | null;
  needs_human_reason: string | null;
};

const toMessengerMessage = (row: MessengerMessageDbRow): MessengerMessageRow => ({
  id: Number(row.id),
  mid: row.mid,
  senderId: row.sender_id,
  recipientId: row.recipient_id,
  sentAt: Number(row.sent_at),
  text: row.text,
  attachmentCount: Number(row.attachment_count),
  receivedAt: Number(row.received_at),
  repliedAt: row.replied_at === null || row.replied_at === undefined ? null : Number(row.replied_at),
  replyMid: row.reply_mid ?? null,
  replyText: row.reply_text ?? "",
  repliedBy: row.replied_by ?? "",
  needsHuman: Number(row.needs_human ?? 0) !== 0,
  needsHumanReason: row.needs_human_reason ?? "",
});

const MESSENGER_COLUMNS = `id, mid, sender_id, recipient_id, sent_at, text, attachment_count, received_at, replied_at, reply_mid, reply_text, replied_by, needs_human, needs_human_reason`;

/**
 * Store one incoming message, once.
 *
 * `INSERT OR IGNORE` on the UNIQUE `mid`: Meta redelivers anything it did not
 * see answered, so the same message arrives again as a matter of course. The
 * second insert changes no row and reports `inserted: false` — a caller answers
 * 200 and moves on. Nothing is ever overwritten: the first delivery is the one
 * that was actually observed.
 */
export const recordMessengerMessage = async (input: {
  mid: string;
  senderId: string;
  recipientId: string;
  sentAt: number;
  text: string;
  attachmentCount: number;
  receivedAt: number;
}): Promise<{ inserted: boolean; id: number }> => {
  const result = await getDb()
    .query<unknown, [string, string, string, number, string, number, number]>(
      `INSERT OR IGNORE INTO messenger_messages
         (mid, sender_id, recipient_id, sent_at, text, attachment_count, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.mid,
      input.senderId,
      input.recipientId,
      input.sentAt,
      input.text,
      input.attachmentCount,
      input.receivedAt,
    );
  return { inserted: Number(result.changes) > 0, id: Number(result.lastInsertRowid) };
};

/** One stored message by Meta's id, or null. */
export const getMessengerMessageByMid = async (mid: string): Promise<MessengerMessageRow | null> => {
  const row = await getDb()
    .query<MessengerMessageDbRow, [string]>(
      `SELECT ${MESSENGER_COLUMNS} FROM messenger_messages WHERE mid = ?`,
    )
    .get(mid);
  return row ? toMessengerMessage(row) : null;
};

/** The newest messages first — the inbox a person reads. */
export const listMessengerMessages = async (limit = 50): Promise<MessengerMessageRow[]> => {
  const take = Math.max(1, Math.min(200, Math.trunc(limit)));
  const rows = await getDb()
    .query<MessengerMessageDbRow, [number]>(
      `SELECT ${MESSENGER_COLUMNS} FROM messenger_messages
        ORDER BY received_at DESC, id DESC LIMIT ?`,
    )
    .all(take);
  return rows.map(toMessengerMessage);
};

/** How many DMs are stored in total, and how many are still unanswered. */
export const messengerMessageCounts = async (): Promise<{ total: number; unanswered: number }> => {
  const row = await getDb()
    .query<{ total: number; unanswered: number }, []>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN replied_at IS NULL THEN 1 ELSE 0 END) AS unanswered
         FROM messenger_messages`,
    )
    .get();
  return { total: Number(row?.total ?? 0), unanswered: Number(row?.unanswered ?? 0) };
};

/**
 * Write down that a reply was accepted by Meta.
 *
 * `replied_at IS NULL` in the WHERE is what stops a second reply being sent over
 * the first: the update only lands on a message that has not been answered, so
 * `false` means "somebody already answered this one" and the caller stops.
 */
export const markMessengerMessageReplied = async (input: {
  mid: string;
  replyMid: string;
  repliedAt: number;
  /** "auto" when the watcher sent it, "human" when a person did. */
  repliedBy?: string;
  /**
   * The words that were actually sent, kept on the row so the thread this
   * message belongs to is readable afterwards -- by the next draft, and by the
   * repeat guard. Optional so an old caller cannot fail to compile, but both
   * send paths pass it.
   */
  replyText?: string;
}): Promise<boolean> => {
  const result = await getDb()
    .query<unknown, [number, string, string, string, string]>(
      `UPDATE messenger_messages
          SET replied_at = ?, reply_mid = ?, replied_by = ?, reply_text = ?,
              reply_claimed_at = NULL, needs_human = 0, needs_human_reason = ''
        WHERE mid = ? AND replied_at IS NULL`,
    )
    .run(
      input.repliedAt,
      input.replyMid,
      (input.repliedBy ?? "human").slice(0, 16),
      (input.replyText ?? "").slice(0, 2000),
      input.mid,
    );
  return Number(result.changes) > 0;
};

/**
 * Whether this sender has ever been answered.
 *
 * The auto-reply branch asks this before answering again: one reply per person
 * per conversation is the polite limit, and it is the one guard that keeps a
 * burst of five messages from becoming five automated replies.
 */
/**
 * Remember the draft this server just handed to a person.
 *
 * Overwrites the previous draft for the same message: only the last one can be
 * the text somebody is about to send. Nothing here is a message and nothing is
 * sent — it is the yardstick `looksLikeAiDraft` measures a reply against when
 * the send arrives, and it is why the automated-assistant line is decided on the
 * server rather than in the browser.
 */
export const saveMessengerDraft = async (input: {
  mid: string;
  body: string;
  createdAt: number;
}): Promise<void> => {
  await getDb()
    .query<unknown, [string, string, number]>(
      `INSERT INTO messenger_drafts (mid, body, created_at) VALUES (?, ?, ?)
       ON CONFLICT(mid) DO UPDATE SET body = excluded.body, created_at = excluded.created_at`,
    )
    .run(input.mid, input.body, input.createdAt);
};

/** The last draft for this message, or null when nobody asked for one. */
export const getMessengerDraft = async (mid: string): Promise<string | null> => {
  const row = await getDb()
    .query<{ body: string }, [string]>(`SELECT body FROM messenger_drafts WHERE mid = ?`)
    .get(mid);
  return row?.body ?? null;
};

export const senderHasBeenAnswered = async (senderId: string): Promise<boolean> => {
  const row = await getDb()
    .query<{ n: number }, [string]>(
      `SELECT COUNT(*) AS n FROM messenger_messages
        WHERE sender_id = ? AND replied_at IS NOT NULL`,
    )
    .get(senderId);
  return Number(row?.n ?? 0) > 0;
};


/* ------------------------------------------------------- the answering settings */

/**
 * The `messenger_settings` key/value rows, as a plain map.
 *
 * Read at call time on every watcher run and every admin page load, so a change
 * made on `/admin/messenger` takes effect on the next tick — no deploy, no
 * restart, and nothing for the owner to paste.
 */
export const readMessengerSettings = async (): Promise<Record<string, string>> => {
  const rows = await getDb()
    .query<{ key: string; value: string }, []>(`SELECT key, value FROM messenger_settings`)
    .all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
};

/** Write one setting. `INSERT OR REPLACE`, so the second write is the value. */
export const writeMessengerSetting = async (key: string, value: string): Promise<void> => {
  await getDb()
    .query<unknown, [string, string, number]>(
      `INSERT OR REPLACE INTO messenger_settings (key, value, updated_at) VALUES (?, ?, ?)`,
    )
    .run(key, value, Date.now());
};

/** Write a setting only when it is not there yet — how the secret is minted once. */
export const writeMessengerSettingIfAbsent = async (key: string, value: string): Promise<boolean> => {
  const result = await getDb()
    .query<unknown, [string, string, number]>(
      `INSERT OR IGNORE INTO messenger_settings (key, value, updated_at) VALUES (?, ?, ?)`,
    )
    .run(key, value, Date.now());
  return Number(result.changes) > 0;
};

/* --------------------------------------------------------- the watcher's reads */

/**
 * The messages waiting for an answer, oldest first.
 *
 * Three conditions, and each is a rule rather than an optimisation:
 *   - `replied_at IS NULL` — answered is answered, once;
 *   - `sender_id != pageId` — the Page never answers itself, so an echo that
 *     slipped through cannot start a loop;
 *   - `received_at >= since` — older than Meta's 24-hour window is not something
 *     a reply can be sent to at all. The watcher flags those instead (see
 *     `flagMessengerNeedsHuman`), so they stop being looked at.
 */
export const listMessengerMessagesAwaitingReply = async (input: {
  pageId: string;
  since: number;
  limit?: number;
}): Promise<MessengerMessageRow[]> => {
  const take = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 10)));
  const rows = await getDb()
    .query<MessengerMessageDbRow, [string, number, number]>(
      `SELECT ${MESSENGER_COLUMNS} FROM messenger_messages
        WHERE replied_at IS NULL
          AND needs_human = 0
          AND sender_id != ?
          AND received_at >= ?
        ORDER BY received_at ASC, id ASC
        LIMIT ?`,
    )
    .all(input.pageId, input.since, take);
  return rows.map(toMessengerMessage);
};

/**
 * Take the claim on one row, or find out somebody else has it.
 *
 * This is what makes a second watcher run — a cron tick landing while the first
 * is still waiting on the model — a no-op instead of a second reply to the same
 * person. The claim is a conditional UPDATE, which libSQL applies atomically: one
 * caller sees `changes: 1`, every other sees 0. A claim older than `ttlMs` is
 * treated as abandoned, so a run that died mid-send cannot wedge a message
 * forever.
 */
export const claimMessengerMessageForReply = async (input: {
  mid: string;
  nowMs: number;
  ttlMs: number;
}): Promise<boolean> => {
  const result = await getDb()
    .query<unknown, [number, string, number]>(
      `UPDATE messenger_messages SET reply_claimed_at = ?
        WHERE mid = ? AND replied_at IS NULL AND needs_human = 0
          AND (reply_claimed_at IS NULL OR reply_claimed_at < ?)`,
    )
    .run(input.nowMs, input.mid, input.nowMs - input.ttlMs);
  return Number(result.changes) > 0;
};

/** Give the claim back — used when a send fails in a way worth retrying. */
export const releaseMessengerReplyClaim = async (mid: string): Promise<void> => {
  await getDb()
    .query<unknown, [string]>(
      `UPDATE messenger_messages SET reply_claimed_at = NULL WHERE mid = ? AND replied_at IS NULL`,
    )
    .run(mid);
};

/** Leave this one for a person, with the reason it was left. */
export const flagMessengerNeedsHuman = async (input: {
  mid: string;
  reason: string;
}): Promise<void> => {
  await getDb()
    .query<unknown, [string, string]>(
      `UPDATE messenger_messages
          SET needs_human = 1, needs_human_reason = ?, reply_claimed_at = NULL
        WHERE mid = ? AND replied_at IS NULL`,
    )
    .run(input.reason.slice(0, 200), input.mid);
};

/**
 * How many automated replies this conversation has had since a person last
 * answered in it.
 *
 * Counted from the rows themselves: the number of this sender's answered
 * messages whose `replied_by` is `auto` and which are newer than the newest
 * `human` reply. Three in a row with nobody reading is the point at which the
 * watcher stops and asks for a person (see `MAX_CONSECUTIVE_AUTO_REPLIES`).
 */
export const countConsecutiveAutoReplies = async (senderId: string): Promise<number> => {
  // A rolling hour, not "since the last human reply".
  //
  // The first version reset only when a person replied from our side, so a
  // prospect who wrote four times in a row — or the owner testing his own Page —
  // tripped the cap after three automated replies and every later message in
  // that thread was flagged and left unanswered. That is the opposite of what
  // the guard is for: it exists to stop a runaway, not to go quiet on someone
  // who is talking to us. A rolling window forgets, so a chatty thread is never
  // cut off, while a flood still hits the ceiling.
  const row = await getDb()
    .query<{ n: number | null }, [string, number]>(
      `SELECT COUNT(*) AS n FROM messenger_messages
        WHERE sender_id = ?
          AND replied_at IS NOT NULL
          AND replied_by = 'auto'
          AND replied_at > ?`,
    )
    .get(senderId, Date.now() - 60 * 60 * 1000);
  return Number(row?.n ?? 0);
};

/**
 * Flag every unanswered message that has fallen out of Meta's 24-hour window.
 *
 * One statement, and it is what stops the watcher retrying a send that cannot
 * succeed: Meta only accepts a `RESPONSE` inside the day the person's message
 * opened, so a message from yesterday evening is not "late", it is unanswerable.
 * The `needs_human = 0` guard makes the second run of this a no-op (0 changes),
 * which is what keeps an idle cron tick cheap.
 *
 * The lower bound is deliberate: anything older than a month is left as it is
 * rather than rewritten on every boot — it is history, not a task.
 */
export const flagStaleMessengerMessages = async (input: {
  pageId: string;
  before: number;
  after: number;
}): Promise<number> => {
  const result = await getDb()
    .query<unknown, [string, number, number]>(
      `UPDATE messenger_messages
          SET needs_human = 1, needs_human_reason = 'window_closed', reply_claimed_at = NULL
        WHERE replied_at IS NULL
          AND needs_human = 0
          AND sender_id != ?
          AND received_at < ?
          AND received_at >= ?`,
    )
    .run(input.pageId, input.before, input.after);
  return Number(result.changes);
};

/**
 * The recent thread with one person, oldest first.
 *
 * One row per message they sent, each carrying our reply to it when we have
 * one. That is the whole conversation as the database holds it: what they said,
 * what we said back, and when -- which is what the drafter is given so it can
 * answer as the person on the other end of an ongoing conversation instead of a
 * stranger reading one line.
 *
 * The newest `limit` inbound messages are taken, then reversed, so a long
 * history still puts the last few exchanges in front of the model rather than
 * the first few. Read-only: nothing here writes a row.
 */
export const listMessengerThread = async (input: {
  senderId: string;
  limit?: number;
}): Promise<MessengerMessageRow[]> => {
  const take = Math.max(1, Math.min(20, Math.trunc(input.limit ?? 6)));
  const rows = await getDb()
    .query<MessengerMessageDbRow, [string, number]>(
      `SELECT ${MESSENGER_COLUMNS} FROM messenger_messages
        WHERE sender_id = ?
        ORDER BY received_at DESC, id DESC LIMIT ?`,
    )
    .all(input.senderId, take);
  return rows.map(toMessengerMessage).reverse();
};

/**
 * The words we already sent in this thread, newest first.
 *
 * Only rows that were actually answered and whose wording was recorded, so the
 * repeat guard is comparing against things we know we said. A row answered
 * before `reply_text` existed contributes nothing rather than a guess.
 */
export const listSentRepliesInThread = async (input: {
  senderId: string;
  limit?: number;
}): Promise<string[]> => {
  const take = Math.max(1, Math.min(20, Math.trunc(input.limit ?? 6)));
  const rows = await getDb()
    .query<{ reply_text: string | null }, [string, number]>(
      `SELECT reply_text FROM messenger_messages
        WHERE sender_id = ? AND replied_at IS NOT NULL AND reply_text IS NOT NULL
          AND reply_text != ''
        ORDER BY replied_at DESC, id DESC LIMIT ?`,
    )
    .all(input.senderId, take);
  return rows.map((row) => (row.reply_text ?? "").trim()).filter((text) => text !== "");
};

/* ------------------------------------------------------- the watcher's health */

/**
 * The numbers the health panel and the dead-man's switch both read, in one query.
 *
 * Why one query: `/admin/messenger` is loaded by a person, and the alert check
 * runs every minute. Five separate counts would be five round trips to a remote
 * database for a screen that is only ever telling someone "fine" or "not fine".
 *
 * `unanswered` deliberately excludes rows already set aside for a person: those
 * are a decision, not a backlog. `waitingOver30` is the subset of the backlog
 * that has waited long enough to be an alert (see `MESSAGE_WAITING_ALERT_MS`).
 * The Page is excluded everywhere, so an echo can never look like a customer.
 */
export const messengerHealthCounts = async (input: {
  nowMs: number;
  unansweredMs: number;
  since: number;
  pageId: string;
}): Promise<{
  lastInboundAt: number;
  lastReplyAt: number;
  unanswered: number;
  waitingOver30: number;
  oldestUnansweredAt: number;
  windowClosed: number;
}> => {
  const row = await getDb()
    .query<
      {
        last_inbound_at: number | null;
        last_reply_at: number | null;
        unanswered: number | null;
        waiting_over: number | null;
        oldest_unanswered_at: number | null;
        window_closed: number | null;
      },
      [number, number, string]
    >(
      `SELECT
         MAX(CASE WHEN received_at >= ? THEN received_at END) AS last_inbound_at,
         MAX(replied_at) AS last_reply_at,
         SUM(CASE WHEN replied_at IS NULL AND needs_human = 0 THEN 1 ELSE 0 END) AS unanswered,
         SUM(CASE WHEN replied_at IS NULL AND needs_human = 0 AND received_at < ?
                  THEN 1 ELSE 0 END) AS waiting_over,
         MIN(CASE WHEN replied_at IS NULL AND needs_human = 0 THEN received_at END) AS oldest_unanswered_at,
         SUM(CASE WHEN replied_at IS NULL AND needs_human_reason = 'window_closed'
                  THEN 1 ELSE 0 END) AS window_closed
       FROM messenger_messages
        WHERE sender_id != ?`,
    )
    .get(input.since, input.nowMs - input.unansweredMs, input.pageId);
  /* An empty table gives NULLs, not zeros: SUM over no rows is NULL. */
  return {
    lastInboundAt: Number(row?.last_inbound_at ?? 0),
    lastReplyAt: Number(row?.last_reply_at ?? 0),
    unanswered: Number(row?.unanswered ?? 0),
    waitingOver30: Number(row?.waiting_over ?? 0),
    oldestUnansweredAt: Number(row?.oldest_unanswered_at ?? 0),
    windowClosed: Number(row?.window_closed ?? 0),
  };
};

/**
 * Rows a person has to deal with, for the alert email and for the panel.
 *
 * Two shapes, one function, because both callers want the same columns:
 *   - `reason: ""` — unanswered and *not* set aside, older than `olderThan`.
 *     This is the "somebody is waiting" list.
 *   - `reason: "window_closed"` — set aside with that reason. This is the
 *     "we can no longer answer this one" list.
 *
 * The WHERE clause is chosen here rather than by a parameter that switches
 * behaviour inside the SQL: a `? = ''` trick reads as clever and breaks the
 * moment somebody adds a parameter.
 */
export const messengerNeedsHumanRows = async (input: {
  reason: string;
  olderThan: number;
  since: number;
  pageId: string;
  limit?: number;
}): Promise<MessengerMessageRow[]> => {
  const take = String(Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20))));
  const where =
    input.reason === ""
      ? "replied_at IS NULL AND needs_human = 0 AND received_at < ?"
      : "replied_at IS NULL AND needs_human = 1 AND needs_human_reason = ?";
  const rows = await getDb()
    .query<MessengerMessageDbRow, [string, number, string | number]>(
      `SELECT ${MESSENGER_COLUMNS} FROM messenger_messages
        WHERE sender_id != ?
          AND received_at >= ?
          AND ${where}
        ORDER BY received_at ASC, id ASC
        LIMIT ${take}`,
    )
    .all(
      input.pageId,
      input.since,
      input.reason === "" ? input.olderThan : input.reason,
    );
  return rows.map(toMessengerMessage);
};

/**
 * Drop alert dedupe keys older than a cut-off.
 *
 * One key is written per incident so the owner is emailed once, not once a
 * minute. Without this the key/value table would keep every id it ever reported;
 * a month is long enough to recognise a repeat and short enough to stay small.
 */
export const pruneMessengerAlertKeys = async (before: number): Promise<void> => {
  await getDb()
    .query<unknown, [number]>(
      `DELETE FROM messenger_settings WHERE key LIKE 'alert:%' AND updated_at < ?`,
    )
    .run(before);
};

/** The last time this sender wrote to us, in milliseconds (0 when never). */
export const lastInboundFrom = async (senderId: string): Promise<number> => {
  const row = await getDb()
    .query<{ t: number | null }, [string]>(
      `SELECT MAX(received_at) AS t FROM messenger_messages WHERE sender_id = ?`,
    )
    .get(senderId);
  return Number(row?.t ?? 0);
};
