// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gridIndexOf } from "../../domain/Landscape";
import { addNote, emptyNotes } from "../../domain/PlayerNotes";
import { gazetteerFor } from "../../engine/Gazetteer";
import { messages } from "../../i18n/messages";
import { playedState } from "../../test/gameApi";
import { MapPanel } from "./MapPanel";

// 測量図の区画の札（SPEC_v3.3 §5.6・§7）。jsdom には Canvas が無いので測量図そのものは描かれず、DOM の部分だけを確かめる。
vi.mock("phaser", () => ({ default: { Scene: class {}, Game: class {}, CANVAS: 1, Scale: { NONE: 0 }, Core: { Events: {} } } }));

afterEach(cleanup);

const DERIVED_WORDS = ["住宅容量", "食料", "衛生", "治安", "行政能力", "資材", "工期", "木材", "石材"];

describe("区画の札", () => {
  it("区画名・中身・関係する記事と報告を出し、派生指標は出さない", async () => {
    const game = await playedState(21, ["家を建てよ", "畑を開け", "家を建てよ", "市場を開け"]);
    const house = game.buildings.find((b) => b.kind === "residential" && b.tile !== null);
    if (!house?.tile) throw new Error("no house");
    const index = gridIndexOf(house.tile[0], house.tile[1]);
    render(<MapPanel game={game} notes={null} live interactive selected={index} onSelect={() => {}} onPin={() => {}} surveyDelay={false} />);
    const sheet = screen.getByTestId("parcel-sheet");
    expect(sheet.textContent).toContain(gazetteerFor(game.saveId).parcels[index] ?? "?");
    expect(sheet.textContent).toContain(messages.targets.residential);
    for (const word of DERIVED_WORDS) expect(sheet.textContent).not.toContain(word);
    expect(screen.getByTestId("map-canvas").getAttribute("data-survey")).toBe("unavailable");
  });

  it("区画にメモを留める（60字まで。61字では留められない）", async () => {
    const game = await playedState(22, ["家を建てよ"]);
    const onPin = vi.fn();
    render(<MapPanel game={game} notes={null} live interactive selected={44} onSelect={() => {}} onPin={onPin} surveyDelay={false} />);
    const input = screen.getByTestId("parcel-pin-text") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "あ".repeat(61) } });
    expect((screen.getByTestId("parcel-pin") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "井戸が遠い" } });
    fireEvent.click(screen.getByTestId("parcel-pin"));
    expect(onPin).toHaveBeenCalledWith("井戸が遠い", 44);
  });

  it("留めたメモはその区画の札に貼られる。手元でなければ入力欄は出さない（不変条件25）", async () => {
    const game = await playedState(23, ["家を建てよ"]);
    const notes = addNote(emptyNotes(game.saveId), { id: "n", text: "ここは低い", turnCreated: 2, attachedTo: { kind: "parcel", gridIndex: 12 } }).notes;
    render(<MapPanel game={game} notes={notes} live={false} interactive={false} selected={12} onSelect={() => {}} onPin={() => {}} surveyDelay={false} />);
    expect(screen.getByTestId("parcel-note").textContent).toContain("ここは低い");
    expect(screen.queryByTestId("parcel-pin-text")).toBeNull();
  });
});
