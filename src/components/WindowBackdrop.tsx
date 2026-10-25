import type { CSSProperties } from "react";
import { useBackgroundImage } from "../lib/background";
import type { BackgroundPrefs } from "../lib/types";

/** A sibling behind the content: never measured by Mini's ResizeObserver. */
export function WindowBackdrop({ background, enabled = true }: { background: BackgroundPrefs; enabled?: boolean }) {
  const image = useBackgroundImage(enabled);
  return (
    <div className="window-backdrop" aria-hidden="true">
      {image && <img src={image} alt="" className="window-wallpaper" data-fit={background.fit}
        style={{ opacity: background.opacity, filter: `blur(${background.blur}px)`, objectFit: background.fit,
          ["--image-bleed" as string]: `${background.blur * 2}px`,
        } as CSSProperties} />}
    </div>
  );
}
