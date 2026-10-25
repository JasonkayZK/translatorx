import { mergeSettings, normalizeSettings } from "./types";
import type { Settings, SettingsPatch } from "./types";

interface WriterOptions {
  read: () => Settings;
  apply: (settings: Settings) => void;
  save: (patch: SettingsPatch) => Promise<Settings>;
  error: (error: Error) => void;
}

function combine(a: SettingsPatch, b: SettingsPatch): SettingsPatch {
  const next = { ...a, ...b };
  for (const key of ["llm", "mini", "mainAppearance", "background", "goals", "review"] as const) {
    if (a[key] || b[key]) Object.assign(next, { [key]: { ...a[key], ...b[key] } });
  }
  return next;
}

/** Each webview has one writer. Only dirty fields cross IPC; incoming events
 * update the committed base without undoing a slider that is still being dragged. */
export function createSettingsWriter(options: WriterOptions) {
  let committed = normalizeSettings(options.read());
  let pending: SettingsPatch = {};
  let inFlight: SettingsPatch | undefined;
  let flight: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let received = 0;
  let waiting: (() => void)[] = [];
  const hasPending = () => Object.keys(pending).length > 0;
  const show = () => options.apply(mergeSettings(mergeSettings(committed, inFlight ?? {}), pending));

  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    if (flight) return flight.then(flush);
    if (!hasPending()) return Promise.resolve();
    const patch = pending;
    const complete = waiting;
    const before = received;
    pending = {};
    waiting = [];
    inFlight = patch;
    flight = (async () => {
      try {
        const saved = await options.save(patch);
        // An event received during the request may already describe a later commit.
        if (received === before) committed = normalizeSettings(saved);
      } catch (error) {
        options.error(error instanceof Error ? error : new Error(String(error)));
      } finally {
        inFlight = undefined;
        flight = undefined;
        show();
        complete.forEach((resolve) => resolve());
        if (hasPending() && timer === undefined) void flush();
      }
    })();
    return flight;
  }

  return {
    update(patch: SettingsPatch, delayed = false): Promise<void> {
      if (!Object.keys(patch).length) return flush();
      if (!inFlight && !hasPending()) committed = normalizeSettings(options.read());
      pending = combine(pending, patch);
      const done = new Promise<void>((resolve) => waiting.push(resolve));
      show();
      clearTimeout(timer);
      if (delayed) timer = setTimeout(() => { timer = undefined; void flush(); }, 300);
      else void flush();
      return done;
    },
    receive(settings: Settings) {
      received++;
      committed = normalizeSettings(settings);
      show();
    },
    flush,
  };
}
