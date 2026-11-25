import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('locality selections update available details without replacing the street address', async () => {
  const server = await createServer({
    configFile: false,
    resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const { applyPickupLocality } = await server.ssrLoadModule('/src/lib/pickup-location.ts');
    const current = {
      formattedAddress: 'Example street', streetAddress: 'Example street',
      city: '', state: '', postalCode: '', country: 'US',
      latitude: 30, longitude: -97, timeZone: 'America/Chicago', placeId: '', manualConfirmed: true,
    };
    const country = { longText: 'United States', shortText: 'US', types: ['country'] };
    const region = { longText: 'Texas', shortText: 'TX', types: ['administrative_area_level_1'] };
    const city = { longText: 'Austin', shortText: 'Austin', types: ['locality'] };
    const zip = { longText: '78701', shortText: '78701', types: ['postal_code'] };
    const countries = [{ code: 'US', name: 'United States' }];

    const selectedCity = applyPickupLocality(current, 'city', { addressComponents: [city, region, country] }, countries);
    assert.equal(selectedCity.city, 'Austin');
    assert.equal(selectedCity.state, 'TX');
    assert.equal(selectedCity.postalCode, '');
    assert.equal(selectedCity.streetAddress, 'Example street');
    assert.equal(selectedCity.formattedAddress, 'Example street');
    assert.equal(selectedCity.latitude, null);
    assert.equal(selectedCity.longitude, null);
    assert.equal(selectedCity.manualConfirmed, false);

    const selectedZip = applyPickupLocality(current, 'postalCode', { addressComponents: [zip, city, region, country] }, countries);
    assert.deepEqual([selectedZip.city, selectedZip.state, selectedZip.postalCode], ['Austin', 'TX', '78701']);
    const selectedState = applyPickupLocality(current, 'state', { addressComponents: [region, country] }, countries);
    assert.equal(selectedState.state, 'TX');
    assert.throws(() => applyPickupLocality(current, 'postalCode', { addressComponents: [city, country] }, countries));
    assert.throws(() => applyPickupLocality(current, 'city', { addressComponents: [city] }, countries));
  } finally {
    await server.close();
  }
});
