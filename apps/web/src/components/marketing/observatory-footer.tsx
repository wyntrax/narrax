'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';

interface Fleck {
  nx: number;
  ny: number;
  lum: number;
  seed: number;
  len: number;
  ang: number;
}

interface SpireMote {
  x: number;
  phase: number;
  speed: number;
  r: number;
}

export function ObservatoryFooter({
  plateLabel,
  children,
}: {
  plateLabel: string;
  children: ReactNode;
}) {
  const footerRef = useRef<HTMLElement>(null);
  const bpSvgRef = useRef<SVGSVGElement>(null);
  const bpLinesRef = useRef<SVGGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const footer = footerRef.current;
    const bpSvg = bpSvgRef.current;
    const bpLines = bpLinesRef.current;
    const canvas = canvasRef.current;
    if (!footer || !bpSvg || !bpLines || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;
    let flecks: Fleck[] = [];
    let imageReady = false;
    let animStart: number | null = null;
    let progress = reducedMotion ? 1.15 : 0;
    let isAnimating = false;
    let hasRevealed = false;
    let visible = true;
    let rafId: number | null = null;
    let time = 0;
    let disposed = false;

    const spireMotes: SpireMote[] = [];
    for (let m = 0; m < 18; m++) {
      spireMotes.push({
        x: 0.703 + Math.sin(m * 11.3) * 0.015,
        phase: m / 18,
        speed: 0.14 + (m % 4) * 0.04,
        r: 0.8 + (m % 2) * 0.6,
      });
    }

    function drawBlueprint() {
      if (!footer || !bpSvg || !bpLines) return;
      const rect = footer.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      bpSvg.setAttribute('viewBox', `0 0 ${rect.width.toFixed(0)} ${rect.height.toFixed(0)}`);
      bpSvg.style.height = `${rect.height.toFixed(0)}px`;

      const isDesktop = rect.width >= 768;
      const padX = isDesktop ? 32 : 24;
      const innerW = Math.max(200, rect.width - padX * 2);
      const xs = isDesktop
        ? [padX, padX + innerW * 0.25, padX + innerW * 0.5, padX + innerW * 0.75, padX + innerW]
        : [padX, padX + innerW * 0.5, padX + innerW];

      let markup = `<line x1="${(padX - 16).toFixed(1)}" y1="24" x2="${(rect.width - padX + 16).toFixed(1)}" y2="24" stroke="var(--hairline)" stroke-width="1" stroke-dasharray="3 4" />`;
      for (const x of xs) {
        markup += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${(rect.height * 0.92).toFixed(1)}" stroke="url(#bp-vert-fade)" stroke-width="1" stroke-dasharray="3 4" />`;
      }
      bpLines.innerHTML = markup;
    }

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
              if (lum > 74 && ((x * 7 + y * 13) % 5 === 0)) {
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
      sizeCanvas();
      if (reducedMotion) {
        setRevealed(true);
        drawCanvas();
      }
    };
    img.src = '/plates/narrax-footer-observatory.jpg';

    function drawCanvas() {
      if (!canvas || !ctx) return;
      const w = canvas.clientWidth || 800;
      const h = Math.round((w * 9) / 16);
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, w, h);
      if (!imageReady) return;

      if (progress >= 1.12 || reducedMotion) {
        ctx.drawImage(img, 0, 0, w, h);
      } else {
        const frontX = progress * w;
        const bands = 24;
        const bandH = h / bands;
        for (let b = 0; b < bands; b++) {
          const by = b * bandH;
          const jitter = Math.sin(b * 1.9 + progress * 14) * (w * 0.022);
          const clipW = Math.max(0, Math.min(w, frontX + jitter));
          if (clipW > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, by, clipW, bandH + 1);
            ctx.clip();
            ctx.drawImage(img, 0, 0, w, h);
            ctx.restore();
          }
        }
        for (const p of flecks) {
          const dist = p.nx - progress;
          if (dist > -0.04 && dist < 0.2) {
            const norm = (dist + 0.04) / 0.24;
            const spread = Math.sin(norm * Math.PI);
            const px = p.nx * w + spread * (14 + p.seed * 48);
            const py = p.ny * h + (p.seed - 0.5) * spread * 34;
            const alpha = (1 - norm) * p.lum * 0.92;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(p.ang + spread * 1.4);
            ctx.fillStyle = `rgba(234, 228, 215, ${alpha.toFixed(2)})`;
            ctx.fillRect(-p.len * 0.5, -0.7, p.len, 1.4);
            ctx.restore();
          }
        }
      }

      if (!reducedMotion && progress >= 0.85) {
        for (const m of spireMotes) {
          const life = (m.phase + time * m.speed) % 1;
          const mx = m.x * w + Math.sin(life * 6 + m.phase * 10) * 5;
          const my = h * 0.21 - life * (h * 0.18);
          const alpha = Math.sin(life * Math.PI) * 0.55;
          ctx.fillStyle = `rgba(234, 228, 215, ${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(mx, my, m.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const topFade = ctx.createLinearGradient(0, 0, 0, h * 0.14);
      topFade.addColorStop(0, '#050505');
      topFade.addColorStop(1, 'rgba(5, 5, 5, 0)');
      ctx.fillStyle = topFade;
      ctx.fillRect(0, 0, w, h * 0.14);
    }

    function sizeCanvas() {
      if (!footer || !canvas || !ctx) return;
      const w = footer.getBoundingClientRect().width || 800;
      const h = Math.round((w * 9) / 16);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBlueprint();
      drawCanvas();
    }

    function frameLoop(ts: number) {
      if (disposed || !visible || reducedMotion) {
        rafId = null;
        return;
      }
      if (animStart === null) animStart = ts;
      const elapsed = ts - animStart;
      if (isAnimating) {
        const t = Math.min(1, elapsed / 2400);
        const eased = 1 - Math.pow(1 - t, 2.2);
        progress = -0.05 + eased * 1.18;
        if (t >= 1) {
          isAnimating = false;
          progress = 1.15;
        }
      }
      time += 0.016;
      drawCanvas();
      rafId = window.requestAnimationFrame(frameLoop);
    }

    function startReveal() {
      hasRevealed = true;
      setRevealed(true);
      if (reducedMotion) {
        progress = 1.15;
        drawCanvas();
        return;
      }
      animStart = null;
      progress = -0.05;
      isAnimating = true;
      if (visible && rafId === null) rafId = window.requestAnimationFrame(frameLoop);
    }

    const onReplay = () => {
      setRevealed(false);
      window.requestAnimationFrame(() => startReveal());
    };

    const onMotionChange = () => {
      reducedMotion = motionQuery.matches;
      if (reducedMotion) {
        if (rafId !== null) window.cancelAnimationFrame(rafId);
        rafId = null;
        progress = 1.15;
        isAnimating = false;
        setRevealed(true);
        drawCanvas();
      } else if (visible && rafId === null) {
        rafId = window.requestAnimationFrame(frameLoop);
      }
    };

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sizeCanvas) : null;
    ro?.observe(footer);
    window.addEventListener('resize', sizeCanvas);
    window.addEventListener('narrax-footer-replay', onReplay);
    motionQuery.addEventListener('change', onMotionChange);

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          entries => {
            visible = Boolean(entries[0]?.isIntersecting);
            if (visible && !hasRevealed) startReveal();
            else if (visible && !reducedMotion && rafId === null) rafId = window.requestAnimationFrame(frameLoop);
          },
          {threshold: 0.01},
        )
      : null;
    if (reducedMotion) {
      hasRevealed = true;
      setRevealed(true);
    }
    if (io) io.observe(footer);
    else startReveal();

    sizeCanvas();

    return () => {
      disposed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      io?.disconnect();
      window.removeEventListener('resize', sizeCanvas);
      window.removeEventListener('narrax-footer-replay', onReplay);
      motionQuery.removeEventListener('change', onMotionChange);
    };
  }, []);

  return (
    <footer
      ref={footerRef}
      className={`site-footer engraving-footer${revealed ? ' is-revealed' : ''}`}
    >
      <svg ref={bpSvgRef} className="blueprint-svg" aria-hidden="true">
        <defs>
          <linearGradient id="bp-vert-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--hairline)" stopOpacity="1" />
            <stop offset="68%" stopColor="var(--hairline)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="var(--hairline)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g ref={bpLinesRef} />
      </svg>

      {children}

      <div className="engraving-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="engraving-canvas"
          role="img"
          aria-label={plateLabel}
        />
      </div>
    </footer>
  );
}

export function FooterReplayButton({label}: {label: string}) {
  return (
    <button
      type="button"
      className="plate-replay-btn"
      onClick={() => window.dispatchEvent(new Event('narrax-footer-replay'))}
    >
      {label}
    </button>
  );
}
