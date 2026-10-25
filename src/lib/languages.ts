import { languageName } from "./i18n";
export interface Language {
  code: string;
  name: string; // endonym
  label: string;
  speech: string; // BCP 47 tag for speech synthesis
  spaced: boolean; // whether words are separated by spaces
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", speech: "en-US", spaced: true },
  { code: "zh-CN", name: "简体中文", speech: "zh-CN", spaced: false },
  { code: "zh-TW", name: "繁體中文", speech: "zh-TW", spaced: false },
  { code: "ja", name: "日本語", speech: "ja-JP", spaced: false },
  { code: "ko", name: "한국어", speech: "ko-KR", spaced: true },
  { code: "vi", name: "Tiếng Việt", speech: "vi-VN", spaced: true },
  { code: "ru", name: "Русский", speech: "ru-RU", spaced: true },
  { code: "es", name: "Español", speech: "es-ES", spaced: true },
  { code: "pt", name: "Português", speech: "pt-BR", spaced: true },
  { code: "fr", name: "Français", speech: "fr-FR", spaced: true },
  { code: "de", name: "Deutsch", speech: "de-DE", spaced: true },
  { code: "it", name: "Italiano", speech: "it-IT", spaced: true },
  { code: "nl", name: "Nederlands", speech: "nl-NL", spaced: true },
  { code: "id", name: "Bahasa Indonesia", speech: "id-ID", spaced: true },
  { code: "ms", name: "Bahasa Melayu", speech: "ms-MY", spaced: true },
  { code: "sv", name: "Svenska", speech: "sv-SE", spaced: true },
  { code: "pl", name: "Polski", speech: "pl-PL", spaced: true },
  { code: "tr", name: "Türkçe", speech: "tr-TR", spaced: true },
].map((language) => ({ ...language, get label() { return languageName(language.code); } }));

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));

export function lang(code: string): Language {
  return byCode.get(code) ?? { code, name: code, label: languageName(code), speech: code, spaced: true };
}

/** Short badge label, e.g. "EN", "中", "日". */
export function badge(code: string): string {
  const special: Record<string, string> = { "zh-CN": "简", "zh-TW": "繁", ja: "日", ko: "한" };
  return special[code] ?? code.slice(0, 2).toUpperCase();
}

/** Joins translated segments the way the language writes them. */
export function joinSegments(parts: { text: string; breakAfter?: boolean }[], code: string): string {
  const sep = lang(code).spaced ? " " : "";
  let out = "";
  parts.forEach((p, i) => {
    out += p.text.trim();
    if (i < parts.length - 1) out += p.breakAfter ? "\n" : sep;
  });
  return out;
}
