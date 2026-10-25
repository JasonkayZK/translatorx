import { api } from "./api";
import { lang } from "./languages";

let audio: HTMLAudioElement | null = null;
const cache = new Map<string, string>();

function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 400);
  });
}

async function systemVoice(tag: string): Promise<SpeechSynthesisVoice | null> {
  if (!("speechSynthesis" in window)) return null;
  const voices = await voicesReady();
  const lower = tag.toLowerCase();
  const base = lower.split("-")[0];
  return (
    voices.find((v) => v.lang.toLowerCase().replace("_", "-") === lower && v.localService) ??
    voices.find((v) => v.lang.toLowerCase().replace("_", "-") === lower) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ??
    null
  );
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (audio) {
    audio.pause();
    audio = null;
  }
}

/** Speaks with a system voice when one exists, otherwise falls back to online TTS. */
export async function speak(text: string, code: string, opts: { engine: "system" | "google"; rate: number }): Promise<void> {
  stopSpeaking();
  if (!text.trim()) return;
  const tag = lang(code).speech;
  if (opts.engine === "system") {
    const voice = await systemVoice(tag);
    if (voice) {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = opts.rate;
      window.speechSynthesis.speak(u);
      return;
    }
  }
  const key = `${code}|${text}`;
  let b64 = cache.get(key);
  if (!b64) {
    b64 = await api.speak(text, code);
    cache.set(key, b64);
  }
  audio = new Audio(`data:audio/mpeg;base64,${b64}`);
  audio.playbackRate = opts.rate;
  await audio.play();
}
