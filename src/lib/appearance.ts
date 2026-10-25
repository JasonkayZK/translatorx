import type { CSSProperties } from "react";
import { bounded } from "./types";
import type { MaterialPrefs } from "./types";

/** Alpha belongs to fills, never the foreground container. Text stays fully opaque. */
export function materialStyle(material: MaterialPrefs): CSSProperties {
  const opacity = bounded(material.opacity, .3, 1, .85);
  return {
    "--window-opacity": opacity,
    "--surface-opacity": opacity,
    "--editor-opacity": Math.min(1, opacity + .12),
    "--chrome-opacity": Math.min(1, opacity + .04),
    "--surface-blur": material.blur ? "18px" : "0px",
  } as CSSProperties;
}
