// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Header } from "./Header";
import { useMini } from "./store";
import { setLocale } from "../lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
const root = createRoot(host);
afterEach(async () => { await act(async () => { root.render(null); useMini.setState({ popover: false }); }); });

it("exposes the appearance toggle state and an accessible name", async () => {
  setLocale("en");
  await act(async () => root.render(createElement(Header)));
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Transparency"]');
  expect(button).not.toBeNull();
  expect(button?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => button!.click());
  expect(button?.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector('input[type="range"]')).not.toBeNull();
});

it("keeps the pin state accessible without relying on its color", async () => {
  setLocale("en");
  await act(async () => root.render(createElement(Header)));
  const pin = host.querySelector<HTMLButtonElement>('button[title*="Pin:"]');
  expect(pin?.getAttribute("aria-pressed")).toBe("false");
});
