import { DataSource } from 'typeorm';

type Row = Record<string, any>;
type Kind = 'plan' | 'subscription' | 'merchant' | 'storeType';
const aliases: Record<Kind, string[]> = {
  plan:['planId','plan_id'], subscription:['subscriptionId','subscription_id'],
  merchant:['merchantId','merchant_id'], storeType:['storeTypeId','store_type_id'],
};
const kinds = Object.keys(aliases) as Kind[];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (value: string) => uuid.test(value) ? value.toLowerCase() : value;
const isRecord = (value: unknown): value is Row => !!value && typeof value==='object' && !Array.isArray(value) && !(value instanceof Date);

/** Request-local batched lookups. Added relations have a bounded shape, never cycles. */
export class MerchantResponseRelations {
  constructor(private readonly db: Pick<DataSource,'query'>) {}

  async expand(payload: unknown): Promise<unknown> {
    try {
      const wanted = Object.fromEntries(kinds.map(kind=>[kind,new Set<string>()])) as Record<Kind,Set<string>>;
      const records = Object.fromEntries(kinds.map(kind=>[kind,new Map<string,Row>()])) as Record<Kind,Map<string,Row>>;
      const reference = (row: Row, kind: Kind) => {
        const name=aliases[kind].find(alias=>Object.prototype.hasOwnProperty.call(row,alias));
        return name===undefined ? undefined : row[name];
      };
      const collectRow = (row: Row, selected: Kind[]=kinds) => {
        for (const kind of selected) {
          const value=reference(row,kind);
          if (typeof value==='string' && value) wanted[kind].add(key(value));
        }
      };
      const scan = (value: unknown) => {
        if (Array.isArray(value)) {value.forEach(scan);return;}
        if (!isRecord(value)) return;
        collectRow(value);
        Object.values(value).forEach(scan);
      };
      scan(payload);

      if (wanted.subscription.size) {
        try {
          const rows = await this.db.query(`SELECT s.*,to_char(s."startDate",'YYYY-MM-DD') AS "startDate",
            to_char(s."renewalDate",'YYYY-MM-DD') AS "renewalDate",to_char(s."trialEndDate",'YYYY-MM-DD') AS "trialEndDate"
            FROM public.subscriptions s WHERE s.id=ANY($1::text[]) OR s."subscriptionId"=ANY($1::text[])`,[[...wanted.subscription]]);
          for (const row of rows) {records.subscription.set(key(row.id || row.subscriptionId),row);collectRow(row);}
        } catch {}
      }
      if (wanted.merchant.size) {
        try {
          const rows = await this.db.query(`SELECT requested.ref AS lookup,m.* FROM unnest($1::text[]) requested(ref)
            CROSS JOIN LATERAL (
              SELECT mer.*
              FROM public.merchants mer
              WHERE mer."merchantId"=requested.ref OR mer.id::text=requested.ref
              ORDER BY COALESCE(mer."createdDate", now()) DESC LIMIT 1
            ) m`,[[...wanted.merchant]]);
          for (const {lookup,...row} of rows) {records.merchant.set(key(lookup),row);collectRow(row,['plan','storeType']);}
        } catch {}
      }
      await Promise.all((['plan','storeType'] as const).map(async kind=>{
        try {
          const ids=[...wanted[kind]].filter(value=>uuid.test(value));
          if (!ids.length) return;
          const table=kind==='plan'?'plans':'store_types';
          const rows=await this.db.query(`SELECT * FROM public.${table} WHERE id=ANY($1::uuid[])`,[ids]);
          for (const row of rows) records[kind].set(key(row.id),row);
        } catch {}
      }));

      const lookup = (kind: Kind, value: unknown): Row | null => typeof value==='string' ? records[kind].get(key(value)) || null : null;
      const merchantDetails = (row: Row | null): Row | null => row && ({...row,
        plan:lookup('plan',reference(row,'plan')),storeType:lookup('storeType',reference(row,'storeType'))});
      const subscriptionDetails = (row: Row | null): Row | null => row && ({...row,
        plan:lookup('plan',reference(row,'plan')),merchant:merchantDetails(lookup('merchant',reference(row,'merchant')))});
      const visit = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(visit);
        if (!isRecord(value)) return value;
        const result: Row = Object.fromEntries(Object.entries(value).map(([name,child])=>[name,visit(child)]));
        for (const kind of kinds) {
          if (!aliases[kind].some(alias=>Object.prototype.hasOwnProperty.call(value,alias))) continue;
          if (kind==='merchant' && ('merchantCode' in value || ('ownerName' in value && 'businessName' in value))) continue;
          if (kind==='subscription' && value.id===reference(value,kind) && 'billingCycle' in value) continue;
          const related=lookup(kind,reference(value,kind));
          const details=kind==='merchant'?merchantDetails(related):kind==='subscription'?subscriptionDetails(related):related;
          const name=kind==='storeType' && result.storeType!==undefined && result.storeType!==null && !isRecord(result.storeType)
            ? 'storeTypeDetails' : kind;
          result[name]=isRecord(result[name]) ? {...details,...result[name]} : details;
        }
        return result;
      };
      return visit(payload);
    } catch {
      return payload;
    }
  }
}
