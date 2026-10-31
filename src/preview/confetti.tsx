import { useMemo } from 'react';
import { motion } from 'motion/react';

const COLORS = ['#3157E1', '#D8FF68', '#163D34', '#F6D8C5', '#DCE8F7', '#F5DFE4', '#F6E8B9'];

/** One-shot celebration. The parent unmounts it after ~3s; it never intercepts clicks. */
export function Confetti({ count = 70 }: { count?: number }) {
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => {
    const angle = (-90 + (Math.random() - 0.5) * 150) * (Math.PI / 180);
    const speed = 220 + Math.random() * 380;
    return {
      id: i,
      dx: Math.cos(angle) * speed,
      up: Math.sin(angle) * speed,
      fall: 380 + Math.random() * 360,
      spin: (Math.random() - 0.5) * 900,
      size: 7 + Math.random() * 8,
      round: Math.random() > 0.65,
      color: COLORS[i % COLORS.length],
      delay: Math.random() * 0.12,
      life: 1.9 + Math.random() * 0.9,
    };
  }), [count]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[80] overflow-hidden">
      <div className="absolute left-1/2 top-[55%]">
        {pieces.map((p) => (
          <motion.span
            key={p.id}
            className="absolute block"
            style={{ width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.color, borderRadius: p.round ? '999px' : 2 }}
            initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
            animate={{ x: [0, p.dx * 0.8, p.dx], y: [0, p.up, p.up + p.fall], rotate: p.spin, opacity: [1, 1, 0] }}
            transition={{ duration: p.life, delay: p.delay, ease: 'easeOut', times: [0, 0.4, 1] }}
          />
        ))}
      </div>
    </div>
  );
}
