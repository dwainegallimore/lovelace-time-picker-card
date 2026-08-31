import { HomeAssistant, LovelaceCardEditor, TimePickerCardConfig } from './types';

const NAME_TO_LABEL_MAP: Record<string, string> = {
  entity: 'input_datetime entity id',
  name: 'Name',
  hour_step: 'Hour step',
  minute_step: 'Minute step',
  hour_mode: 'Hour mode',
  link_values: 'Link values',
  align_controls: 'Align controls',
  embedded: 'Embedded?',
  thin: 'Thin layout?',
  icon: 'Icon',
  seconds: 'Seconds',
};

const SCHEMA = [
  { name: 'entity', selector: { entity: { domain: 'input_datetime' } } },
  {
    name: 'name',
    selector: { text: {} },
  },
  {
    type: 'grid',
    schema: [
      {
        name: 'hour_step',
        type: 'integer',
        required: true,
        default: 1,
        valueMin: 1,
        valueMax: 24,
      },
      {
        name: 'minute_step',
        type: 'integer',
        required: true,
        default: 5,
        valueMin: 1,
        valueMax: 60,
      },
      {
        name: 'hour_mode',
        type: 'select',
        options: [
          [12, '12'],
          [24, '24'],
        ],
      },
      { name: 'link_values', type: 'boolean' },
    ],
  },
  {
    type: 'expandable',
    name: 'layout',
    title: 'Layout controls',
    schema: [
      {
        name: 'hour_mode',
        type: 'select',
        options: [
          ['single', 'single'],
          ['double', 'double'],
        ],
      },
      {
        name: 'align_controls',
        type: 'select',
        options: [
          ['left', 'left'],
          ['center', 'center'],
          ['right', 'right'],
        ],
      },
      {
        name: 'name',
        type: 'select',
        options: [
          ['header', 'header'],
          ['inside', 'inside'],
        ],
      },
      { name: 'embedded', type: 'boolean' },
      { name: 'thin', type: 'boolean' },
    ],
  },
  {
    type: 'expandable',
    name: 'hide',
    title: 'Hide controls',
    schema: [
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'name', type: 'boolean' },
          { name: 'icon', type: 'boolean' },
          { name: 'seconds', type: 'boolean' },
        ],
      },
    ],
  },
  {
    type: 'expandable',
    title: 'Actions',
    schema: [
      { name: 'tap_action', selector: { action: {} } },
      { name: 'double_tap_action', selector: { action: {} } },
      { name: 'hold_action', selector: { action: {} } },
    ],
  },
];

interface HaFormElement extends HTMLElement {
  hass?: HomeAssistant;
  data?: unknown;
  schema?: unknown;
  computeLabel?: (schema: { name: string }) => string;
}

/**
 * Wraps Home Assistant's own `<ha-form>` element imperatively instead of through Lit,
 * so the visual editor keeps its full functionality (entity/action pickers, expandables)
 * without pulling in the `lit` package.
 */
export class TimePickerCardEditor extends HTMLElement implements LovelaceCardEditor {
  private _hass?: HomeAssistant;
  private _config?: TimePickerCardConfig;
  private _form?: HaFormElement;

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    if (this._form) {
      this._form.hass = hass;
    }
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  setConfig(config: TimePickerCardConfig): void {
    this._config = config;
    if (this._form) {
      this._form.data = config;
    }
  }

  connectedCallback(): void {
    if (this._form) {
      return;
    }

    const form = document.createElement('ha-form') as HaFormElement;
    form.hass = this._hass;
    form.data = this._config;
    form.schema = SCHEMA;
    form.computeLabel = ({ name }: { name: string }): string => NAME_TO_LABEL_MAP[name] || name;
    form.addEventListener('value-changed', ((ev: CustomEvent) => {
      ev.stopPropagation();
      const newConfig = { ...this._config, ...ev.detail.value } as TimePickerCardConfig;
      this._config = newConfig;
      form.data = newConfig;
      this.dispatchEvent(
        new CustomEvent('config-changed', { bubbles: true, composed: true, detail: { config: newConfig } })
      );
    }) as EventListener);

    this._form = form;
    this.appendChild(form);
  }
}

customElements.define('time-picker-card-editor', TimePickerCardEditor);
