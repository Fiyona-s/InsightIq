/** The InsightIQ mark: the same shape as the favicon (frontend/public/favicon.svg) and docs/logo.svg. One logo everywhere. */
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="InsightIQ" focusable="false">
      <rect className="brand-logo-bg" width="32" height="32" rx="8" />
      <g className="brand-logo-mark" fill="none" strokeWidth="2"><rect x="7" y="7" width="7" height="7" rx="1" /><rect x="18" y="7" width="7" height="11" rx="1" /><rect x="7" y="18" width="7" height="7" rx="1" /><path d="M18 22h7m-3.5-3.5v7" /></g>
    </svg>
  );
}
