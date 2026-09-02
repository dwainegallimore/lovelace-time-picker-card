import { bindActionHandler, computeDomain } from './actions';
import {
  CARD_SIZE,
  CARD_VERSION,
  DEFAULT_HOUR_MODE,
  DEFAULT_HOUR_STEP,
  DEFAULT_LAYOUT_ALIGN_CONTROLS,
  DEFAULT_LAYOUT_HOUR_MODE,
  DEFAULT_LAYOUT_NAME,
  DEFAULT_MINUTE_STEP,
  DEFAULT_SECOND_STEP,
  ENTITY_DOMAIN,
} from './const';
import './editor';
import { createErrorCard } from './error-card';
import { Hour } from './models/hour';
import { Minute } from './models/minute';
import { Second } from './models/second';
import { Time } from './models/time';
import {
  Direction,
  HassEntity,
  HomeAssistant,
  Layout,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  Period,
  TimePickerCardConfig,
} from './types';
import { generateWheelRange, TimeWheel } from './wheel';

function getEntityTime(entity: HassEntity): { hour: number; minute: number; second: number } {
  const stateMatch = entity.state.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:$|\s)/);
  const stateTime = stateMatch
    ? { hour: Number(stateMatch[1]), minute: Number(stateMatch[2]), second: Number(stateMatch[3] ?? 0) }
    : undefined;

  return {
    hour: stateTime?.hour ?? (typeof entity.attributes.hour === 'number' ? entity.attributes.hour : 0),
    minute: stateTime?.minute ?? (typeof entity.attributes.minute === 'number' ? entity.attributes.minute : 0),
    second: stateTime?.second ?? (typeof entity.attributes.second === 'number' ? entity.attributes.second : 0),
  };
}

console.info(
  `%c  TIME-PICKER-CARD  \n%c  Version ${CARD_VERSION}    `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray'
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'time-picker-card',
  name: 'Time Picker Card',
  description: 'A Time Picker card for setting the time value of Input Datetime entities.',
});

