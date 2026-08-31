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

/** Fields whose selector.select values are strings but the config stores as a number. */
const NUMERIC_SELECT_FIELDS = new Set(['hour_mode']);

const SCHEMA = [
  {
    type: 'grid',
    schema: [
      { name: 'entity', selector: { entity: { domain: 'input_datetime' } } },
      { name: 'name', selector: { text: {} } },
    ],
  },
  {
    // Two forced single-column sub-grids side by side, same proven pattern as "Appearance"
    // below - a plain 4-item grid depends on the dialog's width for its column count (it
    // rendered 3-per-row in a wide dialog, scattering these), so column count can't be left
    // to chance here.
    type: 'grid',
    column_min_width: '220px',
    schema: [
      {
        type: 'grid',
        column_min_width: '100%',
        schema: [
          {
            name: 'hour_step',
            default: 1,
            selector: { number: { mode: 'box', min: 1, max: 24, step: 1 } },
          },
          {
            name: 'minute_step',
            default: 5,
            selector: { number: { mode: 'box', min: 1, max: 60, step: 1 } },
          },
        ],
      },
      {
        type: 'grid',
        column_min_width: '100%',
        schema: [
          {
            name: 'hour_mode',
            selector: {
              select: {
                mode: 'box',
                options: [
                  { value: '12', label: '12-hour' },
                  { value: '24', label: '24-hour' },
                ],
              },
            },
          },
          { name: 'link_values', selector: { boolean: {} } },
        ],
      },
    ],
  },
  {
    // No `name` here - this expandable is purely a visual accordion. Its two direct
    // children each own exactly one data key (layout / hide) so nothing double-nests.
    type: 'expandable',
    title: 'Appearance',
    schema: [
      {
        type: 'grid',
        name: 'layout',
        column_min_width: '220px',
        schema: [
          {
            // Unnamed nested grids are pure visual grouping - they flatten straight
            // into the parent's "layout" scope rather than adding another nesting level.
            type: 'grid',
            column_min_width: '100%',
            schema: [
              {
                name: 'align_controls',
                selector: {
                  select: {
                    mode: 'box',
                    options: [
                      { value: 'left', label: 'Left' },
                      { value: 'center', label: 'Center' },
                      { value: 'right', label: 'Right' },
                    ],
                  },
                },
              },
              {
                name: 'name',
                selector: {
                  select: {
                    mode: 'box',
                    options: [
                      { value: 'header', label: 'Header' },
                      { value: 'inside', label: 'Inside' },
                    ],
                  },
                },
              },
              {
                name: 'hour_mode',
                selector: {
                  select: {
                    mode: 'box',
                    options: [
                      { value: 'single', label: 'Single' },
                      { value: 'double', label: 'Double' },
                    ],
                  },
                },
              },
            ],
          },
          {
            type: 'grid',
            column_min_width: '100%',
            schema: [
              { name: 'embedded', selector: { boolean: {} } },
              { name: 'thin', selector: { boolean: {} } },
            ],
          },
        ],
      },
      {
        type: 'grid',
        name: 'hide',
        column_min_width: '150px',
        schema: [
          { name: 'name', selector: { boolean: {} } },
          { name: 'icon', selector: { boolean: {} } },
          { name: 'seconds', selector: { boolean: {} } },
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
      this._form.data = this._toFormData(config);
    }
  }

  connectedCallback(): void {
    if (this._form) {
      return;
    }

    const form = document.createElement('ha-form') as HaFormElement;
    form.hass = this._hass;
    form.data = this._toFormData(this._config);
    form.schema = SCHEMA;
    form.computeLabel = ({ name }: { name: string }): string => NAME_TO_LABEL_MAP[name] || name;
    form.addEventListener('value-changed', ((ev: CustomEvent) => {
      ev.stopPropagation();
      const value = { ...ev.detail.value };
      for (const field of NUMERIC_SELECT_FIELDS) {
        if (typeof value[field] === 'string') {
          value[field] = Number(value[field]);
        }
      }
      const newConfig = { ...this._config, ...value } as TimePickerCardConfig;
      this._config = newConfig;
      form.data = this._toFormData(newConfig);
      this.dispatchEvent(
        new CustomEvent('config-changed', { bubbles: true, composed: true, detail: { config: newConfig } })
      );
    }) as EventListener);

    this._form = form;
    this.appendChild(form);
  }

  /** ha-form's select selector requires string values, so numeric config fields need stringifying for display. */
  private _toFormData(config?: TimePickerCardConfig): unknown {
    if (!config) {
      return config;
    }

    const data: Record<string, unknown> = { ...config };
    for (const field of NUMERIC_SELECT_FIELDS) {
      if (data[field] !== undefined) {
        data[field] = String(data[field]);
      }
    }
    return data;
  }
}

customElements.define('time-picker-card-editor', TimePickerCardEditor);
