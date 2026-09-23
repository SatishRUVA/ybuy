/**
 * Base skeleton rectangle. Compose every loading screen from this instead of
 * hand-building each one — pass sizing via `className` and shape via `rounded`.
 */
export function Skeleton({ className = '', rounded = 'rounded-card' }: { className?: string; rounded?: string }) {
  return <div className={`skeleton ${rounded} ${className}`} />;
}

/** Mirrors ListingCard's image-area-to-text-area ratio (compact = aspect-[4/3], else aspect-[5/4]). */
export function ListingCardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="bg-card rounded-card-xl overflow-hidden border border-app shadow-card">
      <Skeleton className={`w-full ${compact ? 'aspect-[4/3]' : 'aspect-[5/4]'}`} rounded="rounded-none" />
      <div className="p-3.5 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
        <div className="flex items-center justify-between pt-1">
          <Skeleton className="h-4 w-12" />
        </div>
      </div>
    </div>
  );
}

/** Mirrors ListingCardWide's row layout (square thumb + stacked text lines). */
export function ListingCardWideSkeleton() {
  return (
    <div className="flex gap-3 bg-card rounded-card-xl overflow-hidden border border-app shadow-card p-2.5">
      <Skeleton className="w-32 sm:w-40 shrink-0 aspect-square" rounded="rounded-card-lg" />
      <div className="flex-1 py-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-16 mt-3" />
      </div>
    </div>
  );
}

export function ListingGridSkeleton({ count = 10, className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4' }: { count?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => <ListingCardSkeleton key={i} />)}
    </div>
  );
}

/** Mirrors ListingPage: gallery + title/meta rows on the left, sticky booking card on the right. */
export function ListingDetailSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
      <div className="space-y-2 mb-4">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="w-full aspect-[4/3]" rounded="rounded-card-xl" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-36" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
        <div className="lg:col-span-1">
          <Skeleton className="w-full h-72" rounded="rounded-card-xl" />
        </div>
      </div>
    </div>
  );
}

/** Mirrors a dashboard booking row: thumbnail + title/date lines + price/actions column. */
export function BookingRowSkeleton() {
  return (
    <div className="p-4 rounded-card-xl bg-card border border-app">
      <div className="flex gap-4">
        <Skeleton className="w-20 h-20 shrink-0" rounded="rounded-card-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
        <div className="shrink-0 space-y-2">
          <Skeleton className="h-4 w-12 ml-auto" />
          <Skeleton className="h-3 w-16 ml-auto" />
        </div>
      </div>
    </div>
  );
}

export function BookingListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => <BookingRowSkeleton key={i} />)}
    </div>
  );
}

/** Mirrors a conversation-list row: avatar circle + name/preview lines. */
export function ConversationRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-card-xl border border-app bg-card">
      <Skeleton className="w-12 h-12 shrink-0" rounded="rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function ConversationListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => <ConversationRowSkeleton key={i} />)}
    </div>
  );
}
