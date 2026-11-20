import { useEffect, useState } from 'react';
import { HERO_IMAGES } from '@/main-site/components/hero-images';

const ROTATE_MS = 7200;

/** A slow, decorative crossfade keeps the marketplace imagery present without competing with search. */
export function HeroCarousel() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setActive((a) => (a + 1) % HERO_IMAGES.length), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {HERO_IMAGES.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          loading={i === 0 ? 'eager' : 'lazy'}
          className={`absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-[1400ms] ease-in-out ${
            i === active ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.025]'
          }`}
        />
      ))}
    </div>
  );
}
