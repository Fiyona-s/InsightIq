/** Plain wording for a dashboard tile's stored freshness status. The stored status value itself is never changed. */
export const NOT_TRACKED = "Revision not recorded";
export function freshnessLabel(status: string | null | undefined): string {
  return !status || status === NOT_TRACKED ? "Saved before change tracking" : status;
}
export function freshnessHelp(status: string | null | undefined): string | undefined {
  return !status || status === NOT_TRACKED
    ? "We cannot tell whether the data has changed since this was saved. Refresh to start tracking."
    : undefined;
}
