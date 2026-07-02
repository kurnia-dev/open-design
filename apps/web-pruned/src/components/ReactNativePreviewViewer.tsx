import { MockFrame, DeviceOptions, type DeviceName } from 'react-mockframe';
import 'react-mockframe/styles/mockframe.css';
import { useMemo } from 'react';
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

export function ReactNativePreviewViewer({ projectId, file, devServerUrl, deviceName, currentUrl, landscape = false }: Props) {
  const config = DeviceOptions[deviceName];
  const color = config.colors.length > 0
    ? (DEFAULT_COLOR[deviceName] ?? config.colors[0])
    : undefined;

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
            key={iframeKey}
            src={currentUrl}
            title={file.name}
            style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#fff' }}
            sandbox="allow-scripts allow-downloads allow-same-origin"
          />
        </MockFrame>
      </div>
    </div>
  );
}
