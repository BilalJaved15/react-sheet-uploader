import type { StepId } from '../../types';
import { CheckIcon } from './Icons';

const STEP_LABELS: Record<StepId, string> = {
  upload: 'Upload',
  sheet: 'Sheet',
  header: 'Header row',
  match: 'Match columns',
  matchValues: 'Match values',
  review: 'Review',
};

interface StepperProps {
  steps: StepId[];
  current: StepId | 'confirm';
  /** Called when a completed step is clicked. Omit to make the bar read-only. */
  onNavigate?: (step: StepId) => void;
}

export function Stepper({ steps, current, onNavigate }: StepperProps) {
  // 'confirm' sits past the end of the flow, so everything reads as complete.
  const currentIndex = current === 'confirm' ? steps.length : steps.indexOf(current as StepId);

  return (
    <nav className="rsu-stepper" aria-label="Import progress">
      {steps.map((step, index) => {
        const status =
          index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'incomplete';
        const navigable = status === 'complete' && onNavigate !== undefined;

        return (
          <button
            key={step}
            type="button"
            className={`rsu-step rsu-step--${status}`}
            disabled={!navigable}
            aria-current={status === 'current' ? 'step' : undefined}
            onClick={navigable ? () => onNavigate(step) : undefined}
          >
            <span className="rsu-step-marker">
              {status === 'complete' ? <CheckIcon size={11} /> : index + 1}
            </span>
            {STEP_LABELS[step]}
          </button>
        );
      })}
    </nav>
  );
}
