import budgetMarkdown from "~/content/lead-magnets/conference-budget-template.md?raw";
import committeeMarkdown from "~/content/lead-magnets/conference-committee-roles.md?raw";
import eventRefundMarkdown from "~/content/lead-magnets/event-refund-policy.md?raw";
import checklistMarkdown from "~/content/lead-magnets/vendor-contract-checklist.md?raw";
import timelineMarkdown from "~/content/lead-magnets/conference-day-timeline.md?raw";
import invitationMarkdown from "~/content/lead-magnets/speaker-invitation-letter.md?raw";
import contractMarkdown from "~/content/lead-magnets/speaker-contract-template.md?raw";
import visitMarkdown from "~/content/lead-magnets/venue-site-visit-checklist.md?raw";
import feesMarkdown from "~/content/lead-magnets/speaker-fees-and-honorariums.md?raw";
import planningMarkdown from "~/content/lead-magnets/conference-planning-checklist.md?raw";

/**
 * The guides: one record per guide, used by the pages, the index, the printable
 * sheet, the sitemap and the server.
 *
 * **Two kinds of guide, and the difference is a decision, not a style.** Of the
 * ten guides, **exactly two are free** — the conference budget template and
 * the conference day timeline — and the other eight are part of the $199 plan on
 * an event. That is the owner's line, and this table is where it is enforced.
 *
 *  - `access: "free"` — the whole guide is in the HTML of its page for anyone,
 *    signed in or not. This is the only organic traffic the site has: a search
 *    engine must be able to read it and a person with JavaScript off must too.
 *    Both free guides carry a `printableHeading`, and the *printable sheet* is
 *    a separate page that asks for an email address first — the reading is
 *    never gated, only the one-page sheet.
 *  - `access: "paid"` — the page shows a real opening section of the guide (a
 *    few hundred words, ending at a section boundary) and then says plainly
 *    that the rest is included with Convocate, at $199 flat per event. Signed
 *    in, on an account that has ever unlocked an event, the whole guide is on
 *    the same URL. A crawler still finds a real page with real text, which is
 *    the point of not redirecting anyone to /pricing. **A paid guide carries no
 *    email form**: asking for an address in exchange for something the visitor
 *    cannot have yet is a dark pattern, so the only form in this file's world
 *    is the printable form on the two free guides.
 *
 * The promises and meta descriptions below are the reader-facing copy. Nothing
 * in them may call a paid guide free, and none of them may promise that
 * anything is emailed: list email does not exist yet.
 *
 * The consent line in particular is stored in the database with each signup, so
 * a silent edit here would mean rows that claim a promise nobody was shown.
 * Bump a `*_VERSION` whenever its `*_TEXT` changes.
 *
 * Positioning: these guides are for any conference or event organizer. Nothing
 * in them may say the product is only for churches.
 */

export type LeadMagnetSlug =
  | "conference-budget-template"
  | "vendor-contract-checklist"
  | "conference-day-timeline"
  | "speaker-invitation-letter"
  | "speaker-contract-template"
  | "venue-site-visit-checklist"
  | "speaker-fees-and-honorariums"
  | "conference-planning-checklist"
  | "conference-committee-roles"
  | "event-refund-policy";

export type LeadMagnetAccess = "free" | "paid";

export type LeadMagnet = {
  /** The URL segment: `/resources/<slug>`. Also stored on every signup row. */
  slug: LeadMagnetSlug;
  /** The page's H1. */
  title: string;
  /** `<title>`. */
  metaTitle: string;
  /** Meta description. */
  metaDescription: string;
  /** The promise paragraph, under the H1. */
  promise: string;
  /** The link label used on `/resources`. */
  buttonLabel: string;
  /** Whether the whole guide is public, or the opening of it is. */
  access: LeadMagnetAccess;
  /**
   * Free guides only, and only where there is a sheet worth printing: the exact
   * `## heading` of the section that becomes the printable one-page sheet. Its
   * presence is what turns the email form into "Get the printable version"
   * rather than the planning-notes form.
   */
  printableHeading?: string;
  /** The one honest line under the printable form, on a free guide. */
  printableNote?: string;
  /**
   * The one honest line under the planning-notes form. **Not set on any paid
   * guide** — a paid page carries no form at all. The two free guides set it as
   * the promise the address buys (the printable opens now, plus the occasional
   * planning note); it only renders where a free guide has no printable sheet
   * to offer instead.
   */
  notesNote?: string;
  /** The guide body, as Markdown. */
  markdown: string;
};

