import { useEffect, useState } from 'react';

// Curated bright, well-lit stock photos (Pexels) — verified visually to avoid dark/moody shots.
const HERO_IMAGES = [
  'https://images.pexels.com/photos/10513799/pexels-photo-10513799.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop', // camping tents, daylight
  'https://images.pexels.com/photos/30413424/pexels-photo-30413424.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop', // tools
  'https://images.pexels.com/photos/9644360/pexels-photo-9644360.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop', // party & events
  'https://images.pexels.com/photos/6552592/pexels-photo-6552592.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop', // home electronics
  'https://images.pexels.com/photos/16998814/pexels-photo-16998814.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop', // sports & fitness
  'https://images.pexels.com/photos/5163429/pexels-photo-5163429.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop', // home & garden
  'https://images.pexels.com/photos/35486274/pexels-photo-35486274.jpeg?auto=compress&cs=tinysrgb&w=1600&h=900&fit=crop', // music & other gear
];

const ROTATE_MS = 4000;

/** Auto-rotating background carousel — no prev/next controls by design. */
export function HeroCarousel() {
  const [active, setActive] = useState(0);

  useEffect(() => {
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
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
            i === active ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
    </div>
  );
}
