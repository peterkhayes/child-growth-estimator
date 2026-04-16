export interface Measurement {
  date: string;   // ISO date string (YYYY-MM-DD)
  height: string; // stored in cm
  weight: string; // stored in kg
}

export interface StoredData {
  birthday: string;
  sex: string;
  unit: string;
  measurements: Measurement[];
  queryAge: string;
  queryHeight: string;
  queryWeight: string;
  queryMode: string;
}

declare global {
  interface Window {
    storage?: {
      get(key: string): Promise<{ value: string } | null | undefined>;
      set(key: string, value: string): Promise<void>;
    };
  }
}

export const STORAGE_KEY = "child-growth-data";

export async function loadData(): Promise<Partial<StoredData> | null> {
  const result = await window.storage?.get(STORAGE_KEY);
  if (!result?.value) return null;
  return JSON.parse(result.value) as Partial<StoredData>;
}

export async function saveData(data: StoredData): Promise<void> {
  await window.storage?.set(STORAGE_KEY, JSON.stringify(data));
}
