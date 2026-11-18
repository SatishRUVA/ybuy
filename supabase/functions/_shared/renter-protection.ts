export interface ProtectionRequest {
  bookingId: string;
  categoryId: string;
  startDate: string;
  endDate: string;
  quantity: number;
  replacementValueCents: number;
}

export interface ProtectionProvider {
  quote(request: ProtectionRequest): Promise<{ status: 'unavailable'; premiumCents: 0 }>;
}

export const unavailableProtection: ProtectionProvider = {
  async quote() {
    return { status: 'unavailable', premiumCents: 0 };
  },
};
