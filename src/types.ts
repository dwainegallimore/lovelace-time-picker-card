/**
 * Minimal local re-declarations of the Home Assistant frontend types this card needs.
 * These replace `custom-card-helpers` / `home-assistant-js-websocket` so the card ships
 * with zero runtime dependencies - Home Assistant's own frontend defines the real
 * `hass`, `ha-card`, `ha-form`, `state-badge`, `hui-error-card`, etc. at runtime.
 */

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    has_time?: boolean;
    hour?: number;
    minute?: number;
    second?: number;
    [key: string]: unknown;
  };
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  callService: (domain: string, service: string, data?: Record<string, unknown>) => Promise<void>;
  [key: string]: unknown;
}

export interface ActionConfig {
  action: 'more-info' | 'toggle' | 'navigate' | 'url' | 'call-service' | 'perform-action' | 'none' | 'assist';
  entity?: string;
  navigation_path?: string;
  url_path?: string;
  service?: string;
  perform_action?: string;
  service_data?: Record<string, unknown>;
  data?: Record<string, unknown>;
  target?: Record<string, unknown>;
  confirmation?: unknown;
}

export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

export interface LovelaceGridOptions {
  columns?: number | 'full';
  rows?: number | 'auto';
  max_columns?: number;
  min_columns?: number;
  min_rows?: number;
  max_rows?: number;
}

export interface LovelaceCard extends HTMLElement {
  hass?: HomeAssistant;
  isPanel?: boolean;
  editMode?: boolean;
  getCardSize(): number | Promise<number>;
  getGridOptions?(): LovelaceGridOptions;
  setConfig(config: LovelaceCardConfig): void;
}

export interface LovelaceCardEditor extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: LovelaceCardConfig): void;
}

export interface TimePickerCardConfig extends LovelaceCardConfig {
  entity: string;
  name?: string;
  link_values?: boolean;
  hour_mode?: HourMode;
  hour_step?: number;
  minute_step?: number;
  second_step?: number;
  delay?: number;
  layout?: TimePickerLayoutConfig;
  hide?: TimePickerHideConfig;
  tap_action?: ActionConfig;
  double_tap_action?: ActionConfig;
  hold_action?: ActionConfig;
}

export type HourMode = 12 | 24 | undefined;

export interface TimePickerLayoutConfig {
  align_controls?: Layout.AlignControls;
  name?: Layout.Name;
  hour_mode?: Layout.HourMode;
  embedded?: boolean;
  thin?: boolean;
}

export namespace Layout {
  export type HourMode = 'single' | 'double';

  export enum AlignControls {
    LEFT = 'left',
    CENTER = 'center',
    RIGHT = 'right',
  }

  export enum Name {
    HEADER = 'header',
    INSIDE = 'inside',
  }
}

export interface TimePickerHideConfig {
  name?: boolean;
  icon?: boolean;
  seconds?: boolean;
}

export enum Direction {
  UP = 'up',
  DOWN = 'down',
}

export enum Period {
  AM = 'AM',
  PM = 'PM',
}
