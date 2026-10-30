/**
 * The Start instance — where the one request middleware is registered.
 *
 * Why a request middleware and not a client script: the brief the owner asked for
 * is first-party analytics with no cookies, no beacon to an outside domain and no
 * identity. This runs on the server, in front of the router, so it counts the page
 * the server actually served — including fetches by link previews and crawlers,
 * which never run JavaScript — and it writes one row. Nothing reaches the browser.
 *
 * What it does NOT count, on purpose:
 *
 *   - `handlerType === "serverFn"` — calls the app makes to load data after a page
 *     has rendered. Counting those would turn one page view into a dozen.
 *   - anything that is not a GET, or that carries a file extension, or that lives
 *     under the machine-only prefixes — see `shouldCountView`.
 *
 * It never blocks the response and never fails it: `recordPageView` swallows its
 * own errors (a database that cannot be reached must not take the site down), and
 * the call is not awaited, so a slow insert cannot add latency to a page.
 */
import { createMiddleware, createStart } from "@tanstack/react-start";
import { recordPageView } from "./server/analytics.server";

const pageViewLogger = createMiddleware({ type: "request" }).server(
  async ({ request, pathname, handlerType, next }) => {
    const result = await next();
    if (handlerType === "router") {
      void recordPageView({ method: request.method, pathname, headers: request.headers });
    }
    return result;
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [pageViewLogger],
}));
