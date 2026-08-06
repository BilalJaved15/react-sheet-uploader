import { useEffect, useRef } from 'react';
import { Button } from './Button';
import { AlertIcon } from './Icons';

interface ConfirmDialogProps {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Captured so the modal's own Escape handler does not close the whole
  // uploader when the user only meant to dismiss this prompt.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onCancel]);

  return (
    <div className="rsu-confirm-overlay" onMouseDown={onCancel}>
      <div
        className="rsu-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="rsu-confirm-dialog-head">
          <span
            className={`rsu-confirm-icon${destructive ? ' rsu-confirm-icon--destructive' : ''}`}
          >
            <AlertIcon size={17} />
          </span>
          <div>
            <div className="rsu-confirm-dialog-title">{title}</div>
            {body && <div className="rsu-confirm-dialog-body">{body}</div>}
          </div>
        </div>

        <div className="rsu-confirm-dialog-actions">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <button
            ref={confirmRef}
            type="button"
            className={`rsu-btn ${destructive ? 'rsu-btn--danger' : 'rsu-btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
