import { Link } from "@tanstack/react-router";

/**
 * The one "there is nothing here" page.
 *
 * It exists as a component (rather than only as the root router's
 * `notFoundComponent`) so a page that must not advertise that it exists can show
 * the *identical* thing: `/admin` renders this for anyone who is not an admin, so
 * a normal account cannot tell it apart from a URL that was never a page. One
 * definition means the two can never drift apart in wording or layout.
 */
export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <p className="font-serif text-2xl">Page not found</p>
      <p className="mt-2 text-sm text-ink-soft">
        That page doesn&rsquo;t exist.{" "}
        <Link to="/" className="text-brand underline">
          Head back to the start.
        </Link>
      </p>
    </div>
  );
}
