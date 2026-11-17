import { POINT_UNITS_PER_POINT, formatPoints, pointUnitsFromInput, pointsFromUnits, pointsWord } from './points';

// Intl groups thousands with a no-break space in Russian.
const NBSP = ' ';

describe('points', () => {
  it('counts a hundred units to the point', () => {
    expect(POINT_UNITS_PER_POINT).toBe(100);
    expect(pointsFromUnits(1240)).toBe(12.4);
    expect(pointsFromUnits(40)).toBe(0.4);
    expect(pointsFromUnits(0)).toBe(0);
  });

  describe('formatPoints', () => {
    it('drops the decimals on whole points and keeps two otherwise', () => {
      expect(formatPoints(3000)).toBe('30');
      expect(formatPoints(1240)).toBe('12,40');
      expect(formatPoints(40)).toBe('0,40');
      expect(formatPoints(5)).toBe('0,05');
      expect(formatPoints(0)).toBe('0');
    });

    it('uses the language separators', () => {
      expect(formatPoints(1240, 'en')).toBe('12.40');
      expect(formatPoints(245000, 'ru')).toBe(`2${NBSP}450`);
      expect(formatPoints(245050, 'en')).toBe('2,450.50');
    });

    it('starts a negative amount with a real minus sign', () => {
      expect(formatPoints(-40)).toBe('−0,40');
      expect(formatPoints(-100, 'en')).toBe('−1');
    });

    it('falls back to Russian on a malformed language tag', () => {
      expect(formatPoints(1240, '')).toBe('12,40');
    });
  });

  describe('pointsWord', () => {
    it('follows the Russian plural rules for whole points', () => {
      expect(pointsWord(100)).toBe('балл');
      expect(pointsWord(2100)).toBe('балл');
      expect(pointsWord(200)).toBe('балла');
      expect(pointsWord(400)).toBe('балла');
      expect(pointsWord(2200)).toBe('балла');
      expect(pointsWord(500)).toBe('баллов');
      expect(pointsWord(1100)).toBe('баллов');
      expect(pointsWord(1200)).toBe('баллов');
      expect(pointsWord(1400)).toBe('баллов');
      expect(pointsWord(11100)).toBe('баллов');
      expect(pointsWord(0)).toBe('баллов');
    });

    it('says «балла» for any fraction', () => {
      expect(pointsWord(40)).toBe('балла');
      expect(pointsWord(1240)).toBe('балла');
      expect(pointsWord(101)).toBe('балла');
      expect(pointsWord(550)).toBe('балла');
    });

    it('ignores the sign', () => {
      expect(pointsWord(-100)).toBe('балл');
      expect(pointsWord(-500)).toBe('баллов');
    });

    it('has point and points in English', () => {
      expect(pointsWord(100, 'en')).toBe('point');
      expect(pointsWord(-100, 'en')).toBe('point');
      expect(pointsWord(200, 'en')).toBe('points');
      expect(pointsWord(40, 'en')).toBe('points');
      expect(pointsWord(110, 'en')).toBe('points');
      expect(pointsWord(0, 'en')).toBe('points');
    });

    it('agrees with the language plural rules the translations use', () => {
      const forms: Record<string, string> = { one: 'балл', few: 'балла', many: 'баллов', other: 'балла' };
      const rules = new Intl.PluralRules('ru');
      for (const units of [0, 40, 100, 150, 200, 500, 1100, 1240, 2100, 2200, 2500, 10100]) {
        expect(pointsWord(units)).toBe(forms[rules.select(pointsFromUnits(units))]);
      }
    });
  });

  describe('pointUnitsFromInput', () => {
    it('reads points with a comma or a dot', () => {
      expect(pointUnitsFromInput('12,4')).toBe(1240);
      expect(pointUnitsFromInput('12.40')).toBe(1240);
      expect(pointUnitsFromInput('12')).toBe(1200);
      expect(pointUnitsFromInput('0,05')).toBe(5);
      expect(pointUnitsFromInput(',5')).toBe(50);
      expect(pointUnitsFromInput('12.')).toBe(1200);
      expect(pointUnitsFromInput(' 2 450,50 ')).toBe(245050);
      expect(pointUnitsFromInput(`2${NBSP}450`)).toBe(245000);
    });

    it('takes a number as points', () => {
      expect(pointUnitsFromInput(12.4)).toBe(1240);
      expect(pointUnitsFromInput(5)).toBe(500);
    });

    it('rounds a third decimal half up to a whole unit', () => {
      expect(pointUnitsFromInput('12,345')).toBe(1235);
      expect(pointUnitsFromInput('12,344')).toBe(1234);
      expect(pointUnitsFromInput('1.005')).toBe(101);
      expect(pointUnitsFromInput(1.005)).toBe(101);
      expect(pointUnitsFromInput('0,004')).toBe(0);
    });

    it('is 0 for anything that is not a non-negative number', () => {
      expect(pointUnitsFromInput('')).toBe(0);
      expect(pointUnitsFromInput('abc')).toBe(0);
      expect(pointUnitsFromInput('-5')).toBe(0);
      expect(pointUnitsFromInput('1e3')).toBe(0);
      expect(pointUnitsFromInput('1,2,3')).toBe(0);
      expect(pointUnitsFromInput(Number.NaN)).toBe(0);
      expect(pointUnitsFromInput(-5)).toBe(0);
      expect(pointUnitsFromInput(Number.POSITIVE_INFINITY)).toBe(0);
    });
  });
});
