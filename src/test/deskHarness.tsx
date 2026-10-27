// 机（Desk）のコンポーネントテストの共通部品。各テストファイルで phaser を vi.mock してから使う。
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { GameState } from "../domain/GameState";
import { App } from "../ui/App";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, type Settings } from "../ui/settings/settings";
import { makeTestGameApi } from "./gameApi";

/** 机に載っている情報（入力欄はその値、選択肢は選んでいるもの）。飾り（aria-hidden）は除く */
export const readable = (root: Element): string => {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.getAttribute("aria-hidden") === "true") return;
    // 並べ読みの語（map-ref）は文中の inline 要素：それを含む文はひとつながりに読む（平面では常に付き、俯瞰では Tab のときだけ付くため）
    if (Array.from(node.children).some((child) => child.getAttribute("data-testid") === "map-ref")) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
      parts.push(`[${node.value}]`);
      return;
    }
    if (node instanceof HTMLSelectElement) {
      parts.push(`[${node.selectedOptions[0]?.textContent ?? ""}]`);
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(root);
  return parts.join(" ").replace(/\s+/g, " ").trim();
};

/** 情報を持つ書類（ランプは飾り） */
export const INFO_OBJECTS = ["ledger", "map", "letters", "newspaper", "result", "decree", "stamp", "notepad", "archive"] as const;
/** 入力欄のある書類：俯瞰では読むだけの紙なので、手元で平面と比べる */
export const WRITABLE = ["decree", "notepad"] as const;

export const storageWith = (settings: Partial<Settings>) => {
  const data = new Map<string, string>([[SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...settings })]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

export const memoryStorage = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

export const renderDesk = async (settings: Partial<Settings>, saved: GameState | null = null, notesStorage = memoryStorage()) => {
  const api = makeTestGameApi({ saved, seed: 11 });
  const view = render(<App api={api} settingsStorage={storageWith(settings)} notesStorage={notesStorage} fpsFromQuery={false} />);
  await screen.findByTestId("year");
  await act(async () => {}); // 任命候補の読み込みを待つ
  return { api, notesStorage, ...view };
};

export const object = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-object="${id}"]`);
  if (el === null) throw new Error(`机に ${id} が無い`);
  return el;
};

export type InfoId = (typeof INFO_OBJECTS)[number];
export const readAll = (): Record<InfoId, string> => Object.fromEntries(INFO_OBJECTS.map((id) => [id, readable(object(id))])) as Record<InfoId, string>;

export const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key });

/** 祖先まで含めて、遠近の変形が掛かっていないか（インラインの transform を見る。CSS の傾きは手元・平面では外している） */
export const underPerspective = (el: Element): boolean => {
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (node instanceof HTMLElement && node.style.transform.includes("perspective")) return true;
  }
  return false;
};

