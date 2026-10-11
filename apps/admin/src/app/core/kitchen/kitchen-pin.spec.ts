import { appendPinDigit, canSubmitPin, newPinProblem, pinSlots } from './kitchen-pin';

describe('kitchen PIN rules', () => {
  it('lets the tablet send 4, 5 or 6 digits — and nothing shorter', () => {
    expect(canSubmitPin('482')).toBe(false);
    expect(canSubmitPin('4821')).toBe(true);
    expect(canSubmitPin('48213')).toBe(true);
    expect(canSubmitPin('482137')).toBe(true);
  });

  it('stops taking digits at six, and takes digits only', () => {
    let pin = '';
    for (const d of '12345678') pin = appendPinDigit(pin, d);
    expect(pin).toBe('123456');
    expect(appendPinDigit('12', 'x')).toBe('12');
  });

  it('marks the first four slots as needed and the last two as optional', () => {
    const slots = pinSlots('48213');
    expect(slots.map((s) => s.filled)).toEqual([true, true, true, true, true, false]);
    expect(slots.map((s) => s.optional)).toEqual([false, false, false, false, true, true]);
  });

  it('sets only 6-digit PINs that are not a first guess', () => {
    expect(newPinProblem('418273')).toBeNull();
    expect(newPinProblem('4182')).toBe('FORMAT');
    expect(newPinProblem('41827a')).toBe('FORMAT');
    for (const easy of ['000000', '123456', '987654']) expect(newPinProblem(easy)).toBe('TOO_SIMPLE');
  });
});
