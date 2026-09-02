const DEFAULT_ITEM_HEIGHT = 44;
const DEFAULT_REPEATS = 5; // odd, so there's always a true middle copy to sit in
const SETTLE_DEBOUNCE_MS = 120;
const COLLAPSE_DELAY_MS = 500;

/**
 * Generates the cyclical sequence of values a wheel steps through, starting at `min`
 * and repeatedly adding `step` with wraparound - mirrors the increment/decrement
 * wraparound math in `TimeUnit`, so a wheel visits exactly the values the old
 * arrow-stepper would have.
 */
export function generateWheelRange(min: number, max: number, step: number): number[] {
  const rangeSize = max - min + 1;
  const values: number[] = [];
  const seen = new Set<number>();
  let value = min;

  do {
    values.push(value);
    seen.add(value);
    value = (((value + step - min) % rangeSize) + rangeSize) % rangeSize + min;
  } while (value !== min && !seen.has(value) && values.length < rangeSize);

  return values;
}

/**
 * Index of the closest value to `target` in `values`. Used so an entity value that doesn't
 * land exactly on the wheel's step grid (e.g. a real input_datetime minute of 23 when
 * minute_step is configured as 5, which happens with any value set outside this card - by
 * voice, an automation, or the native more-info dialog) still displays *something* sensible
 * instead of silently failing to sync at all.
 */
