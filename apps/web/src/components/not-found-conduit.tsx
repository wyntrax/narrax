'use client';
import {useEffect, useRef} from 'react';
import {ArrowLeft, Compass} from 'lucide-react';
import {Link} from '@/i18n/navigation';
import {BrandMark} from './brand-mark';
import {ThemeToggle, LocaleToggle} from './toggles';
import './not-found-conduit.css';

interface Fleck {
  nx: number;
  ny: number;
  lum: number;
  seed: number;
  len: number;
  ang: number;
}

export function NotFoundConduit({
  theme,
  title,
  subtitle,
  homeLabel,
  radarLabel,
  accessLabel,
  replayLabel,
}: {
  theme: string;
  title: string;
  subtitle: string;
  homeLabel: string;
  radarLabel: string;
  accessLabel: string;
  replayLabel: string;
}) {
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;
    let width = 1280;
    let height = 720;
    let visible = true;
    let rafId: number | null = null;
    let time = 0;
    let imageReady = false;
    let flecks: Fleck[] = [];
    let revealStart: number | null = null;
    let progress = reducedMotion ? 1.15 : -0.05;
    let isRevealing = !reducedMotion;
    let disposed = false;

    const embers = Array.from({length: 36}, (_, i) => ({
      x: Math.sin(i * 19.7) * 0.5 + 0.5,
      y: Math.cos(i * 7.3) * 0.5 + 0.5,
      r: 0.75 + (i % 4) * 0.4,
      vy: 0.032 + (i % 5) * 0.014,
      vx: 0.014 + (i % 3) * 0.008,
      wobble: (i % 6) * 0.7,
      glow: i % 3 === 0,
    }));

    const fractureSparks = Array.from({length: 14}, (_, s) => {
      const leftSide = s % 2 === 0;
      return {
        baseNx: leftSide ? 0.378 : 0.62,
        baseNy: 0.285 + (s % 4) * 0.015,
        dir: leftSide ? 1 : -1,
        phase: s / 14,
        speed: 0.14 + (s % 5) * 0.03,
        r: 0.7 + (s % 2) * 0.5,
      };
    });

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (disposed) return;
      imageReady = true;
      try {
        const off = document.createElement('canvas');
        const sw = 480;
        const sh = 270;
        off.width = sw;
        off.height = sh;
        const octx = off.getContext('2d');
        if (octx) {
          octx.drawImage(img, 0, 0, sw, sh);
          const data = octx.getImageData(0, 0, sw, sh).data;
          const sampled: Fleck[] = [];
          for (let y = 0; y < sh; y += 3) {
            for (let x = 0; x < sw; x += 3) {
              const idx = (y * sw + x) * 4;
              const r = data[idx] ?? 0;
              const g = data[idx + 1] ?? 0;
              const b = data[idx + 2] ?? 0;
              const lum = r * 0.299 + g * 0.587 + b * 0.114;
              if (lum > 76 && ((x * 7 + y * 13) % 5 === 0)) {
                sampled.push({
                  nx: x / sw,
                  ny: y / sh,
                  lum: lum / 255,
                  seed: ((x * 37 + y * 17) % 100) / 100,
                  len: 2 + (lum > 180 ? 2.5 : 1.2),
                  ang: ((x + y) % 6) * 0.52,
                });
              }
            }
          }
          flecks = sampled;
        }
      } catch {
        flecks = [];
      }
      drawFrame();
    };
    img.src = '/plates/narrax-404-conduit.jpg';

    function drawFrame() {
      if (!ctx) return;
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, width, height);
      if (!imageReady) return;

      const natW = img.naturalWidth || 1600;
      const natH = img.naturalHeight || 900;
      const scale = Math.max(width / natW, height / natH);
      const drawW = natW * scale;
      const drawH = natH * scale;
      const imgX = (width - drawW) * 0.5;
      const imgY = (height - drawH) * 0.52;

      if (progress >= 1.12 || reducedMotion) {
        ctx.drawImage(img, imgX, imgY, drawW, drawH);
      } else {
        const halfW = width * 0.5;
        const spanReveal = Math.max(0, Math.min(1, progress)) * halfW;
        const bands = 24;
        const bandH = height / bands;
        for (let b = 0; b < bands; b++) {
          const by = b * bandH;
          const jitter = Math.sin(b * 1.9 + progress * 14) * (width * 0.018);
          const leftW = Math.max(0, Math.min(halfW, spanReveal + jitter));
          const rightStart = Math.max(halfW, Math.min(width, width - spanReveal + jitter));
          const rightW = Math.max(0, width - rightStart);

          if (leftW > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, by, leftW, bandH + 1);
            ctx.clip();
            ctx.drawImage(img, imgX, imgY, drawW, drawH);
            ctx.restore();
          }
          if (rightW > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(rightStart, by, rightW, bandH + 1);
            ctx.clip();
            ctx.drawImage(img, imgX, imgY, drawW, drawH);
            ctx.restore();
          }
        }

        const leftFront = spanReveal;
        const rightFront = width - spanReveal;
        for (const p of flecks) {
          const pxBase = imgX + p.nx * drawW;
          const pyBase = imgY + p.ny * drawH;
          const isLeft = pxBase < halfW;
          const distNorm = isLeft
            ? (pxBase - leftFront) / Math.max(180, halfW)
            : (rightFront - pxBase) / Math.max(180, halfW);
          if (distNorm > -0.04 && distNorm < 0.24) {
            const norm = (distNorm + 0.04) / 0.28;
            const spread = Math.sin(norm * Math.PI);
            const push = spread * (14 + p.seed * 44) * (isLeft ? 1 : -1);
            const px = pxBase + push;
            const py = pyBase + (p.seed - 0.5) * spread * 30;
            const alpha = (1 - norm) * p.lum * 0.9;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(p.ang + spread * 1.3);
            ctx.fillStyle = `rgba(234, 228, 215, ${alpha.toFixed(2)})`;
            ctx.fillRect(-p.len * 0.5, -0.7, p.len, 1.4);
            ctx.restore();
          }
        }
      }

      for (let f = 0; f < 4; f++) {
        const driftX = Math.sin(time * (0.22 + f * 0.07) + f * 1.7) * (width * 0.07);
        const fx = width * (0.24 + f * 0.17) + driftX;
        const fy = height * (0.68 + (f % 2) * 0.06);
        const fr = width * (0.16 + (f % 3) * 0.04);
        const mistGrad = ctx.createRadialGradient(fx, fy, 4, fx, fy, fr);
        mistGrad.addColorStop(0, 'rgba(234, 228, 215, 0.055)');
        mistGrad.addColorStop(1, 'rgba(5, 5, 5, 0)');
        ctx.fillStyle = mistGrad;
        ctx.beginPath();
        ctx.ellipse(fx, fy, fr, fr * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reducedMotion && progress >= 0.65) {
        for (const e of embers) {
          const ex = ((e.x + time * e.vx) % 1) * width + Math.sin(time * 0.8 + e.wobble) * 10;
          const ey = (1 - ((e.y + time * e.vy) % 1)) * height;
          const pulse = 0.28 + 0.34 * Math.sin(time * 1.4 + e.wobble);
          if (e.glow) {
            const aura = ctx.createRadialGradient(ex, ey, 0.5, ex, ey, e.r * 5);
            aura.addColorStop(0, `rgba(245, 240, 230, ${(pulse * 0.45).toFixed(2)})`);
            aura.addColorStop(1, 'rgba(5, 5, 5, 0)');
            ctx.fillStyle = aura;
            ctx.beginPath();
            ctx.arc(ex, ey, e.r * 5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = `rgba(245, 240, 230, ${pulse.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(ex, ey, e.r, 0, Math.PI * 2);
          ctx.fill();
        }

        for (const s of fractureSparks) {
          const life = (s.phase + time * s.speed) % 1;
          const sx = imgX + (s.baseNx + s.dir * life * 0.05) * drawW;
          const sy = imgY + (s.baseNy - life * 0.07) * drawH + Math.sin(life * 8) * 3;
          const alpha = Math.sin(life * Math.PI) * 0.62;
          ctx.fillStyle = `rgba(245, 240, 230, ${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function resizeCanvas() {
      if (!stage || !canvas || !ctx) return;
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFrame();
    }

    function tick(ts: number) {
      if (disposed || !visible || reducedMotion) {
        rafId = null;
        return;
      }
      if (isRevealing) {
        if (revealStart === null) revealStart = ts;
        const t = Math.min(1, (ts - revealStart) / 1800);
        const eased = 1 - Math.pow(1 - t, 3);
        progress = -0.05 + eased * 1.2;
        if (t >= 1) {
          isRevealing = false;
          progress = 1.15;
        }
      }
      time += 0.016;
      drawFrame();
      rafId = window.requestAnimationFrame(tick);
    }

    const onReplay = () => {
      if (reducedMotion) {
        progress = 1.15;
        isRevealing = false;
        drawFrame();
        return;
      }
      revealStart = null;
      progress = -0.05;
      isRevealing = true;
      if (visible && rafId === null) rafId = window.requestAnimationFrame(tick);
    };

    const onMotionChange = () => {
      reducedMotion = motionQuery.matches;
      if (reducedMotion) {
        if (rafId !== null) window.cancelAnimationFrame(rafId);
        rafId = null;
        progress = 1.15;
        isRevealing = false;
        drawFrame();
      } else if (visible && rafId === null) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizeCanvas) : null;
    ro?.observe(stage);
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('narrax-404-replay', onReplay);
    motionQuery.addEventListener('change', onMotionChange);

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(entries => {
          visible = Boolean(entries[0]?.isIntersecting);
          if (visible && !reducedMotion && rafId === null) rafId = window.requestAnimationFrame(tick);
        })
      : null;
    io?.observe(stage);

    resizeCanvas();
    if (!reducedMotion) rafId = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      io?.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('narrax-404-replay', onReplay);
      motionQuery.removeEventListener('change', onMotionChange);
    };
  }, []);

  return (
    <div ref={stageRef as React.RefObject<HTMLDivElement>} className="conduit-stage">
      <canvas ref={canvasRef} className="conduit-canvas" aria-hidden="true" />

      <header className="conduit-header">
        <Link href="/" prefetch={false} className="conduit-brand" aria-label={homeLabel}>
          <BrandMark />
          <span>NARRAX</span>
        </Link>
      </header>

      <main id="main" className="conduit-chasm">
        <h1 className="sr-only">404 · {title}</h1>
        <svg className="conduit-numeral" viewBox="0 0 472 210" aria-hidden="true">
          <defs>
            <linearGradient id="nx-404-sheen" gradientUnits="userSpaceOnUse" x1="460" y1="20" x2="20" y2="195">
              <stop offset="2%" className="conduit-stop-start" />
              <stop offset="94%" className="conduit-stop-end" />
            </linearGradient>
          </defs>
          <path
            fill="url(#nx-404-sheen)"
            fillRule="evenodd"
            d="M 102 12 H 131 V 128 H 150 V 155 H 131 V 198 H 104 V 155 H 12 V 128 L 102 12 Z M 104 53 L 46 128 H 104 Z"
          />
          <path
            fill="url(#nx-404-sheen)"
            fillRule="evenodd"
            d="M 225 12 H 247 A 58 58 0 0 1 305 70 V 140 A 58 58 0 0 1 247 198 H 225 A 58 58 0 0 1 167 140 V 70 A 58 58 0 0 1 225 12 Z M 225 39 A 31 31 0 0 0 194 70 V 140 A 31 31 0 0 0 225 171 H 247 A 31 31 0 0 0 278 140 V 70 A 31 31 0 0 0 247 39 Z"
          />
          <polygon fill="url(#nx-404-sheen)" points="182.6,149.3 274.6,47.3 289.4,60.7 197.4,162.7" />
          <path
            fill="url(#nx-404-sheen)"
            fillRule="evenodd"
            d="M 412 12 H 441 V 128 H 460 V 155 H 441 V 198 H 414 V 155 H 322 V 128 L 412 12 Z M 414 53 L 356 128 H 414 Z"
          />
        </svg>

        <div className="conduit-rule" aria-hidden="true" />
        <p className="conduit-copy">{subtitle}</p>
      </main>

      <footer className="conduit-footer">
        <div className="conduit-actions">
          <Link className="button button-primary" href="/" prefetch={false}>
            <ArrowLeft size={16} aria-hidden="true" />
            {homeLabel}
          </Link>
          <Link className="button button-ghost" href="/app/radar" prefetch={false}>
            <Compass size={16} aria-hidden="true" />
            {radarLabel}
          </Link>
          <Link className="button button-ghost" href="/early-access" prefetch={false}>
            {accessLabel} <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="conduit-footer-controls">
          <ThemeToggle initial={theme} showLabel />
          <LocaleToggle />
          <button
            type="button"
            className="plate-replay-btn"
            onClick={() => window.dispatchEvent(new Event('narrax-404-replay'))}
          >
            {replayLabel}
          </button>
        </div>
      </footer>
    </div>
  );
}
