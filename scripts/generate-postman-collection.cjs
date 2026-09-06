const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve(__dirname, '../docs/postman/PDH - Complete APIs.postman_collection.json');

const jsonHeader = [{ key: 'Content-Type', value: 'application/json' }];
const request = (name, method, base, route, body, options = {}) => {
  const item = {
    name,
    request: {
      method,
      header: [...(body !== undefined ? jsonHeader : []), ...(options.headers || [])],
      url: {
        raw: `{{${base}}}${route}`,
        host: [`{{${base}}}`],
        path: route.split('?')[0].split('/').filter(Boolean),
      },
    },
    response: [],
  };
  if (route.includes('?')) {
    item.request.url.query = route.split('?')[1].split('&').map((part) => {
      const [key, value] = part.split('=');
      return { key, value };
    });
  }
  if (body !== undefined) {
    item.request.body = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }
  if (options.auth) item.request.auth = options.auth;
  if (options.description) item.request.description = options.description;
  return item;
};

const health = (base, prefix = '') => [
  request('Health', 'GET', base, `${prefix}/health`),
  request('Readiness', 'GET', base, `${prefix}/ready`),
];

const envelope = {
  eventId: 'evt_{{$guid}}',
  eventType: 'ORDER_RECEIVED',
  source: 'postman',
  timestamp: '{{$isoTimestamp}}',
  correlationId: 'corr_{{$guid}}',
  version: '1.0.0',
  payload: {
    id: 'ord_{{$guid}}',
    externalOrderId: '{{externalOrderId}}',
    merchantId: '{{merchantId}}',
    platform: 'DOORDASH',
    status: 'CREATED',
    subtotal: 20,
    tax: 2,
    deliveryFee: 3,
    totalAmount: 25,
    customer: { name: 'Test Customer', phone: '+15555550100' },
    deliveryAddress: { street: '1 Main Street', city: 'Test City', postalCode: '10001' },
    items: [{ externalItemId: '{{itemId}}', name: 'Test Item', quantity: 1, unitPrice: 20 }],
  },
};

const bearer = { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] };

