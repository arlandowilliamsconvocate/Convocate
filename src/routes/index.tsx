import { Link, createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/site-chrome";
import { getSessionUser } from "~/server/api";

export const Route = createFileRoute("/")({
  loader: async () => ({ user: await getSessionUser() }),
  component: Landing,
});

const pillars = [
  {
    title: "A budget that adds up",
    body: "Line items by venue, speaker fees, music, equipment, travel, hospitality and production — with planned versus committed totals and the unallocated balance always in view.",
  },
  {
    title: "One contracts board",
    body: "Invited, negotiating, contracted, booked. Speakers, musicians, singers, backline suppliers and the venue itself, each with their fee, travel and rental costs and whether the contract is signed.",
  },
  {
    title: "One shared record",
    body: "Retreat centers, hotels, guest speakers and the finance committee read from the same numbers instead of four versions of a spreadsheet.",
  },
];

const steps = [
  {
    label: "Step 1",
    title: "Set the frame",
    body: "Name, dates, venue, expected attendance and the budget you have to hit.",
  },
  {
    label: "Step 2",
    title: "Build the budget",
    body: "Planned and committed line items, rolled up by category, against the target.",
  },
  {
    label: "Step 3",
    title: "Work the contracts",
    body: "Move every guest, supplier and the venue from invited to booked as the paperwork progresses.",
  },
  {
    label: "Step 4",
    title: "Report with confidence",
    body: "Give the board live totals instead of last week's spreadsheet.",
  },
];

const eyebrow = "text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft";

/**
 * One step in "How a conference moves through Convocate", drawn in the same
 * plate-over-box style as the /pricing tiers: a centred plate carrying the step
 * number and title, overlapping a box underneath that holds the description.
 */
function Step({ id, label, title, body }: { id: string; label: string; title: string; body: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <div className="relative z-10 mx-3 rounded-xl border border-line bg-white px-4 py-4 text-center shadow-sm sm:mx-4">
        <p className={eyebrow}>{label}</p>
        <h3 id={id} className="mt-2 text-lg leading-snug text-ink">
          {title}
        </h3>
      </div>
      <div className="-mt-6 flex flex-1 flex-col rounded-xl border border-line bg-white px-4 pb-6 pt-10 shadow-sm">
        <p className="text-sm leading-relaxed text-ink-soft">{body}</p>
      </div>
    </section>
  );
}

function Landing() {
  const { user } = Route.useLoaderData();
  return (
    <div className="min-h-screen bg-paper">
      {/* The public header — About, Pricing, Sign in, Create account — is shared
          with /about, /pricing, /signin and /signup (src/components/site-chrome.tsx). */}
      <SiteHeader signedIn={Boolean(user)} />

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-16 sm:pt-24">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brass">
            For conference and event directors
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.1] text-ink sm:text-5xl">
            Run the whole conference from one page — not from six spreadsheets and a
            group chat.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft">
            Convocate is a planning workspace for conferences and events. Build and track the
            budget, keep the venue rental and every guest, music and equipment contract moving, and
            see at a glance what is committed, what is still open, and who has actually
            signed.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to={user ? "/app" : "/signup"}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand/90"
            >
              {user ? "Open your workspace" : "Start planning — it's free"}
            </Link>
            {!user && (
              <Link
                to="/signin"
                className="rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-medium text-ink shadow-sm hover:bg-paper-deep"
              >
                I already have an account
              </Link>
            )}
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            Create a conference in under a minute. No credit card, no setup call.
          </p>

          {/* The nearest thing to a demo, and the one click that asks for nothing:
              a whole worked conference, invented figures, read-only. It sits in
              the hero rather than buried in the page because a director deciding
              whether to sign up wants to see the arithmetic, not a description
              of it. */}
          <div className="mt-6 max-w-2xl rounded-xl border border-line bg-white px-4 py-3.5 shadow-sm">
            <p className="text-sm text-ink">
              <Link to="/example" className="font-semibold text-brand underline">
                See a worked example
              </Link>{" "}
              — a 260-person conference with its budget, contracts and registration filled in. Every
              figure is invented. No account, no sign-up.
            </p>
          </div>
        </section>

        {/* The 60-second walkthrough. Captions are burned into the picture and a
            subtitle track is attached, so it reads with the sound off. preload="none"
            keeps the home page light — the poster carries the first frame until play. */}
        <section className="mx-auto max-w-4xl px-6 pb-16">
          <div className="overflow-hidden rounded-xl border border-line bg-black shadow-sm">
            <video
              className="block w-full"
              controls
              playsInline
              preload="none"
              poster="/promo/poster.png"
              width={1280}
              height={720}
            >
              <source src="/promo/convocate-60s-720.mp4" type="video/mp4" />
              <track
                kind="captions"
                src="/promo/convocate-60s.srt"
                srcLang="en"
                label="English"
                default
              />
              Your browser cannot play this video.{" "}
              <a href="/promo/convocate-60s.mp4">Download it instead</a>.
            </video>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            Sixty seconds through the product. Sound off is fine — the captions are on screen.
          </p>
        </section>

        <section className="border-y border-line/70 bg-white">
          <div className="mx-auto grid max-w-6xl gap-8 px-6 py-14 sm:grid-cols-3">
            {pillars.map((pillar, index) => (
              <div key={pillar.title}>
                <span className="font-serif text-sm text-brass">0{index + 1}</span>
                <h2 className="mt-2 text-lg text-ink">{pillar.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{pillar.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl text-ink">How a conference moves through Convocate</h2>
          <div className="mt-6 grid items-stretch gap-6 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <Step
                key={step.title}
                id={`step-${index + 1}`}
                label={step.label}
                title={step.title}
                body={step.body}
              />
            ))}
          </div>
        </section>
      </main>

      {/* The footer is shared, mounted once in src/routes/__root.tsx. */}
    </div>
  );
}
