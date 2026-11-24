import {describe,expect,it} from 'vitest';
import {displayAmount,displayExact} from './displayNumber';
import {suggestUnit} from './unitSuggestions';
describe('confirmed units only',()=>{
  it('shows % only for a column the owner confirmed as a percentage',()=>{
    expect(displayAmount(12.3456,undefined,undefined,'DOUBLE',true)).toBe('12.35%');
    expect(displayExact(12.3456789,undefined,undefined,'DOUBLE',true)).toBe('12.3456789%');
  });
  it('a column named like a percentage or like money is a bare number until confirmed',()=>{
    expect(displayAmount(12.3456,undefined,undefined,'DOUBLE')).toBe('12.35');
    expect(displayAmount(12.3456,undefined,undefined,'DOUBLE',false)).toBe('12.35');
    expect(displayExact(7,undefined,undefined,'BIGINT')).toBe('7');
  });
  it('never turns a currency column into a percentage and ignores empty values',()=>{
    expect(displayAmount(5,{currency:'USD'} as never,undefined,'DOUBLE',true)).toContain('$');
    expect(displayAmount(null,undefined,undefined,'DOUBLE',true)).not.toContain('%');
  });
  it('name hints are suggestions only',()=>{
    expect(suggestUnit('revenue')).toBe('money');
    expect(suggestUnit('sales')).toBe('money');           // may really be a count: the owner decides
    expect(suggestUnit('discount_pct')).toBe('percent');
    expect(suggestUnit('order_count')).toBe('neither');
    expect(suggestUnit('region')).toBe('neither');
  });
});
