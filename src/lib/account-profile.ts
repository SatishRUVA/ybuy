import { supabase } from '@/lib/supabase';
import { assertPlainText, assertUuid } from '@/lib/text-safety';

export async function updateOwnAccountProfile(userId: string, input: { fullName: string; phone: string; bio: string }): Promise<void> {
  assertUuid(userId, 'user id');
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const bio = input.bio.trim();
  assertPlainText('Full name', fullName, 100);
  assertPlainText('Phone', phone, 32);
  assertPlainText('About you', bio, 500);
  if (fullName.length < 2) throw new Error('Enter a name with at least 2 characters.');

  const { error } = await supabase.from('profiles')
    .update({ full_name: fullName, phone: phone || null, bio: bio || null })
    .eq('id', userId);
  if (error) throw new Error(error.message);

  const { data, error: verifyError } = await supabase.rpc('get_my_profile')
    .single<{ id: string; full_name: string; phone: string | null; bio: string | null }>();
  if (verifyError) throw new Error(verifyError.message);
  if (!data || data.id !== userId || data.full_name !== fullName || data.phone !== (phone || null) || data.bio !== (bio || null)) {
    throw new Error('The saved profile could not be verified. Reload before retrying.');
  }
}