/**
 * The consent line for the planning-notes form, identical wherever it appears
 * (the copy file is explicit that it must not vary — "a different promise in
 * each one is how consent gets murky"). The link markup is applied by the form,
 * so this is the plain text a reader is shown and the exact string stored
 * against their signup.
 */
export const CONSENT_TEXT_BODY =
  "No card. We'll also send you the occasional planning note by email — usually no more than once a month, and you can leave any time with one click. We never sell or share your address.";

/**
 * The whole line, as the reader sees it: the body plus the privacy link. The
 * form renders the body and then a real link, and this is the sentence that goes
 * into the database — one string, composed here, so the two can never drift.
 */
export const CONSENT_TEXT = `${CONSENT_TEXT_BODY} See our privacy page.`;

/**
 * Which wording a row consented to. Date + counter: the date the line shipped,
 * the counter for edits within that day. Stored on every row, so the record
 * says what was promised, not just that something was.
 */
export const CONSENT_VERSION = "lead-optin-2026-10-23.1";

/**
 * The line under the printable form on the two free guides.
 *
 * It says three things and nothing else: what the address is for, that the
 * sheet opens straight away, and that the address is not sold. It does not say
 * the sheet will be emailed, because nothing is emailed — there is no list send
 * in this build, and the person gets the sheet the second they submit.
 */
export const PRINTABLE_CONSENT_TEXT_BODY =
  "We use it for the occasional planning note by email — usually no more than once a month, and one click ends it. We never sell or share your address. The printable opens here as soon as you submit it; nothing is emailed to you.";

/** The line as the reader sees it, plus the privacy link. Stored with the row. */
export const PRINTABLE_CONSENT_TEXT = `${PRINTABLE_CONSENT_TEXT_BODY} See our privacy page.`;

/** The version stored against a row created by the printable form. */
export const PRINTABLE_CONSENT_VERSION = "printable-2026-10-23.1";

