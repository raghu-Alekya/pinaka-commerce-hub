const SYNC_META_KEY = '_pch_order_id';

export function buildWooOrderPayload(input: {
  orderId: string;
  clientOrderId?: string;
  customerName?: string;
  customerPhone?: string;
  request: Record<string, unknown>;
}): Record<string, unknown> {
  const request = input.request || {};
  const metadata = metaEntries(request.meta_data);
  const identity = String(input.orderId || '').trim();
  if (identity && !metadata.some((entry) => entry.key === SYNC_META_KEY)) {
    metadata.push({ key: SYNC_META_KEY, value: identity });
  }
  const clientOrderId = String(input.clientOrderId || metaValue(metadata, '_pos_client_order_id') || '').trim();
  if (clientOrderId && !metadata.some((entry) => entry.key === '_pos_client_order_id')) {
    metadata.push({ key: '_pos_client_order_id', value: clientOrderId });
  }

  const payload: Record<string, unknown> = {
    status: text(request.status) || 'processing',
    set_paid: request.set_paid !== false,
    payment_method: text(request.payment_method) || 'cash',
    payment_method_title: text(request.payment_method_title) || text(request.payment_method) || 'Cash',
    currency: text(request.currency) || undefined,
    customer_note: text(request.customer_note) || undefined,
    transaction_id: clientOrderId || identity,
    billing: billingAddress(request.billing, input.customerName, input.customerPhone),
    line_items: lineItems(request.line_items),
    meta_data: metadata,
  };
  if (typeof request.prices_include_tax === 'boolean') payload.prices_include_tax = request.prices_include_tax;
  copyLines(payload, 'tax_lines', request.tax_lines, taxLine);
  const shipping = billingAddress(request.shipping, '', '');
  delete shipping.first_name;
  const shippingName = text(record(request.shipping).first_name);
  if (shippingName) shipping.first_name = shippingName;
  if (Object.keys(shipping).length) payload.shipping = shipping;
  copyLines(payload, 'fee_lines', request.fee_lines, feeLine);
  copyLines(payload, 'shipping_lines', request.shipping_lines, shippingLine);
  copyLines(payload, 'coupon_lines', request.coupon_lines, couponLine);
  return payload;
}

export function findSyncedWebsiteOrder(orders: unknown, orderId: string): number | undefined {
  const identity = String(orderId || '').trim();
  if (!identity || !Array.isArray(orders)) return undefined;
  for (const order of orders) {
    const recordOrder = record(order);
    const id = Number(recordOrder.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const matched = metaEntries(recordOrder.meta_data).some((entry) => entry.key === SYNC_META_KEY && String(entry.value) === identity);
    if (matched) return id;
  }
  return undefined;
}

function billingAddress(value: unknown, customerName?: string, customerPhone?: string): Record<string, string> {
  const billing = record(value);
  const address: Record<string, string> = {
    first_name: text(billing.first_name) || String(customerName || '').trim() || 'Walk-in Customer',
  };
  const email = text(billing.email);
  if (email.includes('@') && email.includes('.') && !email.includes(' ')) address.email = email;
  const phone = text(billing.phone) || String(customerPhone || '').trim();
  if (phone) address.phone = phone;
  for (const key of ['last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country']) {
    const field = text(billing[key]);
    if (field) address[key] = field;
  }
  return address;
}

function lineItems(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((line) => {
    const source = record(line);
    const productId = Number(source.product_id);
    const quantity = Number(source.quantity || 1);
    const mapped: Record<string, unknown> = {
      quantity: Number.isFinite(quantity) && quantity !== 0 ? quantity : 1,
      subtotal: money(source.subtotal ?? source.total),
      total: money(source.total ?? source.subtotal),
    };
    if (Number.isSafeInteger(productId) && productId > 0) mapped.product_id = productId;
    const name = text(source.name);
    if (name) mapped.name = name;
    const variationId = Number(source.variation_id);
    if (Number.isSafeInteger(variationId) && variationId > 0) mapped.variation_id = variationId;
    const taxClass = text(source.tax_class);
    if (taxClass) mapped.tax_class = taxClass;
    if (source.subtotal_tax !== undefined && source.subtotal_tax !== null && source.subtotal_tax !== '') {
      mapped.subtotal_tax = money(source.subtotal_tax);
    }
    if (source.total_tax !== undefined && source.total_tax !== null && source.total_tax !== '') {
      mapped.total_tax = money(source.total_tax);
    }
    if (Array.isArray(source.meta_data)) mapped.meta_data = source.meta_data;
    return mapped;
  });
}

function taxLine(source: Record<string, unknown>): Record<string, unknown> | undefined {
  const total = source.tax_total ?? source.total;
  if (total === undefined || total === null || total === '') return undefined;
  const mapped: Record<string, unknown> = { tax_total: money(total) };
  const label = text(source.label || source.rate_code);
  if (label) mapped.label = label;
  const rateId = Number(source.rate_id ?? source.id);
  if (Number.isSafeInteger(rateId) && rateId > 0) mapped.rate_id = rateId;
  if (source.shipping_tax_total !== undefined && source.shipping_tax_total !== null && source.shipping_tax_total !== '') {
    mapped.shipping_tax_total = money(source.shipping_tax_total);
  }
  return mapped;
}

function feeLine(source: Record<string, unknown>): Record<string, unknown> {
  return {
    name: text(source.name) || 'Fee',
    total: money(source.total),
    tax_status: text(source.tax_status) || 'none',
    tax_class: text(source.tax_class) || '',
  };
}

function shippingLine(source: Record<string, unknown>): Record<string, unknown> {
  return {
    method_id: text(source.method_id) || 'flat_rate',
    method_title: text(source.method_title) || 'Shipping',
    total: money(source.total),
  };
}

function couponLine(source: Record<string, unknown>): Record<string, unknown> | undefined {
  const code = text(source.code);
  return code ? { code } : undefined;
}

function copyLines(
  payload: Record<string, unknown>,
  key: string,
  value: unknown,
  map: (source: Record<string, unknown>) => Record<string, unknown> | undefined,
): void {
  if (!Array.isArray(value) || !value.length) return;
  const lines = value.map((line) => map(record(line))).filter((line): line is Record<string, unknown> => Boolean(line));
  if (lines.length) payload[key] = lines;
}

function metaEntries(value: unknown): Array<{ key: string; value: unknown }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const source = record(entry);
    const key = text(source.key);
    return key ? [{ key, value: source.value }] : [];
  });
}

function metaValue(entries: Array<{ key: string; value: unknown }>, key: string): unknown {
  return entries.find((entry) => entry.key === key)?.value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function money(value: unknown): string {
  const amount = Number(value ?? 0);
  return (Number.isFinite(amount) ? amount : 0).toFixed(2);
}
