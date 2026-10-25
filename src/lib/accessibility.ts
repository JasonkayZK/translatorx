import { isTauri } from "./api";

export interface AccessibilityDiagnostics {
  supported: boolean;
  trusted: boolean;
  executable: string;
  bundleId: string;
  signature: "adhoc" | "certificate" | "unsigned" | "unknown" | "unsupported";
}

export async function accessibilityDiagnostics(): Promise<AccessibilityDiagnostics> {
  if (!isTauri) {
    return { supported: false, trusted: false, executable: "Browser preview", bundleId: "com.translatorx.desktop", signature: "unsupported" };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AccessibilityDiagnostics>("ax_diagnostics");
}
