/**
 * The public component.
 *
 * Visibility works three ways, matching how Dromo's uploader is used in the
 * wild: pass `children` and clicking them opens the modal; pass `open` to drive
 * it from your own state; or hold a ref and call `open()`.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { UploaderModal } from './ui/UploaderModal';
import type { SheetUploaderProps, UploaderInstance } from './types';

export const SheetUploader = forwardRef<UploaderInstance, SheetUploaderProps>(
  function SheetUploader(props, ref) {
    const { open: controlledOpen, onOpenChange, children } = props;

    const isControlled = controlledOpen !== undefined;
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

    const instanceRef = useRef<UploaderInstance | null>(null);

    const setOpen = useCallback(
      (next: boolean) => {
        if (!isControlled) setUncontrolledOpen(next);
        onOpenChange?.(next);
      },
      [isControlled, onOpenChange],
    );

    const close = useCallback(() => setOpen(false), [setOpen]);

    // The modal only exists while open, so `open`/`close` on the ref must be
    // served by this component rather than the modal's own instance.
    useImperativeHandle(
      ref,
      (): UploaderInstance => ({
        open: () => setOpen(true),
        close,
        addField: (...args) => instanceRef.current?.addField(...args),
        removeField: (...args) => instanceRef.current?.removeField(...args),
        updateInfoMessages: (...args) => instanceRef.current?.updateInfoMessages(...args),
        addRows: (...args) => instanceRef.current?.addRows(...args),
        removeRows: (...args) => instanceRef.current?.removeRows(...args),
        getRecords: () => instanceRef.current?.getRecords() ?? [],
        setRecords: (...args) => instanceRef.current?.setRecords(...args),
        setConfirmationMessage: (...args) => instanceRef.current?.setConfirmationMessage(...args),
        setMessage: (...args) => instanceRef.current?.setMessage(...args),
        goToStep: (...args) => instanceRef.current?.goToStep(...args),
      }),
      [close, setOpen],
    );

    useEffect(() => {
      if (!isOpen) instanceRef.current = null;
    }, [isOpen]);

    // `display: contents` keeps the host's own layout intact, and no role or
    // tabIndex is added: `children` is nearly always an interactive element
    // already, and wrapping a button in a button is invalid and unfocusable.
    const trigger: ReactNode = children ? (
      <span className="rsu-trigger" style={{ display: 'contents' }} onClick={() => setOpen(true)}>
        {children}
      </span>
    ) : null;

    return (
      <>
        {trigger}
        {isOpen && (
          <UploaderModal
            {...props}
            onClose={close}
            onInstanceReady={(instance) => {
              instanceRef.current = instance;
            }}
          />
        )}
      </>
    );
  },
);

/**
 * Drop-in alias for codebases migrating from `dromo-uploader-react`.
 * Same props, same behaviour; `licenseKey` is accepted and ignored.
 */
export const DromoUploader = SheetUploader;
