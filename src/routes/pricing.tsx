import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SitePageActions } from "~/components/site-chrome";
import {
  EYEBROW,
  FRAME,
  PageHead,
  PublicPage,
  SectionHead,
  actionPrimary,
  actionSecondary,
} from "~/components/public-page";

/**
 * /pricing — the one price, what the free plan holds, and what the $199 opens.
 *
 * Public and static: no loader, no session, no database. The copy is the
 * approved text from the lead; do not add claims, prices or names to it.
 *
 * The layout is the landing page's: a centred page opening on cream, the two
 * plans side by side inside the same 78rem frame and separated by a hairline
 * rather than by two coloured boxes, then the product screenshots on a
 * deep-cream band, then the closing actions. Nothing here is a card: every
 * boundary is a 1px taupe rule, and there is no filled button on the page —
 * both plan actions are thin outlined rules, as on the landing page.
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

/** A hairline-separated list: no bullets, no box, one rule per row. */
const hairlineList = "border-t border-taupe/70";
const hairlineItem = "border-b border-taupe/70 py-3.5 text-[15.5px] leading-[1.7] text-charcoal-soft";

/**
 * One plan. The eyebrow is the tier label, then the number in Fraunces, then
 * the plan's name as the `h2`, then a hairline and the detail. `accent` is the
 * paid column, which carries the terracotta label and the vertical rule that
 * divides the two plans.
 */
function Tier({
  id,
  label,
  name,
  price,
  priceNote,
  accent = false,
  className = "",
  children,
}: {
  id: string;
  label: string;
  name: string;
  price: string;
  priceNote: string;
  accent?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={`flex flex-col ${className}`}>
      <p className={accent ? EYEBROW : `${EYEBROW} text-charcoal-soft`}>{label}</p>
      <p className="font-display mt-4 text-[clamp(2.75rem,5vw,3.75rem)] font-normal leading-none tracking-[-0.02em] text-charcoal">
        {price}
      </p>
      <h2
        id={id}
        className="font-display mt-5 text-balance text-[1.5rem] font-normal leading-snug text-charcoal"
      >
        {name}
      </h2>
      <p className="mt-3 text-[15.5px] leading-[1.7] text-charcoal-soft">{priceNote}</p>
      <div className="mt-8 flex flex-1 flex-col border-t border-taupe/80 pt-8">{children}</div>
    </section>
  );
}

