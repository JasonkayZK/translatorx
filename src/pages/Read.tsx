import { t as tr } from "../lib/i18n";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookOpenText, Check, ChevronDown, Loader2, PenLine, Plus, Send, Sparkles, Volume2, X } from "lucide-react";
import { activityContext } from "../lib/learning";
import { api } from "../lib/api";
import { joinSegments, lang } from "../lib/languages";
import { splitDraft } from "../lib/segment";
import { speak } from "../lib/speech";
import { llmReady } from "../lib/types";
import type { Breakdown, ChatMessage } from "../lib/types";
import { WordPicker } from "../components/WordPicker";
import { Button, cx, Empty, IconButton, PageHeader, Segmented } from "../components/ui";
import { useApp } from "../store";
import type { ReadPair, ReadView } from "../store";
import { toPractice } from "./Write/Compose";

const SAMPLE = "The model was trained on a curated dataset that spans nearly a decade of research. It outperforms every public benchmark released this year.";

type Pair = ReadPair;
interface Numbered { pair: Pair; index: number }

/** Sentences grouped back into the paragraphs they were pasted in. */
export function paragraphsOf(pairs: Pair[]): Numbered[][] {
  const out: Numbered[][] = [];
  pairs.forEach((pair, index) => {
    const last = out[out.length - 1];
    if (last && (last[0].pair.para ?? 0) === (pair.para ?? 0)) last.push({ pair, index });
    else out.push([{ pair, index }]);
  });
  return out;
}