export const LEAD_MAGNETS: readonly LeadMagnet[] = [
  {
    slug: "conference-budget-template",
    title: "Conference budget template: every line a conference really has",
    metaTitle: "Conference budget template — Convocate",
    metaDescription:
      "A working budget for a 100 to 500 seat conference, line by line: what each line pays for, what organizers forget, and a percentage guide to check your numbers against.",
    promise:
      "A working budget for a 100 to 500 seat conference, line by line — what each line pays for, what organizers forget to put in it, and a percentage guide to check your own numbers against. It covers venue, catering, speaker fees and travel, music, AV, backline, printing, badges, marketing, staff, insurance and contingency. Free to read, and it works in a spreadsheet or on paper.",
    buttonLabel: "Read the budget template",
    access: "free",
    printableHeading: "The worksheet",
    printableNote:
      "Leave an address and the printable opens straight away — the worksheet on one sheet, a clean copy for a meeting or a folder, with no site around it.",
    notesNote:
      "The guide is above in full, free to read. Printing it asks for an email address: leave one here and the printable version opens straight away. That address also gets the occasional planning note — usually no more than once a month, nothing else, and one click ends it.",
    markdown: budgetMarkdown,
  },
  {
    slug: "vendor-contract-checklist",
    title: "What to confirm in writing before you sign a venue or speaker contract",
    metaTitle: "Venue and speaker contract checklist — Convocate",
    metaDescription:
      "The questions to get answered before you sign a venue or speaker contract: deposits, cancellation, seated capacity, load-in, AV and power, insurance, and who pays for what.",
    promise:
      "A checklist of the questions to get answered before you sign — deposit and cancellation terms, what \"seated capacity\" actually means, load-in and load-out windows, AV and power, insurance and liability, who pays for what, and what happens if the speaker cancels. It ends with the three clauses people most often regret, and an email you can copy and send to the venue today.",
    buttonLabel: "Read the contract checklist",
    access: "paid",
    markdown: checklistMarkdown,
  },
  {
    slug: "conference-day-timeline",
    title: "Conference day timeline: a run-of-show from a month out to the last chair",
    metaTitle: "Conference day timeline and run-of-show — Convocate",
    metaDescription:
      "What has to be done a month out, a week out and the day before, then an hour-by-hour day sheet with an owner named against every line, and five decisions to make in advance.",
    promise:
      "What has to be done a month out, a week out and the day before, then a printable hour-by-hour sheet for the day itself, with an owner named against every line. It includes the five decisions to make in advance, so nobody is making them in a corridor while two hundred people wait. Free to read, and it prints on one page per person.",
    buttonLabel: "Read the day timeline",
    access: "free",
    printableHeading: "The printable day-of sheet",
    printableNote:
      "Leave an address and the printable opens straight away — the day-of sheet on one page, one copy per owner, with room for the clock times and the names.",
    notesNote:
      "The timeline is above in full, free to read. Printing it asks for an email address: leave one here and the printable version opens straight away. That address also gets the occasional planning note — usually no more than once a month, nothing else, and one click ends it.",
    markdown: timelineMarkdown,
  },
  {
    slug: "speaker-invitation-letter",
    title: "Speaker invitation letter template",
    metaTitle: "Speaker invitation letter template — Convocate",
    metaDescription:
      "Three ready-to-send speaker invitation letters — keynote, workshop and breakout — with what to include, what to leave out, and what to settle before you send.",
    promise:
      "Three complete invitation letters — a keynote, a workshop leader and a breakout session — plus a fill-in-the-blank version, the six things every invitation has to say, what to leave out, and the four things to agree before the letter goes out: fee, travel, recording and cancellation. Included with Convocate, and it prints.",
    buttonLabel: "Read the invitation letters",
    access: "paid",
    markdown: invitationMarkdown,
  },
  {
    slug: "speaker-contract-template",
    title: "Speaker contract template",
    metaTitle: "Speaker contract template — Convocate",
    metaDescription:
      "A speaker contract template in full: every clause, every blank named, and a plain-English note on what each one protects. Included with Convocate, and it prints.",
    promise:
      "A complete speaker agreement you can fill in and sign today — eighteen clauses in the order they belong, every blank named, a plain-English note beside each clause explaining what goes wrong when it is missing, an index of every blank, and a section on what to change and what not to change. Included with Convocate, no download, and it prints.",
    buttonLabel: "Read the contract template",
    access: "paid",
    markdown: contractMarkdown,
  },
  {
    slug: "venue-site-visit-checklist",
    title: "Venue site visit checklist",
    metaTitle: "Venue site visit checklist — Convocate",
    metaDescription:
      "A venue site visit checklist to take with you: what to bring, what to measure, what the photos never show, the money questions, and a notes sheet to fill in.",
    promise:
      "A printable checklist for the hour you spend in the room: what to bring, what to measure with a tape, what to count, the photographs to take, the back-of-house route to walk, the money questions to ask while you are standing there, a section on the five things people forget, and a fill-in notes sheet that turns the visit into numbers you can compare. Included with Convocate, no download, and it prints.",
    buttonLabel: "Read the site visit checklist",
    access: "paid",
    markdown: visitMarkdown,
  },
  {
    slug: "speaker-fees-and-honorariums",
    title: "How much should I pay a guest speaker?",
    metaTitle: "How much should I pay a guest speaker? — Convocate",
    metaDescription:
      "How much should I pay a guest speaker? What actually drives the fee, what to ask their office, how travel is budgeted, and the questions to put to your accountant.",
    promise:
      "A guide to setting one speaker's fee: what actually drives the number, why published averages will not help you, the questions to ask a speaker or their office, how travel and lodging are budgeted separately, what an honorarium is and when it is the right word, the questions to put to your accountant about tax, and a one-page worksheet that turns all of it into a number you can defend. Included with Convocate, no download, and it prints.",
    buttonLabel: "Read the speaker fee guide",
    access: "paid",
    markdown: feesMarkdown,
  },
  {
    slug: "conference-planning-checklist",
    title: "Conference planning checklist: twelve months out to one month out",
    metaTitle: "Conference planning checklist — Convocate",
    metaDescription:
      "A twelve-month conference planning checklist in four phases, with a role named against every line, the five things that actually go wrong, and a one-page summary.",
    promise:
      "A twelve-month checklist in four phases, from twelve months out to one month out, with a role named against every line rather than a person — so the list survives a volunteer leaving. It covers the budget ceiling, the venue shortlist, the speaker ask, the contract terms, registration, the printed materials and the week-of confirmations, and it ends with the five things that actually go wrong and a one-page summary you can hand to somebody else. Included with Convocate, and it prints.",
    buttonLabel: "Read the planning checklist",
    access: "paid",
    markdown: planningMarkdown,
  },
  {
    slug: "conference-committee-roles",
    title: "Conference planning committee roles and responsibilities",
    metaTitle: "Conference planning committee roles and responsibilities — Convocate",
    metaDescription:
      "Who does what on a conference committee: the eight seats, what each one owns, the decisions each can make alone, and where the money and contracts sit.",
    promise:
      "The eight seats a conference committee actually has, what each one owns, and the decisions each one is allowed to make alone — plus where the money and the contracts sit, with one seat owning both and everyone else reading. It covers the spending limits worth agreeing in dollars, the decisions worth settling before you need them, what to do when the committee is three people, the first meeting that assigns the seats, and five failures a checklist cannot catch. Included with Convocate, no download, and it prints.",
    buttonLabel: "Read the committee roles guide",
    access: "paid",
    markdown: committeeMarkdown,
  },
  {
    slug: "event-refund-policy",
    title: "Event cancellation policy template",
    metaTitle: "Event cancellation policy template — Convocate",
    metaDescription:
      "What happens to an attendee's money if the event is cancelled or they cannot come: what you can actually pay back, the date ladder, and the wording to publish.",
    promise:
      "How to decide what happens to an attendee's money before someone asks: what you can actually pay back once the venue deposit is spent, the four things an attendee can be offered, a cancellation ladder you fill in with your own dates, the seven kinds of cancellation including your own, the venue clause that sets the ceiling, a full policy and a six-sentence version in plain words, the wording that starts arguments, and where the policy has to appear. Included with Convocate, no download, and it prints.",
    buttonLabel: "Read the event refund policy guide",
    access: "paid",
    markdown: eventRefundMarkdown,
  },
];