/**
 * A product screenshot: the image inside a hairline, a factual caption, and alt
 * text that says what is actually on screen. Width and height are the file's
 * own pixel size, so the browser reserves the space before the image loads and
 * the page does not jump.
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
    <figure>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full border border-taupe/80 bg-cream"
      />
      <figcaption className="mt-3 border-t border-taupe/60 pt-3 text-[13px] leading-relaxed text-charcoal-soft">
        {caption}
      </figcaption>
    </figure>
  );
}

function Pricing() {
  return (
    <PublicPage>
      <PageHead
        eyebrow="Pricing"
        title="One conference, one payment"
        lede={
          <>
            Convocate costs $199 per conference, paid once. No subscription, no per-seat charge,
            nothing renews. Every option opens on that conference when you pay.
          </>
        }
      />

      {/* Free first in the source, then the $199 plan: the same order the eye reads. */}
      <div className={FRAME}>
        <div className="grid items-stretch gap-16 md:grid-cols-2 md:gap-0">
          <Tier
            id="free-plan"
            label="Start here"
            name="Free plan"
            price="$0"
            priceNote="One conference, and you work on it alone."
            className="md:pr-12 lg:pr-16"
          >
            <ul className={hairlineList}>
              <li className={hairlineItem}>
                the conference itself: name, dates, venue, expected attendance and budget target
              </li>
              <li className={hairlineItem}>
                one budget line against that target, with planned and committed amounts, so you can
                see the arithmetic work on your own numbers
              </li>
              <li className={hairlineItem}>
                the read-only example conference, to look around before you start
              </li>
            </ul>
            <div className="mt-10">
              <Shot
                src="/screenshots/free-plan-conference.webp"
                width={1077}
                height={397}
                alt="A conference card from the Convocate app: Bridgeway Conference 2027, Mar 12, 2027 – Mar 14, 2027 at Riverside Conference Center, with a target of $75,000, $80,300 planned, over by $5,300, a count of guests and suppliers, and a badge reading Example · view only."
                caption="What the free plan gives you: the conference itself — its name, dates, venue and budget target. The card shown is the read-only example conference; its figures are invented, which is why it is marked “Example · view only”."
              />
            </div>
            <div className="mt-auto pt-10">
              <p className="text-[15px] leading-[1.7] text-charcoal-soft">
                Not included on the free plan: more than one budget line, contracts, committee
                invitations, printing a contract or the whole board, attached documents, invitation
                letters and generated agreements.
              </p>
              <Link to="/signup" search={{ redirect: undefined }} className={`${actionSecondary} mt-7`}>
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
            className="md:border-l md:border-taupe/80 md:pl-12 lg:pl-16"
          >
            <p className="text-[15.5px] leading-[1.7] text-charcoal-soft">
              Everything on that conference, with nothing held back:
            </p>
            <ul className={`${hairlineList} mt-6`}>
              <li className={hairlineItem}>
                unlimited budget lines, by category, with planned versus committed, rollups and the
                over-budget flag
              </li>
              <li className={hairlineItem}>
                unlimited contracts across speakers, musicians, singers, bands, backline and
                equipment suppliers, and the venue, with pipeline stage and contract state
              </li>
              <li className={hairlineItem}>printing a contract and printing the whole board</li>
              <li className={hairlineItem}>
                attached signed contracts and scans (PDF, PNG, JPG — up to 10 MB per file, 100 MB
                per conference)
              </li>
              <li className={hairlineItem}>
                invitation letters generated from what you have entered, editable before you print
              </li>
              <li className={hairlineItem}>
                draft agreements per guest, supplier or venue, with optional clauses and your own
                free text
              </li>
              <li className={hairlineItem}>committee invitations as Editor or Viewer, revocable at any time</li>
            </ul>
            <div className="mt-auto pt-10">
              <p className="border-t border-taupe/70 pt-6 text-[15px] leading-[1.7] text-charcoal-soft">
                Registration fees and donations are paid into your own Stripe account. Convocate
                takes nothing from them.
              </p>
              <Link to="/signup" search={{ redirect: undefined }} className={`${actionPrimary} mt-7`}>
                Create an account to unlock
              </Link>
            </div>
          </Tier>
        </div>

        {/* The refund rule, exactly as the landing page and the Terms state it. */}
        <p className="mx-auto mt-16 max-w-[62ch] border-t border-taupe/80 pt-8 text-center text-[15.5px] leading-[1.8] text-charcoal-soft">
          If it is not right for you, say so within 48 hours of paying and the whole amount comes
          back — no questions, and the conference stays, back on the free plan with its data in
          place.
        </p>
      </div>

      <section
        aria-labelledby="inside-the-plan"
        className="mt-20 border-y border-taupe/70 bg-cream-deep px-6 py-20 md:mt-24 md:py-24 lg:px-10"
      >
        <div className="mx-auto max-w-[78rem]">
          <SectionHead
            id="inside-the-plan"
            title="What the $199 plan looks like inside"
            lede="Captured from the read-only example conference — invented figures, marked “Example · view only” in the product."
            measure="56ch"
          />
          <div className="mt-14 grid gap-12 md:mt-16 md:grid-cols-2 md:gap-x-12 md:gap-y-14">
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
        </div>
      </section>

      <div className={`${FRAME} pb-24`}>
        <div className="mx-auto max-w-[78rem]">
          <SitePageActions
            primary={{ label: "Create an account", to: "/signup" }}
            secondary={{ label: "See what the product does", to: "/about" }}
          />
        </div>
      </div>
    </PublicPage>
  );
}
