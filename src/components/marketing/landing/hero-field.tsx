"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The living background behind the hero (design step 10.2), drawn on a canvas by our own code,
 * no library. Like Vercel's and Resend's hero canvases, it answers the pointer:
 * - a field of dots on the 56px grid (one every 28px) brightens and lifts near the pointer;
 * - a few faint lights travel along the grid lines.
 * Without a hovering pointer (phones) a soft spotlight drifts by itself. It is decorative and
 * hidden from assistive tech. It starts only once the page is idle (so it never competes with
 * the first paint), pauses off screen and in background tabs, and with "reduce motion" it draws
 * one still frame. The colour comes from CSS (`currentColor`), so it suits both themes.
 */
export function HeroField({ className, quiet = false }: { className?: string; quiet?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const GAP = 28;
    const GRID = 56;
    const R = quiet ? 220 : 180; // spotlight radius, px
    const strength = quiet ? 0.55 : 1;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let rgb = "255,255,255";
    let raf = 0;
    let running = false;
    let visible = true;
    let last = performance.now();
    // Pointer (target) and the eased spotlight that follows it; off canvas until used.
    const target = { x: -9999, y: -9999, active: false };
    const spot = { x: -9999, y: -9999, a: 0 };
    type Beam = { horizontal: boolean; line: number; pos: number; speed: number; len: number };
    let beams: Beam[] = [];

    const newBeam = (): Beam => {
      const horizontal = Math.random() < 0.5;
      const lines = Math.max(1, Math.floor((horizontal ? h : w) / GRID));
      const speed = (70 + Math.random() * 90) * (Math.random() < 0.5 ? 1 : -1);
      const span = horizontal ? w : h;
      return {
        horizontal,
        line: (1 + Math.floor(Math.random() * lines)) * GRID,
        pos: speed > 0 ? -120 : span + 120,
        speed,
        len: 90 + Math.random() * 90,
      };
    };

    const resize = () => {
      const r = host.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, hover ? 2 : 1.5);
      w = Math.round(r.width);
      h = Math.round(r.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const m = getComputedStyle(canvas).color.match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3) rgb = `${m[0]},${m[1]},${m[2]}`;
      beams = quiet || reduce ? [] : Array.from({ length: w < 700 ? 2 : 4 }, newBeam);
    };

    const draw = (t: number) => {
      const dt = Math.min(64, t - last) / 1000;
      last = t;
      ctx.clearRect(0, 0, w, h);

      // Without a hovering pointer, the spotlight drifts on a slow figure-eight.
      if (!target.active && !reduce) {
        const s = t / 1000;
        target.x = w * (0.5 + 0.32 * Math.sin(s * 0.23));
        target.y = h * (0.32 + 0.16 * Math.sin(s * 0.37));
      }
      const ease = 1 - Math.pow(0.0015, dt); // frame-rate independent smoothing
      spot.x += (target.x - spot.x) * ease;
      spot.y += (target.y - spot.y) * ease;
      const wantA = reduce ? 0 : target.active ? 1 : 0.55;
      spot.a += (wantA - spot.a) * ease;

      // Dots: a faint base everywhere; near the spotlight, brighter, larger and lifted.
      for (let y = GAP / 2; y < h; y += GAP) {
        for (let x = GAP / 2; x < w; x += GAP) {
          const dx = x - spot.x;
          const dy = y - spot.y;
          const d2 = dx * dx + dy * dy;
          let k = 0;
          if (d2 < R * R) {
            const d = Math.sqrt(d2) / R;
            k = (1 - d) * (1 - d) * spot.a * strength;
          }
          const alpha = 0.1 + k * 0.6;
          const size = 1 + k * 1.3;
          const lift = k * 4;
          ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
          ctx.fillRect(x - size / 2, y - size / 2 - lift, size, size);
        }
      }

      // Lights travelling along the grid lines.
      for (let i = 0; i < beams.length; i++) {
        const b = beams[i]!;
        b.pos += b.speed * dt;
        const span = b.horizontal ? w : h;
        if (b.pos < -200 || b.pos > span + 200) {
          beams[i] = newBeam();
          continue;
        }
        const head = b.pos;
        const tail = b.pos - Math.sign(b.speed) * b.len;
        const g = b.horizontal
          ? ctx.createLinearGradient(tail, 0, head, 0)
          : ctx.createLinearGradient(0, tail, 0, head);
        g.addColorStop(0, `rgba(${rgb},0)`);
        g.addColorStop(1, `rgba(${rgb},0.45)`);
        ctx.fillStyle = g;
        if (b.horizontal) ctx.fillRect(Math.min(head, tail), b.line - 0.5, b.len, 1);
        else ctx.fillRect(b.line - 0.5, Math.min(head, tail), 1, b.len);
      }
    };

    const loop = (t: number) => {
      draw(t);
      raf = running ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (running || reduce || !visible || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = host.getBoundingClientRect();
      target.x = e.clientX - r.left;
      target.y = e.clientY - r.top;
      target.active = true;
    };
    const onLeave = () => {
      target.active = false;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    const ro = new ResizeObserver(() => {
      resize();
      if (!running) draw(performance.now());
    });
    const io = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) start();
      else stop();
    });

    // Wait for an idle moment so the first paint and the page's own scripts come first.
    const begin = () => {
      resize();
      draw(performance.now());
      ro.observe(host);
      io.observe(host);
      if (hover) {
        host.addEventListener("pointermove", onMove);
        host.addEventListener("pointerleave", onLeave);
      }
      document.addEventListener("visibilitychange", onVisibility);
      canvas.setAttribute("data-ready", "");
      start();
    };
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(begin, { timeout: 1500 })
      : window.setTimeout(begin, 600);

    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      stop();
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [quiet]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={cn(
        "hero-field text-foreground pointer-events-none absolute inset-0 size-full opacity-0 transition-opacity duration-700 data-[ready]:opacity-100",
        className,
      )}
    />
  );
}
