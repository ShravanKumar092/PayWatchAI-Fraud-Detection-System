import { useId } from "react";

export default function BrandLogo({
  size = 56,
  className = "",
  title = "PayWatch AI logo",
  animated = false,
}) {
  const pixelSize = Number(size) || 56;
  const instanceId = useId().replace(/:/g, "");
  const shellGradientId = `paywatch-shell-${instanceId}`;
  const coreGradientId = `paywatch-core-${instanceId}`;
  const glowGradientId = `paywatch-glow-${instanceId}`;
  const orbitGradientId = `paywatch-orbit-${instanceId}`;
  const shadowFilterId = `paywatch-shadow-${instanceId}`;
  const innerShadowFilterId = `paywatch-inner-${instanceId}`;

  return (
    <svg
      className={className}
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 96 96"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={shellGradientId} x1="12" y1="10" x2="80" y2="86" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8ee9ff" />
          <stop offset="0.42" stopColor="#49bfff" />
          <stop offset="1" stopColor="#1f3c88" />
        </linearGradient>
        <linearGradient id={coreGradientId} x1="30" y1="18" x2="68" y2="76" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff2b0" />
          <stop offset="0.42" stopColor="#ffcb5a" />
          <stop offset="1" stopColor="#ff7d35" />
        </linearGradient>
        <radialGradient id={glowGradientId} cx="0" cy="0" r="1" gradientTransform="translate(30 20) rotate(42) scale(48 52)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="0.38" stopColor="#9be6ff" stopOpacity="0.44" />
          <stop offset="1" stopColor="#08111f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={orbitGradientId} x1="18" y1="24" x2="76" y2="76" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9ce7ff" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#5ec7ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffc45e" stopOpacity="0.88" />
        </linearGradient>
        <filter id={shadowFilterId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#020914" floodOpacity="0.48" />
        </filter>
        <filter id={innerShadowFilterId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#ffffff" floodOpacity="0.2" />
        </filter>
      </defs>
      <g filter={`url(#${shadowFilterId})`}>
        {animated ? (
          <g opacity="0.55">
            <circle cx="48" cy="48" r="32" fill="none" stroke={`url(#${orbitGradientId})`} strokeWidth="1.5" strokeDasharray="3 6">
              <animate attributeName="opacity" values="0.18;0.55;0.18" dur="4s" repeatCount="indefinite" />
            </circle>
            <circle cx="48" cy="48" r="26" fill="none" stroke="#7dd7ff" strokeOpacity="0.18" strokeWidth="1" />
          </g>
        ) : null}
        <g>
          {animated ? (
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 0 -1.4; 0 0; 0 1.1; 0 0"
              dur="5.8s"
              repeatCount="indefinite"
            />
          ) : null}
        <path
          d="M48 6C28 6 12 16 12 30v18c0 21 16 35 36 42 20-7 36-21 36-42V30C84 16 68 6 48 6z"
          fill={`url(#${shellGradientId})`}
        />
        <path
          d="M48 12c-16 0-28 8-28 20v15c0 16 11 27 28 33 17-6 28-17 28-33V32c0-12-12-20-28-20z"
          fill={`url(#${glowGradientId})`}
        />
        <path
          d="M48 14c17 0 28 8 28 20v13c0 16-11 27-28 33-17-6-28-17-28-33V34c0-12 11-20 28-20z"
          fill="none"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1.5"
        />
        <path
          d="M49 18l14 10v16L49 54 35 44V28l14-10z"
          fill={`url(#${coreGradientId})`}
          opacity="0.96"
        />
        <path d="M49 18v36l14-10V28L49 18z" fill="#ffd36a" opacity="0.72" />
        <path d="M49 18L35 28v16l14 10V18z" fill="#ffac54" opacity="0.54" />
        <path
          d="M49 18l-14 10m14-10 14 10m-28 16 14 10m14-10L49 54"
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M25 61c6-8 13-12 21-12 7 0 13 2 18 6 4-7 9-12 15-15"
          fill="none"
          stroke="#dff8ff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="26" cy="61" r="4" fill="#9be6ff" />
        <circle cx="46" cy="50" r="4" fill="#fff2b0" />
        <circle cx="64" cy="55" r="4" fill="#ffcb5a" />
        <circle cx="79" cy="39" r="4" fill="#9be6ff" />
        <g filter={`url(#${innerShadowFilterId})`} opacity="0.78">
          <path
            d="M41 16c3-1.6 6.6-2.2 10-2.2 13.6 0 23.1 6.1 25.6 15.7"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.42"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
        {animated ? (
          <>
            <g opacity="0.95">
              <animateTransform attributeName="transform" type="rotate" from="0 48 48" to="360 48 48" dur="18s" repeatCount="indefinite" />
              <circle cx="48" cy="20" r="3.3" fill="#fff3b8" />
              <circle cx="71" cy="43" r="2.6" fill="#7fdcff" />
              <circle cx="26" cy="67" r="2.6" fill="#ffc86d" />
            </g>
            <circle cx="48" cy="48" r="10" fill="rgba(255,255,255,0.08)">
              <animate attributeName="r" values="9.5;11.8;9.5" dur="3.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.14;0.32;0.14" dur="3.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="46" cy="50" r="4.4" fill="#fff2b0">
              <animate attributeName="r" values="4;4.9;4" dur="2.2s" repeatCount="indefinite" />
            </circle>
          </>
        ) : null}
        </g>
      </g>
    </svg>
  );
}
