import { createFileRoute } from "@tanstack/react-router";
import { PaidGuidePage } from "~/components/lead-magnet";
import { LEAD_MAGNETS, leadMagnetHead } from "~/lib/lead-magnets";
import { guideAccessFn } from "~/server/api";
/**
 * /resources/speaker-contract-template — a paid-plan guide.
 *
 * The full agreement, clause by clause.
 *
 * The page is a real page either way, and that is deliberate. A stranger, and a
 * signed-in account that has never unlocked an event, get the opening of the
 * guide — whole sections, cut at a section boundary — and then a wall that says
 * what the rest is and what it costs. An account that has ever unlocked an event
 * gets the whole guide, in the server HTML, printable. Nobody is redirected to
 * /pricing: a page that can be found and read a little is the point.
 *
 * `guideAccessFn` decides which of those two the server sends. The decision is
 * the server's: this component only renders the answer.
 */
const magnet = LEAD_MAGNETS[4];
export const Route = createFileRoute("/resources/speaker-contract-template")({
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
