import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Category } from '@/data';

const NAMED_ICONS: Record<string, LucideIcon> = {
  tools: Icons.Wrench,
  toolsequipment: Icons.Wrench,
  electronics: Icons.Monitor,
  camping: Icons.Tent,
  outdoorcamping: Icons.Tent,
  outdoors: Icons.Tent,
  party: Icons.PartyPopper,
  partyevents: Icons.PartyPopper,
  events: Icons.PartyPopper,
  sports: Icons.Dumbbell,
  sportsfitness: Icons.Dumbbell,
  fitness: Icons.Dumbbell,
  vehicle: Icons.Car,
  vehicles: Icons.Car,
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function CategoryIcon({
  category, size = 18, className,
}: { category: Pick<Category, 'id' | 'name' | 'icon'>; size?: number; className?: string }) {
  const iconKey = [category.id, category.name].map(normalize).find((key) => NAMED_ICONS[key]);
  const Icon = (iconKey ? NAMED_ICONS[iconKey] : undefined)
    ?? (Icons as unknown as Record<string, LucideIcon>)[category.icon]
    ?? Icons.Package;

  return <Icon size={size} className={className} aria-hidden="true" />;
}