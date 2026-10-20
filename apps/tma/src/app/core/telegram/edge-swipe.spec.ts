import { EdgeSwipe } from './edge-swipe';

describe('EdgeSwipe', () => {
  /** A finger from (x0, y0) through `path`, lifted at the last point after `ms`. */
  function swipe(x0: number, y0: number, path: Array<[number, number]>, ms = 300): { back: boolean; peak: number } {
    const gesture = new EdgeSwipe();
    if (!gesture.start(x0, y0, 0)) return { back: false, peak: 0 };
    let peak = 0;
    for (const [x, y] of path) peak = Math.max(peak, gesture.move(x, y));
    const last = path[path.length - 1] ?? [x0, y0];
    return { back: gesture.end(last[0], ms), peak };
  }

  it('goes back on a swipe right from the left edge', () => {
    const result = swipe(6, 400, [
      [30, 402],
      [70, 405],
      [110, 408],
    ]);
    expect(result.back).toBe(true);
    expect(result.peak).toBe(1);
  });

  it('ignores a swipe that starts away from the edge', () => {
    expect(swipe(60, 400, [[200, 400]]).back).toBe(false);
  });

  // Scrolling a list that starts near the edge must keep working.
  it('lets a vertical move scroll', () => {
    const result = swipe(8, 400, [
      [12, 380],
      [30, 300],
      [120, 250],
    ]);
    expect(result.back).toBe(false);
    expect(result.peak).toBe(0);
  });

  it('stays put when the finger comes back before letting go', () => {
    expect(
      swipe(8, 400, [
        [60, 402],
        [20, 402],
      ]).back,
    ).toBe(false);
  });

  it('takes a short quick flick', () => {
    expect(swipe(8, 400, [[60, 403]], 60).back).toBe(true);
    expect(swipe(8, 400, [[60, 403]], 600).back).toBe(false);
  });

  it('starts the edge after a landscape notch', () => {
    const gesture = new EdgeSwipe();
    expect(gesture.start(50, 300, 0, 44)).toBe(true);
    expect(gesture.start(80, 300, 0, 44)).toBe(false);
  });

  it('drops the gesture when the system takes the touch', () => {
    const gesture = new EdgeSwipe();
    gesture.start(5, 300, 0);
    gesture.move(60, 300);
    gesture.cancel();
    expect(gesture.end(120, 100)).toBe(false);
  });
});
