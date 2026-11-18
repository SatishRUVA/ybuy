import { operationRpc } from '@/lib/operations';

export interface RewardTransaction {
  id: string;
  points: number;
  kind: 'signup' | 'redemption' | 'reversal';
  booking_id: string | null;
  created_at: string;
}

export interface Rewards {
  test_only: true;
  enabled: boolean;
  signup_enabled: boolean;
  verified: boolean;
  eligible: boolean;
  awarded: boolean;
  signup_points: number;
  balance: number;
  transactions: RewardTransaction[];
}

export const getMyRewards = () => operationRpc<Rewards>('get_my_rewards');
export const redeemTestRewardPoints = (bookingId: string) =>
  operationRpc('redeem_test_reward_points', { p_booking_id: bookingId });
