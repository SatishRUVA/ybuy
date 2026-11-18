import { BookingHandoff } from '@/main-site/components/booking-handoff';

export function CheckInPage({ id }: { id: string }) {
  return <BookingHandoff key={`pickup:${id}`} bookingId={id} kind="pickup" />;
}

export function CheckOutPage({ id }: { id: string }) {
  return <BookingHandoff key={`return:${id}`} bookingId={id} kind="return" />;
}
