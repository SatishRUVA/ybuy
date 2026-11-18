import { operationRpc } from '@/lib/operations';

export interface RewardCampaignSnapshot {
  id: string;
  name: string;
  multiplier: number;
  starts_at: string;
  ends_at: string;
}

export interface RewardTransaction {
  id: string;
  points: number;
  kind: 'signup' | 'redemption' | 'reversal';
  booking_id: string | null;
  created_at: string;
  base_points?: number | null;
  multiplier?: number | null;
  final_points?: number | null;
  campaign_id?: string | null;
  campaign_snapshot?: RewardCampaignSnapshot | null;
  event_type?: 'signup' | null;
  event_ref?: string | null;
  event_at?: string | null;
  idempotency_key?: string | null;
}

export interface Rewards {
  test_only: true;
  enabled: boolean;
  signup_enabled: boolean;
  verified: boolean;
  eligible: boolean;
  awarded: boolean;
  signup_points: number;
  signup_offer?: {
    base_points: number;
    multiplier: number;
    final_points: number;
    campaign: RewardCampaignSnapshot | null;
  };
  balance: number;
  transactions: RewardTransaction[];
}

export const getMyRewards = () => operationRpc<Rewards>('get_my_rewards');
export const redeemTestRewardPoints = (bookingId: string) =>
  operationRpc('redeem_test_reward_points', { p_booking_id: bookingId });
