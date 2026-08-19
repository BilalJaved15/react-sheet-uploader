/**
 * The modal shell: chrome, step routing, and the footer's navigation rules.
 *
 * Rendered into a portal on `document.body` so the host application's stacking
 * contexts and `overflow: hidden` cannot clip it.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useUploader } from '../state/useUploader';
import type { SheetUploaderProps, StepId } from '../types';
import { Button } from './components/Button';
import { CloseIcon } from './components/Icons';
import { Stepper } from './components/Stepper';
import { HeaderStep } from './steps/HeaderStep';
import { MatchStep } from './steps/MatchStep';
import { MatchValuesStep } from './steps/MatchValuesStep';
import { ReviewStep } from './steps/ReviewStep';
import { SheetStep } from './steps/SheetStep';
import { UploadStep } from './steps/UploadStep';
import { buildThemeVars, useCustomFont } from './theme';

interface UploaderModalProps extends SheetUploaderProps {
  onClose: () => void;
  onInstanceReady?: (instance: ReturnType<typeof useUploader>['instance']) => void;
}

export function UploaderModal(props: UploaderModalProps) {
  const { settings = {}, onClose, onCancel, className, onInstanceReady } = props;

  const controller = useUploader(props, onClose);
  const { state, fields, rows, sourceColumns, actions, visibleSteps, instance } = controller;

  const dialogRef = useRef<HTMLDivElement | null>(null);

  useCustomFont(settings.styleOverrides?.global?.customFontURL);
  const themeVars = useMemo(
    () => buildThemeVars(settings.styleOverrides),
    [settings.styleOverrides],
  );

  useEffect(() => {
    onInstanceReady?.(instance);
  }, [instance, onInstanceReady]);

  const cancel = useCallback(() => {
    onCancel?.();
    onClose();
  }, [onCancel, onClose]);

  /* Escape closes; Tab is trapped inside the dialog. */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [cancel]);

  /* Keep the page behind the modal from scrolling. */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const title =
    settings.title ??
    (props.importIdentifier ?? settings.importIdentifier
      ? `Add ${props.importIdentifier ?? settings.importIdentifier}`
      : 'Import data');

  const stepIndex = visibleSteps.indexOf(state.step as StepId);

  const goBack = useCallback(() => {
    const previous = visibleSteps[stepIndex - 1];
    if (previous) actions.goToStep(previous);
  }, [actions, stepIndex, visibleSteps]);

  const footer = renderFooter();

  return createPortal(
    <div className={`rsu-root${className ? ` ${className}` : ''}`} style={themeVars}>
      <div className="rsu-overlay" onMouseDown={(event) => event.target === event.currentTarget && cancel()}>
        <div
          ref={dialogRef}
          className="rsu-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="rsu-header">
            <div>
              <h2 className="rsu-title">{title}</h2>
              {state.filename && <p className="rsu-subtitle">{state.filename}</p>}
            </div>
            <button type="button" className="rsu-close" aria-label="Close" onClick={cancel}>
              <CloseIcon size={17} />
            </button>
          </header>

          {state.step !== 'confirm' && (
            <Stepper
              steps={visibleSteps}
              current={state.step}
              onNavigate={(step) => actions.goToStep(step)}
            />
          )}

          {state.banner && (
            <div className={`rsu-banner rsu-banner--${state.banner.level}`} role="alert">
              <span>{state.banner.message}</span>
              <button
                type="button"
                className="rsu-banner-dismiss"
                aria-label="Dismiss"
                onClick={() => actions.setBanner(null)}
              >
                <CloseIcon size={14} />
              </button>
            </div>
          )}

          <div className="rsu-relative">
            <div className={`rsu-body${state.step === 'review' ? ' rsu-body--flush' : ''}`}>
              {renderStep()}
            </div>

            {state.busy && (
              <div className="rsu-busy" role="status" aria-live="polite">
                <div className="rsu-spinner" />
                <span className="rsu-busy-text">{state.busy}</span>
              </div>
            )}
          </div>

          {footer && <footer className="rsu-footer">{footer}</footer>}
        </div>
      </div>
    </div>,
    document.body,
  );

  function renderStep() {
    switch (state.step) {
      case 'upload':
        return (
          <UploadStep
            settings={settings}
            fields={props.fields}
            fileParsers={props.fileParsers}
            onFile={(file) => void actions.acceptFile(file)}
            onManualEntry={() => void actions.startManualEntry()}
            onError={(message) => actions.setBanner(message, 'error')}
          />
        );

      case 'sheet':
        return (
          <SheetStep
            sheets={state.sheets}
            selected={state.activeSheetName}
            onSelect={actions.selectSheet}
          />
        );

      case 'header':
        return (
          <HeaderStep
            rows={rows}
            headerRowIndex={state.headerRowIndex}
            onSelect={actions.setHeaderRowIndex}
          />
        );

      case 'match':
        return (
          <MatchStep
            columns={sourceColumns}
            fields={fields}
            mappings={state.mappings}
            settings={settings.matchingStep ?? {}}
            allowCustomFields={settings.allowCustomFields ?? false}
            aiMatch={state.aiMatch}
            onChange={actions.setMappings}
            onAddCustomField={actions.addExtraField}
            onConfirmAll={actions.confirmAllMappings}
          />
        );

      case 'matchValues':
        return (
          <MatchValuesStep
            groups={controller.valueMappingGroups}
            mappings={controller.valueMappings}
            settings={settings.matchValuesStep ?? {}}
            onChange={controller.setValueMappings}
          />
        );

      case 'review':
        return (
          <ReviewStep
            records={state.records}
            fields={fields}
            dataVersion={state.dataVersion}
            settings={settings.reviewStep ?? {}}
            manualEntry={state.manualEntry}
            onEdit={actions.applyEdits}
            onDeleteRows={actions.deleteRecords}
            onAddRow={actions.addRecord}
          />
        );

      case 'confirm':
        return (
          <div className="rsu-confirm">
            <div className="rsu-confirm-title">Import complete</div>
            <div className="rsu-confirm-body">{state.confirmationMessage}</div>
          </div>
        );

      default:
        return null;
    }
  }

  function renderFooter() {
    const back =
      stepIndex > 0 ? (
        <Button variant="secondary" onClick={goBack}>
          Back
        </Button>
      ) : (
        <Button variant="tertiary" onClick={cancel}>
          Cancel
        </Button>
      );

    switch (state.step) {
      case 'upload':
      case 'sheet':
        return <>{back}</>;

      case 'header':
        return (
          <>
            {back}
            <div className="rsu-footer-actions">
              <Button variant="primary" onClick={() => actions.confirmHeader(state.headerRowIndex)}>
                Continue
              </Button>
            </div>
          </>
        );

      case 'match':
        return (
          <>
            {back}
            <div className="rsu-footer-actions">
              <Button variant="primary" onClick={() => void actions.confirmMatch()}>
                Continue
              </Button>
            </div>
          </>
        );

      case 'matchValues':
        return (
          <>
            {back}
            <div className="rsu-footer-actions">
              <Button variant="primary" onClick={() => void actions.buildAndReview()}>
                Continue
              </Button>
            </div>
          </>
        );

      case 'review':
        return (
          <>
            {back}
            <div className="rsu-footer-actions">
              {!controller.submitState.allowed && controller.submitState.reason && (
                <span className="rsu-footer-note">{controller.submitState.reason}</span>
              )}
              <Button
                variant="primary"
                disabled={!controller.submitState.allowed}
                onClick={() => void actions.submit()}
              >
                Submit
              </Button>
            </div>
          </>
        );

      case 'confirm':
        return (
          <div className="rsu-footer-actions">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        );

      default:
        return null;
    }
  }
}
