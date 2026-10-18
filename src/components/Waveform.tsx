import { useEffect, useRef } from "react";
import { useRecorder } from "@/lib/recorder";

/** Live level bars while recording; newest enters at the right. */
export function Waveform() {
  const ref = useRef<HTMLCanvasElement>(null);
  const analyser = useRecorder((s) => s.analyser);
  const state = useRecorder((s) => s.state);
  const stateRef = useRef(state);
  stateRef.current = state;
  const hist = useRef<number[]>([]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const buf = new Uint8Array(analyser?.fftSize ?? 1024);
    const color = getComputedStyle(document.documentElement).getPropertyValue("--amber-bright").trim() || "#F0AC41";
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const step = 6;
      if (t - last > 50) {
        last = t;
        let v = 0;
        if (analyser && stateRef.current === "recording") {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const x = (buf[i]! - 128) / 128;
            sum += x * x;
          }
          v = Math.min(1, Math.sqrt(sum / buf.length) * 5);
        }
        if (stateRef.current !== "paused") hist.current.push(v);
        const max = Math.ceil(w / step) + 1;
        while (hist.current.length > max) hist.current.shift();
      }
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.fillStyle = color;
      g.shadowColor = color;
      g.shadowBlur = 6;
      const H = hist.current;
      const mid = h / 2;
      for (let i = 0; i < Math.ceil(w / step); i++) {
        const v = H[H.length - 1 - i] ?? 0;
        const x = w - i * step - step / 2;
        if (v < 0.05) {
          g.beginPath();
          g.arc(x, mid, 1, 0, Math.PI * 2);
          g.fill();
        } else {
          const bh = Math.max(4, v * h * 0.95);
          g.fillRect(x - 0.9, mid - bh / 2, 1.8, bh);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return <canvas ref={ref} className="h-24 w-full" aria-hidden />;
}
