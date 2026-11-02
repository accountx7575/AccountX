// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DatePicker, maskInput, displayToIso, isoToDisplay } from '@/components/common/DatePicker';

describe('DatePicker — format and validation safeguards', () => {
  afterEach(() => {
    cleanup();
  });

  it('isoToDisplay formats ISO date to DD/MM/YYYY', () => {
    expect(isoToDisplay('2026-10-28')).toBe('28/10/2026');
    expect(isoToDisplay('')).toBe('');
    expect(isoToDisplay('invalid')).toBe('');
  });

  it('displayToIso strictly converts DD/MM/YYYY to ISO date within 2000-2099', () => {
    expect(displayToIso('28/10/2026')).toBe('2026-10-28');
    // Year before 2000 rejected
    expect(displayToIso('26/02/0269')).toBeNull();
    expect(displayToIso('01/01/1999')).toBeNull();
    // Year after 2099 rejected
    expect(displayToIso('31/12/2100')).toBeNull();
    // Invalid days or months rejected
    expect(displayToIso('99/99/9999')).toBeNull();
    expect(displayToIso('31/02/2026')).toBeNull();
    expect(displayToIso('32/01/2026')).toBeNull();
  });

  it('maskInput clamps invalid day, month, and year values', () => {
    // Clamps day 99 to 31, month 99 to 12, year 9999 to 2099
    expect(maskInput('99999999')).toBe('31/12/2099');
    expect(maskInput('28102026')).toBe('28/10/2026');
    // Year 0269 clamped to 2000
    expect(maskInput('26020269')).toBe('26/02/2000');
    // Non-digits stripped
    expect(maskInput('abc28xyz10def2026')).toBe('28/10/2026');
  });

  it('renders input with font-normal and opens calendar popup on focus or click', () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-10-28" onChange={onChange} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('28/10/2026');
    expect(input.className).toContain('font-normal');
    expect(input.className).not.toContain('font-bold');

    // Calendar is initially closed
    expect(screen.queryByDisplayValue('October')).toBeNull();

    // Clicking input opens popup
    fireEvent.click(input);
    expect(screen.getByDisplayValue('October')).not.toBeNull();
    expect(screen.getByDisplayValue('2026')).not.toBeNull();
  });

  it('reverts invalid input on blur without corrupting view or value', () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-10-28" onChange={onChange} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);

    expect(input.value).toBe('28/10/2026');
  });
});
