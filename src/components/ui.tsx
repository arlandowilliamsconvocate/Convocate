import type { ButtonHTMLAttributes, ComponentProps, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export const inputClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm outline-none transition placeholder:text-ink-soft/50 focus:border-brand focus:ring-2 focus:ring-brand/15";

export const labelClass = "block text-xs font-semibold uppercase tracking-wide text-ink-soft";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white shadow-sm hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "border border-line bg-white text-ink shadow-sm hover:bg-paper-deep disabled:opacity-50",
  ghost: "text-ink-soft hover:text-ink hover:bg-paper-deep",
  danger: "text-red-700 hover:bg-red-50",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition ${variants[variant]} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className={labelClass}>{label}</span>
      {children}
      {hint ? <span className="block text-xs text-ink-soft/80">{hint}</span> : null}
    </label>
  );
}

// `ComponentProps<"input">` rather than `InputHTMLAttributes` so a caller can pass
// a `ref` through (React 19 hands it in as a prop) — the assistant pop-up focuses
// its textbox when it opens.
export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-white shadow-sm ${className}`}>{children}</div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-paper-deep/40 px-6 py-10 text-center">
      <p className="font-serif text-lg text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-soft">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
