import { BadGatewayException } from '@nestjs/common';

type Connection = { wordpressUrl: string; wordpressJwt: string };
type TaxRate = Record<string, unknown> & { id: number; rate: string; class?: string };
export type SyncedTaxClass = { name: string; slug: string; rate: number | null; rates: TaxRate[] };

async function fetchTaxCollection(connection: Connection, path: string): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  for (let page = 1; page <= 1000; page++) {
    const url = new URL(connection.wordpressUrl.replace(/\/+$/, '') + '/wp-json/wc/v3/' + path);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + connection.wordpressJwt },
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new BadGatewayException('Could not reach WordPress while syncing ' + path);
    }
    if (!response.ok) throw new BadGatewayException('WordPress ' + path + ' returned HTTP ' + response.status + '. Check the saved token and tax permissions.');
    let body: unknown;
    try { body = await response.json(); } catch { throw new BadGatewayException('Invalid WordPress tax JSON response'); }
    if (!Array.isArray(body) || body.some(item => !item || typeof item !== 'object')) throw new BadGatewayException('Invalid WordPress tax collection');
    items.push(...body);
    if (path === 'taxes/classes' || path === 'settings/general') return items;
    const pages = Number(response.headers.get('x-wp-totalpages'));
    if (Number.isFinite(pages) && pages > 0 ? page >= pages : body.length < 100) return items;
  }
  throw new BadGatewayException('WordPress tax pagination limit reached');
}

/** Pull-only tax sync; retains every location-specific rate without calculating product tax. */
export async function fetchPosTaxClasses(connection: Connection): Promise<SyncedTaxClass[]> {
  const [classes, rates] = await Promise.all([
    fetchTaxCollection(connection, 'taxes/classes'),
    fetchTaxCollection(connection, 'taxes'),
  ]);
  const groups = new Map<string, SyncedTaxClass>();
  groups.set('standard', { name: 'Standard', slug: 'standard', rate: null, rates: [] });
  for (const item of classes) {
    if (typeof item.name !== 'string' || typeof item.slug !== 'string') throw new BadGatewayException('Invalid WordPress tax class');
    const slug = item.slug || 'standard';
    groups.set(slug, { name: item.name, slug, rate: null, rates: [] });
  }
  for (const item of rates) {
    if (!Number.isInteger(item.id) || item.rate === null || item.rate === undefined || String(item.rate).trim() === '' || !Number.isFinite(Number(item.rate))) throw new BadGatewayException('Invalid WordPress tax rate');
    const slug = item.class || 'standard';
    if (!groups.has(slug)) groups.set(slug, { name: slug, slug, rate: null, rates: [] });
    groups.get(slug)!.rates.push(item as TaxRate);
  }
  for (const group of groups.values()) {
    const values = [...new Set(group.rates.map(rate => Number(rate.rate)))];
    group.rate = values.length === 1 ? values[0] : null;
  }
  return [...groups.values()];
}

export async function fetchPosTaxConfiguration(connection: Connection): Promise<{ taxEnabled: boolean; taxClasses: SyncedTaxClass[] }> {
  const [taxClasses, settings] = await Promise.all([
    fetchPosTaxClasses(connection),
    fetchTaxCollection(connection, 'settings/general'),
  ]);
  const setting = settings.find(item => item.id === 'woocommerce_calc_taxes');
  if (!setting || !['yes', 'no'].includes(setting.value)) throw new BadGatewayException('WordPress did not return a valid Enable Taxes setting');
  return { taxEnabled: setting.value === 'yes', taxClasses };
}
