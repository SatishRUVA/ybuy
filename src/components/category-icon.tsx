import { Baby, Camera, Car, Dumbbell, Home, Leaf, Monitor, Music, Package, PartyPopper, Tent, Trees, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Category } from '@/data';

const NAMED_ICONS: Record<string, LucideIcon> = {
  cameras: Camera,
  tools: Wrench,
  toolsequipment: Wrench,
  electronics: Monitor,
  camping: Tent,
  outdoorcamping: Tent,
  outdoors: Tent,
  party: PartyPopper,
  partyevents: PartyPopper,
  events: PartyPopper,
  sports: Dumbbell,
  sportsfitness: Dumbbell,
  fitness: Dumbbell,
  vehicle: Car,
  vehicles: Car,
  homegarden: Leaf,
  home: Home,
  garden: Trees,
  baby: Baby,
  music: Music,
};
const ICON_EXPORTS: Record<string, LucideIcon> = { Baby, Camera, Car, Dumbbell, Home, Leaf, Monitor, Music, Package, PartyPopper, Tent, Trees, Wrench };

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function CategoryIcon({
  category, size = 18, className,
}: { category: Pick<Category, 'id' | 'name' | 'icon'>; size?: number; className?: string }) {
  const iconKey = [category.id, category.name].map(normalize).find((key) => NAMED_ICONS[key]);
  const Icon = (iconKey ? NAMED_ICONS[iconKey] : undefined)
    ?? ICON_EXPORTS[category.icon]
    ?? Package;

  return <Icon size={size} className={className} aria-hidden="true" />;
}