/** One guide by its URL segment, or `undefined` for anything else. */
export function leadMagnet(slug: string): LeadMagnet | undefined {
  return LEAD_MAGNETS.find((magnet) => magnet.slug === slug);
}

/**
 * The guide paths, as literal types rather than assembled strings: the router's
 * `<Link to>` is checked against the routes it knows about, and a `string` would
 * not type-check. One table, so a page, a card, a printable and the sitemap
 * cannot disagree.
 */
const LEAD_MAGNET_PATHS = {
  "conference-budget-template": "/resources/conference-budget-template",
  "vendor-contract-checklist": "/resources/vendor-contract-checklist",
  "conference-day-timeline": "/resources/conference-day-timeline",
  "speaker-invitation-letter": "/resources/speaker-invitation-letter",
  "speaker-contract-template": "/resources/speaker-contract-template",
  "venue-site-visit-checklist": "/resources/venue-site-visit-checklist",
  "speaker-fees-and-honorariums": "/resources/speaker-fees-and-honorariums",
  "conference-planning-checklist": "/resources/conference-planning-checklist",
  "conference-committee-roles": "/resources/conference-committee-roles",
  "event-refund-policy": "/resources/event-refund-policy",
} as const;

export type LeadMagnetPath = (typeof LEAD_MAGNET_PATHS)[LeadMagnetSlug];

/** `/resources/<slug>` — built in one place so a page and the sitemap agree. */
export function leadMagnetPath(slug: LeadMagnetSlug): LeadMagnetPath {
  return LEAD_MAGNET_PATHS[slug];
}

/** `/print/guide/<slug>` — the printable sheet, behind the email gate. */
export function printablePath(slug: LeadMagnetSlug): `/print/guide/${LeadMagnetSlug}` {
  return `/print/guide/${slug}`;
}

/* ------------------------------------------------------------------ SEO */
/**
 * The public origin, spelled once. A canonical link has to be absolute, and it
 * has to name the host people actually reach (the bare domain redirects here),
 * or a crawler is told the page's real home is somewhere else.
 */
export const SITE_ORIGIN = "https://www.getconvocate.com";
/**
 * The `<head>` of one guide page: its title, its meta description, its Open
 * Graph tags, and the canonical URL.
 *
 * The canonical matters because the same guide can be reached as
 * `/resources/<slug>`, as that path with a query string, and through the
 * `/resources` index, and every one of them must tell a search engine that this
 * page is the one to index. Both shapes are indexable pages with real text on
 * them: a free guide is the whole guide, and a paid guide's teaser is the page a
 * crawler gets. Either way the canonical points at the public URL, never at a
 * signed-in view of it.
 */
