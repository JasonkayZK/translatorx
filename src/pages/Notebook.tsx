import { t as tr } from "../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { Check, FileDown, NotebookPen, PenLine, Pencil, Search, Trash2, Volume2 } from "lucide-react";
import { api, exportFile } from "../lib/api";
import { lang } from "../lib/languages";
import { speak } from "../lib/speech";
import type { Sentence, Word } from "../lib/types";
import { Button, ConfirmIconButton, cx, Empty, IconButton, PageHeader, Segmented } from "../components/ui";
import { useApp } from "../store";
import { toPractice } from "./Write/Compose";

const DAY = 86_400_000;

export function dueLabel(dueAt: number): { text: string; due: boolean } {
  const d = dueAt - Date.now();
  if (d <= 0) return { text: tr("Due for review"), due: true };
  if (d < 3_600_000) return { text: tr("In {p0} minutes", { p0: Math.max(1, Math.round(d / 60000)) }), due: false };
  if (d < DAY) return { text: tr("In {p0} hours", { p0: Math.round(d / 3_600_000) }), due: false };
  return { text: tr("In {p0} days", { p0: Math.round(d / DAY) }), due: false };
}

/** Wraps occurrences of `word` inside `text` so the saved word stands out in its context. */
function Highlight({ text, word }: { text: string; word: string }) {
  const i = text.toLowerCase().indexOf(word.toLowerCase());
  if (!word || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-soft px-0.5 text-ink">{text.slice(i, i + word.length)}</mark>
      {text.slice(i + word.length)}
    </>
  );
}