export function ReadPage() {
  const { settings, toast, go, setPair, setDraft, startPractice, setRead } = useApp();
  const input = useApp((s) => s.readInput);
  const pairs = useApp((s) => s.readPairs);
  const view = useApp((s) => s.readView);
  const setInput = (readInput: string) => setRead({ readInput });
  const setPairs = (readPairs: Pair[]) => setRead({ readPairs });
  const setView = (readView: ReadView) => setRead({ readView });
  const src = settings.targetLang;
  const dst = settings.nativeLang;
  const operation = useRef<{ key: string; activity: ReturnType<typeof activityContext> } | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const paragraphs = useMemo(() => paragraphsOf(pairs), [pairs]);
  const spaced = lang(src).spaced;

  const run = async () => {
    const segs = splitDraft(input, src, "sentence");
    if (!segs.length || submitting.current) return;
    submitting.current = true;
    const key = JSON.stringify([input, src, dst]);
    if (operation.current?.key !== key) operation.current = { key, activity: activityContext("read") };
    setBusy(true);
    try {
      const translated = await api.translateTexts(segs.map((s) => s.source), src, dst, operation.current.activity);
      operation.current = null;
      let para = 0;
      setPairs(segs.map((s, i) => {
        const pair = { text: s.source, translation: translated[i] ?? "", para };
        if (s.breakAfter) para++;
        return pair;
      }));
      setFocus(null);
      setSaved(new Set());
      setExpanded(new Set());
    } catch (e) {
      toast(tr("Translation failed: {p0}", { p0: (e as Error).message }), "error");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const say = (t: string) => speak(t, src, { engine: settings.ttsEngine, rate: settings.speechRate }).catch((e) => toast((e as Error).message, "error"));
  const joinSource = (items: Numbered[]) => items.map((x) => x.pair.text).join(spaced ? " " : "");
  const joinTranslation = (items: Numbered[]) => joinSegments(items.map((x) => ({ text: x.pair.translation })), dst);

  const save = async (text: string, translation: string, key: string) => {
    if (saved.has(key)) return;
    try {
      await api.addSentence({ source: translation, target: text, sourceLang: dst, targetLang: src, origin: "read" });
      setSaved((s) => new Set(s).add(key));
      toast(tr("Added to sentence notebook"), "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  // Reverse drill: see the native translation, write the original sentence yourself.
  const drill = (list: Pair[]) => {
    setPair(dst, src);
    setDraft(list.map((p) => p.translation).join(""));
    startPractice(toPractice(list.map((p) => ({ source: p.translation, target: p.text, breakAfter: false }))));
    go("write");
  };

  const toggleExpanded = (i: number) => setExpanded((s) => { const next = new Set(s); if (next.has(i)) next.delete(i); else next.add(i); return next; });

  const sentenceRow = (item: Numbered, nested: boolean) => {
    const key = `s:${item.index}`;
    const isSaved = saved.has(key);
    return (
      <li key={item.index} data-focus={focus === item.index} className={cx("read-sentence", !nested && "recent-item")}>
        <WordPicker text={item.pair.text} code={src} native={dst} translation={item.pair.translation} className="font-reading text-[17px] leading-relaxed text-ink" />
        <div className="selectable mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{item.pair.translation}</div>
        <div className="read-actions">
          <IconButton label={tr("Read aloud")} onClick={() => say(item.pair.text)}><Volume2 className="size-4" /></IconButton>
          <IconButton label={isSaved ? tr("Saved to sentences") : tr("Save this sentence")} active={isSaved} disabled={isSaved} onClick={() => save(item.pair.text, item.pair.translation, key)}>
            {isSaved ? <Check className="size-4" /> : <Bookmark className="size-4" />}
          </IconButton>
          <IconButton label={tr("Practice this sentence")} onClick={() => drill([item.pair])}><PenLine className="size-4" /></IconButton>
          <IconButton label={tr("Breakdown")} active={focus === item.index} onClick={() => setFocus(focus === item.index ? null : item.index)}><Sparkles className="size-4" /></IconButton>
        </div>
      </li>
    );
  };

  return (
    <div className="relative flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="page-shell">
          <PageHeader eyebrow={tr("read.eyebrow", { from: lang(src).label, to: lang(dst).label })} title={tr("Understand it, then write it")}>
            {pairs.length > 0 && (
              <>
                <Segmented size="sm" label={tr("read.view")} value={view} onChange={setView} options={[{ value: "paragraph", label: tr("read.viewParagraph"), hint: tr("read.viewParagraphHint") }, { value: "sentence", label: tr("read.viewSentence"), hint: tr("read.viewSentenceHint") }]} />
                <Button variant="outline" onClick={() => drill(pairs)} icon={<PenLine className="size-4" />}>{tr("Practice all sentences")}</Button>
              </>
            )}
          </PageHeader>

          <div className="card overflow-hidden">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  run();
                }
              }}
              placeholder={tr("Paste an article, email, or comment in {p0}…", { p0: lang(src).label })}
              className="block min-h-[130px] w-full resize-y bg-transparent px-6 py-5 font-reading text-[17px] leading-relaxed text-ink outline-none placeholder:text-ink-3/80"
            />
            <div className="flex items-center gap-2 border-t border-line bg-paper-2/50 px-4 py-2.5">
              <button className="text-[12px] text-ink-3 hover:text-ink" onClick={() => setInput(SAMPLE)}>{tr("Use example")}</button>
              <Button className="ml-auto" variant="ink" loading={busy} disabled={!input.trim()} onClick={run} icon={<BookOpenText className="size-4" />}>{tr("Compare sentence by sentence")}</Button>
            </div>
          </div>

          {pairs.length === 0 ? (
            <Empty icon={<BookOpenText className="size-5" />} title={tr("Read with sentence translations")}>
              {tr("Paste foreign text to translate each sentence. Click words to look them up and save them, or use Breakdown to explore vocabulary and grammar. You can also practice the entire text.")}</Empty>
          ) : view === "sentence" ? (
            <ol className="stagger mt-8 space-y-2">{pairs.map((pair, index) => sentenceRow({ pair, index }, false))}</ol>
          ) : (
            <div className="stagger mt-8 space-y-3">
              {paragraphs.map((items, pi) => {
                const key = `p:${pi}`;
                const isSaved = saved.has(key);
                const open = expanded.has(pi);
                return (
                  <article key={pi} className="recent-item read-paragraph">
                    <div className="read-paragraph-source selectable">
                      {items.map((item, k) => (
                        <Fragment key={item.index}>
                          {k > 0 && spaced ? " " : ""}
                          <WordPicker inline text={item.pair.text} code={src} native={dst} translation={item.pair.translation} />
                        </Fragment>
                      ))}
                    </div>
                    <p className="read-paragraph-translation selectable">{joinTranslation(items)}</p>
                    <div className="read-actions">
                      <IconButton label={tr("Read aloud")} onClick={() => say(joinSource(items))}><Volume2 className="size-4" /></IconButton>
                      <IconButton label={isSaved ? tr("Saved to sentences") : tr("read.saveParagraph")} active={isSaved} disabled={isSaved} onClick={() => save(joinSource(items), joinTranslation(items), key)}>
                        {isSaved ? <Check className="size-4" /> : <Bookmark className="size-4" />}
                      </IconButton>
                      <IconButton label={tr("read.practiceParagraph")} onClick={() => drill(items.map((x) => x.pair))}><PenLine className="size-4" /></IconButton>
                      <button type="button" aria-expanded={open} onClick={() => toggleExpanded(pi)}
                        className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink">
                        {tr("read.sentenceCount", { count: items.length })}
                        <ChevronDown className={cx("size-3.5 transition-transform", open && "rotate-180")} />
                      </button>
                    </div>
                    {open && <ol className="read-sentences space-y-1">{items.map((item) => sentenceRow(item, true))}</ol>}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {focus !== null && pairs[focus] && <ExplainPanel key={pairs[focus].text} pair={pairs[focus]} code={src} native={dst} onClose={() => setFocus(null)} />}
    </div>
  );
}

function ExplainPanel({ pair, code, native, onClose }: { pair: Pair; code: string; native: string; onClose: () => void }) {
  const { settings, toast, go } = useApp();
  const ready = llmReady(settings);
  const [data, setData] = useState<Breakdown | null>(null);
  const [err, setErr] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [savedTerms, setSavedTerms] = useState<Set<string>>(() => new Set());
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) return;
    api.explainSentence(pair.text, code, native).then(setData).catch((e) => setErr((e as Error).message));
  }, [pair.text, code, native, ready]);

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [chat]);

  const ask = async () => {
    if (!q.trim() || asking) return;
    const history: ChatMessage[] = [...chat, { role: "user", content: q.trim() }];
    setChat(history);
    setQ("");
    setAsking(true);
    try {
      const a = await api.askTutor(pair.text, history, code, native);
      setChat([...history, { role: "assistant", content: a }]);
    } catch (e) {
      setChat([...history, { role: "assistant", content: tr("Something went wrong: {p0}", { p0: (e as Error).message }) }]);
    } finally {
      setAsking(false);
    }
  };

  const saveTerm = async (term: string, meaning: string) => {
    if (savedTerms.has(term)) return;
    try {
      await api.addWord({ text: term, meaning, lang: code, context: pair.text, contextTranslation: pair.translation });
      setSavedTerms((s) => new Set(s).add(term));
      toast(tr("Added to vocabulary: {p0}", { p0: term }), "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <aside className="reading-panel flex shrink-0 animate-rise flex-col border-l border-line">
      <div className="flex items-center justify-between px-5 pt-11 pb-3">
        <span className="eyebrow flex items-center gap-1.5"><Sparkles className="size-3 text-seal" /> {tr("Sentence breakdown")}</span>
        <IconButton label={tr("Close")} onClick={onClose}><X className="size-4" /></IconButton>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-4">
        <p className="selectable rounded-xl border border-line bg-card px-4 py-3 font-display text-[15px] leading-relaxed">{pair.text}</p>
        {!ready ? (
          <div className="rounded-xl border border-dashed border-line-2 p-4 text-[13px] leading-relaxed text-ink-3">
            {tr("Sentence breakdown and the AI tutor need a configured model (OpenAI, DeepSeek, Qwen, Ollama, or another OpenAI-compatible service).")}<Button className="mt-3" size="sm" variant="ink" onClick={() => go("settings")}>{tr("Open settings")}</Button>
          </div>
        ) : err ? (
          <div className="text-[13px] text-seal">{err}</div>
        ) : !data ? (
          <div className="flex items-center gap-2 text-[13px] text-ink-3"><Loader2 className="size-4 animate-spin" />{tr("Analyzing…")}</div>
        ) : (
          <>
            <section>
              <div className="eyebrow mb-2">{tr("Key vocabulary")}</div>
              <ul className="space-y-1">
                {data.vocabulary.map((v) => {
                  const done = savedTerms.has(v.term);
                  return (
                    <li key={v.term} className="group flex items-baseline gap-2 rounded-lg px-2 py-1.5 hover:bg-card">
                      <span className="font-display text-[15px] text-ink">{v.term}</span>
                      <span className="font-mono text-[10.5px] text-ink-3">{v.pos}</span>
                      <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">{v.meaning}</span>
                      <button title={done ? tr("Added to vocabulary") : tr("Add to vocabulary")} aria-label={done ? tr("Added to vocabulary") : tr("Add to vocabulary")} disabled={done} onClick={() => saveTerm(v.term, v.meaning)}
                        className={cx("rounded-md p-0.5 transition-colors", done ? "text-moss" : "text-ink-3 opacity-60 group-hover:opacity-100 focus-visible:opacity-100 hover:text-seal")}>
                        {done ? <Check className="size-4" /> : <Plus className="size-4" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section>
              <div className="eyebrow mb-2">{tr("Grammar")}</div>
              <ul className="space-y-2.5">
                {data.grammar.map((g) => (
                  <li key={g.title} className="border-l-2 border-seal/40 pl-3">
                    <div className="text-[13px] font-medium text-ink">{g.title}</div>
                    <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{g.detail}</div>
                  </li>
                ))}
              </ul>
            </section>
            {data.tip && <p className="rounded-xl bg-amber-soft/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">{data.tip}</p>}
          </>
        )}
        {ready && chat.length > 0 && (
          <section className="space-y-3">
            <div className="eyebrow">{tr("Ask the AI tutor")}</div>
            {chat.map((m, i) => (
              <div key={i} className={cx("selectable rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap", m.role === "user" ? "ml-8 bg-ink text-paper" : "mr-4 border border-line bg-card text-ink-2")}>
                {m.content}
              </div>
            ))}
            {asking && <div className="flex items-center gap-2 text-[12px] text-ink-3"><Loader2 className="size-3.5 animate-spin" />{tr("Thinking…")}</div>}
            <div ref={end} />
          </section>
        )}
      </div>
      {ready && (
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-1.5 focus-within:border-line-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && ask()}
              placeholder={tr("Ask about vocabulary, grammar, or tone…")}
              className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
            />
            <button aria-label={tr("read.send")} onClick={ask} disabled={!q.trim() || asking} className="text-ink-3 hover:text-seal disabled:opacity-40"><Send className="size-4" /></button>
          </div>
        </div>
      )}
    </aside>
  );
}