export function leadMagnetHead(magnet: LeadMagnet) {
  const url = `${SITE_ORIGIN}${leadMagnetPath(magnet.slug)}`;
  return {
    meta: [
      { title: magnet.metaTitle },
      { name: "description", content: magnet.metaDescription },
      { property: "og:title", content: magnet.title },
      { property: "og:description", content: magnet.metaDescription },
      { property: "og:type", content: "article" },
      { property: "og:url", content: url },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/* --------------------------------------------------------------- teaser */
const countWords = (text: string): number =>
  text.split(/\s+/).filter((word) => word !== "").length;

/**
 * The opening of a paid guide, for a reader who has not unlocked an event: the
 * introduction plus whole sections, stopping at a section boundary once it has
 * said enough to be worth reading.
 *
 * Two rules, both deliberate:
 *  - **Never split a paragraph or a table.** The cut is always the line before a
 *    `## ` heading, so the teaser ends where the author ended a section and
 *    never mid-sentence.
 *  - **At least `minWords`.** A teaser that stops after two lines is an advert.
 *    The first section is always included, even if the introduction alone
 *    already reaches the minimum, so the reader gets one real section of the
 *    guide rather than only its opening paragraph.
 *
 * The `#` title is dropped: the page already has an `<h1>`, exactly as
 * `renderMarkdown` drops it for a full guide.
 */
export function teaserMarkdown(markdown: string, minWords = 320): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const cutPoints: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^ {0,3}##\s+/.test(lines[index])) cutPoints.push(index);
  }
  // The body starts after the `#` title line, so the teaser never repeats it.
  const bodyStart = /^ {0,3}#\s+/.test(lines[0] ?? "") ? 1 : 0;
  if (cutPoints.length === 0) return lines.slice(bodyStart).join("\n");
  // Include the introduction and the first section whatever its length, then
  // keep adding sections while the teaser is still short.
  let cut = cutPoints.length > 1 ? cutPoints[1] : lines.length;
  for (let index = 1; index < cutPoints.length; index += 1) {
    const candidate = lines.slice(bodyStart, cutPoints[index]).join("\n");
    cut = cutPoints[index];
    if (countWords(candidate) >= minWords) break;
  }
  return lines.slice(bodyStart, cut).join("\n").trimEnd();
}

/**
 * One `## section` of a guide, as Markdown, for the printable sheet: from the
 * heading to the next `## ` heading. `undefined` when the guide has no section
 * by that name, which the server treats as "there is no printable here" rather
 * than printing an empty sheet.
 */
export function printableSection(markdown: string, heading: string): string | undefined {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return undefined;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {0,3}##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

/* --------------------------------------------------------------- email */

/**
 * Trim and lowercase an address. This is the only normalisation: the row that
 * is stored is the row that is looked up, so two spellings of one address can
 * never become two signups.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Why this is not a plausible email address, in words a reader can act on — or
 * `null` when it is plausible. Deliberately not a full RFC 5322 parser: it
 * rejects what is obviously not an address and accepts what obviously is, which
 * is all a signup form needs. The server runs the same function, so a browser
 * that skips it changes nothing.
 */
export function emailProblem(raw: string): string | null {
  const email = normaliseEmail(raw);
  if (email === "") return "Enter your email address.";
  if (email.length > 254) return "That address is too long.";
  if (/\s/.test(email)) return "An email address cannot contain spaces.";
  const parts = email.split("@");
  if (parts.length !== 2) return "Enter an email address like you@example.org.";
  const [local, domain] = parts;
  if (local === "" || domain === "") return "Enter an email address like you@example.org.";
  if (local.length > 64) return "The part before the @ is too long.";
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i.test(local)) {
    return "That address has a character we cannot accept before the @.";
  }
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return "That address has a misplaced dot before the @.";
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
    return "Enter an email address like you@example.org.";
  }
  if (domain.startsWith("-") || domain.includes("..") || /\.-/.test(domain)) {
    return "Enter an email address like you@example.org.";
  }
  const lastLabel = domain.split(".").pop() ?? "";
  if (lastLabel.length < 2) return "Enter an email address like you@example.org.";
  return null;
}
