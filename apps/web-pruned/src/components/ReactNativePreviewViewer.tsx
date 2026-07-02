import { MockFrame, DeviceOptions, type DeviceName } from 'react-mockframe';
import 'react-mockframe/styles/mockframe.css';
import { useMemo, useRef, useEffect } from 'react';
import type { ProjectFile } from '../types';
import styles from './ReactNativePreviewViewer.module.css';

interface Props {
  projectId: string;
  file: ProjectFile;
  devServerUrl: string;
  deviceName: DeviceName;
  currentUrl: string;
  landscape?: boolean;
}

const DEFAULT_COLOR: Partial<Record<DeviceName, string>> = {
  'iPhone 8': 'silver',
  'iPhone 8 Plus': 'silver',
  'iPhone 17': 'black',
  'Pixel 10': 'obsidian',
  'Galaxy S25': 'phantom-black',
  'iPad Mini': 'silver',
  'iPad Pro': 'space-gray',
};

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function getDeviceInsets(deviceName: DeviceName, landscape: boolean): Insets {
  if (landscape) {
    if (deviceName.startsWith('iPhone 8')) {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }
    if (deviceName.startsWith('iPhone')) {
      return { top: 0, bottom: 21, left: 47, right: 47 };
    }
    if (deviceName.startsWith('iPad')) {
      return { top: 24, bottom: 20, left: 0, right: 0 };
    }
    return { top: 0, bottom: 15, left: 0, right: 0 };
  } else {
    if (deviceName.startsWith('iPhone 8')) {
      return { top: 20, bottom: 0, left: 0, right: 0 };
    }
    if (deviceName.startsWith('iPhone')) {
      return { top: 47, bottom: 34, left: 0, right: 0 };
    }
    if (deviceName.startsWith('iPad')) {
      return { top: 24, bottom: 20, left: 0, right: 0 };
    }
    return { top: 38, bottom: 15, left: 0, right: 0 };
  }
}

export function ReactNativePreviewViewer({ projectId, file, devServerUrl, deviceName, currentUrl, landscape = false }: Props) {
  const config = DeviceOptions[deviceName];
  const color = config.colors.length > 0
    ? (DEFAULT_COLOR[deviceName] ?? config.colors[0])
    : undefined;

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const calculatedInsets = useMemo(() => getDeviceInsets(deviceName, landscape), [deviceName, landscape]);

  const srcUrl = useMemo(() => {
    try {
      const url = new URL(currentUrl);
      url.searchParams.set('safeAreaInsetsTop', String(calculatedInsets.top));
      url.searchParams.set('safeAreaInsetsBottom', String(calculatedInsets.bottom));
      url.searchParams.set('safeAreaInsetsLeft', String(calculatedInsets.left));
      url.searchParams.set('safeAreaInsetsRight', String(calculatedInsets.right));
      return url.toString();
    } catch {
      return currentUrl;
    }
  }, [currentUrl, calculatedInsets]);

  const postInsets = () => {
    const iframe = iframeRef.current;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'od-safe-area-insets',
        insets: calculatedInsets,
      }, '*');
    }
  };

  useEffect(() => {
    postInsets();
  }, [calculatedInsets]);

  const iframeKey = useMemo(() => {
    const base = devServerUrl.replace(/\/+$/, '');
    const safePath = file.path?.replace(/\\/g, '/') ?? '';
    return `${base}/${safePath}`;
  }, [devServerUrl, file.path]);

  return (
    <div className={styles.viewer}>
      <div className={styles.frameWrapper}>
        <MockFrame {...{ device: deviceName, landscape, ...(color ? { color } : {}) } as any}>
          <iframe
            ref={iframeRef}
            key={iframeKey}
            src={srcUrl}
            onLoad={postInsets}
            title={file.name}
            style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#fff' }}
            sandbox="allow-scripts allow-downloads allow-same-origin"
          />
        </MockFrame>
      </div>
    </div>
  );
}
