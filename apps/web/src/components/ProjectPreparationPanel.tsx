import React from 'react';
import { Icon } from './Icon';
import { Spinner } from './Loading';
import Ansi from 'ansi-to-react';

interface Props {
  npmInstallStatus?: 'idle' | 'running' | 'completed' | 'failed';
  npmInstallMessage?: string;
  npmInstallLogs?: string[];
  devServerReady?: boolean;
}

export function ProjectPreparationPanel({
  npmInstallStatus = 'idle',
  npmInstallLogs = [],
  devServerReady = false,
}: Props) {
  const step1Status = npmInstallStatus === 'running'
    ? 'running'
    : npmInstallStatus === 'failed'
      ? 'failed'
      : 'completed';

  const step2Status = step1Status === 'failed' || step1Status === 'running'
    ? 'pending'
    : devServerReady === false
      ? 'running'
      : 'completed';

  // Filter and minimize logs to only show key lines
  const cleanLogs = (npmInstallLogs || [])
    .filter(line => {
      const l = line.toLowerCase();
      if (l.includes('progress: ') || l.includes('resolving: ') || l.includes('fetch:') || l.includes('tarball')) return false;
      return line.trim().length > 0;
    })
    .slice(-6); // Only show last 6 lines to keep it minimal and clean

  const renderStepIcon = (status: 'pending' | 'running' | 'completed' | 'failed') => {
    if (status === 'completed') {
      return <Icon name="check" size={14} style={{ color: 'var(--green)' }} />;
    }
    if (status === 'running') {
      return <Spinner size={14} />;
    }
    if (status === 'failed') {
      return <Icon name="alert-triangle" size={14} style={{ color: 'var(--red)' }} />;
    }
    return (
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'var(--text-muted)',
        opacity: 0.4,
        display: 'inline-block'
      }} />
    );
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      padding: '24px',
      boxSizing: 'border-box',
      background: 'var(--bg)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'var(--bg-card, var(--bg-2))',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        textAlign: 'left'
      }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
          Project Preparation
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px' }}>
              {renderStepIcon(step1Status)}
            </div>
            <span style={{
              fontSize: '13.5px',
              color: step1Status === 'failed' ? 'var(--red)' : 'var(--text)',
              fontWeight: step1Status === 'running' ? 500 : 400
            }}>
              Installing dependencies
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px' }}>
              {renderStepIcon(step2Status)}
            </div>
            <span style={{
              fontSize: '13.5px',
              color: step2Status === 'pending' ? 'var(--text-muted)' : 'var(--text)',
              fontWeight: step2Status === 'running' ? 500 : 400
            }}>
              Starting development server
            </span>
          </div>
        </div>

        {(step1Status === 'running' || step1Status === 'failed') && cleanLogs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
              Installation Logs
            </span>
            <div style={{
              background: 'var(--bg-3, rgba(0, 0, 0, 0.02))',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: '10.5px',
              lineHeight: '1.5',
              color: 'var(--text-secondary)',
              maxHeight: '100px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap'
            }}>
              <Ansi>{cleanLogs.join('\n')}</Ansi>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
