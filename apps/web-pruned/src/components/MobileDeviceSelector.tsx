import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { DeviceNames, DeviceOptions, type DeviceName } from 'react-mockframe';
import type { Dict } from '../i18n/types';
import { Icon } from './Icon';
import { RemixIcon } from './RemixIcon';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

const MOBILE_DEVICES = DeviceNames.filter((name) => {
  const cfg = DeviceOptions[name];
  return cfg.width && cfg.height && !name.startsWith('MacBook');
});

interface Props {
  device: DeviceName;
  onDevice: (name: DeviceName) => void;
  t: TranslateFn;
  tabIndex?: number;
}

export function MobileDeviceSelector({ device, onDevice, t, tabIndex }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const activeConfig = DeviceOptions[device];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSelect = useCallback((name: DeviceName) => {
    onDevice(name);
    setOpen(false);
  }, [onDevice]);

  const iconName = activeConfig.width && activeConfig.width >= 500 ? 'tablet-line' : 'smartphone-line';

  return (
    <div className="viewer-viewport-switcher" ref={menuRef}>
      <button
        type="button"
        className={`viewer-action viewer-viewport-trigger mobile-device-trigger${open ? '' : ' od-tooltip'}`}
        aria-label={t('fileViewer.viewportAria')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={`${device} · ${activeConfig.width}×${activeConfig.height}`}
        data-tooltip={open ? undefined : `${device} · ${activeConfig.width}×${activeConfig.height}`}
        data-tooltip-placement="bottom"
        tabIndex={tabIndex}
        onClick={() => setOpen((value) => !value)}
      >
        <RemixIcon name={iconName} size={14} className="viewer-viewport-icon" />
        <span className="mobile-device-trigger-text">{device} · {activeConfig.width}×{activeConfig.height}</span>
        <RemixIcon name="arrow-down-s-line" size={14} />
      </button>
      {open ? (
        <div className="viewer-viewport-menu" id={listboxId} role="listbox" aria-label={t('fileViewer.viewportAria')}>
          {MOBILE_DEVICES.map((name) => {
            const selected = name === device;
            const cfg = DeviceOptions[name];
            const isTablet = cfg.width >= 500;
            return (
              <button
                key={name}
                type="button"
                className={`viewer-viewport-menu-item${selected ? ' active' : ''}`}
                role="option"
                aria-selected={selected}
                title={`${name} · ${cfg.width}×${cfg.height}`}
                onClick={() => handleSelect(name)}
              >
                <span className="viewer-viewport-menu-label">
                  <RemixIcon name={isTablet ? 'tablet-line' : 'smartphone-line'} size={14} />
                  <span className="mobile-device-menu-name">{name}</span>
                  <span className="mobile-device-menu-size">{cfg.width}×{cfg.height}</span>
                </span>
                {selected ? <Icon name="check" size={13} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