const CARD_STYLES = `
  :host {
    display: block;
    height: 100%;
    --tpc-elements-background-color: var(--time-picker-elements-background-color, var(--primary-color));
    --tpc-control-padding: var(--time-picker-control-padding, 8px);
    --tpc-icon-color: var(--time-picker-icon-color, var(--primary-text-color));
    --tpc-text-color: var(--time-picker-text-color, #fff);
    --tpc-accent-color: var(--time-picker-accent-color, var(--primary-color));
    --tpc-off-color: var(--time-picker-off-color, var(--disabled-text-color));
    --tpc-border-radius: var(--time-picker-border-radius, var(--ha-card-border-radius, 12px));
    --tpc-item-height: 44px;
  }

  * { box-sizing: border-box; }

  .tpc-card-content {
    height: 100%;
  }

  ha-card {
    /* min-height, not height: a wheel expanding from its collapsed row to showing its
       neighbors (44px -> 132px) grows this card's natural content height, and a hard
       height: 100% + overflow: hidden here would silently clip that growth to whatever the
       surrounding grid cell happened to be at the last layout pass - invisible if the grid
       hasn't (or can't) reactively resize to match. min-height keeps the card filling at
       least its given space (so a manually-oversized grid cell still looks filled) without
       capping how tall it's allowed to grow. overflow: visible lets that growth, and the
       expanded wheel's own fade mask, render past the card's own box instead of vanishing. */
    min-height: 100%;
    width: 100%;
    overflow: visible;
    border-radius: var(--tpc-border-radius);
    display: flex;
    flex-direction: column;
  }

  ha-card.embedded {
    box-shadow: none;
    border: none;
    background: transparent;
  }

  .tpc-header {
    padding: 14px 20px 10px;
    color: var(--secondary-text-color);
    background: transparent;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-align: center;
    user-select: none;
  }

  ha-card.thin .tpc-header { padding: 8px 12px 6px; }

  .tpc-row {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    padding: 20px 16px;
  }

  ha-card.thin .tpc-row { padding: 6px !important; }
  .tpc-row.embedded { padding: 0; }
  .tpc-row.with-header-name { padding: 12px 16px 20px; }

  .tpc-nested-name {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-right: 16px;
    user-select: none;
    /* The wheel (.tpc-content, flex-shrink: 0 below) must never be clipped by ha-card's own
       overflow: hidden when a narrow tile can't fit both at their natural width - this is the
       one that's allowed to give ground, wrapping or shrinking its text instead. Flex items
       default to min-width: auto (their own content's width as a floor), which some themes'
       fonts/sizing push wide enough that it stops this from actually shrinking - min-width: 0
       removes that floor so the shrink below can go all the way down to wrapped text. */
    min-width: 0;
    flex-shrink: 1;
  }

  .tpc-nested-name state-badge { color: var(--tpc-icon-color); flex-shrink: 0; }
  .tpc-nested-name span {
    color: var(--primary-text-color);
    font-weight: 500;
    min-width: 0;
  }

  .tpc-content {
    display: flex;
    align-items: center;
    gap: 20px;
    flex: 1 0 auto;
  }

  .tpc-content.layout-left { justify-content: flex-start; }
  .tpc-content.layout-center { justify-content: center; }
  .tpc-content.layout-right { justify-content: flex-end; }

  .tpc-wheel-group {
    display: flex;
    align-items: center;
    position: relative;
    border-radius: calc(var(--tpc-border-radius) * 0.6);
    background: var(--secondary-background-color, rgba(127, 127, 127, 0.05));
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(127, 127, 127, 0.08);
    padding: 0 8px;
    transition: border-radius 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .tpc-wheel-group::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: var(--tpc-item-height);
    transform: translateY(-50%);
    background: rgba(127, 127, 127, 0.14);
    background: color-mix(in srgb, var(--tpc-accent-color) 10%, transparent);
    border-radius: calc(var(--tpc-border-radius) * 0.6);
    pointer-events: none;
  }

  .tpc-wheel {
    position: relative;
    width: 2.1em;
    height: var(--tpc-item-height);
    outline: none;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: height 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .tpc-wheel-group.is-active .tpc-wheel,
  .tpc-wheel-group:focus-within .tpc-wheel {
    height: calc(var(--tpc-item-height) * 3);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 32%, black 68%, transparent 100%);
    mask-image: linear-gradient(to bottom, transparent 0%, black 32%, black 68%, transparent 100%);
  }

  .tpc-wheel:focus-visible {
    box-shadow: inset 0 0 0 2px var(--tpc-accent-color);
    border-radius: 8px;
  }

  .tpc-wheel-scroll {
    height: calc(var(--tpc-item-height) * 3);
    overflow-y: scroll;
    overscroll-behavior: contain;
    scroll-snap-type: y mandatory;
    scrollbar-width: none;
    padding: var(--tpc-item-height) 0;
  }

  .tpc-wheel-scroll::-webkit-scrollbar { display: none; }

  .tpc-wheel-item {
    height: var(--tpc-item-height);
    display: flex;
    align-items: center;
    justify-content: center;
    scroll-snap-align: center;
    font-size: 1.5rem;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    color: var(--primary-text-color);
    transition: color 0.15s ease-out;
    user-select: none;
    cursor: pointer;
    will-change: transform, opacity;
  }

  .tpc-wheel-item.is-center {
    color: var(--tpc-accent-color);
    font-weight: 600;
  }

  .tpc-separator {
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--tpc-item-height);
    font-size: 1.4rem;
    font-weight: 600;
    color: var(--secondary-text-color);
    opacity: 0.6;
  }

  .tpc-period {
    position: relative;
    display: flex;
    border-radius: 999px;
    background: var(--tpc-off-color);
    padding: 3px;
    overflow: hidden;
  }

  .tpc-period button {
    position: relative;
    z-index: 1;
    border: none;
    background: transparent;
    font: inherit;
    font-weight: 600;
    font-size: 0.85rem;
    letter-spacing: 0.02em;
    padding: 8px 14px;
    border-radius: 999px;
    color: var(--tpc-text-color);
    cursor: pointer;
    transition: color 0.25s ease, transform 0.15s ease;
  }

  .tpc-period button:active { transform: scale(0.94); }

  .tpc-period.single button { display: none; }
  .tpc-period.single button.active { display: block; }

  .tpc-period-thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc(50% - 3px);
    border-radius: 999px;
    background: var(--tpc-accent-color);
    transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
    z-index: 0;
  }

  .tpc-period.pm .tpc-period-thumb { transform: translateX(100%); }

  .entity-icon { cursor: pointer; }
`;

interface PeriodElements {
  wrap: HTMLDivElement;
  single?: HTMLButtonElement;
}

export class TimePickerCard extends HTMLElement implements LovelaceCard {
  static getStubConfig(_hass: HomeAssistant, entities: Array<string>): Omit<TimePickerCardConfig, 'type'> {
    const datetimeEntity = entities.find((entityId) => computeDomain(entityId) === ENTITY_DOMAIN);

    return {
      entity: datetimeEntity || '',
      hour_mode: DEFAULT_HOUR_MODE,
      hour_step: DEFAULT_HOUR_STEP,
      minute_step: DEFAULT_MINUTE_STEP,
      layout: {
        hour_mode: DEFAULT_LAYOUT_HOUR_MODE,
        align_controls: DEFAULT_LAYOUT_ALIGN_CONTROLS,
        name: DEFAULT_LAYOUT_NAME,
      },
      hide: {
        seconds: true,
      },
    };
  }

