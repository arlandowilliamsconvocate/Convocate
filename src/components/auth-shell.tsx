import type { ReactNode } from "react";
import { PublicPage, Rule } from "./public-page";

/**
 * The frame for every signed-out screen that asks for something: sign in,
 * create account, forgot password, choose a new password.
 *
 * It is the landing page's cream and grain, its header, its Fraunces `h1` in
 * regular weight and its short terracotta rule. The column is 30rem — narrow on
 * purpose, because a form is a single decision at a time — and the copy inside
 * it is left-aligned, which is the one place a centred block would read worse.
 *
 * The children are the form itself, separated from the heading by a hairline
 * rule rather than boxed in a white card: there is no card anywhere on these
 * screens, only rules and space.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <PublicPage>
      <div className="mx-auto flex w-full max-w-[78rem] flex-col justify-start px-6 pb-24 pt-12 md:min-h-[66vh] md:justify-center md:pb-28 md:pt-16 lg:px-10">
        <div className="mx-auto w-full max-w-[30rem]">
          <h1 className="font-display text-[clamp(1.85rem,3.4vw,2.5rem)] font-normal leading-[1.12] tracking-[-0.012em] text-charcoal">
            {title}
          </h1>
          <Rule centered={false} className="mt-6" />
          <p className="mt-6 text-[16px] leading-[1.7] text-charcoal-soft">{subtitle}</p>
          <div className="mt-10 border-t border-taupe/80 pt-10">{children}</div>
          <p className="mt-8 text-[14px] leading-relaxed text-charcoal-soft">{footer}</p>
        </div>
      </div>
    </PublicPage>
  );
}
