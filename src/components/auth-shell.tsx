import type { ReactNode } from "react";
import { SiteHeader } from "./site-chrome";

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
    <div className="flex min-h-screen flex-col bg-paper">
      {/* The same public header as the landing, About and Pricing pages, so
          About and Pricing are reachable from here too. */}
      <SiteHeader />
      <main className="flex flex-1 items-start justify-center px-6 pb-20 pt-6">
        <div className="w-full max-w-md">
          <h1 className="text-3xl text-ink">{title}</h1>
          <p className="mt-2 text-sm text-ink-soft">{subtitle}</p>
          <div className="mt-7 rounded-xl border border-line bg-white p-6 shadow-sm">{children}</div>
          <p className="mt-5 text-center text-sm text-ink-soft">{footer}</p>
        </div>
      </main>
    </div>
  );
}
