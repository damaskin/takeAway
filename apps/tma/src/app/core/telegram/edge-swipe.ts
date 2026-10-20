/**
 * The iOS «swipe from the left edge to go back», which a Telegram Mini App
 * does not get from Telegram: only its BackButton goes back there. Pure
 * touch arithmetic, fed by `TmaEdgeSwipeBackComponent`, so the thresholds
 * can be tested without a phone.
 *
 * A swipe counts when it starts within `edgeWidth` of the left edge, moves
 * mostly to the right, and either goes `triggerDistance` far or is a quick
 * flick past `flickDistance`. A mostly vertical move is a scroll and drops
 * the gesture at once, so lists keep scrolling as before.
 */
export interface EdgeSwipeOptions {
  /** How close to the left edge the finger has to land, in CSS px. */
  edgeWidth: number;
  /** Rightward travel before the gesture shows (and claims the touch). */
  engageDistance: number;
  /** Travel that goes back on release. */
  triggerDistance: number;
  /** A shorter swipe still goes back when it is at least this long and fast. */
  flickDistance: number;
  /** Average speed of a flick, in px per ms. */
  flickSpeed: number;
}

export const EDGE_SWIPE_DEFAULTS: EdgeSwipeOptions = {
  edgeWidth: 24,
  engageDistance: 12,
  triggerDistance: 80,
  flickDistance: 40,
  flickSpeed: 0.5,
};

type Phase = 'idle' | 'tracking' | 'dragging';

export class EdgeSwipe {
  private phase: Phase = 'idle';
  private x0 = 0;
  private y0 = 0;
  private t0 = 0;

  constructor(private readonly options: EdgeSwipeOptions = EDGE_SWIPE_DEFAULTS) {}

  /** The finger is on the glass and moving right, close to the edge: show the hint. */
  get dragging(): boolean {
    return this.phase === 'dragging';
  }

  /**
   * A finger landed. `leftInset`: the safe area on the left (a landscape
   * notch), so the edge band starts where the content does. True when the
   * touch may become a swipe back.
   */
  start(x: number, y: number, time: number, leftInset = 0): boolean {
    if (x > leftInset + this.options.edgeWidth) {
      this.phase = 'idle';
      return false;
    }
    this.phase = 'tracking';
    this.x0 = x;
    this.y0 = y;
    this.t0 = time;
    return true;
  }

  /** The finger moved. Returns how far the swipe is towards going back: 0 to 1. */
  move(x: number, y: number): number {
    if (this.phase === 'idle') return 0;
    const dx = x - this.x0;
    const dy = Math.abs(y - this.y0);
    if (this.phase === 'tracking') {
      // Up, down or left first: a scroll or something else, not a way back.
      if (dx < -4 || dy > Math.max(16, dx)) {
        this.phase = 'idle';
        return 0;
      }
      if (dx >= this.options.engageDistance && dx > dy * 1.5) this.phase = 'dragging';
      else return 0;
    }
    return Math.min(1, Math.max(0, dx / this.options.triggerDistance));
  }

  /** The finger lifted. True when that is a swipe back. */
  end(x: number, time: number): boolean {
    const wasDragging = this.phase === 'dragging';
    this.phase = 'idle';
    if (!wasDragging) return false;
    const dx = x - this.x0;
    if (dx >= this.options.triggerDistance) return true;
    const elapsed = Math.max(1, time - this.t0);
    return dx >= this.options.flickDistance && dx / elapsed >= this.options.flickSpeed;
  }

  /** The system took the touch over (`touchcancel`), or a second finger came down. */
  cancel(): void {
    this.phase = 'idle';
  }

  /** Where the finger started, for the hint's height. */
  get startY(): number {
    return this.y0;
  }
}
