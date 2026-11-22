// 自動退避（FR-ST-01）。ブラウザ内に最新 1 件だけを保持する。失敗しても例外を外へ出さない。
import { type Project, parseProject, serializeProject } from './project';

export const AUTOSAVE_KEY = 'circuit-review:autosave';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveAutosave(storage: KeyValueStorage, project: Project): boolean {
  try {
    storage.setItem(AUTOSAVE_KEY, serializeProject(project));
    return true;
  } catch {
    return false;
  }
}

export function loadAutosave(storage: KeyValueStorage): Project | null {
  try {
    const text = storage.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    const r = parseProject(text);
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

export function clearAutosave(storage: KeyValueStorage): void {
  try {
    storage.removeItem(AUTOSAVE_KEY);
  } catch {
    // 消去できなくても画面は動かす
  }
}
