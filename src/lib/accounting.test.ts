import { describe, it, expect } from 'vitest';
import { calculateGstAmounts, type GstBreakdown } from '@/lib/accounting';
import { roundTo2 } from '@/lib/utils';

const SLABS = [0, 0.25, 3, 5, 12, 18, 28];

const paisa = (rupees: number) => Math.round(rupees * 100);

/** deterministic taxable bases per rate for the cess-combo matrix */
const taxableFor = (rate: number) => roundTo2(1000 * (1 + rate / 100));

describe('calculateGstAmounts — intra-state (CGST + SGST)', () => {
  it('splits tax into equal halves for a standard slab', () => {
    const r = calculateGstAmounts(10000, 18, false);
    expect(r.igst_amount).toBe(0);
    expect(r.total_tax).toBe(1800);
    expect(r.cgst_amount).toBe(900);
    expect(r.sgst_amount).toBe(900);
  });

  it('keeps cgst + sgst === total_tax exactly (m011 recombine identity)', () => {
    for (const rate of SLABS) {
      for (const taxable of [0.01, 33.33, 10.01, 999.99, 12345.67]) {
        const r = calculateGstAmounts(taxable, rate, false);
        expect(paisa(r.cgst_amount + r.sgst_amount)).toBe(paisa(r.total_tax));
        // halves may differ only when total tax is an odd number of paisa
        expect(Math.abs(paisa(r.cgst_amount) - paisa(r.sgst_amount))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rounds the full-rate tax first, then splits; odd paisa falls to SGST', () => {
    // 10.01 @ 0.25% => 0.025025 -> 0.03 total; half 0.015 rounds UP to 0.02 CGST, SGST keeps 0.01
    const r = calculateGstAmounts(10.01, 0.25, false);
    expect(paisa(r.total_tax)).toBe(3);
    expect(paisa(r.cgst_amount)).toBe(2);
    expect(paisa(r.sgst_amount)).toBe(1);
  });

  it('handles an odd half by giving sgst the residual paisa', () => {
    for (const [taxable, rate] of [[7.5, 5], [13.37, 12], [101.05, 3]] as const) {
      const r = calculateGstAmounts(taxable, rate, false);
      expect(paisa(r.cgst_amount + r.sgst_amount)).toBe(paisa(r.total_tax));
    }
  });
});

describe('calculateGstAmounts — inter-state (IGST)', () => {
  it('puts the whole tax on IGST with zero halves', () => {
    const r = calculateGstAmounts(10000, 18, true);
    expect(r.igst_amount).toBe(1800);
    expect(r.cgst_amount).toBe(0);
    expect(r.sgst_amount).toBe(0);
    expect(r.total_tax).toBe(1800);
  });

  it('matches the intra-state total for the same base and rate', () => {
    for (const rate of SLABS) {
      const intra = calculateGstAmounts(4321.21, rate, false);
      const inter = calculateGstAmounts(4321.21, rate, true);
      expect(inter.total_tax).toBe(intra.total_tax);
      expect(inter.igst_amount).toBe(intra.total_tax);
    }
  });
});

describe('calculateGstAmounts — degenerate inputs', () => {
  it('returns zeros for zero rate regardless of interstate flag', () => {
    expect(calculateGstAmounts(500, 0, false)).toEqual<GstBreakdown>({
      cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total_tax: 0,
    });
    expect(calculateGstAmounts(500, 0, true).total_tax).toBe(0);
  });

  it('treats NaN rate as 0', () => {
    const r = calculateGstAmounts(500, NaN, false);
    expect(r.total_tax).toBe(0);
  });

  it('rounds a fractional taxable base before applying the rate', () => {
    // 100.005 -> roundTo2 -> 100.01 (float-noise guard on the base)
    const r = calculateGstAmounts(100.005, 18, false);
    expect(r.total_tax).toBe(roundTo2((roundTo2(100.005) * 18) / 100));
  });
});

describe('J1 canonical identity: grand = taxable + CGST + SGST + IGST + cess + round_off', () => {
  const buildGrand = (
    taxable: number,
    rate: number,
    isInterState: boolean,
    cess = 0
  ) => {
    const gst = calculateGstAmounts(taxable, rate, isInterState);
    const grandBeforeRound = roundTo2(
      roundTo2(taxable) + gst.total_tax + cess
    );
    const roundOff = roundTo2(Math.round(grandBeforeRound) - grandBeforeRound);
    return {
      gst,
      roundOff,
      grandTotal: roundTo2(grandBeforeRound + roundOff),
    };
  };

  it('identity holds across every slab, both modes, with and without cess', () => {
    for (const rate of SLABS) {
      for (const interState of [false, true]) {
        for (const cess of [0, 0.5, 1.23]) {
          for (const taxable of [1, 99.99, 1250, 84999.37]) {
            const { gst, roundOff, grandTotal } = buildGrand(taxable, rate, interState, cess);
            const recomposed =
              paisa(roundTo2(taxable)) +
              paisa(gst.cgst_amount) + paisa(gst.sgst_amount) + paisa(gst.igst_amount) +
              paisa(cess) +
              paisa(roundOff);
            expect(recomposed).toBe(paisa(grandTotal));
          }
        }
      }
    }
  });

  it('cess x inter-state combos keep the identity and leave GST heads untouched by cess', () => {
    for (const rate of [5, 12, 18, 28]) {
      for (const interState of [false, true]) {
        for (const cess of [0.25, 2]) {
          const base = buildGrand(taxableFor(rate), rate, interState, 0);
          const withCess = buildGrand(taxableFor(rate), rate, interState, cess);
          // cess must not perturb the GST heads themselves
          expect(withCess.gst.total_tax).toBe(base.gst.total_tax);
          const recomposedWithCess =
            paisa(roundTo2(taxableFor(rate))) + paisa(withCess.gst.total_tax) +
            paisa(cess) + paisa(withCess.roundOff);
          expect(recomposedWithCess).toBe(paisa(withCess.grandTotal));
        }
      }
    }
  });

  it('round_off is a clean paisa-level correction within ±0.50', () => {
    for (const rate of SLABS) {
      const { roundOff } = buildGrand(7777.77, rate, false);
      expect(Number.isInteger(paisa(roundOff))).toBe(true);
      expect(Math.abs(paisa(roundOff))).toBeLessThanOrEqual(50);
    }
  });
});
