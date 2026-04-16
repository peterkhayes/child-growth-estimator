import type { Measurement } from "./storage.js";

export interface SharePayload {
  birthday: string;
  sex: string;
  measurements: Measurement[];
}

export const SHARE_PARAM = "d";

export function encodeShare(payload: SharePayload): string {
  return btoa(JSON.stringify(payload))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(encoded: string): SharePayload | null {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "==".slice(0, (4 - b64.length % 4) % 4);
    return JSON.parse(atob(padded)) as SharePayload;
  } catch {
    return null;
  }
}
