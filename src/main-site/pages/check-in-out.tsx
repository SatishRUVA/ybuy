import { BookingHandoff } from '@/main-site/components/booking-handoff';

export function CheckInPage({ id }: { id: string }) {
  return <BookingHandoff bookingId={id} kind="pickup" />;
}

export function CheckOutPage({ id }: { id: string }) {
  return <BookingHandoff bookingId={id} kind="return" />;
}
