import { supabase } from '@/lib/supabase';

export interface VaultEntry {
  key: string;
  configured: boolean;
  version: number;
  updated_at: string | null;
}
export interface VaultStatus { expires_at: string; entries: VaultEntry[] }

export async function prepareVault() {
  const { error } = await supabase.rpc('admin_vault_prepare');
  if (error) throw new Error('Vault backend is unavailable or access was denied.');
}

export async function getVaultStatus(): Promise<VaultStatus> {
  const { data, error } = await supabase.rpc('admin_vault_status');
  if (error) throw new Error(error.message);
  return data as VaultStatus;
}

export async function saveVaultEntry(entry: VaultEntry, secret: string) {
  const { error } = await supabase.rpc('admin_vault_save', {
    p_key: entry.key, p_secret: secret, p_expected_version: entry.version,
    p_reason: 'Vault Chest write; value omitted',
  });
  // Do not reflect a database/provider error that could contain submitted input.
  if (error) {
    if (error.code === '42501') throw new Error('Vault access expired or was revoked. Lock the vault and verify MFA again.');
    if (error.code === '40001') throw new Error('This entry changed. Lock the vault and unlock again before replacing it.');
    throw new Error('The secret could not be saved. Check the input, backend migration and connection, then try again.');
  }
}
