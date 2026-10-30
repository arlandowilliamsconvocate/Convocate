/**
 * What the help assistant is allowed to know.
 *
 * These are the only facts it answers from, so every line is checked against the
 * product as it is built today. Nothing here describes a feature that does not
 * exist, a price that is not charged, or a capability we do not have (no reading
 * of an organizer's event data, no taking money at registration).
 *
 * Keep entries short — two to four sentences. The whole file is sent with every
 * question, so it is also the prompt's size limit on a small quota.
 */

export type HelpDoc = { title: string; body: string };

export const HELP_DOCS: HelpDoc[] = [
  {
    title: "What the $199 unlock includes",
    body: "A conference costs a flat $199, once, per event — no subscription and no per-seat charge. That one payment opens unlimited budget lines, unlimited contracts, committee invites, exports, attached contract documents, printed contracts, invitation letters, generated agreements, electronic signing of those agreements, the pre- and post-conference checklists, and event registration with its public page, ticket types and attendee list.",
  },
  {
    title: "What the free plan includes",
    body: "The free plan is one event, for the account owner alone, with one budget line and nothing else. It has no committee invites, no contracts, no exports, no attached documents and no registration. The single budget line is there so you can see the arithmetic work on one of your own numbers before deciding to pay.",
  },
  {
    title: "Budget lines and categories",
    body: "The budget is a list of lines; each line has a description, a category, and a planned amount. Categories are venue, speaker fees, music, equipment and backline, travel, hospitality, production, and other. The budget shows what you planned against your target, and the conference list shows whether you are over or unallocated.",
  },
  {
    title: "The contracts board",
    body: "Every guest and supplier sits on one board with four stages: Invited, then Negotiating, then Contracted, then Booked. You add a contract with the name, the kind of guest or supplier, and the fees, then move it along as the conversation goes. The board totals what is contracted so far.",
  },
  {
    title: "Attaching a contract document",
    body: "A contract can carry the documents behind it — the signed PDF, a scan, a photo of a signed page. Accepted types are PDF, PNG and JPG, up to 10 MB per file and 100 MB per event. Anything else is refused on the server, not just in the browser.",
  },
  {
    title: "The generated agreement",
    body: "Convocate can generate an agreement for a contract from your organizer details, the guest's details and the terms you fill in, and you can print it or attach it to the contract. It is a draft to review and adapt, not legal advice, and the document says so on its face. Fill in the jurisdiction, tax and policy lines yourself — they are deliberately left blank.",
  },
  {
    title: "The signing link",
    body: "You create a private signing link for a contract and send it to the guest yourself — Convocate does not email it for you. There is one live link per contract: making a new one revokes the old one. The guest types their name, ticks the box, may draw a signature, and the record keeps their name, the drawing, the time and their IP address. It is not a notarized or qualified electronic signature, and the page tells the guest that plainly.",
  },
  {
    title: "The pre- and post-conference checklists",
    body: "Each event has a checklist with 9 items before the conference and 7 after it. Ticking an item records who ticked it and when; you can rename, reorder, remove or add your own items. A committee Viewer can read every item and change none of them.",
  },
  {
    title: "Committee roles",
    body: "An owner can invite people to a conference as Editor or Viewer. An Editor can change the event, its budget and its contracts; a Viewer can read the event but cannot change anything, and is never shown any amount of money anywhere in Convocate — not on the board, the budget, or a printed sheet.",
  },
  {
    title: "Event registration",
    body: "Registration gives the event a public page with its own link, ticket types, and an attendee list the organizer can see. It does not take money yet: no card is charged to an attendee, and the organizer marks a fee as paid by hand once they have collected it. Registration is part of the $199 unlock, not the free plan.",
  },
  {
    title: "Your organization logo",
    body: "You can upload your organization's logo on the \"Your details\" page; PNG and JPEG are accepted and SVG is refused, with a 1 MB cap. The logo prints on the documents Convocate generates — contracts, agreements and invitation letters — so they carry your branding rather than ours.",
  },
  {
    title: "The 48-hour refund",
    body: "Any payment can be refunded in full, with no questions asked, within 48 hours of the card being charged. The event goes back to the free plan and keeps its data. Requests after 48 hours are handled case by case.",
  },
  {
    title: "The guides at /resources",
    body: "Two guides are free to read: the conference budget template and the conference day timeline, each in full on its own page. Printing either one asks for an email address, which is also how you join the planning-notes list. The other guides — the vendor contract checklist, the invitation letters, the speaker contract template, the venue site visit checklist, the speaker-fee guide and the conference planning checklist — are part of the $199 plan on an event.",
  },
  {
    title: "Where to get help from a person",
    body: "The assistant cannot see or change an account, and cannot take a payment, issue a refund or reset a password. For anything like that, or anything this assistant does not know, email hello@mail.getconvocate.com.",
  },
];

/** The topics as plain text for the prompt — one numbered block per entry. */
export const helpDocsAsText = (): string =>
  HELP_DOCS.map((doc, index) => `${index + 1}. ${doc.title}\n${doc.body}`).join("\n\n");
