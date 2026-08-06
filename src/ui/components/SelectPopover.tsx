/**
 * The dropdown used by `select` and `multi-select` cells.
 *
 * Not a native `<select>`: multi-select needs checkboxes (a native multiple
 * select is unusable with a mouse), and both need to render above the grid's
 * scroll container, so the list is positioned as a fixed-position popover
 * anchored to the cell.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SelectOption } from '../../types';
import { CheckIcon } from './Icons';

interface SelectPopoverProps {
  options: SelectOption[];
  /** Currently chosen option labels. */
  selected: string[];
  multiple: boolean;
  /** Anchor rectangle, in viewport coordinates. */
  anchor: DOMRect;
  /** Lets the user type a value that is not in the list. */
  allowCustom: boolean;
  onChange: (labels: string[]) => void;
  onClose: () => void;
}

const MAX_HEIGHT = 260;

export function SelectPopover({
  options,
  selected,
  multiple,
  anchor,
  allowCustom,
  onChange,
  onClose,
}: SelectPopoverProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const chosen = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.value.toLowerCase().includes(needle),
    );
  }, [options, query]);

  /* Flip above the anchor when there is not enough room below. */
  const [position, setPosition] = useState<{ top: number; left: number; width: number }>({
    top: anchor.bottom,
    left: anchor.left,
    width: Math.max(anchor.width, 200),
  });

  useLayoutEffect(() => {
    const width = Math.max(anchor.width, 200);
    const spaceBelow = window.innerHeight - anchor.bottom;
    const height = Math.min(MAX_HEIGHT, containerRef.current?.offsetHeight ?? MAX_HEIGHT);

    const top = spaceBelow < height + 12 ? Math.max(8, anchor.top - height) : anchor.bottom;
    const left = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);

    setPosition({ top, left, width });
  }, [anchor]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  /* Dismiss on outside click, and on any scroll that would move the anchor. */
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    const onScroll = () => onClose();

    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  const toggle = (option: SelectOption) => {
    if (!multiple) {
      onChange(chosen.has(option.label) ? [] : [option.label]);
      onClose();
      return;
    }
    const next = new Set(chosen);
    if (next.has(option.label)) next.delete(option.label);
    else next.add(option.label);
    // Preserve the schema's option order rather than click order.
    onChange(options.filter((o) => next.has(o.label)).map((o) => o.label));
  };

  const commitCustom = () => {
    const value = query.trim();
    if (value === '') return;
    if (multiple) {
      onChange([...selected, value]);
      setQuery('');
    } else {
      onChange([value]);
      onClose();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        const option = filtered[activeIndex];
        if (option) toggle(option);
        else if (allowCustom) commitCustom();
        break;
      }
      case 'Tab':
        onClose();
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={containerRef}
      className="rsu-popover"
      style={{ top: position.top, left: position.left, width: position.width }}
      role="listbox"
      aria-multiselectable={multiple}
      onKeyDown={handleKeyDown}
    >
      {(options.length > 7 || allowCustom) && (
        <input
          ref={searchRef}
          className="rsu-popover-search"
          type="text"
          placeholder={allowCustom ? 'Search or type a value' : 'Search'}
          value={query}
          aria-label="Filter options"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />
      )}

      <div className="rsu-popover-list">
        {filtered.length === 0 && !allowCustom && (
          <div className="rsu-popover-empty">No matching options</div>
        )}

        {filtered.map((option, index) => {
          const isChosen = chosen.has(option.label);
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={isChosen}
              className={`rsu-popover-item${index === activeIndex ? ' rsu-popover-item--active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => toggle(option)}
            >
              <span className="rsu-popover-check">{isChosen && <CheckIcon size={13} />}</span>
              <span className="rsu-popover-label">{option.label}</span>
            </button>
          );
        })}

        {allowCustom && query.trim() !== '' && !filtered.some((o) => o.label === query.trim()) && (
          <button type="button" className="rsu-popover-item rsu-popover-item--custom" onClick={commitCustom}>
            <span className="rsu-popover-check" />
            <span className="rsu-popover-label">
              Use “{query.trim()}”
            </span>
          </button>
        )}
      </div>

      {multiple && (
        <div className="rsu-popover-footer">
          <button type="button" className="rsu-popover-clear" onClick={() => onChange([])}>
            Clear
          </button>
          <button type="button" className="rsu-popover-done" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
