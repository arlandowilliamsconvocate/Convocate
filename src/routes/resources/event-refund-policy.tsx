import { createFileRoute } from "@tanstack/react-router";
import { PaidGuidePage } from "~/components/lead-magnet";
import { leadMagnet, leadMagnetHead } from "~/lib/lead-magnets";
import { guideAccessFn } from "~/server/api";
/**
 * /resources/event-refund-policy — one of the guides that comes with the $199
 * plan.
 *
 * What happens to an attendee's money if the event is cancelled or they cannot
 * come: what you can actually pay back, the date ladder, and the wording to
 * publish.
 *
 * The page is a real page either way, and that is deliberate. A stranger, and a
 * signed-in account that has never unlocked an event, get the opening of the
 * guide — whole sections, cut at a section boundary — and then a wall that says
 * what the rest is and what it costs. An account that has ever unlocked an event
 * gets the whole guide, in the server HTML, printable. Nobody is redirected to
 * /pricing: a page that can be found and read a little is the point.
 *
 * The cut lands before `## What you can actually pay back`, so a visitor who has
 * not unlocked an event reads the introduction and "The two policies, and why
 * they have to fit together" — the diagnosis, which is the hook — and never the
 * arithmetic, the ladder, the template or the wording.
 *
 * There is no email form on this page, on purpose: the guide cannot be handed
 * over in exchange for an address, so asking for one would be a dark pattern.
 *
 * `guideAccessFn` decides which of those two the server sends. The decision is
 * the server's: this component only renders the answer.
 */
const magnet = leadMagnet("event-refund-policy");
if (!magnet) {
  throw new Error("The event-refund-policy guide is missing from LEAD_MAGNETS");
}
export const Route = createFileRoute("/resources/event-refund-policy")({
  loader: async () => {
    const access = await guideAccessFn({ data: { slug: magnet.slug } });
    return { signedIn: access.signedIn, full: access.full };
  },
  head: () => leadMagnetHead(magnet),
  component: () => {
    const access = Route.useLoaderData();
    return <PaidGuidePage magnet={magnet} access={access} />;
  },
});