const folders = [
  {
    name: 'Gateway Service (3000)',
    item: [
      ...health('gatewayBaseUrl', '/api/v1/gateway'),
      request('Get Orders', 'GET', 'gatewayBaseUrl', '/api/v1/gateway/orders'),
      request('Stream Orders (SSE)', 'GET', 'gatewayBaseUrl', '/api/v1/gateway/orders/stream', undefined, { description: 'Server-Sent Events endpoint; the request remains open.' }),
      request('Update Order Status', 'PATCH', 'gatewayBaseUrl', '/api/v1/gateway/orders/{{orderId}}/status', { status: 'ACCEPTED' }),
    ],
  },
  {
    name: 'Connector Service (3001)',
    item: [
      ...health('connectorBaseUrl', '/api/v1/connectors'),
      request('List Connectors', 'GET', 'connectorBaseUrl', '/api/v1/connectors'),
      request('DoorDash Webhook', 'POST', 'connectorBaseUrl', '/api/v1/connectors/doordash/webhook', {
        order_id: '{{externalOrderId}}', store_id: '{{merchantId}}', total: 25,
        items: [{ id: '{{itemId}}', name: 'Test Item', qty: 1, price: 25 }],
      }, { headers: [{ key: 'x-correlation-id', value: 'corr_{{$guid}}' }] }),
      request('OrderOut Webhook', 'POST', 'connectorBaseUrl', '/api/v1/connectors/orderout/webhook', {
        destination: { storeId: '{{merchantId}}' },
        source: { orderNumber: '{{externalOrderId}}', placedOn: '{{$isoTimestamp}}' },
        payload: {
          customer: { customerName: 'Test Customer', phoneNumber: '+15555550100' },
          order: { orderType: 'PICKUP', subtotal: 20, tax: 2, total: 22, payment: { status: 'PAID' }, items: [{ id: '{{itemId}}', name: 'Test Item', price: 20, quantity: 1, total: 20, modifiers: [] }] },
        },
      }, { headers: [{ key: 'x-correlation-id', value: 'corr_{{$guid}}' }] }),
    ],
  },
  {
    name: 'Order Service (3002)',
    item: [
      ...health('orderServiceBaseUrl', '/api/v1/orders'),
      request('Ingest Order Event', 'POST', 'orderServiceBaseUrl', '/api/v1/orders/events', envelope),
      request('Get All Orders', 'GET', 'orderServiceBaseUrl', '/api/v1/orders'),
      request('Get Order', 'GET', 'orderServiceBaseUrl', '/api/v1/orders/{{orderId}}'),
      request('Update Order Status', 'PATCH', 'orderServiceBaseUrl', '/api/v1/orders/{{orderId}}/status', { status: 'ACCEPTED' }),
    ],
  },
  {
    name: 'Merchant Service (3003)',
    item: [
      ...health('merchantServiceBaseUrl', '/api/v1/merchants'),
      request('Get All Merchants', 'GET', 'merchantServiceBaseUrl', '/api/v1/merchants'),
      request('Get Merchant', 'GET', 'merchantServiceBaseUrl', '/api/v1/merchants/{{merchantId}}'),
      request('Create Merchant', 'POST', 'merchantServiceBaseUrl', '/api/v1/merchants/create-merchant', {
        merchantId: '{{merchantId}}',
        businessName: 'Test Restaurant',
        legalBusinessName: 'Test Restaurant Private Limited',
        businessType: 'Restaurant',
        country: 'India',
        state: 'Karnataka',
        city: 'Bengaluru',
        postalCode: '560001',
        businessAddress: '123 MG Road',
        firstName: 'Test',
        lastName: 'Owner',
        email: 'test.owner@example.com',
        phone: '+919876543210',
        plan: 'Professional',
        billingCycle: 'Monthly',
        stores: [{
          id: 'STR-{{merchantId}}',
          name: 'Test Restaurant Main Store',
          type: 'Restaurant',
          url: 'https://example.com',
          address: '123 MG Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          zip: '560001',
          currency: 'INR',
          timezone: 'Asia/Kolkata',
        }],
      }),
      request('Update Store Status', 'PATCH', 'merchantServiceBaseUrl', '/api/v1/merchants/{{merchantId}}/status', { status: 'OPEN' }),
      request('Update Auto-Accept', 'PATCH', 'merchantServiceBaseUrl', '/api/v1/merchants/{{merchantId}}/auto-accept', { autoAccept: true }),
    ],
  },
  {
    name: 'Menu Service (3004)',
    item: [
      ...health('menuServiceBaseUrl', '/api/v1/menus'),
      request('Get Merchant Menu', 'GET', 'menuServiceBaseUrl', '/api/v1/menus/{{merchantId}}'),
      request('Create or Update Menu Item', 'POST', 'menuServiceBaseUrl', '/api/v1/menus/{{merchantId}}/items', { externalItemId: '{{itemId}}', name: 'Test Item', description: 'Postman item', price: 20, category: 'Main', isAvailable: true }),
      request('Set Item Availability (86)', 'PATCH', 'menuServiceBaseUrl', '/api/v1/menus/{{merchantId}}/items/{{itemId}}/86', { isAvailable: false }),
      request('Sync Menu to Platforms', 'POST', 'menuServiceBaseUrl', '/api/v1/menus/{{merchantId}}/sync'),
    ],
  },
  {
    name: 'Inventory Service (3005)',
    item: [
      ...health('inventoryServiceBaseUrl', '/api/v1/inventory'),
      request('Get Merchant Inventory', 'GET', 'inventoryServiceBaseUrl', '/api/v1/inventory/{{merchantId}}'),
      request('Update Ingredient Stock', 'PATCH', 'inventoryServiceBaseUrl', '/api/v1/inventory/{{merchantId}}/items/{{ingredientId}}', { currentStock: 50 }),
      request('Deduct Stock from Order Event', 'POST', 'inventoryServiceBaseUrl', '/api/v1/inventory/events', envelope),
    ],
  },
  {
    name: 'Analytics Service (3006)',
    item: [
      ...health('analyticsServiceBaseUrl', '/api/v1/analytics'),
      request('Get Merchant Analytics', 'GET', 'analyticsServiceBaseUrl', '/api/v1/analytics/{{merchantId}}'),
      request('Record Order Event', 'POST', 'analyticsServiceBaseUrl', '/api/v1/analytics/events', envelope),
    ],
  },
  {
    name: 'POS Integration Service (3007)',
    item: [
      ...health('posServiceBaseUrl', '/api/v1/pos'),
      request('Get Pending POS Orders', 'GET', 'posServiceBaseUrl', '/api/v1/pos/orders/pending?merchantId={{merchantId}}'),
      request('Handle Order Event', 'POST', 'posServiceBaseUrl', '/api/v1/pos/events', envelope),
      request('Manually Sync Order', 'POST', 'posServiceBaseUrl', '/api/v1/pos/sync', envelope),
    ],
  },
  { name: 'Notification Service (3008)', item: health('notificationServiceBaseUrl') },
  { name: 'Admin API (3009)', item: health('adminApiBaseUrl') },
  {
    name: 'Auth Service (3010)',
    item: [
      ...health('authServiceBaseUrl'),
      request('Get Mock Mailbox', 'GET', 'authServiceBaseUrl', '/api/v1/dev/mailbox'),
      request('Clear Mock Mailbox', 'DELETE', 'authServiceBaseUrl', '/api/v1/dev/mailbox'),
      request('Sign Up', 'POST', 'authServiceBaseUrl', '/api/v1/auth/signup', { email: '{{ownerEmail}}', password: '{{ownerPassword}}' }),
      request('Login', 'POST', 'authServiceBaseUrl', '/api/v1/auth/login', { email: '{{ownerEmail}}', password: '{{ownerPassword}}' }),
      request('Google Login', 'POST', 'authServiceBaseUrl', '/api/v1/auth/google', { credential: '{{googleCredential}}' }),
      request('Request Password Reset', 'POST', 'authServiceBaseUrl', '/api/v1/auth/password/reset-request', { email: '{{ownerEmail}}' }),
      request('Complete Password Reset', 'POST', 'authServiceBaseUrl', '/api/v1/auth/password/reset', { token: '{{actionToken}}', password: '{{newPassword}}' }),
      request('Accept Invitation', 'POST', 'authServiceBaseUrl', '/api/v1/auth/invitations/accept', { token: '{{actionToken}}', password: '{{ownerPassword}}' }),
      request('Invitation Web Page', 'GET', 'authServiceBaseUrl', '/accept-invitation?token={{actionToken}}'),
      request('Reset Password Web Page', 'GET', 'authServiceBaseUrl', '/reset-password?token={{actionToken}}'),
      request('Create POS Account', 'POST', 'authServiceBaseUrl', '/api/pos/account', { account_name: 'Test Restaurant', account_manager_email: '{{ownerEmail}}', account_manager_firstname: 'Restaurant', account_manager_lastname: 'Owner', account_manager_phone: '+919090909090' }, { headers: [{ key: 'api-key', value: '{{posApiKey}}' }] }),
      request('List Users', 'GET', 'authServiceBaseUrl', '/api/v1/users', undefined, { auth: bearer }),
      request('Get User', 'GET', 'authServiceBaseUrl', '/api/v1/users/{{userId}}', undefined, { auth: bearer }),
      request('Create User', 'POST', 'authServiceBaseUrl', '/api/v1/users', { firstName: 'Team', lastName: 'Member', email: '{{managedUserEmail}}', phoneNumber: '+919090909090', role: 'MANAGER', notificationEnabled: true }, { auth: bearer }),
      request('Update User', 'PATCH', 'authServiceBaseUrl', '/api/v1/users/{{userId}}', { firstName: 'Updated', role: 'USER', notificationEnabled: false }, { auth: bearer }),
      request('Delete User', 'DELETE', 'authServiceBaseUrl', '/api/v1/users/{{userId}}', undefined, { auth: bearer }),
    ],
  },
];

