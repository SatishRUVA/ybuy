import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, ImagePlus, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Button, IconButton } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';

export function ListingPhotoEditor({ photos, maximum, maximumBytes, disabled, warnings, uploadProgress, preventLastPhotoRemoval = false, onAdd, onDrop, onReplace, onRemove, onReorder, error }: {
  photos: string[];
  maximum: number;
  maximumBytes: number;
  disabled: boolean;
  warnings: Record<string, string>;
  uploadProgress?: { done: number; total: number; text: string } | null;
  preventLastPhotoRemoval?: boolean;
  error?: string;
  onAdd: () => void;
  onDrop: (files: File[]) => void;
  onReplace: (index: number) => void;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState(false);
  const reducedMotion = useReducedMotion();
  const active = Math.min(selected, Math.max(0, photos.length - 1));
  const activePhoto = photos[active];
  return <div>
    <div aria-label="Listing photos"
      onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); if (!disabled) onDrop(Array.from(event.dataTransfer.files)); }}>
      <button id="listing-add-photo" type="button" disabled={disabled || photos.length >= maximum} onClick={onAdd}
        aria-label={photos.length === 0 ? 'Add your cover photo' : 'Upload listing photos'}
        aria-describedby={error ? 'listing-photos-error' : 'listing-photo-help'}
        className={`p1-upload owner-photo-drop w-full ${dragging ? 'outline outline-2 outline-[var(--p1-blue)]' : ''}`}>
        <motion.span animate={uploadProgress && !reducedMotion ? { y: [0, -4, 0] } : undefined} transition={{ duration: 1.1, repeat: Infinity }}>
          <Upload size={24} aria-hidden="true" className="text-main" />
        </motion.span>
        <b>{uploadProgress ? 'Saving photos...' : 'Choose photos'}</b>
        <span id="listing-photo-help">Choose original photos from your camera or device. JPEG, PNG or WebP &middot; up to {Math.round(maximumBytes / 1048576)} MB each</span>
      </button>
      {(photos.length > 0 || uploadProgress) && <div className="mt-3 flex gap-2 overflow-x-auto py-1">
        <AnimatePresence initial={false}>
        {photos.map((photo, index) => <motion.button key={photo} type="button" disabled={disabled} onClick={() => setSelected(index)}
          aria-label={index === 0 ? 'Select cover photo' : `Select photo ${index + 1}${warnings[photo] ? ', quality suggestion' : ''}`}
          aria-pressed={active === index} layout={!reducedMotion} initial={reducedMotion ? false : { opacity: 0, scale: 0.92, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, scale: 0.9 }} transition={{ duration: 0.2 }} className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-card border-2 ${active === index ? 'border-accent' : 'border-app'}`}>
          <img src={photo} alt={`Listing photo ${index + 1}${index === 0 ? ', cover photo' : ''}`} className="h-full w-full object-cover" />
          {index === 0 && <span className="absolute bottom-0 inset-x-0 bg-accent text-accent-text text-[10px] py-0.5">Cover</span>}
          {active === index && <span className="absolute right-1 top-1 rounded-full bg-accent text-accent-text p-0.5"><Check size={10} aria-hidden="true" /></span>}
        </motion.button>)}
        </AnimatePresence>
        {uploadProgress && Array.from({ length: Math.min(Math.max(1, maximum - photos.length), Math.max(1, uploadProgress.total - uploadProgress.done)) }, (_, index) => <motion.div key={`uploading-${index}`} initial={reducedMotion ? false : { opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-card border border-app bg-subtle p-2">
          <Skeleton className="h-full w-full" rounded="rounded-card-sm" />
          <span className="absolute inset-x-0 bottom-1 text-center text-[9px] font-medium text-sec">Uploading…</span>
        </motion.div>)}
        {photos.length < maximum && <button type="button" disabled={disabled} onClick={onAdd} aria-label={`Add supporting photo ${photos.length + 1}`}
          className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-strong text-accent">
          <Plus size={18} aria-hidden="true" /><span className="text-[11px] font-semibold">Add more</span>
          <span className="text-[10px] text-sec">{photos.length}/{maximum} photos</span>
        </button>}
      </div>}
      {photos.length > 0 && <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-sec">Photo {active + 1} of {photos.length}</span>
        <div className="flex">
          <IconButton label={`Move photo ${active + 1} earlier`} disabled={disabled || active === 0} variant="ghost"
            onClick={() => { onReorder(active, active - 1); setSelected(active - 1); }}><ArrowLeft size={15} aria-hidden="true" /></IconButton>
          <IconButton label={`Move photo ${active + 1} later`} disabled={disabled || active === photos.length - 1} variant="ghost"
            onClick={() => { onReorder(active, active + 1); setSelected(active + 1); }}><ArrowRight size={15} aria-hidden="true" /></IconButton>
          <IconButton label={`Replace photo ${active + 1}`} disabled={disabled} onClick={() => onReplace(active)} variant="ghost"><RotateCcw size={15} aria-hidden="true" /></IconButton>
          <IconButton label={`Remove photo ${active + 1}`} disabled={disabled || (preventLastPhotoRemoval && photos.length === 1)} onClick={() => onRemove(active)} variant="ghost"><Trash2 size={15} aria-hidden="true" /></IconButton>
        </div>
      </div>}
    </div>
    {uploadProgress && <div className="mt-3 rounded-card-lg border border-app bg-card p-3" role="status" aria-live="polite" aria-busy="true">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-main">{uploadProgress.text}</span><span className="shrink-0 text-sec">{uploadProgress.done}/{uploadProgress.total}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-subtle"><motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.max(8, uploadProgress.done / Math.max(1, uploadProgress.total) * 100)}%` }} transition={{ duration: reducedMotion ? 0 : 0.35, ease: 'easeOut' }} /></div>
    </div>}
    {preventLastPhotoRemoval && photos.length === 1 && <p className="mt-2 text-xs text-sec">Published listings need at least one photo. Replace it, or archive the listing before removing it.</p>}
    {active > 0 && <Button size="sm" className="mt-2" variant="secondary" disabled={disabled} icon={<ImagePlus size={14} aria-hidden="true" />}
      onClick={() => { onReorder(active, 0); setSelected(0); }}>Make cover photo</Button>}
    {activePhoto && warnings[activePhoto] && <p role="status" className="mt-2 rounded-card bg-warning-soft p-3 text-xs text-warning">{warnings[activePhoto]} This is a suggestion, not a publication blocker.</p>}
    {error && <p id="listing-photos-error" role="alert" className="mt-2 text-sm text-error">{error}</p>}
  </div>;
}
