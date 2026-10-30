import { supabase } from '@/lib/supabase';

export interface MarketplaceCountry { code: string; name: string }

export async function fetchMarketplaceCountries(): Promise<MarketplaceCountry[]> {
  const { data: setting, error } = await supabase.from('app_settings')
    .select('value').eq('key', 'marketplace_country_codes').maybeSingle();
  if (error) throw new Error(`Could not load marketplace countries: ${error.message}`);
  const codes: unknown = setting?.value;
  if (!Array.isArray(codes) || codes.length === 0 || !codes.every(code => typeof code === 'string' && /^[A-Z]{2}$/.test(code))) {
    throw new Error('Marketplace countries are not configured. Contact an administrator.');
  }
  const { data, error: countriesError } = await supabase.from('reference_countries')
    .select('code,name').in('code', codes).order('name');
  if (countriesError) throw new Error(`Could not load marketplace countries: ${countriesError.message}`);
  if (!data || data.length !== codes.length) throw new Error('Marketplace country configuration is invalid.');
  return data;
}

export function countryIsAllowed(country: string, countries: MarketplaceCountry[]): boolean {
  const value = country.trim().toLowerCase();
  return countries.some(item => item.code.toLowerCase() === value || item.name.toLowerCase() === value);
}

export async function requireMarketplaceCountry(country: string): Promise<string> {
  const countries = await fetchMarketplaceCountries();
  const match = countries.find(item => countryIsAllowed(country, [item]));
  if (!match) throw new Error('Choose a location in an enabled marketplace country.');
  return match.code;
}
