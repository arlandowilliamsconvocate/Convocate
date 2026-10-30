import { Link } from "@tanstack/react-router";
import { PublicPage, Rule, linkInline } from "./public-page";

/**
 * The one "there is nothing here" page.
 *
 * It exists as a component (rather than only as the root router's
 * `notFoundComponent`) so a page that must not advertise that it exists can show
 * the *identical* thing: `/admin` renders this for anyone who is not an admin, so
 * a normal account cannot tell it apart from a URL that was never a page. One
 * definition means the two can never drift apart in wording or layout.
 *
 * The wording and the destination are unchanged. What changed is that it now
 * sits in the site's own frame — cream, grain, the shared header and footer, a
 * Fraunces `h1` with the terracotta rule — instead of floating on bare paper.
 * It also now has a real `h1`: it used to be a paragraph, so a not-found page had
 * no top-level heading at all.
 */
export function NotFoundPage() {
  return (
    <PublicPage>
      <div className="mx-auto flex max-w-[78rem] flex-col items-center px-6 pb-28 pt-20 text-center md:pb-36 md:pt-28 lg:px-10">
        <h1 className="font-display max-w-[20ch] text-balance text-[clamp(1.95rem,4vw,3rem)] font-normal leading-[1.1] tracking-[-0.015em] text-charcoal">
          Page not found
        </h1>
        <Rule className="mt-7" />
        <p className="mt-7 max-w-[46ch] text-[16.5px] leading-[1.78] text-charcoal-soft">
          That page doesn&rsquo;t exist.{" "}
          <Link to="/" className={linkInline}>
            Head back to the start.
          </Link>
        </p>
      </div>
    </PublicPage>
  );
}
