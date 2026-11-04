import { supabase } from '@/lib/supabase';
import { isBookingReference, isRentalAgreementReference, type BookingReference, type RentalAgreementReference } from '@/lib/customer-references';

export interface RentalAgreement {
  id: string;agreement_reference: RentalAgreementReference;version: number;created_at: string;template_id: string | null;
  snapshot: {
    booking_id: string;booking_reference: BookingReference;agreement_reference: RentalAgreementReference;currency: string;owner_name: string;renter_name: string;
    listing: { title: string;description: string | null;condition: string | null;owner_declared_value: number | null;photos: string[];approximate_pickup_area: string | null };
    start_date: string;end_date: string;quantity: number;daily_rate: number;rental_subtotal: number;owner_discount_amount?: number;owner_discount_source?: string;promo_code?: string|null;service_fee: number;insurance_amount?: number;tax_amount?: number;tax_rate?: number;sandbox_tax?: boolean;deposit: number;total: number;
    deposit_model: string;payment_first?: boolean;terms_version: number | null;terms: string | null;legal_status: 'approval_pending' | 'approved_template' | 'test_dummy';test_only_dummy_terms?: boolean;missing_policy_approval: string[];
  };
  acceptances: { role: string;accepted_at: string }[];
}
export async function fetchRentalAgreement(bookingId: string): Promise<RentalAgreement | null> {
  const { data,error }=await supabase.rpc('get_rental_agreement',{p_booking_id:bookingId});
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (!isRentalAgreementReference(data.agreement_reference)
    || !isBookingReference(data.snapshot?.booking_reference)
    || !isRentalAgreementReference(data.snapshot?.agreement_reference)) {
    throw new Error('The saved rental references could not be verified.');
  }
  return data as RentalAgreement;
}
export async function acceptRentalAgreement(agreement: RentalAgreement): Promise<void> {
  const { error }=await supabase.rpc('accept_rental_agreement',{p_agreement_id:agreement.id,p_version:agreement.version});
  if (error) throw new Error(error.message);
}
