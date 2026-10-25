import { expect, it } from "vitest";
import { materialStyle } from "./appearance";
it("changes real surface opacity without changing foreground opacity", () => {
  const clear = materialStyle({ opacity: .3, blur: true }) as Record<string, unknown>;
  const solid = materialStyle({ opacity: 1, blur: false }) as Record<string, unknown>;
  expect(clear["--surface-opacity"]).toBe(.3);
  expect(solid["--surface-opacity"]).toBe(1);
  expect(clear["--editor-opacity"]).toBeLessThan(.92);
  expect(clear["--surface-blur"]).toBe("18px");
  expect(solid["--surface-blur"]).toBe("0px");
  expect(clear).not.toHaveProperty("opacity");
});
