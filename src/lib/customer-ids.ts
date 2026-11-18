export interface CustomerIdInput {
  identifiers: string[];
  invalid: string[];
  duplicates: number;
}

export function parseCustomerIds(input: string, csv = false): CustomerIdInput {
  if (new TextEncoder().encode(input).length > 65536) throw new Error('Import must be at most 64 KB.');
  let values: string[];
  if (csv) {
    const rows: string[] = [];
    let field = '';
    let quoted = false;
    let closedQuote = false;
    const source = input.replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index++) {
      const character = source[index];
      if (quoted) {
        if (character === '"' && source[index + 1] === '"') { field += '"'; index++; }
        else if (character === '"') { quoted = false; closedQuote = true; }
        else field += character;
      } else if (character === '"' && field.length === 0 && !closedQuote) {
        quoted = true;
      } else if (character === ',' || character === ';') {
        throw new Error('CSV must contain one Customer ID column, optionally headed customer_id.');
      } else if (character === '\r' || character === '\n') {
        if (field.trim()) rows.push(field);
        field = '';
        closedQuote = false;
        if (character === '\r' && source[index + 1] === '\n') index++;
      } else {
        if (character === '"' || (closedQuote && character.trim())) throw new Error('CSV has invalid quoting.');
        field += character;
      }
    }
    if (quoted) throw new Error('CSV has an unclosed quoted field.');
    if (field.trim()) rows.push(field);
    if (rows[0]?.trim().toLowerCase() === 'customer_id') rows.shift();
    values = rows;
  } else {
    values = input.trim().split(/[\s,;]+/).filter(Boolean);
  }
  if (values.length === 0 || values.length > 100) throw new Error('Enter between 1 and 100 Customer IDs per investigation.');
  const normalized = values.map((value) => value.trim().toUpperCase());
  if (normalized.some((value) => value.length > 64)) throw new Error('An identifier exceeds 64 characters.');
  const identifiers = [...new Set(normalized)];
  return { identifiers, invalid: identifiers.filter((value) => !/^YB-\d{10}$/.test(value)),
    duplicates: normalized.length - identifiers.length };
}
