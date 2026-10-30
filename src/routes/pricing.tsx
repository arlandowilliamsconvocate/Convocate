import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteHeader, SitePageActions } from "~/components/site-chrome";

/**
 * /pricing — the one price, what the free plan holds, and what the $199 opens.
 *
 * Public and static: no loader, no session, no database. The copy is the
 * approved text from the lead; do not add claims, prices or names to it.
 *
 * Layout (owner, 2026-10-24): the two tiers sit side by side from `md` up and
 * stack on a phone, because reading them one under the other buried the second
 * one. Each column is two parts that read as one unit: a price plate carrying
 * the tier name and the number, and a features box underneath that the plate
 * overlaps by a few pixels, so the plate breaks the box's top edge. The plate
 * is inset from the box, which is what makes the overlap read as a cap rather
 * than as two stacked cards.
 *
 * The intro prose stays in a narrow measure — a line past ~75 characters reads
 * worse, which is the opposite of what was asked for — while the tier row uses
 * the full width of the page frame. The paid column is the one the eye should
 * land on: brass (the site's gold) on the plate and the box, and a filled navy
 * button, where the free column has a plain border and a quiet button. Both
 * buttons sit at the foot of their column, so with the two columns stretched to
 * the same height they line up across the row.
 *
 * The four product screenshots live below the two columns rather than inside
 * the paid one. Four full-width shots made that column about 2,500px tall;
 * holding the columns to one height with them inside would have left a column
 * of empty white under the free plan. Below the row they also get the full
 * width, which keeps their text legible.
 *
 * The screenshots are real captures of the read-only example conference
 * ("Bridgeway Conference 2027", invented figures, labeled "Example · view
 * only" in the product). They are WebP files in `public/screenshots`, captured
 * from the live site at 1000–1100px and encoded at about 1x so the text stays
 * legible at the ~540px they are shown at here.
 */
export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Convocate" },
      {
        name: "description",
        content:
          "Convocate costs $199 per conference, paid once — no subscription, no per-seat charge, nothing renews. The free plan lets you run one conference on your own with one budget line.",
      },
    ],
  }),
  component: Pricing,
});

const bulletList = "mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-ink-soft";
const eyebrow = "text-xs font-semibold uppercase tracking-[0.18em]";

/** A column's closing button: filled on the paid column, quiet on the free one. */
const filledAction =
  "inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const quietAction =
  "inline-flex items-center justify-center rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-medium text-ink shadow-sm hover:bg-paper-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * One tier: a price plate over a features box, the plate overlapping the box by
 * `-mt-6` and raised above it so the plate's bottom edge sits on top of the
 * box's top edge. `accent` is the paid column — brass border and eyebrow.
 */
