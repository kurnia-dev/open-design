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

  // Determine the status label
  let mainStatusText = 'Preparing your project';
  if (step1Status === 'running') {
    mainStatusText = 'Installing project dependencies';
  } else if (step1Status === 'failed') {
    mainStatusText = 'Setup failed';
  } else if (step2Status === 'running') {
    mainStatusText = 'Booting development server';
  } else if (step2Status === 'completed') {
    mainStatusText = 'Project is ready';
  }

  // Animation CSS styles
  const styles = `
    @keyframes od-shimmer {
      0% { opacity: 0.15; }
      50% { opacity: 0.45; }
      100% { opacity: 0.15; }
    }
    @keyframes od-flow {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    @keyframes od-float {
      0% { transform: translateY(0px); }
      50% { transform: translateY(-4px); }
      100% { transform: translateY(0px); }
    }
    @keyframes od-pulse-border {
      0% { border-color: var(--border); }
      50% { border-color: var(--accent); }
      100% { border-color: var(--border); }
    }
    .od-skeleton-line {
      height: 8px;
      border-radius: 4px;
      background: var(--border);
      opacity: 0.2;
    }
    .od-skeleton-line.is-running-install {
      animation: od-shimmer 1.8s ease-in-out infinite;
    }
    .od-skeleton-line.is-running-dev {
      background: linear-gradient(90deg, var(--border) 0%, var(--accent) 50%, var(--border) 100%);
      background-size: 200% 100%;
      opacity: 0.7;
      animation: od-flow 2s linear infinite;
    }
    .od-skeleton-line.is-failed {
      background: var(--red);
      opacity: 0.3;
    }
  `;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      padding: '24px',
      boxSizing: 'border-box',
      background: 'var(--bg)',
      flexDirection: 'column',
      gap: '24px'
    }}>
      <style>{styles}</style>

      {/* Dashed Animation Card */}
      <div style={{
        width: '280px',
        height: '180px',
        border: step1Status === 'failed'
          ? '2.5px dashed var(--red)'
          : step2Status === 'running'
            ? '2.5px dashed var(--accent)'
            : '2.5px dashed var(--border)',
        borderRadius: '16px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '12px',
        position: 'relative',
        background: 'rgba(0, 0, 0, 0.02)',
        animation: step2Status === 'running' ? 'od-pulse-border 2s infinite' : 'none'
      }}>
        {/* Skeleton code lines */}
        <div
          className={`od-skeleton-line ${step1Status === 'running' ? 'is-running-install' : step2Status === 'running' ? 'is-running-dev' : step1Status === 'failed' ? 'is-failed' : ''}`}
          style={{ width: '70%', animationDelay: '0s' }}
        />
        <div
          className={`od-skeleton-line ${step1Status === 'running' ? 'is-running-install' : step2Status === 'running' ? 'is-running-dev' : step1Status === 'failed' ? 'is-failed' : ''}`}
          style={{ width: '50%', animationDelay: '0.3s' }}
        />
        <div
          className={`od-skeleton-line ${step1Status === 'running' ? 'is-running-install' : step2Status === 'running' ? 'is-running-dev' : step1Status === 'failed' ? 'is-failed' : ''}`}
          style={{ width: '85%', animationDelay: '0.6s' }}
        />
        <div
          className={`od-skeleton-line ${step1Status === 'running' ? 'is-running-install' : step2Status === 'running' ? 'is-running-dev' : step1Status === 'failed' ? 'is-failed' : ''}`}
          style={{ width: '40%', animationDelay: '0.9s' }}
        />

        {/* Floating circular code symbol badge */}
        <div style={{
          position: 'absolute',
          bottom: '16px',
          left: '16px',
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          border: step1Status === 'failed' ? '1.5px solid var(--red)' : '1.5px solid var(--border)',
          background: 'var(--bg-card, var(--bg-2))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          animation: step1Status === 'running' || step2Status === 'running' ? 'od-float 2.5s ease-in-out infinite' : 'none',
        }}>
          {step1Status === 'failed' ? (
            <Icon name="alert-triangle" size={14} style={{ color: 'var(--red)' }} />
          ) : (
            <span style={{
              fontSize: '11px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              color: step2Status === 'running' ? 'var(--accent)' : 'var(--text-secondary)'
            }}>
              {"</>"}
            </span>
          )}
        </div>
      </div>

      {/* Centered status indicators panel */}
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
          {mainStatusText}
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
