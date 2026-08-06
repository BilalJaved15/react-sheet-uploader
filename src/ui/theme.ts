/**
 * Translates the `styleOverrides` setting into CSS custom properties.
 *
 * Everything the stylesheet draws reads from a `--rsu-*` variable, so branding
 * an uploader never requires overriding selectors — which matters because this
 * component renders inside someone else's application and their CSS should not
 * have to fight ours.
 */

import type { CSSProperties } from 'react';
import type { StyleOverrides } from '../types';

type Vars = Record<string, string>;

function assign(vars: Vars, name: string, value: string | undefined): void {
  if (value !== undefined && value !== null && value !== '') vars[name] = value;
}

function buttonVars(vars: Vars, prefix: string, style: StyleOverrides['primaryButton']): void {
  if (!style) return;
  assign(vars, `${prefix}-bg`, style.backgroundColor);
  assign(vars, `${prefix}-fg`, style.textColor);
  assign(vars, `${prefix}-border`, style.border);
  assign(vars, `${prefix}-radius`, style.borderRadius);
  assign(vars, `${prefix}-hover-bg`, style.hoverBackgroundColor);
  assign(vars, `${prefix}-hover-fg`, style.hoverTextColor);
  assign(vars, `${prefix}-hover-border`, style.hoverBorder);
  assign(vars, `${prefix}-disabled-bg`, style.disabledBackgroundColor);
  assign(vars, `${prefix}-disabled-fg`, style.disabledTextColor);
  assign(vars, `${prefix}-padding`, style.padding);
}

export function buildThemeVars(overrides: StyleOverrides | undefined): CSSProperties {
  const vars: Vars = {};
  if (!overrides) return vars as CSSProperties;

  const { global } = overrides;
  if (global) {
    assign(vars, '--rsu-text', global.primaryTextColor ?? global.textColor);
    assign(vars, '--rsu-text-muted', global.secondaryTextColor);
    assign(vars, '--rsu-surface', global.backgroundColor);
    assign(vars, '--rsu-radius', global.borderRadius);
    assign(vars, '--rsu-border-color', global.borderColor);
    assign(vars, '--rsu-border-width', global.borderWidth);
    assign(vars, '--rsu-border-style', global.borderStyle);
    assign(vars, '--rsu-success', global.successColor);
    assign(vars, '--rsu-warning', global.warningColor);
    assign(vars, '--rsu-error', global.errorColor);
    assign(vars, '--rsu-backdrop-blur', global.backdropBlur);
    assign(vars, '--rsu-font', global.customFontFamily);
  }

  buttonVars(vars, '--rsu-btn-primary', overrides.primaryButton);
  buttonVars(vars, '--rsu-btn-secondary', overrides.secondaryButton);
  buttonVars(vars, '--rsu-btn-tertiary', overrides.tertiaryButton);

  const { dropzone } = overrides;
  if (dropzone) {
    assign(vars, '--rsu-dropzone-bg', dropzone.backgroundColor);
    assign(vars, '--rsu-dropzone-border-color', dropzone.borderColor);
    assign(vars, '--rsu-dropzone-border-width', dropzone.borderWidth);
    assign(vars, '--rsu-dropzone-border-style', dropzone.borderStyle);
    assign(vars, '--rsu-dropzone-radius', dropzone.borderRadius);
    assign(vars, '--rsu-dropzone-outline', dropzone.outline);
  }

  const { helpText } = overrides;
  if (helpText) {
    assign(vars, '--rsu-help-bg', helpText.backgroundColor);
    assign(vars, '--rsu-help-fg', helpText.textColor);
    assign(vars, '--rsu-help-radius', helpText.borderRadius);
    assign(vars, '--rsu-help-border', helpText.border);
  }

  const { stepperBar } = overrides;
  if (stepperBar) {
    assign(vars, '--rsu-step-complete', stepperBar.completeColor);
    assign(vars, '--rsu-step-incomplete', stepperBar.incompleteColor);
    assign(vars, '--rsu-step-current', stepperBar.currentColor);
    assign(vars, '--rsu-step-font-size', stepperBar.fontSize);
    assign(vars, '--rsu-step-complete-weight', stepperBar.completeFontWeight);
    assign(vars, '--rsu-step-incomplete-weight', stepperBar.incompleteFontWeight);
    assign(vars, '--rsu-step-current-weight', stepperBar.currentFontWeight);
    assign(vars, '--rsu-step-bg', stepperBar.backgroundColor);
    assign(vars, '--rsu-step-border-bottom', stepperBar.borderBottom);
  }

  const { dataTable } = overrides;
  if (dataTable) {
    assign(vars, '--rsu-grid-header-weight', dataTable.headerFontWeight);
    assign(vars, '--rsu-grid-header-bg', dataTable.headerBackgroundColor);
    assign(vars, '--rsu-grid-header-fg', dataTable.headerTextColor);
    assign(vars, '--rsu-grid-rowheader-bg', dataTable.rowHeaderBackgroundColor);
    assign(vars, '--rsu-grid-rowheader-fg', dataTable.rowHeaderTextColor);
    assign(vars, '--rsu-grid-corner-bg', dataTable.cornerHeaderBackgroundColor);
    assign(vars, '--rsu-grid-selection-border', dataTable.cellSelectionBorderColor);
    assign(vars, '--rsu-grid-selection-bg', dataTable.cellSelectionBackgroundColor);
    assign(vars, '--rsu-accent', dataTable.accentColor);
    assign(vars, '--rsu-grid-header-active-bg', dataTable.headerActiveBackgroundColor);
    assign(vars, '--rsu-grid-header-active-fg', dataTable.headerActiveTextColor);
    assign(vars, '--rsu-grid-header-highlight-bg', dataTable.headerHighlightedBackgroundColor);
    assign(vars, '--rsu-grid-header-highlight-fg', dataTable.headerHighlightedTextColor);
  }

  const { modalOverlay } = overrides;
  if (modalOverlay) {
    assign(vars, '--rsu-overlay-bg', modalOverlay.backgroundColor);
    assign(vars, '--rsu-overlay-opacity', modalOverlay.opacity);
  }

  const { errorNavigator } = overrides;
  if (errorNavigator) {
    assign(vars, '--rsu-nav-error', errorNavigator.errorColor);
    assign(vars, '--rsu-nav-warning', errorNavigator.warningColor);
    assign(vars, '--rsu-nav-accent', errorNavigator.accentColor);
  }

  return vars as CSSProperties;
}

/**
 * Loads a webfont named by `customFontURL`.
 *
 * Injected rather than declared in the stylesheet because the URL is only known
 * at runtime; the same href is never added twice.
 */
export function useCustomFont(url: string | undefined): void {
  if (typeof document === 'undefined' || !url) return;
  const existing = document.querySelector(`link[data-rsu-font="${CSS.escape(url)}"]`);
  if (existing) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.rsuFont = url;
  document.head.appendChild(link);
}
