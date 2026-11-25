import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SettingsApiService } from './settings-api.service';
import { SettingsJson } from './settings-api.repository';

function createService(initial: SettingsJson = {}) {
  const configurations: SettingsJson = { ...initial };
  const repository = {
    readConfiguration: async (_scope: unknown, name: string) => configurations[name] ?? {},
    merge: async (_scope: unknown, _patch: SettingsJson, values: Record<string, SettingsJson> = {}) => {
      for (const [name, value] of Object.entries(values)) {
        configurations[name] = { ...(configurations[name] ?? {}), ...value };
      }
      return {};
    },
  };
  return { service: new SettingsApiService(repository as never), configurations };
}

const scope = { user: { id: 'actor' }, merchantHeader: 'merchant', storeHeader: 'store' };

test('email settings persist and read back independently per template id', async () => {
  const { service, configurations } = createService();

  await service.saveEmailSettings({
    template_id: 'new-order', enabled: true, recipients: 'orders@example.com',
    subject: 'Order: {site_title}', heading: 'New order', additional_content: 'Order body', email_type: 'html',
    store_name_display: 'Order store', intro_text: 'Order intro', summary_heading: 'Order summary label',
  }, scope);
  await service.saveEmailSettings({
    template_id: 'new-user-registration', enabled: false, recipients: 'users@example.com',
    subject: 'Welcome: {site_title}', heading: 'New user', additional_content: 'User body', email_type: 'plain',
    store_name_display: 'Registration store', intro_text: 'Registration intro', summary_heading: 'Registration summary',
  }, scope);

  const order = await service.getEmailSettings(scope, 'new-order');
  const registration = await service.getEmailSettings(scope, 'new-user-registration');
  const orderData = order.data as SettingsJson;
  const registrationData = registration.data as SettingsJson;
  assert.equal(orderData.recipients, 'orders@example.com');
  assert.equal(orderData.subject, 'Order: {site_title}');
  assert.equal(orderData.store_name_display, 'Order store');
  assert.equal(orderData.intro_text, 'Order intro');
  assert.equal(orderData.summary_heading, 'Order summary label');
  assert.equal(registrationData.recipients, 'users@example.com');
  assert.equal(registrationData.subject, 'Welcome: {site_title}');
  assert.equal(registrationData.store_name_display, 'Registration store');
  assert.equal(registrationData.intro_text, 'Registration intro');
  assert.equal(registrationData.summary_heading, 'Registration summary');
  assert.equal(registrationData.enabled, false);
  assert.equal(registrationData.email_type, 'plain');
  assert.deepEqual(Object.keys(configurations.email_settings.templates).sort(), ['new-order', 'new-user-registration']);
});

test('legacy root settings only fall back to the new-order template', async () => {
  const { service } = createService({
    email_settings: {
      enabled: true, recipients: 'legacy@example.com', subject: 'Legacy subject',
      heading: 'Legacy heading', additional_content: '', email_type: 'html',
    },
  });

  const order = await service.getEmailSettings(scope, 'new-order');
  const registration = await service.getEmailSettings(scope, 'new-user-registration');
  const orderData = order.data as SettingsJson;
  const registrationData = registration.data as SettingsJson;
  assert.equal(orderData.subject, 'Legacy subject');
  assert.equal(orderData.store_name_display, '{site_title}');
  assert.equal(orderData.intro_text, 'You’ve received a new order from John Doe.');
  assert.equal(orderData.summary_heading, 'Order summary');
  assert.equal(registrationData.subject, '');
  assert.equal(registrationData.recipients, '');
  assert.equal(registrationData.store_name_display, '{site_title}');
  assert.equal(registrationData.intro_text, 'A new user has registered on {site_title}.');
});
