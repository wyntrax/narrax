'use client';

import {useId} from 'react';
import {BrandMark} from './brand-mark';
import './narrax-loader.css';

/**
 * Narrax Signal Observatory loader for dashboard & research surfaces.
 * Combines a rotating astrolabe reticle, sweeping narrative radar beam,
 * staggered orbital signal blips, and the centered theme-aware Narrax emblem.
 */
export function NarraxLoader({label}: {label: string}) {
  const sweepId = useId();
  return (
    <div className="research-loading narrax-loader" role="status" aria-live="polite">
      <div className="narrax-loader-stage" aria-hidden="true">
        <svg className="narrax-loader-svg" viewBox="0 0 120 120" fill="none">
          <defs>
            <linearGradient id={sweepId} x1="60" y1="60" x2="108" y2="34" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
              <stop offset="55%" stopColor="currentColor" stopOpacity="0.14" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.45" />
            </linearGradient>
          </defs>

          {/* Subtle crosshair axes */}
          <line x1="60" y1="8" x2="60" y2="112" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
          <line x1="8" y1="60" x2="112" y2="60" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />

          {/* Expanding sonar pulses */}
          <circle cx="60" cy="60" r="52" stroke="currentColor" strokeOpacity="0.32" strokeWidth="1" className="narrax-loader-sonar" />
          <circle cx="60" cy="60" r="52" stroke="currentColor" strokeOpacity="0.32" strokeWidth="1" className="narrax-loader-sonar narrax-loader-sonar--delayed" />

          {/* Outer astrolabe degree ring */}
          <g className="narrax-loader-ring-outer">
            <circle cx="60" cy="60" r="53" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
            <g stroke="currentColor" strokeOpacity="0.38" strokeWidth="1.2" strokeLinecap="round">
              <line x1="60" y1="4" x2="60" y2="9" />
              <line x1="60" y1="111" x2="60" y2="116" />
              <line x1="4" y1="60" x2="9" y2="60" />
              <line x1="111" y1="60" x2="116" y2="60" />
              <line x1="21.8" y1="21.8" x2="24.6" y2="24.6" strokeOpacity="0.24" />
              <line x1="95.4" y1="95.4" x2="98.2" y2="98.2" strokeOpacity="0.24" />
              <line x1="98.2" y1="21.8" x2="95.4" y2="24.6" strokeOpacity="0.24" />
              <line x1="24.6" y1="95.4" x2="21.8" y2="98.2" strokeOpacity="0.24" />
            </g>
          </g>

          {/* Counter-rotating orbital track */}
          <circle
            cx="60"
            cy="60"
            r="39"
            stroke="currentColor"
            strokeOpacity="0.22"
            strokeWidth="1"
            strokeDasharray="3 6"
            className="narrax-loader-ring-mid"
          />

          {/* Sweeping radar sector */}
          <g className="narrax-loader-sweep">
            <path d="M60 60 L60 8 A52 52 0 0 1 106 36 Z" fill={`url(#${sweepId})`} />
            <line x1="60" y1="60" x2="60" y2="8" stroke="currentColor" strokeOpacity="0.65" strokeWidth="1.25" strokeLinecap="round" />
          </g>

          {/* Staggered narrative signal blips */}
          <circle cx="83" cy="28" r="2.6" fill="currentColor" className="narrax-loader-blip" />
          <circle cx="94" cy="76" r="2.2" fill="currentColor" className="narrax-loader-blip narrax-loader-blip--2" />
          <circle cx="31" cy="82" r="2.4" fill="currentColor" className="narrax-loader-blip narrax-loader-blip--3" />
        </svg>

        <div className="narrax-loader-core">
          <BrandMark />
        </div>
      </div>

      <div className="narrax-loader-meta">
        <span className="narrax-loader-label">{label}</span>
        <span className="narrax-loader-trace" aria-hidden="true" />
      </div>
    </div>
  );
}
