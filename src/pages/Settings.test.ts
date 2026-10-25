// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { SettingsPage } from "./Settings";
import { setLocale } from "../lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(host); });

it("makes appearance easy to find without unmounting other settings", async () => {
  setLocale("en");
  await act(async () => root.render(createElement(SettingsPage)));
  const link = host.querySelector<HTMLAnchorElement>('nav[aria-label="Settings sections"] a[href="#appearance"]');
  expect(link).not.toBeNull();
  const secret = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(secret).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(secret, "unsaved-local-key");
    secret.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => link!.click());
  expect(host.querySelector('input[type="password"]')).toBe(secret);
  expect(secret.value).toBe("unsaved-local-key");
  expect([...host.querySelectorAll("section[id]")].map((s) => s.id)).toEqual(expect.arrayContaining(["appearance", "general", "services", "practice", "desktop"]));
});
