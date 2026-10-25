import { useEffect } from "react";
import { create } from "zustand";
import { api, onEvent } from "./api";

export const useBackgroundAsset = create(() => ({ dataUrl: null as string | null, loading: false, error: "" }));
let request = 0;
let consumers = 0;
let generation = 0;
let unlisten: (() => void) | undefined;

export async function refreshBackground(): Promise<void> {
  const current = ++request;
  useBackgroundAsset.setState({ loading: true, error: "" });
  try {
    const dataUrl = await api.getBackgroundImage();
    if (current === request) useBackgroundAsset.setState({ dataUrl, loading: false, error: "" });
  } catch (error) {
    if (current === request) useBackgroundAsset.setState({ dataUrl: null, loading: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function retain() {
  consumers++;
  if (consumers === 1) {
    const current = ++generation;
    // Subscribe before the initial read so a concurrent replacement cannot be missed.
    void onEvent("background-image-changed", () => { void refreshBackground(); }).then((stop) => {
      if (current !== generation || !consumers) { stop(); return; }
      unlisten = stop;
      void refreshBackground();
    }).catch((error) => {
      if (current === generation) useBackgroundAsset.setState({ error: String(error), loading: false });
    });
  }
  return () => {
    if (--consumers === 0) {
      generation++;
      request++;
      unlisten?.();
      unlisten = undefined;
      useBackgroundAsset.setState({ dataUrl: null, error: "", loading: false });
    }
  };
}

export function useBackgroundImage(enabled = true) {
  const image = useBackgroundAsset((s) => s.dataUrl);
  useEffect(() => enabled ? retain() : undefined, [enabled]);
  return enabled ? image : null;
}
