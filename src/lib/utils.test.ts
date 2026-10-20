import { describe, it, expect } from 'vitest';
import { amountInWordsIndian, numberToWordsIndian } from '@/lib/utils';

describe('amountInWordsIndian — edge cases', () => {
  it('zero', () => {
    expect(amountInWordsIndian(0)).toBe('Zero Rupees Only');
  });

  it('one rupee', () => {
    expect(amountInWordsIndian(1)).toBe('One Rupees Only');
  });

  it('plain rupee amounts', () => {
    expect(amountInWordsIndian(21)).toBe('Twenty One Rupees Only');
    expect(amountInWordsIndian(105)).toBe('One Hundred Five Rupees Only');
    expect(amountInWordsIndian(1500)).toBe('One Thousand Five Hundred Rupees Only');
  });

  it('lakh grouping', () => {
    expect(amountInWordsIndian(100000)).toBe('One Lakh Rupees Only');
    expect(amountInWordsIndian(250000)).toBe('Two Lakh Fifty Thousand Rupees Only');
    expect(amountInWordsIndian(123456)).toBe('One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only');
  });

  it('crore grouping', () => {
    expect(amountInWordsIndian(10000000)).toBe('One Crore Rupees Only');
    expect(amountInWordsIndian(123456789)).toBe(
      'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Rupees Only'
    );
    expect(amountInWordsIndian(102030400)).toBe(
      'Ten Crore Twenty Lakh Thirty Thousand Four Hundred Rupees Only'
    );
  });

  it('paise suffix when fractional part present', () => {
    expect(amountInWordsIndian(10.55)).toBe('Ten Rupees and Fifty Five Paise Only');
    expect(amountInWordsIndian(0.01)).toBe('Zero Rupees and One Paise Only');
    expect(amountInWordsIndian(99.99)).toBe('Ninety Nine Rupees and Ninety Nine Paise Only');
  });

  it('paise rounding of float noise stays within 0-99 for currency values', () => {
    // classic binary-float traps for 2dp money
    expect(amountInWordsIndian(1.99)).toBe('One Rupees and Ninety Nine Paise Only');
    expect(amountInWordsIndian(2.675)).toBe('Two Rupees and Sixty Seven Paise Only'); // binary float: 67.4999... -> rounds DOWN
  });

  it('negative amounts use absolute value (display-only util)', () => {
    expect(amountInWordsIndian(-1500)).toBe('One Thousand Five Hundred Rupees Only');
  });
});

describe('numberToWordsIndian — sign & scale', () => {
  it('negative amounts are prefixed with Negative ', () => {
    expect(numberToWordsIndian(-1)).toBe('Negative One');
    expect(numberToWordsIndian(-105)).toBe('Negative One Hundred Five');
    expect(numberToWordsIndian(-12345678)).toBe('Negative One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight');
  });

  it('zero and crore scale stay correct at the sign boundary', () => {
    expect(numberToWordsIndian(0)).toBe('Zero');
    expect(numberToWordsIndian(10000000)).toBe('One Crore');
  });

  it('amountInWordsIndian keeps abs behavior (document display, positives only)', () => {
    expect(amountInWordsIndian(-105)).toBe('One Hundred Five Rupees Only');
    expect(amountInWordsIndian(-105)).toBe(amountInWordsIndian(105));
  });

  it('paise component is rendered from the fractional part', () => {
    expect(amountInWordsIndian(105.5)).toBe('One Hundred Five Rupees and Fifty Paise Only');
  });
});
