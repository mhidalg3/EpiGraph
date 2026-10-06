/**
 * Cosmetic canvas geometry only. Positions are hand-authored for the Northstar W01–W14 backbone and carry no
 * semantic meaning: nothing in the engine, the model or any verdict reads them.
 */

export interface Point {
  x: number;
  y: number;
}

export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 132;
export const NOTE_WIDTH = 220;
export const NOTE_HEIGHT = 96;
export const SYSTEM_NODE_WIDTH = 190;

const X0 = 50;
const COLUMN_STEP = 244;
const col = (n: number): number => X0 + n * COLUMN_STEP;

const SUPPLIER_ROW_Y = 70;
const INVOICE_ROW_Y = 440;
const EXCEPTION_ROW_Y = 700;
const NOTE_GAP = 14;
const SYSTEM_GAP = 24;

export interface LaneBand {
  id: 'supplier' | 'invoice';
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const LANE_WIDTH = col(4) + NODE_WIDTH + X0;

export const LANE_BANDS: readonly LaneBand[] = [
  { id: 'supplier', label: 'Supplier management', x: 0, y: 0, width: LANE_WIDTH, height: 290 },
  { id: 'invoice', label: 'Invoice-to-payment', x: 0, y: 306, width: LANE_WIDTH, height: 700 },
];

/** Where expanded finding notes go relative to their activity so they never cover a neighbouring backbone node. */
type NoteSide = 'above' | 'below';

interface Slot extends Point {
  noteSide: NoteSide;
}

const SLOTS: Readonly<Record<string, Slot>> = {
  W01: { x: col(0), y: SUPPLIER_ROW_Y, noteSide: 'below' },
  W02: { x: col(1), y: SUPPLIER_ROW_Y, noteSide: 'below' },
  W03: { x: col(2), y: SUPPLIER_ROW_Y, noteSide: 'below' },
  W04: { x: col(3), y: SUPPLIER_ROW_Y, noteSide: 'below' },
  W05: { x: col(4), y: SUPPLIER_ROW_Y, noteSide: 'below' },
  W06: { x: col(0), y: INVOICE_ROW_Y, noteSide: 'above' },
  W07: { x: col(1), y: INVOICE_ROW_Y, noteSide: 'above' },
  W08: { x: col(2), y: INVOICE_ROW_Y, noteSide: 'above' },
  W09: { x: col(3), y: INVOICE_ROW_Y, noteSide: 'above' },
  W10: { x: col(4), y: INVOICE_ROW_Y, noteSide: 'above' },
  W11: { x: col(4), y: EXCEPTION_ROW_Y, noteSide: 'below' },
  W12: { x: col(2), y: EXCEPTION_ROW_Y, noteSide: 'below' },
  W14: { x: col(3), y: EXCEPTION_ROW_Y, noteSide: 'below' },
  W13: { x: col(0), y: EXCEPTION_ROW_Y, noteSide: 'below' },
};

/** Declared backbone order, used only to avoid drawing data-flow arrows against the process direction. */
export const ACTIVITY_ORDER: readonly string[] = Object.keys(SLOTS);

const FALLBACK_Y = EXCEPTION_ROW_Y + NODE_HEIGHT + 2 * (NOTE_HEIGHT + NOTE_GAP);

/** Activities outside the Northstar backbone (imported models) are laid out in a plain grid below it. */
function slotFor(activityId: string, fallbackIndex: number): Slot {
  return SLOTS[activityId] ?? { x: col(fallbackIndex % 5), y: FALLBACK_Y + Math.floor(fallbackIndex / 5) * (NODE_HEIGHT + NOTE_GAP * 2), noteSide: 'below' };
}

export function activityPosition(activityId: string, fallbackIndex: number): Point {
  const { x, y } = slotFor(activityId, fallbackIndex);
  return { x, y };
}

/** Position of the `index`-th of `count` notes centred on the activity, on the side that keeps the backbone clear. */
export function notePosition(activityId: string, fallbackIndex: number, count: number, index: number): Point {
  const slot = slotFor(activityId, fallbackIndex);
  const gap = 10;
  const rowWidth = count * NOTE_WIDTH + (count - 1) * gap;
  return {
    x: slot.x + NODE_WIDTH / 2 - rowWidth / 2 + index * (NOTE_WIDTH + gap),
    y: slot.noteSide === 'above' ? slot.y - NOTE_HEIGHT - NOTE_GAP : slot.y + NODE_HEIGHT + NOTE_GAP,
  };
}

/** Recipient systems of data transfers sit in the free band beneath their sending activity. */
export function systemPosition(activityId: string, fallbackIndex: number, index: number): Point {
  const slot = slotFor(activityId, fallbackIndex);
  return {
    x: slot.x + index * (SYSTEM_NODE_WIDTH + 12),
    y: slot.y + NODE_HEIGHT + SYSTEM_GAP + (slot.noteSide === 'above' ? 0 : NOTE_HEIGHT + NOTE_GAP),
  };
}
