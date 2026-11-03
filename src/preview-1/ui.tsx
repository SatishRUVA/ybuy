import { useId, useRef, cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Heart, MapPin, Package, Search, ShieldCheck, Star, Truck, X, Zap } from 'lucide-react';
import { type Listing } from '@/data';
import { Select as SelectRoot, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select';
import { distanceMi } from '../preview/dates';
import { href } from './state';
import { useMarketplace } from './marketplace-context';
import { CategoryIcon } from '@/components/category-icon';

export const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2,
}).format(value);
export const tones: Record<string, string> = {
  Cameras: 'var(--p1-category-cameras)', Outdoor: 'var(--p1-category-outdoor)', Camping: 'var(--p1-category-outdoor)', Garden: 'var(--p1-category-outdoor)',
  Tools: 'var(--p1-category-tools)', Sports: 'var(--p1-category-sports)', Home: 'var(--p1-category-home)', Fashion: 'var(--p1-category-fashion)',
  Baby: 'var(--p1-category-baby)', Vehicles: 'var(--p1-category-vehicles)', Party: 'var(--p1-category-fashion)', Music: 'var(--p1-category-fashion)', Electronics: 'var(--p1-category-vehicles)',
  'Tools & Equipment': 'var(--p1-category-tools)', 'Outdoor & Camping': 'var(--p1-category-outdoor)', 'Party & Events': 'var(--p1-category-fashion)',
  'Sports & Fitness': 'var(--p1-category-sports)', 'Home & Garden': 'var(--p1-category-home)',
};
export function Button({ variant = 'primary', children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'lime' | 'danger' }) {
  return <button type="button" className={`p1-button p1-button-${variant} ${className}`} {...props}>{children}</button>;
}
export function Action({ to, id, children, variant = 'primary', className = '' }: { to: Parameters<typeof href>[0]; id?: string; children: ReactNode; variant?: string; className?: string }) {
  return <a href={href(to, id)} className={`p1-button p1-button-${variant} ${className}`}>{children}</a>;
}
export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'pending' | 'blue' | 'lime' | 'bad' }) {
  return <span className={`p1-tag p1-tag-${tone}`}>{children}</span>;
}
export function PageHead({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="p1-page-head"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}
export function SectionHead({ title, description, to, children }: { title: string; description?: string; to?: Parameters<typeof href>[0]; children?: ReactNode }) {
  return <div className="p1-section-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{to ? <a className="p1-text-link" href={href(to)}>Explore all <ArrowRight size={17} aria-hidden="true" /></a> : children}</div>;
}
export function Avatar({ src, name, size = 40 }: { src: string; name: string; size?: number }) {
  const fallback = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#F7F6F1"/><circle cx="20" cy="15" r="6" fill="#62706D"/><path d="M10 32a10 10 0 0 1 20 0" fill="#62706D"/></svg>')}`;
  return <img className="p1-avatar" src={src || fallback} alt={name} width={size} height={size} style={{ width: size, height: size }} />;
}
export function Rating({ value, count }: { value: number; count?: number }) {
  return <span className="p1-rating"><Star size={13} fill="currentColor" aria-hidden="true" /> <b>{value.toFixed(1)}</b>{count !== undefined && <span>({count})</span>}</span>;
}
export function Save({ id, title }: { id: string; title: string }) {
  const { saved, toggleSaved } = useMarketplace();
  const on = saved.includes(id);
  return <button className={`p1-save ${on ? 'is-saved' : ''}`} type="button" aria-label={`${on ? 'Unsave' : 'Save'} ${title}`} aria-pressed={on} onClick={() => toggleSaved(id)}><Heart size={19} fill={on ? 'currentColor' : 'none'} aria-hidden="true" /></button>;
}
export function ItemCard({ item, compact = false }: { item: Listing; compact?: boolean }) {
  const store = useMarketplace();
  const { search } = store;
  return <article className={`p1-item ${compact ? 'p1-item-compact' : ''}`}>
    <div className="p1-item-photo">
      <a href={href('listing', item.id)} aria-label={`View ${item.title}`}><img src={item.images[0]} alt={item.title} loading="lazy" /></a>
      <Save id={item.id} title={item.title} />
      {item.instantBooking && <span className="p1-instant"><Zap size={13} aria-hidden="true" /> Instant Booking</span>}
      {item.images.length > 0 && <span className="p1-photo-count" aria-label={`${item.images.length} listing photos`}>1/{item.images.length}</span>}
    </div>
    <div className="p1-item-body">
      <div className="p1-item-category"><span><CategoryIcon category={{ id: item.category, name: item.category, icon: 'Package' }} size={16} />{item.category}</span>
        {item.reviewCount > 0 ? <Rating value={item.rating} count={item.reviewCount} /> : <span>New listing</span>}</div>
      <a href={href('listing', item.id)} className="p1-item-title">{item.title}</a>
      <div className="p1-owner-line"><span><Avatar src={item.owner.avatar} name={item.owner.name} size={30} /><b>{item.owner.name.split(' ')[0]}</b>
        {item.verifiedOwner && <span className="p1-card-verified"><ShieldCheck size={16} aria-hidden="true" />Verified Owner</span>}</span>
        <span><MapPin size={14} aria-hidden="true" />{store.production ? store.distance(item) : distanceMi(item, search.loc)} mi</span></div>
      <div className="p1-card-handoff"><span><Package size={14} aria-hidden="true" />Local Pickup</span>
        {item.deliveryAvailable && <span><Truck size={15} aria-hidden="true" />Delivery</span>}</div>
      <div className="p1-card-bottom"><p className="p1-item-price"><strong>{money(item.pricePerDay)}</strong><span>/ day</span></p>
        <Action to="listing" id={item.id}>View Details <ArrowRight size={16} aria-hidden="true" /></Action></div>
    </div>
  </article>;
}
export function Empty({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return <div className="p1-empty"><Search size={30} aria-hidden="true" /><h2>{title}</h2><p>{body}</p><div className="p1-actions">{children}</div></div>;
}
export function Modal({ open, onClose, title, description, children, footer, wide = false }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const opener = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="p1 p1-overlay" /><Dialog.Content className={`p1 p1-dialog ${wide ? 'p1-dialog-wide' : ''}`}
      onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={(event) => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }); } }}>
      <div className="p1-dialog-head"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="p1-icon" aria-label="Close dialog"><X size={20} aria-hidden="true" /></Dialog.Close></div>
      <Dialog.Description className={description ? 'p1-muted' : 'sr-only'}>{description ?? title}</Dialog.Description>
      <div className="p1-dialog-body">{children}</div>
      {footer && <div className="p1-dialog-footer">{footer}</div>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const content = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children) ? cloneElement(children, { id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) }) : children;
  return <div className="p1-field"><label htmlFor={id}>{label}</label>{content}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function Dropdown({ value, onChange, options, label, placeholder = 'Choose an option', id, required, className = '', 'aria-describedby': describedBy }: {
  value: string; onChange: (value: string) => void; options: { value: string; label: string }[];
  label: string; placeholder?: string; id?: string; required?: boolean; className?: string; 'aria-describedby'?: string;
}) {
  return <SelectRoot value={value} onValueChange={onChange} required={required}>
    <SelectTrigger id={id} aria-label={label} aria-describedby={describedBy} className={`p1-dropdown-trigger ${className}`}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent className="p1 p1-dropdown-menu" sideOffset={8} collisionPadding={16}>
      {options.map((option) => <SelectItem key={option.value} value={option.value} className="p1-dropdown-option">{option.label}</SelectItem>)}
    </SelectContent>
  </SelectRoot>;
}
export function ErrorNote({ children }: { children: ReactNode }) { return <p className="p1-error" role="alert">{children}</p>; }
