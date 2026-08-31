import { ActionConfig, HomeAssistant, TimePickerCardConfig } from './types';

const HOLD_TIME = 500;
const DOUBLE_TAP_WINDOW = 250;

export function computeDomain(entityId: string): string {
  return entityId.substring(0, entityId.indexOf('.'));
}

export function hasAction(config?: ActionConfig): boolean {
  return config !== undefined && config.action !== 'none';
}

export function fireEvent(
  el: EventTarget,
  type: string,
  detail?: unknown,
  options?: { bubbles?: boolean; composed?: boolean }
): void {
  el.dispatchEvent(
    new CustomEvent(type, {
      bubbles: options?.bubbles ?? true,
      composed: options?.composed ?? true,
      detail,
    })
  );
}

export type ActionKind = 'tap' | 'hold' | 'double_tap';

export function handleAction(
  el: HTMLElement,
  hass: HomeAssistant,
  config: TimePickerCardConfig,
  kind: ActionKind
): void {
  const actionConfig: ActionConfig =
    (kind === 'tap' ? config.tap_action : kind === 'hold' ? config.hold_action : config.double_tap_action) ?? {
      action: 'more-info',
    };

  switch (actionConfig.action) {
    case 'more-info':
      fireEvent(el, 'hass-more-info', { entityId: actionConfig.entity ?? config.entity });
      break;

    case 'navigate':
      if (actionConfig.navigation_path) {
        window.history.pushState(null, '', actionConfig.navigation_path);
        fireEvent(window, 'location-changed', { replace: false });
      }
      break;

    case 'url':
      if (actionConfig.url_path) {
        window.open(actionConfig.url_path);
      }
      break;

    case 'call-service':
    case 'perform-action': {
      const [domain, service] = (actionConfig.service ?? actionConfig.perform_action ?? '').split('.');
      if (domain && service) {
        hass.callService(domain, service, actionConfig.service_data ?? actionConfig.data ?? {});
      }
      break;
    }

    case 'toggle': {
      const entityId = actionConfig.entity ?? config.entity;
      hass.callService(computeDomain(entityId), 'toggle', { entity_id: entityId });
      break;
    }

    case 'none':
    default:
      break;
  }
}

/**
 * Binds tap / hold / double-tap handling to an element using Pointer Events,
 * dispatching through {@link handleAction}. A dependency-free stand-in for the
 * action-handler directive + mwc-ripple approach used by custom-card-helpers.
 */
export function bindActionHandler(
  el: HTMLElement,
  getContext: () => { hass: HomeAssistant; config: TimePickerCardConfig }
): void {
  let holdTimer: number | undefined;
  let held = false;
  let pendingTap: number | undefined;

  const start = (): void => {
    held = false;
    holdTimer = window.setTimeout(() => {
      held = true;
      const { hass, config } = getContext();
      if (hasAction(config.hold_action)) {
        handleAction(el, hass, config, 'hold');
      }
    }, HOLD_TIME);
  };

  const cancel = (): void => {
    window.clearTimeout(holdTimer);
  };

  const end = (): void => {
    window.clearTimeout(holdTimer);
    if (held) {
      return;
    }

    const { hass, config } = getContext();

    if (!hasAction(config.double_tap_action)) {
      handleAction(el, hass, config, 'tap');
      return;
    }

    if (pendingTap === undefined) {
      pendingTap = window.setTimeout(() => {
        pendingTap = undefined;
        handleAction(el, hass, config, 'tap');
      }, DOUBLE_TAP_WINDOW);
    } else {
      window.clearTimeout(pendingTap);
      pendingTap = undefined;
      handleAction(el, hass, config, 'double_tap');
    }
  };

  el.style.cursor = 'pointer';
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', (ev) => ev.preventDefault());
}
