import { useLiveQuery } from "dexie-react-hooks";
import { db, type BoardPosRec } from "./db";
import { assertWritable } from "./repo";

export interface BoardPlacement {
  id: string;
  x: number;
  y: number;
}

const round = (n: number) => Math.round(n);

/** Saved card positions on one case's evidence board. The id of each row is the id of the item it places. */
export const useBoardPositions = (caseId: string) =>
  useLiveQuery(() => db.boardPositions.where("caseId").equals(caseId).toArray(), [caseId]);

/** Board layout writes. Positions are layout only: they never touch the records themselves. */
export const boardRepo = {
  /** Saves positions for items that have none yet. A saved position is never overwritten here. */
  async placeNew(caseId: string, placements: BoardPlacement[]) {
    if (placements.length === 0) return;
    await assertWritable(caseId);
    await db.transaction("rw", db.boardPositions, async () => {
      const existing = await db.boardPositions.bulkGet(placements.map((p) => p.id));
      const fresh: BoardPosRec[] = placements.filter((_, i) => !existing[i]).map((p) => ({ id: p.id, caseId, x: round(p.x), y: round(p.y) }));
      if (fresh.length) await db.boardPositions.bulkPut(fresh);
    });
  },

  /** Moves one card and keeps its hidden flag. */
  async move(caseId: string, id: string, x: number, y: number) {
    await assertWritable(caseId);
    await db.transaction("rw", db.boardPositions, async () => {
      const cur = await db.boardPositions.get(id);
      await db.boardPositions.put({ ...cur, id, caseId, x: round(x), y: round(y) });
    });
  },

  /** Rewrites positions after an automatic arrangement. Hidden flags are kept. */
  async arrange(caseId: string, placements: BoardPlacement[]) {
    if (placements.length === 0) return;
    await assertWritable(caseId);
    await db.transaction("rw", db.boardPositions, async () => {
      const existing = await db.boardPositions.bulkGet(placements.map((p) => p.id));
      await db.boardPositions.bulkPut(
        placements.map((p, i) => ({ ...existing[i], id: p.id, caseId, x: round(p.x), y: round(p.y) })),
      );
    });
  },

  /** Takes a card off the board or puts it back. `at` is used when the card has no saved position yet. */
  async setHidden(caseId: string, id: string, hidden: boolean, at?: { x: number; y: number }) {
    await assertWritable(caseId);
    await db.transaction("rw", db.boardPositions, async () => {
      const cur = await db.boardPositions.get(id);
      const base = cur ?? (at ? { id, caseId, x: round(at.x), y: round(at.y) } : null);
      if (!base) return;
      const next: BoardPosRec = { id, caseId, x: base.x, y: base.y };
      if (hidden) next.hidden = true;
      await db.boardPositions.put(next);
    });
  },
};
