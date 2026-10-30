import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, Input, labelClass } from "~/components/ui";
import { DRAFT_NOTICE, formatMoment } from "~/lib/agreement";
import { formatDateRange } from "~/lib/money";
import { getSignaturePageFn, submitSignatureFn } from "~/server/api";

/**
 * The signing page — `/sign/<token>`.
 *
 * This is the page the OTHER party to an engagement agreement opens: a speaker,
 * a musician, a supplier, a venue. Signed out, on a phone, for someone who has
 * never heard of Convocate. It takes the token and nothing else — no account, no
 * conference id — and it shows only what the server sent: the agreement they are
 * being asked to accept, and nothing about the rest of the organizer's workspace
 * (no attendee, no budget, no other contract, no committee).
 *
 * What they do here is the owner's decision, in his words: type a name, tick a
 * box, and the server records the moment and the version of the text. It says on
 * the page, in plain words, that this is an electronic acceptance and not a
 * notarized or regulated signature.
 *
 * Slice 2 adds a DRAWN signature under the typed name — the owner reversed the
 * earlier "typed name only" decision and asked for both. It is optional and it
 * can never block a signature: the typed name and the tick remain the legal act,
 * and if the drawing cannot be made into a small, honest PNG the signature is
 * sent without it.
 */
export const Route = createFileRoute("/sign/$token")({
  head: () => ({
    meta: [{ title: "Accept agreement — Convocate" }],
  }),
  loader: async ({ params }) => ({
    page: await getSignaturePageFn({ data: { token: params.token } }),
  }),
  component: SignPage,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line/70">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-serif text-xl font-semibold tracking-tight text-brand">Convocate</span>
            <span className="hidden text-xs uppercase tracking-[0.18em] text-ink-soft sm:inline">
              Conference/Event planning
            </span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}

function SignPage() {
  const { page } = Route.useLoaderData();
  const { token } = Route.useParams();
  const [done, setDone] = useState<{ name: string; acceptedAt: number; image: string } | null>(null);
  if (done) return <Accepted name={done.name} acceptedAt={done.acceptedAt} image={done.image} />;
  if (!page.ok) {
    return (
      <Shell>
        <Card className="p-7">
          <h1 className="font-serif text-2xl text-ink">This signing link cannot be used</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            It may have been replaced or revoked, it may have expired, or it may already have been
            used. Nothing has been recorded and nothing has been signed. Ask whoever sent you the
            link for a new one.
          </p>
        </Card>
      </Shell>
    );
  }

  const agreement = page.page;
  const dates = agreement.startDate ? formatDateRange(agreement.startDate, agreement.endDate) : "";
  return (
    <Shell>
      <Card className="p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">Agreement to accept</p>
        <h1 className="mt-1 font-serif text-2xl leading-tight text-ink">{agreement.title}</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          {agreement.eventName}
          {dates ? ` · ${dates}` : ""}
          {agreement.venue ? ` · ${agreement.venue}` : ""}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink">
          {agreement.organizerName
            ? `${agreement.organizerName} has prepared this agreement and is asking you — ${agreement.guestName}, as ${agreement.guestRole.toLowerCase()} — to accept it.`
            : `The organizer has prepared this agreement and is asking you — ${agreement.guestName}, as ${agreement.guestRole.toLowerCase()} — to accept it.`}{" "}
          Read it through, then accept it below.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">{DRAFT_NOTICE}</p>

        <div className="mt-5 max-h-[26rem] overflow-auto rounded-lg border border-line bg-white px-5 py-4">
          <div className="whitespace-pre-wrap font-serif text-[12.5px] leading-relaxed text-black">
            {agreement.body}
          </div>
        </div>

        <AcceptForm
          token={token}
          guestName={agreement.guestName}
          shownVersion={agreement.fingerprint}
          onAccepted={setDone}
        />
      </Card>
    </Shell>
  );
}

/* ------------------------------------------------------- the drawn signature */

/**
 * The pad's backing store. It is bigger than the space it is drawn in so the
 * line stays sharp on a phone and on a retina screen: the canvas is laid out at
 * whatever width the card gives it and the browser scales these pixels down,
 * which is why nothing here has to know the device pixel ratio.
 *
 * A fixed backing size also means a reflow, a rotation or a resize cannot lose
 * what has been drawn — the bitmap is never re-created.
 */
const PAD_WIDTH = 1000;
const PAD_HEIGHT = 320;

/**
 * The most characters of a data URL this page will send: about 67 KB of PNG once
 * decoded. A trimmed signature is a few KB, so this is generous — but it is
 * deliberately well under the transport ceiling measured on the live site, where
 * a request body of 160 KB arrives truncated and the call fails. A body of
 * ~130 KB still gets through, so 90 KB of image plus the rest of the form is
 * safe with room to spare.
 */
const MAX_SIGNATURE_DATA_URL_CHARS = 90_000;

type PadHandle = {
  /** The drawing as a trimmed PNG data URL, or null when there is nothing (or it cannot be encoded). */
  exportPng: () => string | null;
  clear: () => void;
};

/**
 * A signature pad: a canvas that takes a mouse, a finger or a stylus.
 *
 * Pointer events cover all three, `touch-action: none` stops the page scrolling
 * under a finger, and the pointer is captured on press so a stroke that runs off
 * the edge still finishes where the hand is.
 *
 * The exported image is TRIMMED to the ink (a signature drawn small in a corner
 * should print small, not as a mostly-empty rectangle), capped in size, and it
 * is only ever returned if it really is a PNG data URL. Every failure returns
 * null: the caller then signs without a drawing rather than not at all.
 */
function SignaturePad({
  disabled,
  handleRef,
}: {
  disabled: boolean;
  handleRef: { current: PadHandle | null };
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const setInk = (value: boolean) => {
    dirty.current = value;
    setHasInk(value);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setInk(false);
  };

  const exportPng = (): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || !dirty.current) return null;
    try {
      const context = canvas.getContext("2d");
      if (!context) return null;
      const { width, height } = canvas;
      const pixels = context.getImageData(0, 0, width, height).data;
      // The bounding box of anything that is not fully transparent.
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (pixels[(y * width + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0 || maxY < 0) return null;
      const padding = 8;
      const sx = Math.max(0, minX - padding);
      const sy = Math.max(0, minY - padding);
      const sw = Math.min(width, maxX + padding) - sx;
      const sh = Math.min(height, maxY + padding) - sy;

      let trimmed = document.createElement("canvas");
      trimmed.width = sw;
      trimmed.height = sh;
      const trimmedContext = trimmed.getContext("2d");
      if (!trimmedContext) return null;
      trimmedContext.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

      let url = trimmed.toDataURL("image/png");
      // Only if a drawing is somehow enormous: shrink it, keeping proportion,
      // until it fits. Anything still too big is dropped by the caller.
      let attempts = 0;
      while (url.length > MAX_SIGNATURE_DATA_URL_CHARS && attempts < 4 && trimmed.width > 32) {
        const smaller = document.createElement("canvas");
        smaller.width = Math.max(1, Math.round(trimmed.width * 0.6));
        smaller.height = Math.max(1, Math.round(trimmed.height * 0.6));
        const smallerContext = smaller.getContext("2d");
        if (!smallerContext) break;
        smallerContext.drawImage(trimmed, 0, 0, smaller.width, smaller.height);
        trimmed = smaller;
        url = trimmed.toDataURL("image/png");
        attempts += 1;
      }
      if (url.length > MAX_SIGNATURE_DATA_URL_CHARS) return null;
      if (!url.startsWith("data:image/png;base64,")) return null;
      return url;
    } catch {
      return null;
    }
  };

  // The parent's submit handler calls these through `handleRef`; re-assigned on
  // every render so they always close over the current canvas and state.
  useEffect(() => {
    handleRef.current = { exportPng, clear };
    return () => {
      handleRef.current = null;
    };
  });

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.lineWidth = 3.4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";
  }, []);

  /** Where the pointer is, in the canvas's own pixels (it is laid out scaled down). */
  const pointFor = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; drawing still works without it.
    }
    drawing.current = true;
    const { x, y } = pointFor(event);
    context.beginPath();
    context.moveTo(x, y);
    // A tap should leave a mark, not nothing.
    context.lineTo(x + 0.01, y + 0.01);
    context.stroke();
    if (!dirty.current) setInk(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    event.preventDefault();
    const { x, y } = pointFor(event);
    context.lineTo(x, y);
    context.stroke();
  };

  const endStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released, or never captured.
    }
  };

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-dashed border-line bg-white">
        <canvas
          ref={canvasRef}
          width={PAD_WIDTH}
          height={PAD_HEIGHT}
          aria-label="Draw your signature here"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          className="block w-full touch-none select-none"
          style={{ touchAction: "none", cursor: disabled ? "default" : "crosshair" }}
        />
        {hasInk ? null : (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-ink-soft/70 select-none">
            Draw your signature here
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-soft">Optional — you can also draw your signature.</p>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || !hasInk}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-paper-deep disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function AcceptForm({
  token,
  guestName,
  shownVersion,
  onAccepted,
}: {
  token: string;
  guestName: string;
  shownVersion: string;
  onAccepted: (result: { name: string; acceptedAt: number; image: string }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(false);
  const pad = useRef<PadHandle | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setReload(false);
    // A drawing can never be the reason a signature fails: if the pad cannot
    // produce a small, valid PNG the acceptance goes in without one.
    let image = "";
    try {
      image = pad.current?.exportPng() ?? "";
    } catch {
      image = "";
    }
    try {
      let result;
      try {
        result = await submitSignatureFn({
          data: { token, name, email, shownVersion, accepted, image },
        });
      } catch (error) {
        // The request itself failed — most likely a body the transport refused.
        // The drawing is optional, so send the acceptance again without it
        // rather than leaving the guest unable to sign.
        if (!image) throw error;
        image = "";
        result = await submitSignatureFn({
          data: { token, name, email, shownVersion, accepted, image },
        });
      }
      if (result.ok) {
        onAccepted({ name: result.name, acceptedAt: result.acceptedAt, image });
        return;
      }
      setError(result.error);
      setReload(result.code === "changed");
    } catch {
      setError("That could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-6 border-t border-line pt-5" onSubmit={(event) => void submit(event)} noValidate>
      <h2 className="font-serif text-xl text-ink">Accept this agreement</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Type your full name and check the box. Your typed name, the date and time, and the version of
        the text you were shown are recorded for the organizer.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Your full name">
          <Input
            value={name}
            autoComplete="name"
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            placeholder={guestName}
          />
        </Field>
        <Field label="Email (optional)">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.org"
          />
        </Field>
      </div>

      <div className="mt-4">
        <span className={labelClass}>Signature</span>
        <div className="mt-1.5">
          <SignaturePad disabled={busy} handleRef={pad} />
        </div>
      </div>

      <label className="mt-4 flex items-start gap-3 rounded-lg border border-line bg-paper-deep/40 px-4 py-3 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={accepted}
          disabled={busy}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span>
          I have read this agreement and I accept it. I understand that typing my name here is my
          signature, and that it is recorded electronically with the date and time.
        </span>
      </label>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
          {reload ? (
            <>
              {" "}
              <button type="button" className="underline" onClick={() => window.location.reload()}>
                Reload the page
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !name.trim() || !accepted}>
          {busy ? "Recording…" : "Accept and sign"}
        </Button>
        <span className="text-xs text-ink-soft">Nothing is charged on this page.</span>
      </div>
    </form>
  );
}

function Accepted({
  name,
  acceptedAt,
  image,
}: {
  name: string;
  acceptedAt: number;
  image: string;
}) {
  return (
    <Shell>
      <Card className="p-7">
        <h1 className="font-serif text-2xl text-ink">Accepted — thank you</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Your acceptance has been recorded for the organizer.
        </p>
        <dl className="mt-5 divide-y divide-line rounded-lg border border-line">
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Signed by</dt>
            <dd className="text-right">
              {image ? (
                <img
                  src={image}
                  alt="The signature you drew"
                  className="mb-1 ml-auto block h-auto w-auto max-h-[64px] max-w-[240px]"
                  style={{ maxHeight: "64px", maxWidth: "240px", height: "auto", width: "auto" }}
                />
              ) : null}
              <span className="text-sm text-ink">{name}</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 px-4 py-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">When</dt>
            <dd className="text-right text-sm text-ink">{formatMoment(acceptedAt)}</dd>
          </div>
        </dl>
        <div className="mt-5 rounded-lg border border-line bg-paper-deep/50 px-4 py-3 text-sm leading-relaxed text-ink">
          This is an electronic acceptance: a typed name, a tick and a timestamp
          {image ? ", with the signature you drew" : ""} against the version of the agreement you
          were shown. It is not a notarized signature and not a qualified or otherwise regulated
          electronic signature. Keep this page as your record — the organizer can see the same
          record on their copy of the agreement.
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-soft">
          If anything above is wrong, contact whoever sent you the link. This link cannot be used again.
        </p>
      </Card>
    </Shell>
  );
}