function csvCell(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function NotebookPage() {
  const { settings, toast, go, setPair, setDraft, startPractice } = useApp();
  const [tab, setTab] = useState<"words" | "sentences">("words");
  const [q, setQ] = useState("");
  const [words, setWords] = useState<Word[]>([]);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [editing, setEditing] = useState<{ kind: "word" | "sentence"; id: number } | null>(null);
  const [editMeaning, setEditMeaning] = useState("");
  const [editNote, setEditNote] = useState("");

  const load = () => {
    api.listWords(q).then(setWords).catch((e) => toast((e as Error).message, "error"));
    api.listSentences(q).then(setSentences).catch((e) => toast((e as Error).message, "error"));
  };

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const say = (t: string, code: string) => speak(t, code, { engine: settings.ttsEngine, rate: settings.speechRate }).catch((e) => toast((e as Error).message, "error"));

  const remove = async (kind: "word" | "sentence", id: number) => {
    try {
      await api.deleteItem(kind, id);
      if (kind === "word") setWords((w) => w.filter((x) => x.id !== id));
      else setSentences((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const isEditing = (kind: "word" | "sentence", id: number) => editing?.kind === kind && editing.id === id;

  const startEdit = (kind: "word" | "sentence", id: number, meaning: string, note: string) => {
    setEditing({ kind, id });
    setEditMeaning(meaning);
    setEditNote(note);
  };

  const saveWord = async (w: Word) => {
    try {
      const meaning = editMeaning.trim();
      const note = editNote.trim();
      await api.updateWord(w.id, meaning, note);
      setWords((ws) => ws.map((x) => (x.id === w.id ? { ...x, meaning, note } : x)));
      setEditing(null);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const saveSentenceNote = async (s: Sentence) => {
    try {
      const note = editNote.trim();
      await api.updateSentenceNote(s.id, note);
      setSentences((ss) => ss.map((x) => (x.id === s.id ? { ...x, note } : x)));
      setEditing(null);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const editKeys = (save: () => void) => (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") save();
    else if (e.key === "Escape") setEditing(null);
  };

  const practice = (list: Sentence[]) => {
    if (!list.length) return;
    setPair(list[0].sourceLang, list[0].targetLang);
    setDraft(list.map((s) => s.source).join("\n"));
    startPractice(toPractice(list.map((s) => ({ source: s.source, target: s.target, breakAfter: false }))));
    go("write");
  };

  // Front/back CSV (plus context and note fields) imports straight into Anki.
  const exportCsv = async () => {
    const rows = tab === "words"
      ? words.map((w) => [w.text, w.meaning, w.context, w.note].map(csvCell).join(","))
      : sentences.map((s) => [s.target, s.source, s.note].map(csvCell).join(","));
    if (!rows.length) {
      toast(tr("Nothing to export yet"), "info");
      return;
    }
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    try {
      const where = await exportFile(`TranslatorX-${tab === "words" ? tr("Words") : tr("Sentences")}-${stamp}.csv`, rows.join("\n"));
      if (where === null) {
        toast(tr("notebook.exportCancelled"), "info");
        return;
      }
      toast(tr("Exported {p0} items to {p1}. Ready to import into Anki.", { p0: rows.length, p1: where }), "success");
    } catch (e) {
      toast(tr("Export failed: {p0}", { p0: (e as Error).message }), "error");
    }
  };

  const counts = useMemo(() => ({ w: words.length, s: sentences.length }), [words, sentences]);

  return (
    <div className="page-shell page-shell-wide">
      <PageHeader eyebrow={tr("Notebook · Language you have written and read")} title={tr("Notebook")}>
        <Button variant="ghost" onClick={exportCsv} icon={<FileDown className="size-4" />}>{tr("Export CSV")}</Button>
        {tab === "sentences" && sentences.length > 0 && (
          <Button variant="ink" onClick={() => practice(sentences.slice(0, 10))} icon={<PenLine className="size-4" />}>{tr("notebook.recent", { count: Math.min(10, sentences.length) })}</Button>
        )}
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented value={tab} onChange={setTab} options={[{ value: "words", label: tr("Words {p0}", { p0: counts.w }) }, { value: "sentences", label: tr("Sentences {p0}", { p0: counts.s }) }]} />
        <label className="relative ml-auto w-72 max-w-full">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Search words, meanings, or sentences")} placeholder={tr("Search words, meanings, or sentences")} className="field h-9 pl-9" />
        </label>
      </div>

      {tab === "words" ? (
        words.length === 0 ? (
          <Empty icon={<NotebookPen className="size-5" />} title={tr("Your vocabulary notebook is empty")}>{tr("Click a word in a completed translation or while reading to save it with its context.")}</Empty>
        ) : (
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {words.map((w) => {
              const due = dueLabel(w.dueAt);
              return (
                <article key={w.id} className="group card flex min-w-0 flex-col p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="break-words font-reading text-[21px] leading-tight text-ink">{w.text}</h3>
                    <span className={cx("shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]", due.due ? "bg-seal-soft text-seal" : "bg-paper-2 text-ink-3")}>{due.text}</span>
                  </div>
                  {isEditing("word", w.id) ? (
                    <div className="mt-2 space-y-1.5">
                      <input autoFocus value={editMeaning} onChange={(e) => setEditMeaning(e.target.value)} onKeyDown={editKeys(() => saveWord(w))} placeholder={tr("Meaning")} className="field h-8 text-[13px]" />
                      <div className="flex gap-1.5">
                        <input value={editNote} onChange={(e) => setEditNote(e.target.value)} onKeyDown={editKeys(() => saveWord(w))} placeholder={tr("Note (collocations, examples, common mistakes…)")} className="field h-8 text-[13px]" />
                        <IconButton label={tr("Save")} onClick={() => saveWord(w)}><Check className="size-4" /></IconButton>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="mt-1.5 text-[13.5px] text-ink-2">{w.meaning || <span className="text-ink-3">{tr("(No meaning yet)")}</span>}</p>
                      {w.note && <p className="selectable mt-1.5 text-[12.5px] leading-relaxed text-ink-3">{tr("common.note", { note: w.note })}</p>}
                    </>
                  )}
                  {w.context && <p className="selectable mt-3 line-clamp-3 border-l-2 border-line-2 pl-3 font-display text-[13px] leading-relaxed text-ink-3"><Highlight text={w.context} word={w.text} /></p>}
                  <div className="mt-auto flex items-center gap-0.5 pt-3 opacity-60 transition-opacity group-hover:opacity-100">
                    <span className="mr-auto font-mono text-[10px] text-ink-3">{tr("notebook.reviews", { language: lang(w.lang).label, count: w.reps })}</span>
                    <IconButton label={tr("Read aloud")} onClick={() => say(w.text, w.lang)}><Volume2 className="size-3.5" /></IconButton>
                    <IconButton label={tr("Edit meaning and note")} onClick={() => startEdit("word", w.id, w.meaning, w.note)}><Pencil className="size-3.5" /></IconButton>
                    <ConfirmIconButton label={tr("Delete")} onConfirm={() => remove("word", w.id)}><Trash2 className="size-3.5" /></ConfirmIconButton>
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : sentences.length === 0 ? (
        <Empty icon={<NotebookPen className="size-5" />} title={tr("No saved sentences yet")}>{tr("Save a sentence during practice or reading. Saved sentences are scheduled for spaced review.")}</Empty>
      ) : (
        <ol className="stagger divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card/60">
          {sentences.map((s) => {
            const due = dueLabel(s.dueAt);
            return (
              <li key={s.id} className="group flex flex-wrap items-start gap-4 px-5 py-5 hover:bg-card">
                <div className="min-w-0 flex-1">
                  <p className="selectable font-display text-[17px] leading-relaxed text-ink">{s.target}</p>
                  <p className="selectable mt-1 text-[13px] text-ink-3">{s.source}</p>
                  {isEditing("sentence", s.id) ? (
                    <div className="mt-2 flex max-w-xl gap-1.5">
                      <input autoFocus value={editNote} onChange={(e) => setEditNote(e.target.value)} onKeyDown={editKeys(() => saveSentenceNote(s))} placeholder={tr("Note (grammar, situations…)")} className="field h-8 text-[13px]" />
                      <IconButton label={tr("Save")} onClick={() => saveSentenceNote(s)}><Check className="size-4" /></IconButton>
                    </div>
                  ) : (
                    s.note && <p className="selectable mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{tr("common.note", { note: s.note })}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <span className={cx("mr-2 rounded-full px-2 py-0.5 font-mono text-[10px]", due.due ? "bg-seal-soft text-seal" : "bg-paper-2 text-ink-3")}>{due.text}</span>
                  <IconButton label={tr("Read aloud")} onClick={() => say(s.target, s.targetLang)}><Volume2 className="size-3.5" /></IconButton>
                  <IconButton label={tr("Practice this sentence")} onClick={() => practice([s])}><PenLine className="size-3.5" /></IconButton>
                  <IconButton label={tr("Edit note")} onClick={() => startEdit("sentence", s.id, "", s.note)}><Pencil className="size-3.5" /></IconButton>
                  <ConfirmIconButton label={tr("Delete")} onConfirm={() => remove("sentence", s.id)}><Trash2 className="size-3.5" /></ConfirmIconButton>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