function nearestIndex(values: number[], target: number): number {
  let bestIndex = 0;
  let bestDistance = Math.abs(values[0] - target);

  for (let i = 1; i < values.length; i++) {
    const distance = Math.abs(values[i] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export type WheelCarry = 'up' | 'down' | null;

export interface WheelOptions {
  label: string;
  itemHeight?: number;
  format?: (value: number) => string;
  onChange?: (value: number, carry: WheelCarry, laps: number) => void;
  /** Fires immediately on interaction start, and (after a short grace delay) on interaction end. */
  onActiveChange?: (active: boolean) => void;
}

/**
 * A vertically-scrolling, infinitely-looping "wheel" picker column (the classic
 * iOS/Android time-picker interaction). Built on native scroll + CSS scroll-snap so
 * momentum, easing and touch handling all come from the platform for free; the only
 * custom logic is the circular illusion (repeating the value list and silently
 * re-centering once the user drifts too far from the middle copy) and a continuous
 * scale/opacity morph applied every animation frame while scrolling.
 */
export class TimeWheel {
  readonly element: HTMLDivElement;

  private readonly scrollEl: HTMLDivElement;
  private readonly itemHeight: number;
  private readonly repeats = DEFAULT_REPEATS;
  private readonly format: (value: number) => string;
  private readonly onChange?: (value: number, carry: WheelCarry, laps: number) => void;
  private readonly onActiveChange?: (active: boolean) => void;

  private items: HTMLDivElement[] = [];
  private values: number[] = [];
  private currentValue = 0;
  private prevRawIndex = 0;
  private rafId: number | null = null;
  private settleTimer: number | undefined;
  private collapseTimer: number | undefined;
  /**
   * A raw index whose scroll assignment was clamped to 0 because the wheel had zero size at
   * the time (a hidden dashboard view/tab, a collapsed ancestor, a sections/masonry grid cell
   * that hasn't been sized yet) - re-applied by the ResizeObserver below the moment the wheel
   * actually gets laid out. Without this, a value that arrives before the card is visible
   * gets stuck showing its default forever: `setValue()` only re-scrolls when the *value*
   * changes, and on every later hass update it already matches, so the wrong on-screen
   * position (still at index 0) is never revisited.
   */
  private pendingRawIndex: number | null = null;
  private readonly resizeObserver: ResizeObserver;

  constructor(options: WheelOptions) {
    this.itemHeight = options.itemHeight ?? DEFAULT_ITEM_HEIGHT;
    this.format = options.format ?? ((value) => String(value));
    this.onChange = options.onChange;
    this.onActiveChange = options.onActiveChange;

    this.element = document.createElement('div');
    this.element.className = 'tpc-wheel';
    this.element.tabIndex = 0;
    this.element.setAttribute('role', 'slider');
    this.element.setAttribute('aria-label', options.label);
    this.element.style.setProperty('--tpc-item-height', `${this.itemHeight}px`);

    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'tpc-wheel-scroll';
    this.scrollEl.style.overflowAnchor = 'none';
    this.element.appendChild(this.scrollEl);

    this.scrollEl.addEventListener('scroll', this.onScroll, { passive: true });
    this.element.addEventListener('keydown', this.onKeydown);
    this.element.addEventListener('pointerenter', () => this.setActive(true));
    this.element.addEventListener('pointerdown', () => this.setActive(true));
    this.element.addEventListener('pointerleave', () => this.setActive(false));
    this.element.addEventListener('focus', () => this.setActive(true));
    this.element.addEventListener('blur', () => this.setActive(false));

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.scrollEl);
  }

  /** Catches up a scroll position that was deferred because the wheel had zero size when it was requested. */
  private onResize(): void {
    if (this.pendingRawIndex === null || this.scrollEl.clientHeight === 0) {
      return;
    }
    const rawIndex = this.pendingRawIndex;
    this.pendingRawIndex = null;
    this.scrollEl.scrollTo({ top: rawIndex * this.itemHeight, behavior: 'auto' });
    this.updateVisualState();
  }

  /** Reveals the full wheel immediately, or schedules a graceful collapse after a short delay. */
  private setActive(active: boolean): void {
    window.clearTimeout(this.collapseTimer);

    if (active) {
      this.onActiveChange?.(true);
    } else {
      this.collapseTimer = window.setTimeout(() => this.onActiveChange?.(false), COLLAPSE_DELAY_MS);
    }
  }

  setValues(values: number[], selected: number): void {
    this.values = values;
    this.scrollEl.innerHTML = '';
    this.items = [];

    const middleCopy = Math.floor(this.repeats / 2);

    for (let copy = 0; copy < this.repeats; copy++) {
      for (const value of values) {
        const item = document.createElement('div');
        item.className = 'tpc-wheel-item';
        item.textContent = this.format(value);
        item.addEventListener('click', () => this.scrollToRawIndex(this.items.indexOf(item)));
        this.scrollEl.appendChild(item);
        this.items.push(item);
      }
    }

    const idxInBase = values.indexOf(selected) !== -1 ? values.indexOf(selected) : nearestIndex(values, selected);
    const startIndex = middleCopy * values.length + idxInBase;
    this.currentValue = values[idxInBase];

    // Force a layout flush before scrolling - without it the browser may still be
    // measuring the pre-insertion (empty) scrollHeight and silently clamp this to 0.
    void this.scrollEl.offsetHeight;
    this.scrollToRawIndex(startIndex, 'auto');
    this.updateVisualState();
  }

  /** Programmatically move to a value (e.g. syncing from hass, or a carry from a neighboring wheel). */
  setValue(value: number, behavior: ScrollBehavior = 'smooth'): void {
    if (this.values.length === 0) {
      return;
    }

    const exactIndex = this.values.indexOf(value);
    const idxInBase = exactIndex !== -1 ? exactIndex : nearestIndex(this.values, value);
    const snappedValue = this.values[idxInBase];

    const length = this.values.length;
    const currentRawIndex = Math.round(this.scrollEl.scrollTop / this.itemHeight);
    const currentLap = Math.floor(currentRawIndex / length);

    let bestIndex = currentLap * length + idxInBase;
    let bestDistance = Math.abs(bestIndex - currentRawIndex);

    for (const lap of [currentLap - 1, currentLap + 1]) {
      const candidate = lap * length + idxInBase;
      const distance = Math.abs(candidate - currentRawIndex);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = candidate;
      }
    }

    this.currentValue = snappedValue;

    // Skip the re-scroll only when the target value hasn't moved AND the wheel is already
    // sitting at the right raw index. Trusting currentValue alone here used to mean any
    // external event that nudges scrollTop away from it (a browser re-layout quirk, some
    // other script touching the DOM, anything) left the wheel silently stuck forever, since
    // no code path revisits a value that "hasn't changed". Skip only when at rest, though -
    // while a scroll/settle is actively in flight (a drag, momentum, our own recenter),
    // scrollTop legitimately differs from the settled position and re-snapping now would
    // fight the user's own gesture.
    const isAtRest = this.settleTimer === undefined;
    if (bestIndex === currentRawIndex || !isAtRest) {
      return;
    }

    this.scrollToRawIndex(bestIndex, behavior);
  }

  focus(): void {
    this.element.focus();
  }

  private scrollToRawIndex(rawIndex: number, behavior: ScrollBehavior = 'smooth'): void {
    this.prevRawIndex = rawIndex;

    if (this.scrollEl.clientHeight === 0) {
      // Not laid out yet (hidden view/tab, collapsed ancestor, unsized grid cell). Assigning
      // scrollTop now would silently clamp to 0 and stick there - defer it to the
      // ResizeObserver, which re-applies it the moment this wheel actually gets a size.
      this.pendingRawIndex = rawIndex;
      return;
    }

    this.pendingRawIndex = null;
    this.scrollEl.scrollTo({ top: rawIndex * this.itemHeight, behavior });
  }

  private onKeydown = (ev: KeyboardEvent): void => {
    let delta = 0;
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') delta = -1;
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') delta = 1;
    else if (ev.key === 'PageUp') delta = -3;
    else if (ev.key === 'PageDown') delta = 3;
    else return;

    ev.preventDefault();
    const rawIndex = Math.round(this.scrollEl.scrollTop / this.itemHeight) + delta;
    this.scrollToRawIndex(rawIndex);
  };

  private onScroll = (): void => {
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.updateVisualState();
      });
    }

    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.onSettle(), SETTLE_DEBOUNCE_MS);
  };

  /** Continuously morphs scale/opacity by distance from center - the "fluid" feel while dragging. */
  private updateVisualState(): void {
    // Viewport-relative geometry, not offsetTop: offsetTop is measured against the item's
    // offsetParent (the outer .tpc-wheel), whose effective position shifts whenever the wheel
    // is collapsed (flex centers the taller, fixed-height scroll content within the shorter
    // collapsed box), which silently throws every distance off by one item at rest - the
    // digit that's actually shown ends up styled as if it were a faded neighbor instead of
    // the bold, full-opacity center. getBoundingClientRect() reflects the true rendered
    // position regardless of that shift.
    const scrollRect = this.scrollEl.getBoundingClientRect();
    const centerY = scrollRect.top + scrollRect.height / 2;

    for (const item of this.items) {
      const itemRect = item.getBoundingClientRect();
      const itemCenterY = itemRect.top + itemRect.height / 2;
      const t = Math.min(1, Math.abs(itemCenterY - centerY) / this.itemHeight);
      item.style.transform = `scale(${1 - 0.32 * t})`;
      item.style.opacity = String(1 - 0.78 * t);
      item.classList.toggle('is-center', t < 0.12);
    }
  }

  private onSettle(): void {
    // The debounce timer that got us here has already fired - clear the stored id so
    // `settleTimer === undefined` reliably means "at rest" for anything that checks it
    // (window.setTimeout never resets the variable on its own once the callback runs).
    this.settleTimer = undefined;

    const length = this.values.length;
    const rawIndex = Math.round(this.scrollEl.scrollTop / this.itemHeight);
    const baseIndex = ((rawIndex % length) + length) % length;
    const value = this.values[baseIndex];

    const lapDiff = Math.floor(rawIndex / length) - Math.floor(this.prevRawIndex / length);
    this.prevRawIndex = rawIndex;

    // Silently recenter once we've drifted near either edge copy, so dragging never runs out of room.
    const currentCopy = Math.floor(rawIndex / length);
    if (currentCopy < 1 || currentCopy > this.repeats - 2) {
      const middleCopy = Math.floor(this.repeats / 2);
      const recenterIndex = middleCopy * length + baseIndex;
      this.scrollToRawIndex(recenterIndex, 'auto');
    }

    const valueChanged = value !== this.currentValue;
    this.currentValue = value;

    if (valueChanged || lapDiff !== 0) {
      const carry: WheelCarry = lapDiff > 0 ? 'up' : lapDiff < 0 ? 'down' : null;
      this.onChange?.(value, carry, Math.abs(lapDiff));
    }

    // Settle is the authoritative resting position - recompute visuals from it directly,
    // rather than trusting whatever the last mid-scroll rAF frame happened to leave behind.
    this.updateVisualState();
    this.setActive(false);
  }
}