  static getConfigElement(): LovelaceCardEditor {
    return document.createElement('time-picker-card-editor') as unknown as LovelaceCardEditor;
  }

  private _hass!: HomeAssistant;
  private _config!: TimePickerCardConfig;
  private _time?: Time;
  private _period: Period = Period.AM;
  private _bounce?: number;
  private _built = false;

  private readonly _root: ShadowRoot;
  private readonly _content: HTMLDivElement;

  private _headerEl?: HTMLElement;
  private _nameLabelEl?: HTMLElement;
  private _badgeEl?: HTMLElement & { stateObj?: HassEntity };
  private _hourWheel?: TimeWheel;
  private _minuteWheel?: TimeWheel;
  private _secondWheel?: TimeWheel;
  private _periodEls?: PeriodElements;
  private _wheelGroup?: HTMLDivElement;
  private readonly _activeWheels = new Set<string>();

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CARD_STYLES;
    this._root.appendChild(style);

    this._content = document.createElement('div');
    this._content.className = 'tpc-card-content';
    this._root.appendChild(this._content);
  }

  setConfig(config: TimePickerCardConfig): void {
    if (!config) {
      throw new Error('Invalid configuration');
    }

    if (!config.entity) {
      throw new Error('You must set an entity');
    }

    if (config.hour_mode && config.hour_mode !== 12 && config.hour_mode !== 24) {
      throw new Error('Invalid hour_mode: select either 12 or 24');
    }

    this._config = config;
    this._built = false;

    if (this._hass) {
      this._update();
    }
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    if (this._config) {
      this._update();
    }
  }

  get hass(): HomeAssistant {
    return this._hass;
  }

  getCardSize(): number {
    return CARD_SIZE;
  }

  /** Tells Lovelace's grid-based "sections" view how to size and resize this card. */
  getGridOptions(): LovelaceGridOptions {
    return {
      columns: 6,
      rows: 'auto',
      min_columns: 4,
      max_columns: 12,
      min_rows: 1,
      max_rows: 4,
    };
  }

  connectedCallback(): void {
    if (this._config && this._hass) {
      this._update();
    }
  }

  private get _entity(): HassEntity | undefined {
    return this._hass.states[this._config.entity];
  }

  private get _isEmbedded(): boolean {
    return this._config.layout?.embedded === true;
  }

  private get _hasNameInHeader(): boolean {
    return (
      Boolean(this._name) &&
      this._config.hide?.name !== true &&
      this._config.layout?.name !== Layout.Name.INSIDE &&
      this._config.layout?.embedded !== true
    );
  }

  private get _hasNameInside(): boolean {
    return (
      Boolean(this._name) &&
      (this._config.layout?.name === Layout.Name.INSIDE || Boolean(this._config.layout?.embedded))
    );
  }

  private get _name(): string | undefined {
    return this._config.name || this._entity?.attributes.friendly_name;
  }

  private get _shouldShowPeriod(): boolean {
    return this._config.hour_mode === 12;
  }

  private get _layoutAlign(): Layout.AlignControls {
    return this._config.layout?.align_controls ?? DEFAULT_LAYOUT_ALIGN_CONTROLS;
  }

  private _update(): void {
    if (!this._built) {
      this._build();
    } else {
      this._refreshValues();
    }
  }

  private _build(): void {
    const entity = this._entity;

    if (!entity) {
      this._showError('Entity not found');
      return;
    }

    if (computeDomain(entity.entity_id) !== ENTITY_DOMAIN) {
      this._showError(`You must set an ${ENTITY_DOMAIN} entity`);
      return;
    }

    if (!entity.attributes.has_time) {
      this._showError(`You must set an ${ENTITY_DOMAIN} entity that sets has_time: true`);
      return;
    }

    const { hour, minute, second } = getEntityTime(entity);
    this._time = new Time(
      new Hour(hour, this._config.hour_step, this._config.hour_mode),
      new Minute(minute, this._config.minute_step),
      new Second(second, this._config.second_step),
      this._config.link_values
    );
    this._period = this._time.hour.value >= 12 ? Period.PM : Period.AM;

    this._content.innerHTML = '';
    this._headerEl = undefined;
    this._nameLabelEl = undefined;
    this._badgeEl = undefined;
    this._periodEls = undefined;

    const card = document.createElement('ha-card');
    card.classList.toggle('embedded', this._isEmbedded);
    card.classList.toggle('thin', this._config.layout?.thin === true);

    if (this._hasNameInHeader) {
      card.appendChild(this._buildHeader());
    }

    const row = document.createElement('div');
    row.className = 'tpc-row';
    row.classList.toggle('with-header-name', this._hasNameInHeader);
    row.classList.toggle('embedded', this._isEmbedded);

    if (this._hasNameInside) {
      row.appendChild(this._buildNestedName(entity));
    }

    const content = document.createElement('div');
    content.className = `tpc-content layout-${this._layoutAlign}`;

    const wheelGroup = document.createElement('div');
    wheelGroup.className = 'tpc-wheel-group';
    this._wheelGroup = wheelGroup;
    this._activeWheels.clear();

    this._hourWheel = new TimeWheel({
      label: 'Hour',
      format: (value) => new Hour(value, 1, this._config.hour_mode).toString(),
      onChange: (value) => this._onHourChange(value),
      onActiveChange: (active) => this._setWheelActive('hour', active),
    });
    wheelGroup.appendChild(this._hourWheel.element);
    wheelGroup.appendChild(this._buildSeparator());

    this._minuteWheel = new TimeWheel({
      label: 'Minute',
      format: (value) => (value < 10 ? `0${value}` : String(value)),
      onChange: (value, carry, laps) => this._onMinuteChange(value, carry, laps),
      onActiveChange: (active) => this._setWheelActive('minute', active),
    });
    wheelGroup.appendChild(this._minuteWheel.element);

    if (this._config.hide?.seconds === false) {
      wheelGroup.appendChild(this._buildSeparator());
      this._secondWheel = new TimeWheel({
        label: 'Second',
        format: (value) => (value < 10 ? `0${value}` : String(value)),
        onChange: (value, carry, laps) => this._onSecondChange(value, carry, laps),
        onActiveChange: (active) => this._setWheelActive('second', active),
      });
      wheelGroup.appendChild(this._secondWheel.element);
    } else {
      this._secondWheel = undefined;
    }

    content.appendChild(wheelGroup);

    if (this._shouldShowPeriod) {
      content.appendChild(this._buildPeriodToggle());
    }

    row.appendChild(content);
    card.appendChild(row);

    // Attach the whole subtree to the live document *before* populating the wheels -
    // scrollTo() on a still-detached element has no layout box and silently clamps to 0.
    this._content.appendChild(card);

    this._hourWheel.setValues(
      generateWheelRange(0, 23, this._config.hour_step ?? DEFAULT_HOUR_STEP),
      this._time.hour.value
    );
    this._minuteWheel.setValues(
      generateWheelRange(0, 59, this._config.minute_step ?? DEFAULT_MINUTE_STEP),
      this._time.minute.value
    );
    this._secondWheel?.setValues(
      generateWheelRange(0, 59, this._config.second_step ?? DEFAULT_SECOND_STEP),
      this._time.second.value
    );

    this._built = true;
  }

  private _refreshValues(): void {
    const entity = this._entity;

    if (!entity || computeDomain(entity.entity_id) !== ENTITY_DOMAIN || !entity.attributes.has_time) {
      this._built = false;
      this._build();
      return;
    }

    if (!this._time) {
      this._build();
      return;
    }

    const { hour, minute, second } = getEntityTime(entity);
    this._time.hour.setStringValue(String(hour));
    this._time.minute.setStringValue(String(minute));
    this._time.second.setStringValue(String(second));
    this._period = this._time.hour.value >= 12 ? Period.PM : Period.AM;

    this._hourWheel?.setValue(this._time.hour.value, 'auto');
    this._minuteWheel?.setValue(this._time.minute.value, 'auto');
    this._secondWheel?.setValue(this._time.second.value, 'auto');
    this._syncPeriodToggle();

    if (this._headerEl) {
      this._headerEl.textContent = this._name ?? '';
    }
    if (this._nameLabelEl) {
      this._nameLabelEl.textContent = this._name ?? '';
    }
    if (this._badgeEl) {
      this._badgeEl.stateObj = entity;
    }
  }

  private _showError(message: string): void {
    this._content.innerHTML = '';
    this._content.appendChild(createErrorCard(message, this._config));
    this._built = false;
    this._time = undefined;
  }

  private _buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'tpc-header';
    header.textContent = this._name ?? '';
    bindActionHandler(header, () => ({ hass: this._hass, config: this._config }));
    this._headerEl = header;
    return header;
  }

  private _buildNestedName(entity: HassEntity): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'tpc-nested-name';
    bindActionHandler(wrap, () => ({ hass: this._hass, config: this._config }));

    if (!this._config.hide?.icon) {
      const badge = document.createElement('state-badge') as HTMLElement & { stateObj?: HassEntity };
      badge.classList.add('entity-icon');
      badge.stateObj = entity;
      wrap.appendChild(badge);
      this._badgeEl = badge;
    }

    if (!this._config.hide?.name) {
      const label = document.createElement('span');
      label.textContent = this._name ?? '';
      wrap.appendChild(label);
      this._nameLabelEl = label;
    }

    return wrap;
  }

  private _buildSeparator(): HTMLElement {
    const sep = document.createElement('div');
    sep.className = 'tpc-separator';
    sep.textContent = ':';
    return sep;
  }

  private _buildPeriodToggle(): HTMLElement {
    const mode = this._config.layout?.hour_mode ?? DEFAULT_LAYOUT_HOUR_MODE;
    const wrap = document.createElement('div');
    wrap.className = `tpc-period ${mode}`;

    if (mode === 'single') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'active';
      btn.addEventListener('click', () => this._onPeriodToggle());
      wrap.appendChild(btn);
      this._periodEls = { wrap, single: btn };
    } else {
      const thumb = document.createElement('span');
      thumb.className = 'tpc-period-thumb';

      const amBtn = document.createElement('button');
      amBtn.type = 'button';
      amBtn.textContent = 'AM';
      amBtn.addEventListener('click', () => this._onPeriodToggle());

      const pmBtn = document.createElement('button');
      pmBtn.type = 'button';
      pmBtn.textContent = 'PM';
      pmBtn.addEventListener('click', () => this._onPeriodToggle());

      wrap.append(thumb, amBtn, pmBtn);
      this._periodEls = { wrap };
    }

    this._syncPeriodToggle();
    return wrap;
  }

  /** Keeps hour/minute/second wheels expanding and collapsing together as one unit. */
  private _setWheelActive(name: string, active: boolean): void {
    if (active) {
      this._activeWheels.add(name);
    } else {
      this._activeWheels.delete(name);
    }

    this._wheelGroup?.classList.toggle('is-active', this._activeWheels.size > 0);
  }

  private _syncPeriodToggle(): void {
    if (!this._periodEls) {
      return;
    }

    this._periodEls.wrap.classList.toggle('pm', this._period === Period.PM);

    if (this._periodEls.single) {
      this._periodEls.single.textContent = this._period;
    }
  }

  private _onHourChange(value: number): void {
    this._time!.hour.setStringValue(String(value));
    this._period = this._time!.hour.value >= 12 ? Period.PM : Period.AM;
    this._syncPeriodToggle();
    this._debouncedCallHassService();
  }

  private _onMinuteChange(value: number, carry: 'up' | 'down' | null, laps: number): void {
    if (this._config.link_values && carry) {
      for (let i = 0; i < laps; i++) {
        this._time!.hourStep(carry === 'up' ? Direction.UP : Direction.DOWN);
      }
      this._hourWheel?.setValue(this._time!.hour.value);
      this._period = this._time!.hour.value >= 12 ? Period.PM : Period.AM;
      this._syncPeriodToggle();
    }

    this._time!.minute.setStringValue(String(value));
    this._debouncedCallHassService();
  }

  private _onSecondChange(value: number, carry: 'up' | 'down' | null, laps: number): void {
    if (this._config.link_values && carry) {
      for (let i = 0; i < laps; i++) {
        this._time!.minute.stepUpdate(carry === 'up' ? Direction.UP : Direction.DOWN, 1);
      }
      this._minuteWheel?.setValue(this._time!.minute.value);
    }

    this._time!.second.setStringValue(String(value));
    this._debouncedCallHassService();
  }

  private _onPeriodToggle(): void {
    this._time!.hour.togglePeriod();
    this._period = this._time!.hour.value >= 12 ? Period.PM : Period.AM;
    this._syncPeriodToggle();
    this._hourWheel?.setValue(this._time!.hour.value);
    this._debouncedCallHassService();
  }

  private _debouncedCallHassService(): void {
    if (this._config.delay) {
      window.clearTimeout(this._bounce);
      this._bounce = window.setTimeout(() => this._callHassService(), this._config.delay);
    } else {
      this._callHassService();
    }
  }

  private _callHassService(): Promise<void> {
    if (!this._hass || !this._time) {
      throw new Error('Unable to update datetime');
    }

    return this._hass.callService(ENTITY_DOMAIN, 'set_datetime', {
      entity_id: this._config.entity,
      time: this._time.value,
    });
  }
}

customElements.define('time-picker-card', TimePickerCard);