// Nginx exposes service routes through https://pdh.alektasolutions.com/connector.
// Keep these requests alongside the direct-port requests so the same collection
// can be used both on a developer machine and on the deployed Ubuntu host.
const publicRouteFor = (folderName, route) => {
  if (folderName.startsWith('Notification Service')) {
    return `/api/v1/notifications${route}`;
  }
  if (folderName.startsWith('Admin API')) {
    return `/api/v1/admin${route}`;
  }
  if (folderName.startsWith('Auth Service') && (route === '/health' || route === '/ready')) {
    return `/api/v1/auth${route}`;
  }
  return route;
};

const publicFolders = folders.map((folder) => ({
  name: folder.name.replace(/ \(\d+\)$/, ''),
  item: folder.item.map((source) => {
    const item = structuredClone(source);
    const localRaw = item.request.url.raw;
    const route = localRaw.replace(/^\{\{[^}]+\}\}/, '');
    const publicRoute = publicRouteFor(folder.name, route);
    item.request.url.raw = `{{publicBaseUrl}}${publicRoute}`;
    item.request.url.host = ['{{publicBaseUrl}}'];
    item.request.url.path = publicRoute.split('?')[0].split('/').filter(Boolean);
    return item;
  }),
}));

const allFolders = publicFolders;

const variables = [
  ['publicBaseUrl', 'https://pdh.alektasolutions.com/connector'],
  ['merchantId', 'Pinaka_013'], ['orderId', 'DD-8811'], ['externalOrderId', 'DD-8811'],
  ['itemId', 'ITEM-001'], ['ingredientId', 'ING-001'], ['userId', ''], ['accessToken', ''],
  ['actionToken', ''], ['posApiKey', 'replace-with-pos-api-key'], ['googleCredential', ''],
  ['ownerEmail', 'owner@example.com'], ['ownerPassword', 'ChangeMe@123'],
  ['newPassword', 'NewPassword@123'], ['managedUserEmail', 'team.member@example.com'],
].map(([key, value]) => ({ key, value }));

const collection = {
  info: {
    _postman_id: '8711a3b0-e6e2-4d78-8cb1-04c2c9b9c855',
    name: 'PDH - Complete APIs',
    description: 'All public Pinaka Delivery Hub HTTP endpoints served through https://pdh.alektasolutions.com/connector. Generated by scripts/generate-postman-collection.cjs.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: allFolders,
  variable: variables,
};

fs.writeFileSync(output, `${JSON.stringify(collection, null, 2)}\n`);
console.log(`Generated ${publicFolders.reduce((sum, folder) => sum + folder.item.length, 0)} website API requests in ${output}`);
