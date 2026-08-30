/**
 * Whether the dashboard's "Export to Anki" section should render.
 *
 * Deliberately independent of `pairReady`: an export failure (e.g. the account-wide export
 * route redirecting back here with no recoverable pair) must still show its banner, even when
 * there's no active pair to render the rest of the section against.
 */
export function shouldShowExportSection(canExport: boolean, hasExportError: boolean): boolean {
  return canExport || hasExportError;
}
