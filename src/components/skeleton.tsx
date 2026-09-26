/**
 * Base skeleton rectangle. Compose every loading screen from this instead of
 * hand-building each one - pass sizing via `className` and shape via `rounded`.
 */
export function Skeleton({ className = '', rounded = 'rounded-card' }: { className?: string; rounded?: string }) {
  return <div className={`skeleton ${rounded} ${className}`} />;
}

/** Mirrors ListingCard: 4:3 media, meta line, two-line title, rating, price. */
export function ListingCardSkeleton() {
  return (
    <div className="flex h-full flex-col bg-card rounded-card-lg overflow-hidden border border-app shadow-xs">
      <Skeleton className="w-full aspect-[4/3]" rounded="rounded-none" />
      <div className="flex min-h-[152px] flex-1 flex-col gap-1.5 p-3.5">
        <Skeleton className="h-4 w-1/2" rounded="rounded-card-sm" />
        <div className="flex h-10 flex-col justify-center gap-1">
          <Skeleton className="h-4 w-full" rounded="rounded-card-sm" />
          <Skeleton className="h-4 w-2/3" rounded="rounded-card-sm" />
        </div>
        <Skeleton className="h-4 w-1/3" rounded="rounded-card-sm" />
        <div className="mt-auto pt-2">
          <Skeleton className="h-5 w-16" rounded="rounded-card-sm" />
        </div>
      </div>
    </div>
  );
}

/** Mirrors ListingCardWide's row layout (4:3 thumb + stacked text lines). */
export function ListingCardWideSkeleton() {
  return (
    <div className="flex h-full min-h-[152px] gap-3.5 bg-card rounded-card-lg overflow-hidden border border-app shadow-xs p-3">
      <Skeleton className="w-28 sm:w-36 shrink-0 aspect-[4/3]" rounded="rounded-card" />
      <div className="flex min-h-[126px] flex-1 flex-col gap-1">
        <Skeleton className="h-4 w-1/3" rounded="rounded-card-sm" />
        <div className="flex h-10 flex-col justify-center gap-1">
          <Skeleton className="h-4 w-3/4" rounded="rounded-card-sm" />
          <Skeleton className="h-4 w-1/2" rounded="rounded-card-sm" />
        </div>
        <Skeleton className="h-4 w-1/2" rounded="rounded-card-sm" />
        <div className="mt-auto pt-1.5">
          <Skeleton className="h-5 w-16" rounded="rounded-card-sm" />
        </div>
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

/** Mirrors ListingPage: title block, 16:10 gallery, detail blocks, sticky booking panel. */
export function ListingDetailSkeleton() {
  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5 sm:py-8">
      <div className="space-y-2.5 mb-5">
        <Skeleton className="h-3 w-24" rounded="rounded-card-sm" />
        <Skeleton className="h-9 w-2/3" rounded="rounded-card-sm" />
        <Skeleton className="h-4 w-1/3" rounded="rounded-card-sm" />
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-8 lg:gap-10">
        <div className="space-y-5">
          <Skeleton className="w-full aspect-[4/3] sm:aspect-[16/10]" rounded="rounded-card-xl" />
          <div className="flex gap-2">
            <Skeleton className="h-11 w-52" rounded="rounded-card" />
            <Skeleton className="h-11 w-40" rounded="rounded-card" />
          </div>
          <div className="space-y-2 pt-3">
            <Skeleton className="h-4 w-full" rounded="rounded-card-sm" />
            <Skeleton className="h-4 w-5/6" rounded="rounded-card-sm" />
            <Skeleton className="h-4 w-2/3" rounded="rounded-card-sm" />
          </div>
        </div>
        <div>
          <Skeleton className="w-full h-[420px]" rounded="rounded-card-lg" />
        </div>
      </div>
    </div>
  );
}

/** Mirrors a dashboard booking row: thumbnail + title/date lines + price column. */
export function BookingRowSkeleton() {
  return (
    <div className="p-3.5 rounded-card-lg bg-card border border-app">
      <div className="flex gap-3.5">
        <Skeleton className="w-20 h-20 shrink-0" rounded="rounded-card" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" rounded="rounded-card-sm" />
          <Skeleton className="h-3 w-1/3" rounded="rounded-card-sm" />
          <Skeleton className="h-5 w-28" rounded="rounded-full" />
        </div>
        <Skeleton className="h-4 w-12 shrink-0" rounded="rounded-card-sm" />
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
    <div className="flex items-center gap-3 p-3 rounded-card-lg border border-app bg-card">
      <Skeleton className="w-11 h-11 shrink-0" rounded="rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" rounded="rounded-card-sm" />
        <Skeleton className="h-3 w-2/3" rounded="rounded-card-sm" />
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
