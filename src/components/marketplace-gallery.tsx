import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/shadcn/dialog';
import { ImageGallery, ListingPhoto } from '@/components/listing-card';

export function MarketplaceGallery({ images, title }: { images: string[]; title: string }) {
  const [open, setOpen] = useState(false);
  const [firstPhoto, setFirstPhoto] = useState(0);
  const opener = useRef<HTMLButtonElement | null>(null);
  const showPhotos = (index: number, button: HTMLButtonElement) => { opener.current = button; setFirstPhoto(index); setOpen(true); };
  const ordered = [...images.slice(firstPhoto), ...images.slice(0, firstPhoto)];
  return <>
    <div className={`p1-gallery ${images.length < 2 ? 'marketplace-photo-layout-single' : ''}`}>
      <button type="button" className="p1-gallery-main" onClick={(event) => showPhotos(0, event.currentTarget)} aria-label="Open item photos" disabled={!images.length}>
        <ListingPhoto src={images[0]} alt={title} loading="eager" />
      </button>
      {images.length > 1 && <div className="p1-gallery-side">
        {images.slice(1, 3).map((src, index) => <button key={`${src}-${index}`} type="button" onClick={(event) => showPhotos(index + 1, event.currentTarget)}
          aria-label={`Open photo ${index + 2}`}><ListingPhoto src={src} alt={`${title}, photo ${index + 2}`} loading="eager" /></button>)}
      </div>}
      {images.length > 0 && <Button variant="secondary" className="p1-gallery-all" icon={<Camera size={16} aria-hidden="true" />}
        onClick={(event) => showPhotos(0, event.currentTarget)}>All {images.length} photos</Button>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Browse the owner's uploaded item photos.</DialogDescription>
        <ImageGallery key={firstPhoto} images={ordered} title={title} />
      </DialogContent>
    </Dialog>
  </>;
}
