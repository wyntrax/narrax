'use client';
import {useEffect, useRef} from 'react';

interface Fleck {
  nx: number;
  ny: number;
  lum: number;
  seed: number;
  len: number;
  ang: number;
}

interface Mote {
  dx: number;
  phase: number;
  speed: number;
  r: number;
  sway: number;
}

/**
 * Interactive bespoke Narrax Hero Copperplate Engraving canvas ("The Threshold").
 * Always draws onto a pure #050505 void so Light Archival Paper CSS inversion
 * turns the void transparent over warm bone paper.
 */
export function HeroPlate() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = canvas.parentElement;
    if (!stage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;
    let width = 1280;
    let height = 720;
    let mouseX = 0;
    let mouseY = 0;
    let smoothX = 0;
    let smoothY = 0;
    let visible = true;
    let rafId: number | null = null;
    let time = 0;
    let imageReady = false;
    let flecks: Fleck[] = [];
    let revealStart: number | null = null;
    let progress = reducedMotion ? 1.15 : -0.05;
    let isRevealing = !reducedMotion;
    let disposed = false;

    const motes: Mote[] = [];
    for (let m = 0; m < 24; m++) {
      motes.push({
        dx: ((Math.sin(m * 17.3) * 0.5 + 0.5) - 0.5) * 0.14,
        phase: m / 24,
        speed: 0.11 + (m % 5) * 0.032,
        r: 0.75 + (m % 3) * 0.45,
        sway: (m % 2 === 0 ? 1 : -1) * (4 + (m % 4) * 2),
      });
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
              if (lum > 76 && ((x * 7 + y * 13) % 5 === 0)) {
                sampled.push({
                  nx: x / sw,
                  ny: y / sh,
                  lum: lum / 255,
                  seed: ((x * 37 + y * 17) % 100) / 100,
                  len: 2 + (lum > 180 ? 2.6 : 1.3),
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
    img.src = '/plates/narrax-hero-threshold.jpg';

    function drawFrame() {
      if (!ctx) return;
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, width, height);
      if (!imageReady) return;

      const natW = img.naturalWidth || 1600;
      const natH = img.naturalHeight || 900;
      const isMobile = width <= 700;
      const parallaxX = reducedMotion ? 0 : smoothX * (isMobile ? 4 : 10);
      const parallaxY = reducedMotion ? 0 : smoothY * (isMobile ? 2 : 5);
      const scale = isMobile
        ? (width * 1.85) / natW
        : Math.max((height * 1.01) / natH, (width * 0.9 + 48) / natW);
      const drawW = natW * scale;
      const drawH = natH * scale;
      const imgX = isMobile
        ? width * 0.5 - drawW * 0.693 + parallaxX
        : width * 0.73 - drawW * 0.693 + parallaxX;
      const imgY = isMobile
        ? 18 + parallaxY
        : Math.max(-24, (height - drawH) * 0.26) + parallaxY;

      const doorX = imgX + drawW * 0.693;
      const doorY = imgY + drawH * 0.44;
      const thresholdY = imgY + drawH * 0.63;

      if (progress >= 1.12 || reducedMotion) {
        ctx.drawImage(img, imgX, imgY, drawW, drawH);
      } else {
        const revealFrontX = width * (1 - progress);
        const bands = 24;
        const bandH = height / bands;
        for (let b = 0; b < bands; b++) {
          const by = b * bandH;
          const jitter = Math.sin(b * 1.9 + progress * 14) * (width * 0.024);
          const startX = Math.max(0, Math.min(width, revealFrontX + jitter));
          const sliceW = width - startX;
          if (sliceW > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(startX, by, sliceW, bandH + 1);
            ctx.clip();
            ctx.drawImage(img, imgX, imgY, drawW, drawH);
            ctx.restore();
          }
        }

        for (let i = 0; i < flecks.length; i++) {
          const p = flecks[i]!;
          const pxBase = imgX + p.nx * drawW;
          const pyBase = imgY + p.ny * drawH;
          const distNorm = (revealFrontX - pxBase) / Math.max(240, width);
          if (distNorm > -0.04 && distNorm < 0.22) {
            const norm = (distNorm + 0.04) / 0.26;
            const spread = Math.sin(norm * Math.PI);
            const px = pxBase - spread * (16 + p.seed * 48);
            const py = pyBase + (p.seed - 0.5) * spread * 32;
            const alpha = (1 - norm) * p.lum * 0.9;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(p.ang + spread * 1.4);
            ctx.fillStyle = `rgba(234, 228, 215, ${alpha.toFixed(2)})`;
            ctx.fillRect(-p.len * 0.5, -0.7, p.len, 1.4);
            ctx.restore();
          }
        }
      }

      if (progress >= 0.55 || reducedMotion) {
        const glowStrength = reducedMotion ? 0.1 : 0.08 + Math.sin(time * 1.4) * 0.04;
        const halo = ctx.createRadialGradient(
          doorX,
          doorY,
          drawW * 0.015,
          doorX,
          doorY,
          drawH * 0.26,
        );
        halo.addColorStop(0, `rgba(245, 240, 230, ${(glowStrength * 1.35).toFixed(3)})`);
        halo.addColorStop(0.55, `rgba(234, 228, 215, ${(glowStrength * 0.45).toFixed(3)})`);
        halo.addColorStop(1, 'rgba(5, 5, 5, 0)');
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, width, height);
      }

      if (!reducedMotion && progress >= 0.72) {
        for (const m of motes) {
          const life = (m.phase + time * m.speed) % 1;
          const mx = doorX + m.dx * drawW + Math.sin(life * 6 + m.phase * 9) * m.sway;
          const my = thresholdY - life * (drawH * 0.44);
          const alpha = Math.sin(life * Math.PI) * 0.52;
          ctx.fillStyle = `rgba(245, 240, 230, ${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(mx, my, m.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (isMobile) {
        const fadeTop = imgY + drawH * 0.58;
        const fadeBottom = imgY + drawH * 1.02;
        const mobileFade = ctx.createLinearGradient(0, fadeTop, 0, fadeBottom);
        mobileFade.addColorStop(0, 'rgba(5, 5, 5, 0)');
        mobileFade.addColorStop(0.55, 'rgba(5, 5, 5, 0.72)');
        mobileFade.addColorStop(1, '#050505');
        ctx.fillStyle = mobileFade;
        ctx.fillRect(0, fadeTop, width, Math.max(0, height - fadeTop));
      } else {
        const shieldW = width * 0.54;
        const leftShield = ctx.createLinearGradient(0, 0, shieldW, 0);
        leftShield.addColorStop(0, 'rgba(5, 5, 5, 0.9)');
        leftShield.addColorStop(0.68, 'rgba(5, 5, 5, 0.46)');
        leftShield.addColorStop(1, 'rgba(5, 5, 5, 0)');
        ctx.fillStyle = leftShield;
        ctx.fillRect(0, 0, shieldW, height);

        const bottomEdge = ctx.createLinearGradient(0, height * 0.84, 0, height);
        bottomEdge.addColorStop(0, 'rgba(5, 5, 5, 0)');
        bottomEdge.addColorStop(1, '#050505');
        ctx.fillStyle = bottomEdge;
        ctx.fillRect(0, height * 0.84, width, height * 0.16);
      }
    }

    function resizeCanvas() {
      if (!stage || !canvas || !ctx) return;
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.style.height = `${height}px`;
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
      smoothX += (mouseX - smoothX) * 0.06;
      smoothY += (mouseY - smoothY) * 0.06;
      drawFrame();
      rafId = window.requestAnimationFrame(tick);
    }

    const onMouseMove = (e: MouseEvent) => {
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };

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
      if (visible && rafId === null) {
        rafId = window.requestAnimationFrame(tick);
      }
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

    stage.addEventListener('mousemove', onMouseMove);
    window.addEventListener('narrax-hero-replay', onReplay);
    motionQuery.addEventListener('change', onMotionChange);
    window.addEventListener('resize', resizeCanvas);

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(entries => {
          visible = Boolean(entries[0]?.isIntersecting);
          if (visible && !reducedMotion && rafId === null) {
            rafId = window.requestAnimationFrame(tick);
          }
        })
      : null;
    io?.observe(stage);

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizeCanvas) : null;
    ro?.observe(stage);

    resizeCanvas();
    if (!reducedMotion) rafId = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      stage.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('narrax-hero-replay', onReplay);
      motionQuery.removeEventListener('change', onMotionChange);
      window.removeEventListener('resize', resizeCanvas);
      io?.disconnect();
      ro?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="portal-canvas" aria-hidden="true" />;
}

export function HeroReplayButton({label}: {label: string}) {
  return (
    <button
      type="button"
      className="plate-replay-btn"
      onClick={() => window.dispatchEvent(new Event('narrax-hero-replay'))}
    >
      {label}
    </button>
  );
}
