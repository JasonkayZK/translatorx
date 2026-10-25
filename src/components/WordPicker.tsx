import { t as tr } from "../lib/i18n";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookmarkPlus, Check, Loader2, Volume2, X } from "lucide-react";
import { activityContext } from "../lib/learning";
import type { ActivityContext } from "../lib/types";
import { api } from "../lib/api";
import { rawSegments } from "../lib/check";
import { speak } from "../lib/speech";
import type { Lookup } from "../lib/types";
import { useApp } from "../store";
import { cx } from "./ui";

interface Props {
  text: string;
  code: string;
  /** Language the lookup explains words in. */
  native: string;
  translation?: string;
  className?: string;
  /** Flow inside surrounding text instead of forming a block of its own. */
  inline?: boolean;
}

/** Viewport rectangle of the clicked word. */
interface Anchor { left: number; top: number; right: number; bottom: number }

/** Target-language text whose words can be clicked to look up and save. */
export function WordPicker({ text, code, native, translation = "", className, inline = false }: Props) {
  const segs = rawSegments(text, code);
  const [open, setOpen] = useState<{ i: number; activity: ActivityContext; word: string; anchor: Anchor } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => target instanceof Node && !!(boxRef.current?.contains(target) || cardRef.current?.contains(target));
    const close = (e: MouseEvent) => { if (!inside(e.target)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    // The card is anchored to the viewport; a page scrolling underneath would leave it adrift.
    const moved = (e: Event) => { if (!inside(e.target)) setOpen(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [open]);

  return (
    <div ref={boxRef} className={cx(inline ? "inline" : "relative", className)}>
      <span className="selectable">
        {segs.map((s, i) =>
          s.word ? (
            <span
              key={i}
              onClick={(e) => {
                const r = (e.target as HTMLElement).getBoundingClientRect();
                setOpen({ i, activity: activityContext("lookup"), word: s.text, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
              }}
              className={cx(
                "cursor-pointer rounded-[3px] decoration-ink-3/50 decoration-dotted underline-offset-[5px] transition-colors hover:bg-amber-soft hover:underline",
                open?.i === i && "bg-amber-soft",
              )}
            >
              {s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </span>
      {open && <WordCard ref={cardRef} key={open.activity.eventId} activity={open.activity} word={open.word} code={code} native={native} context={text} translation={translation} anchor={open.anchor} onClose={() => setOpen(null)} />}
    </div>
  );
}

const MARGIN = 8;

interface CardProps { activity: ActivityContext; word: string; code: string; native: string; context: string; translation: string; anchor: Anchor; onClose: () => void }

/** Rendered at the document root, so no list item, side panel or scroll container can cover it. */
const WordCard = forwardRef<HTMLDivElement, CardProps>(function WordCard({ activity, word, code, native, context, translation, anchor, onClose }, ref) {
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);
  const [info, setInfo] = useState<Lookup | null>(null);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + MARGIN });
  const inner = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLDivElement);

  useEffect(() => {
    let active = true;
    api.lookupWord(word, context, code, native, activity).then((info) => { if (active) setInfo(info); }).catch((e) => { if (active) setErr((e as Error).message); });
    return () => { active = false; };
  }, [word, context, code, native, activity]);

  // Stay inside the viewport: below the word when there is room, above it otherwise.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN));
    let top = anchor.bottom + MARGIN;
    if (top + height > window.innerHeight - MARGIN && anchor.top - height - MARGIN >= MARGIN) top = anchor.top - height - MARGIN;
    setPos({ left, top: Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN)) });
  }, [anchor, info, err]);

  const save = async () => {
    try {
      await api.addWord({ text: word, meaning: info?.meaning ?? "", lang: code, context, contextTranslation: translation });
      setSaved(true);
      toast(tr("Added to vocabulary: {p0}", { p0: word }), "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return createPortal(
    <div ref={inner} role="dialog" aria-label={word} className="card word-card animate-rise p-4 font-sans text-[13px] leading-normal" style={{ left: pos.left, top: pos.top }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-[20px] leading-tight font-medium text-ink">{word}</div>
          {info?.phonetic && <div className="mt-0.5 font-mono text-[11.5px] text-ink-3">{info.phonetic}</div>}
        </div>
        <div className="flex items-center gap-0.5">
          <button className="rounded-md p-1.5 text-ink-3 hover:bg-ink/5 hover:text-ink" title={tr("Read aloud")} onClick={() => speak(word, code, { engine: settings.ttsEngine, rate: settings.speechRate }).catch((e) => toast((e as Error).message, "error"))}>
            <Volume2 className="size-4" />
          </button>
          <button className="rounded-md p-1.5 text-ink-3 hover:bg-ink/5 hover:text-ink" title={tr("Close")} onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="mt-3 min-h-10 text-ink-2">
        {err ? (
          <span role="alert" className="text-danger">{err}</span>
        ) : !info ? (
          <span className="flex items-center gap-2 text-ink-3"><Loader2 className="size-3.5 animate-spin" />{tr("Looking up…")}</span>
        ) : (
          <>
            <div className="text-[14px] text-ink">{info.meaning}</div>
            {info.dict.slice(0, 3).map((d) => (
              <div key={d.pos} className="mt-1.5 flex gap-2 text-[12px]">
                <span className="shrink-0 font-mono text-ink-3">{d.pos}</span>
                <span className="text-ink-2">{d.terms.join("，")}</span>
              </div>
            ))}
          </>
        )}
      </div>
      <button
        onClick={save}
        disabled={saved}
        className={cx("mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-lg text-[12.5px] font-medium transition-colors", saved ? "bg-moss-soft text-moss" : "bg-ink text-paper hover:bg-ink/85")}
      >
        {saved ? <Check className="size-3.5" /> : <BookmarkPlus className="size-3.5" />}
        {saved ? tr("Added to vocabulary") : tr("Add to vocabulary")}
      </button>
    </div>,
    document.body,
  );
});
