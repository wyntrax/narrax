'use client';
import {useEffect, useMemo, useRef, useState} from 'react';

export function TaglineReveal({
  lines,
  hint,
  replayLabel,
}: {
  lines: readonly [string, string, string];
  hint: string;
  replayLabel: string;
}) {
  const containerRef = useRef<HTMLParagraphElement>(null);
  const words = useMemo(() => {
    const out: Array<{word: string; lineIdx: number; idx: number}> = [];
    let idx = 0;
    lines.forEach((line, lineIdx) => {
      for (const word of line.split(' ')) {
        out.push({word, lineIdx, idx});
        idx += 1;
      }
    });
    return out;
  }, [lines]);

  const [litCount, setLitCount] = useState<number>(words.length);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.matches) {
      setLitCount(words.length);
      return;
    }

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 720;
      const startY = vh * 0.9;
      const endY = vh * 0.34;
      const progress = Math.min(1, Math.max(0, (startY - rect.top) / (startY - endY)));
      setLitCount(Math.max(1, Math.floor(progress * (words.length + 0.5))));
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', schedule, {passive: true});
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [words.length]);

  const replay = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLitCount(words.length);
      return;
    }
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    setLitCount(0);
    let current = 0;
    timerRef.current = window.setInterval(() => {
      current += 1;
      setLitCount(current);
      if (current >= words.length && timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 95);
  };

  return (
    <section className="section container tagline-band" aria-label={lines.join(' ')}>
      <div className="tagline-card">
        <p ref={containerRef} className="tagline-statement">
          {lines.map((line, lineIdx) => (
            <span key={lineIdx} className="tagline-line">
              {words
                .filter(w => w.lineIdx === lineIdx)
                .map(w => (
                  <span key={w.idx}>
                    <span className={`reveal-word${w.idx < litCount ? ' is-lit' : ''}`}>{w.word}</span>{' '}
                  </span>
                ))}
              {lineIdx < lines.length - 1 && <br />}
            </span>
          ))}
        </p>
        <div className="tagline-foot">
          <span>{hint}</span>
          <button type="button" className="plate-replay-btn" onClick={replay}>
            {replayLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
