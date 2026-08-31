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
    this.currentValue = selected;
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

    const idxInBase = values.indexOf(selected);
    const startIndex = middleCopy * values.length + Math.max(idxInBase, 0);
    this.prevRawIndex = startIndex;

    // Force a layout flush before scrolling - without it the browser may still be
    // measuring the pre-insertion (empty) scrollHeight and silently clamp this to 0.
    void this.scrollEl.offsetHeight;
    this.scrollEl.scrollTo({ top: startIndex * this.itemHeight, behavior: 'auto' });
    this.updateVisualState();
  }

  /** Programmatically move to a value (e.g. syncing from hass, or a carry from a neighboring wheel). */
  setValue(value: number): void {
    if (value === this.currentValue || this.values.length === 0) {
      return;
    }

    const idxInBase = this.values.indexOf(value);
    if (idxInBase === -1) {
      return;
    }

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

    this.currentValue = value;
    this.scrollToRawIndex(bestIndex);
  }

  focus(): void {
    this.element.focus();
  }

  private scrollToRawIndex(rawIndex: number): void {
    this.prevRawIndex = rawIndex;
    this.scrollEl.scrollTo({ top: rawIndex * this.itemHeight, behavior: 'smooth' });
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
    const center = this.scrollEl.scrollTop + this.scrollEl.clientHeight / 2;

    for (const item of this.items) {
      const itemCenter = item.offsetTop + this.itemHeight / 2;
      const t = Math.min(1, Math.abs(itemCenter - center) / this.itemHeight);
      item.style.transform = `scale(${1 - 0.32 * t})`;
      item.style.opacity = String(1 - 0.78 * t);
      item.classList.toggle('is-center', t < 0.12);
    }
  }

  private onSettle(): void {
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
      this.prevRawIndex = recenterIndex;
      this.scrollEl.scrollTo({ top: recenterIndex * this.itemHeight, behavior: 'auto' });
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
