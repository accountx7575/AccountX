// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TimePicker, sanitizeTimeInput, parseTime, formatTime } from '@/components/common/TimePicker';

describe('TimePicker — formatting, sanitization, and UI', () => {
  afterEach(() => {
    cleanup();
  });

  it('sanitizeTimeInput strips random alphabetical characters and limits length to 8', () => {
    // Specifically prevents garbage text like "11:16 amsdsdsdsdsds"
    expect(sanitizeTimeInput('11:16 amsdsdsdsdsds')).toBe('11:16 am');
    expect(sanitizeTimeInput('hello 12:30 world').trim()).toBe('12:30');
    expect(sanitizeTimeInput('09:45 pm')).toBe('09:45 pm');
    expect(sanitizeTimeInput('!@#$%^&*()')).toBe('');
  });

  it('parseTime parses 12-hour and 24-hour time strings into structured time object', () => {
    expect(parseTime('11:16 am')).toEqual({ hour: 11, minute: 16, meridiem: 'AM' });
    expect(parseTime('02:30 PM')).toEqual({ hour: 2, minute: 30, meridiem: 'PM' });
    // 24-hour time
    expect(parseTime('14:30')).toEqual({ hour: 2, minute: 30, meridiem: 'PM' });
    expect(parseTime('00:15')).toEqual({ hour: 12, minute: 15, meridiem: 'AM' });
    // Out-of-bounds minute clamped
    expect(parseTime('10:99 pm')).toEqual({ hour: 10, minute: 59, meridiem: 'PM' });
  });

  it('formatTime formats padded hour, minute, and uppercase meridiem', () => {
    expect(formatTime(9, 5, 'AM')).toBe('09:05 AM');
    expect(formatTime(12, 0, 'PM')).toBe('12:00 PM');
  });

  it('renders input with font-normal and without font-bold or figure', () => {
    const onChange = vi.fn();
    render(<TimePicker value="11:16 AM" onChange={onChange} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('11:16 AM');
    expect(input.className).toContain('font-normal');
    expect(input.className).toContain('text-slate-800');
    expect(input.className).not.toContain('font-bold');
    expect(input.className).not.toContain('figure');
  });

  it('blocks arbitrary non-time characters on input change', () => {
    const onChange = vi.fn();
    render(<TimePicker value="11:16 AM" onChange={onChange} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '11:16 amxyz123' } });

    // "xyz" stripped, only valid time chars preserved up to max length
    expect(input.value).toBe('11:16 am');
  });

  it('opens popup when clicking clock button and allows selecting preset', () => {
    const onChange = vi.fn();
    render(<TimePicker value="11:16 AM" onChange={onChange} />);

    const openBtn = screen.getByRole('button', { name: /Open time picker/i });
    fireEvent.click(openBtn);

    // Preset buttons appear
    const preset12 = screen.getByRole('button', { name: /12:00PM/i });
    expect(preset12).not.toBeNull();
    fireEvent.click(preset12);

    expect(onChange).toHaveBeenCalledWith('12:00 PM');
  });

  it('reverts invalid input on blur to last valid value', () => {
    const onChange = vi.fn();
    render(<TimePicker value="11:16 AM" onChange={onChange} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'invalid' } });
    fireEvent.blur(input);

    expect(input.value).toBe('11:16 AM');
  });
});
