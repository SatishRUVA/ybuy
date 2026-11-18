import { expect, test } from '@playwright/test';
import { parseCustomerIds } from '../src/lib/customer-ids';

test('normalizes and deduplicates Customer IDs without dropping invalid inputs', () => {
  expect(parseCustomerIds('yb-0000000001, YB-0000000001\ninvalid;YB-0000000002')).toEqual({
    identifiers: ['YB-0000000001','INVALID','YB-0000000002'], invalid: ['INVALID'], duplicates: 1,
  });
});
test('imports one-column CSV including BOM, header, CRLF, quotes and invalid IDs', () => {
  expect(parseCustomerIds('\uFEFFcustomer_id\r\n"yb-0000000001"\r\nYB-0000000001\r\n"not""valid"\n',true)).toEqual({
    identifiers: ['YB-0000000001','NOT"VALID'], invalid: ['NOT"VALID'], duplicates: 1,
  });
});
test('rejects oversized, empty, multi-column and malformed CSV instead of silently dropping data', () => {
  for (const csv of ['customer_id,email\nYB-0000000001,user@example.test', '"unclosed', '"id"trailing']) {
    expect(() => parseCustomerIds(csv,true)).toThrow();
  }
  expect(() => parseCustomerIds('')).toThrow('between 1 and 100');
  expect(() => parseCustomerIds(Array(101).fill('YB-0000000001').join('\n'))).toThrow('between 1 and 100');
  expect(() => parseCustomerIds('x'.repeat(65537))).toThrow('64 KB');
  expect(() => parseCustomerIds('x'.repeat(65))).toThrow('64 characters');
});
