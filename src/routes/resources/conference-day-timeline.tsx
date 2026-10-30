import { createFileRoute } from "@tanstack/react-router";
import { LeadMagnetPage } from "~/components/lead-magnet";
import { LEAD_MAGNETS, leadMagnetHead } from "~/lib/lead-magnets";
/**
 * /resources/conference-day-timeline — one of the free guides.
 *
 * The page, its copy and its guide body all come from `lib/lead-magnets.ts`,
 * which is where the approved opt-in copy lives. This file only names which one.
 *
 * The whole guide is rendered into the HTML of this page (not behind the email
 * form), so a search engine and a reader with JavaScript off both get the guide.
 * `leadMagnetHead` adds the canonical URL beside the title and description.
 */
const magnet = LEAD_MAGNETS[2];
export const Route = createFileRoute("/resources/conference-day-timeline")({
  head: () => leadMagnetHead(magnet),
  component: () => <LeadMagnetPage magnet={magnet} />,
});
