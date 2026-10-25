import { useSyncExternalStore } from "react";
import en from "../locales/en.json";
import zh from "../locales/zh-CN.json";
import ja from "../locales/ja.json";
import type { UiLanguage } from "./types";

export type Locale = "en" | "zh-CN" | "ja";
export type TranslationKey = keyof typeof en;
export type Params = Record<string, string | number>;
export const catalogs: Record<Locale, Record<TranslationKey, string>> = { en, "zh-CN": zh, ja };

/** Match the primary language, including region/script tags and legacy underscore tags. */
export function resolveLocale(preference: UiLanguage, systemLanguage: string): Locale {
  if (preference !== "system") return preference;
  const primary = systemLanguage.trim().toLowerCase().split(/[-_.]/)[0];
  return primary === "zh" ? "zh-CN" : primary === "ja" ? "ja" : "en";
}

let systemLanguage = typeof navigator === "undefined" ? "en" : navigator.language;
let locale: Locale = resolveLocale("system", systemLanguage);
const subscribers = new Set<() => void>();
export const getLocale = (): Locale => locale;
export const subscribeLocale = (listener: () => void) => {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
};

export function setLocale(preference: UiLanguage, nativeLanguage?: string): Locale {
  if (nativeLanguage) systemLanguage = nativeLanguage;
  const next = resolveLocale(preference, systemLanguage);
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (next !== locale) {
    locale = next;
    subscribers.forEach((listener) => listener());
  }
  return next;
}

export function interpolate(template: string, params: Params = {}): string {
  return template.replace(/\{([\w]+)\}/g, (token, key: string) => {
    const value = params[key];
    return value === undefined ? token : typeof value === "number" ? formatNumber(value) : value;
  });
}

/** Also accepts runtime keys from backend error codes. Missing translations fall back to English. */
export const hasTranslation = (key: string): boolean => Object.prototype.hasOwnProperty.call(en, key);

export function t(key: string, params?: Params): string {
  const k = key as TranslationKey;
  return interpolate(catalogs[locale][k] ?? en[k] ?? key, params);
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => "en" as Locale);
  return { t, locale };
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
  // Older weekly buckets store only MM/DD. Parse explicitly (Safari rejects ambiguous dates)
  // and omit an invented year when displaying them. The leap year accepts February 29.
  if (typeof value === "string" && /^\d{2}\/\d{2}$/.test(value)) {
    const [month, day] = value.split("/").map(Number);
    return new Intl.DateTimeFormat(locale, options ?? { month: "short", day: "numeric" }).format(new Date(2000, month - 1, day));
  }
  // Database date-only buckets represent local calendar dates, not midnight UTC.
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