function Tier({
  id,
  label,
  name,
  price,
  priceNote,
  accent = false,
  children,
}: {
  id: string;
  label: string;
  name: string;
  price: string;
  priceNote: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <div
        className={`relative z-10 mx-3 rounded-xl border bg-white px-6 py-5 text-center shadow-sm sm:mx-6 ${
          accent ? "border-brass/60 ring-1 ring-brass/25" : "border-line"
        }`}
      >
        <p className={`${eyebrow} ${accent ? "text-brass" : "text-ink-soft"}`}>{label}</p>
        <h2 id={id} className="mt-2 text-2xl text-ink">
          {name}
        </h2>
        <p className="mt-1 font-serif text-4xl leading-none text-ink">{price}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{priceNote}</p>
      </div>

      <div
        className={`-mt-6 flex flex-1 flex-col rounded-xl border bg-white px-6 pb-6 pt-12 shadow-sm sm:px-7 sm:pb-7 ${
          accent ? "border-brass/50 ring-1 ring-brass/20" : "border-line"
        }`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * A product screenshot: the image, a factual caption, and alt text that says
 * what is actually on screen. Width and height are the file's own pixel size,
 * so the browser reserves the space before the image loads and the page does
 * not jump.
 */
function Shot({
  src,
  alt,
  caption,
  width,
  height,
}: {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
}) {
  return (
    <figure className="mt-4">
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full rounded-xl border border-line bg-white shadow-sm"
      />
      <figcaption className="mt-2 text-xs leading-relaxed text-ink-soft">{caption}</figcaption>
    </figure>
  );
}

function Pricing() {
  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-16 pt-14 sm:pt-20">
        {/* The prose keeps a readable measure; only the tier row goes wide. */}
        <div className="max-w-3xl">
          <h1 className="text-4xl leading-[1.1] text-ink sm:text-5xl">One conference, one payment</h1>

          <p className="mt-5 text-lg leading-relaxed text-ink-soft">
            Convocate costs $199 per conference, paid once. No subscription, no per-seat charge,
            nothing renews. Every option opens on that conference when you pay.
          </p>
        </div>

        {/* Free first in the source, then the $199 plan: the same order the eye reads. */}
        <div className="mt-10 grid items-stretch gap-10 md:grid-cols-2 md:gap-6">
          <Tier
            id="free-plan"
            label="Start here"
            name="Free plan"
            price="$0"
            priceNote="One conference, and you work on it alone."
          >
            <ul className={bulletList}>
              <li>
                the conference itself: name, dates, venue, expected attendance and budget target
              </li>
              <li>
                one budget line against that target, with planned and committed amounts, so you can
                see the arithmetic work on your own numbers
              </li>
              <li>the read-only example conference, to look around before you start</li>
            </ul>
            <Shot
              src="/screenshots/free-plan-conference.webp"
              width={1077}
              height={397}
              alt="A conference card from the Convocate app: Bridgeway Conference 2027, Mar 12, 2027 – Mar 14, 2027 at Riverside Conference Center, with a target of $75,000, $80,300 planned, over by $5,300, a count of guests and suppliers, and a badge reading Example · view only."
              caption="What the free plan gives you: the conference itself — its name, dates, venue and budget target. The card shown is the read-only example conference; its figures are invented, which is why it is marked “Example · view only”."
            />
            <div className="mt-auto pt-6">
              <p className="text-sm leading-relaxed text-ink-soft">
                Not included on the free plan: more than one budget line, contracts, committee
                invitations, printing a contract or the whole board, attached documents, invitation
                letters and generated agreements.
              </p>
              <Link to="/signup" search={{ redirect: undefined }} className={`mt-5 ${quietAction}`}>
                Create a free account
              </Link>
            </div>
          </Tier>

          <Tier
            id="paid-plan"
            label="The full plan"
            name="The $199 unlock"
            price="$199"
            priceNote="One payment, that conference — nothing renews."
            accent
          >
            <p className="text-base leading-relaxed text-ink-soft">
              Everything on that conference, with nothing held back:
            </p>
            <ul className={bulletList}>
              <li>
                unlimited budget lines, by category, with planned versus committed, rollups and the
                over-budget flag
              </li>
              <li>
                unlimited contracts across speakers, musicians, singers, bands, backline and
                equipment suppliers, and the venue, with pipeline stage and contract state
              </li>
              <li>printing a contract and printing the whole board</li>
              <li>
                attached signed contracts and scans (PDF, PNG, JPG — up to 10 MB per file, 100 MB
                per conference)
              </li>
              <li>
                invitation letters generated from what you have entered, editable before you print
              </li>
              <li>
                draft agreements per guest, supplier or venue, with optional clauses and your own
                free text
              </li>
              <li>committee invitations as Editor or Viewer, revocable at any time</li>
            </ul>
            <div className="mt-auto pt-6">
              <Link to="/signup" search={{ redirect: undefined }} className={filledAction}>
                Create an account to unlock
              </Link>
            </div>
          </Tier>
        </div>

        {/* What the four shots used to show inline inside the paid column. */}
        <section aria-labelledby="inside-the-plan" className="mt-16 max-w-5xl">
          <h2 id="inside-the-plan" className="text-2xl text-ink">
            What the $199 plan looks like inside
          </h2>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-ink-soft">
            Captured from the read-only example conference — invented figures, marked “Example ·
            view only” in the product.
          </p>
          <div className="mt-6 grid gap-8 md:grid-cols-2">
            <Shot
              src="/screenshots/budget.webp"
              width={1085}
              height={984}
              alt="The Budget section of the example conference: four summary figures — budget target $75,000, total planned $80,300, total committed $37,100, and over budget by $5,300 with the note “Planned lines exceed the target” — then a table of eight budget lines with category, planned and committed amounts, and a roll-up by category."
              caption="Unlimited budget lines by category, planned against committed, the roll-up by category and the over-budget flag — here $5,300 over a $75,000 target."
            />
            <Shot
              src="/screenshots/contracts.webp"
              width={1085}
              height={1052}
              alt="The contracts board of the example conference: counts of invites, negotiating, contracted and booked entries, a total for all entries and a separate total for signed contracts only, then pipeline columns listing each guest, supplier and venue with its fee and its contract state, such as signed or not sent."
              caption="One board for every guest, supplier and venue, with the pipeline stage and whether the contract itself is signed."
            />
            <Shot
              src="/screenshots/invitation-letter.webp"
              width={820}
              height={470}
              alt="An invitation letter for a guest speaker: headed with the conference name, dates and venue, addressed to Rev. Dr. Anne Mbeki, naming the part they are invited to take and stating a fee of $4,000, an honorarium of $1,500 and $900 set aside for travel, with a total for the part of $6,400."
              caption="An invitation letter built from what is on the contract — dates, venue, the part they take, and the fee, honorarium and travel amounts exactly as entered — editable before printing."
            />
            <Shot
              src="/screenshots/agreement.webp"
              width={820}
              height={1159}
              alt="The first page of a generated draft agreement: the parties, with Rev. Dr. Anne Mbeki as the speaker and the organizer left blank to complete by hand; the scope of services; the schedule with blank times; and the fee itemized as fee $4,000, honorarium $1,500, travel $900, equipment $0 and total $6,400."
              caption="The first page of a draft agreement per guest, supplier or venue: the parties, the scope, the schedule and the fee itemized exactly as the contract states it, with blanks to complete by hand."
            />
          </div>
        </section>

        <SitePageActions
          primary={{ label: "Create an account", to: "/signup" }}
          secondary={{ label: "See what the product does", to: "/about" }}
        />
      </main>
    </div>
  );
}
