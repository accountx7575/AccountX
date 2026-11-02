import { describe, expect, it } from 'vitest';
import { toCsv } from './exportLedger';

describe('toCsv (Excel-compatible CSV per ruling)', () => {
  it('serializes flat rows with header', () => {
    const csv = toCsv([
      { doc_number: 'INV/2026/000001', amount: 1180 },
      { doc_number: 'INV/2026/000002', amount: 2360 },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('doc_number,amount');
    expect(lines[1]).toBe('INV/2026/000001,1180');
    expect(lines[2]).toBe('INV/2026/000002,2360');
  });

  it('escapes commas, quotes and newlines per RFC 4180', () => {
    const csv = toCsv([{ name: 'Sharma, & Sons "Traders"', note: 'line1\nline2' }]);
    expect(csv).toContain('"Sharma, & Sons ""Traders"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it('renders null/undefined as empty cells and stringifies objects as quoted JSON', () => {
    const csv = toCsv([{ a: null, b: undefined, c: { k: 1 } }]);
    expect(csv).toBe('a,b,c\r\n,,"{""k"":1}"');
  });

  it('honors explicit column order and returns empty string for no rows', () => {
    expect(toCsv([{ x: 1, y: 2 }], ['y', 'x'])).toBe('y,x\r\n2,1');
    expect(toCsv([])).toBe('');
  });
});
