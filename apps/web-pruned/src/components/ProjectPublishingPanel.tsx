import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@open-design/components';
import Ansi from 'ansi-to-react';
import { Icon } from './Icon';
import { Spinner } from './Loading';
import { useT } from '../i18n';

export interface PublishStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface Props {
  isPublishing: boolean;
  publishLogs: string[];
  setPublishLogs: (logs: string[]) => void;
  publishSteps: PublishStep[];
}

export function ProjectPublishingPanel({
  isPublishing,
  publishLogs,
  setPublishLogs,
  publishSteps,
}: Props) {
  const t = useT();
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const hasFailedPublish = publishLogs.some((line) => line.includes('ERROR:'));
  const hasSuccessfulPublish = publishLogs.some((line) => line.includes('SUCCESS:'));

  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [publishLogs, showLogs]);

  // We don't deduce steps from logs anymore, we use the `publishSteps` prop

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
    @keyframes od-float-box {
      0% { transform: translateY(0px) rotate(0deg); }
      50% { transform: translateY(-6px) rotate(3deg); }
      100% { transform: translateY(0px) rotate(0deg); }
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
    .od-skeleton-line.is-running {
      animation: od-shimmer 1.8s ease-in-out infinite;
    }
    .od-skeleton-line.is-publishing {
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
    <div className="ds-project-panel ds-project-panel--generating" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', padding: '24px 0' }}>
      <style>{styles}</style>
      <div className="ds-project-generation-stage" style={{ width: 'min(500px, calc(100% - 48px))', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        {/* Animated Package Box Card */}
        <div style={{
          width: '240px',
          height: '140px',
          border: hasFailedPublish
            ? '2px dashed var(--red)'
            : isPublishing
              ? '2px dashed var(--accent)'
              : '2px dashed var(--border)',
          borderRadius: '16px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '10px',
          position: 'relative',
          background: 'rgba(0, 0, 0, 0.02)',
          marginBottom: 24,
          animation: isPublishing ? 'od-pulse-border 2s infinite' : 'none'
        }}>
          <div
            className={`od-skeleton-line ${isPublishing ? 'is-publishing' : hasFailedPublish ? 'is-failed' : ''}`}
            style={{ width: '80%', animationDelay: '0s' }}
          />
          <div
            className={`od-skeleton-line ${isPublishing ? 'is-publishing' : hasFailedPublish ? 'is-failed' : ''}`}
            style={{ width: '60%', animationDelay: '0.2s' }}
          />
          <div
            className={`od-skeleton-line ${isPublishing ? 'is-publishing' : hasFailedPublish ? 'is-failed' : ''}`}
            style={{ width: '70%', animationDelay: '0.4s' }}
          />

          <div style={{
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: hasFailedPublish ? '1.5px solid var(--red)' : hasSuccessfulPublish ? '1.5px solid var(--green)' : '1.5px solid var(--border)',
            background: 'var(--bg-card, var(--bg-2))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            animation: isPublishing ? 'od-float-box 2.5s ease-in-out infinite' : 'none',
          }}>
            {hasFailedPublish ? (
              <Icon name="alert-triangle" size={16} style={{ color: 'var(--red)' }} />
            ) : hasSuccessfulPublish ? (
              <Icon name="check" size={16} style={{ color: 'var(--green)' }} />
            ) : (
              <Icon name="blocks" size={16} style={{ color: isPublishing ? 'var(--accent)' : 'var(--text-secondary)' }} />
            )}
          </div>
        </div>

        <h1 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 8px 0', textAlign: 'center' }}>
          {hasFailedPublish
            ? t('publish.titleError')
            : hasSuccessfulPublish
              ? t('publish.titleSuccess')
              : t('publish.titleRunning')}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', margin: '0 0 24px 0', textAlign: 'center', lineHeight: '1.5' }}>
          {hasFailedPublish
            ? t('publish.descError')
            : hasSuccessfulPublish
              ? t('publish.descSuccess')
              : t('publish.descRunning')}
        </p>

        {/* Centered steps panel */}
        <div style={{
          width: '100%',
          background: 'var(--bg-card, var(--bg-2))',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          textAlign: 'left',
          marginBottom: 16,
        }}>
          {publishSteps.map((step) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px' }}>
                {renderStepIcon(step.status)}
              </div>
              <span style={{
                fontSize: '13.5px',
                color: step.status === 'failed' ? 'var(--red)' : step.status === 'pending' ? 'var(--text-muted)' : 'var(--text)',
                fontWeight: step.status === 'running' ? 500 : 400
              }}>
                {step.label}
              </span>
            </div>
          ))}
        </div>

        {/* Small text-only toggle logs button */}
        <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => setShowLogs(prev => !prev)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              padding: '4px 0',
              cursor: 'pointer',
              textDecoration: 'underline',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            {showLogs ? 'Hide Logs' : 'Show Logs'}
          </button>
        </div>

        {/* Collapsible terminal console logs */}
        {showLogs && (
          <div
            style={{
              width: '100%',
              padding: '16px',
              background: 'transparent',
              color: 'var(--text-secondary)',
              borderRadius: 8,
              fontFamily: 'monospace',
              fontSize: 12.5,
              height: 300,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              border: '1px solid var(--border)',
              textAlign: 'left',
              marginBottom: 16,
            }}
          >
            <div style={{ color: hasFailedPublish ? 'var(--red)' : hasSuccessfulPublish ? 'var(--green)' : 'var(--text-secondary)', marginBottom: 8, fontWeight: 'bold', borderBottom: '1px solid var(--border)', paddingBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{t('publish.consoleLogs')}</span>
              {isPublishing && <span className="animate-pulse" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>● {t('publish.runningState')}</span>}
            </div>
            <div style={{ lineHeight: 1.6 }}>
              <Ansi>{publishLogs.filter(line => line.trim().length > 0).join('\n')}</Ansi>
            </div>
            <div ref={logsEndRef} />
          </div>
        )}

        {!isPublishing && (
          <div style={{ marginTop: 8 }}>
            <Button
              variant="primary"
              onClick={() => {
                setPublishLogs([]);
              }}
            >
              {t('publish.backToWorkspace')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
