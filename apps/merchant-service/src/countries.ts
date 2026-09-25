export type Country = { code: string; name: string; dialCode: string };

export const COUNTRIES: Country[] = [
  { code: 'US', name: 'United States', dialCode: '1' },
  { code: 'CA', name: 'Canada', dialCode: '1' },
  { code: 'IN', name: 'India', dialCode: '91' },
  { code: 'GB', name: 'United Kingdom', dialCode: '44' },
  { code: 'AU', name: 'Australia', dialCode: '61' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '971' },
  { code: 'SG', name: 'Singapore', dialCode: '65' },
  { code: 'DE', name: 'Germany', dialCode: '49' },
  { code: 'FR', name: 'France', dialCode: '33' },
  { code: 'JP', name: 'Japan', dialCode: '81' },
  { code: 'CN', name: 'China', dialCode: '86' },
  { code: 'BR', name: 'Brazil', dialCode: '55' },
  { code: 'MX', name: 'Mexico', dialCode: '52' },
  { code: 'ZA', name: 'South Africa', dialCode: '27' },
  { code: 'NZ', name: 'New Zealand', dialCode: '64' },
  { code: 'IE', name: 'Ireland', dialCode: '353' },
  { code: 'NL', name: 'Netherlands', dialCode: '31' },
  { code: 'ES', name: 'Spain', dialCode: '34' },
  { code: 'IT', name: 'Italy', dialCode: '39' },
  { code: 'PH', name: 'Philippines', dialCode: '63' },
];

const aliases: Record<string, string> = {
  USA: 'US',
  'U.S.A.': 'US',
  'U.S.': 'US',
  US: 'US',
  'UNITED STATES': 'US',
  UK: 'GB',
  'UNITED KINGDOM': 'GB',
};

function dialForCountry(country?: unknown): string | undefined {
  if (typeof country !== 'string' || !country.trim()) return undefined;
  const token = country.trim().toUpperCase();
  const code = aliases[token] || token;
  return COUNTRIES.find(item => item.code === code || item.name.toUpperCase() === token)?.dialCode;
}

/** National subscriber number, with the leading calling code removed. */
export function nationalPhone(phone: unknown, country?: unknown): unknown {
  if (typeof phone !== 'string' || !phone.trim()) return phone;
  const compact = phone.replace(/[^\d+]/g, '');
  const preferred = dialForCountry(country);
  const dials = [...new Set([preferred, ...COUNTRIES.map(item => item.dialCode)].filter(Boolean) as string[])]
    .sort((left, right) => right.length - left.length);
  for (const dial of dials) {
    if (compact.startsWith(`+${dial}`) && compact.length > dial.length + 1) return compact.slice(dial.length + 1);
  }
  return compact.startsWith('+') ? compact.slice(1) : phone;
}
