import {describe,it,expect} from 'vitest';
import {formatNumber,formatCurrency,formatAxisTick} from './formatters';
import {numericAxis} from './chartAxis';
import {middleEllipsis} from './filenames';
describe('shared presentation formatting',()=>{
 it('handles invalid and finite values safely',()=>{
  for(const v of [null,undefined,NaN,Infinity,-Infinity]) {expect(formatNumber(v)).toBe('—');expect(formatCurrency(v,'INR')).toBe('—');expect(formatAxisTick(v,{unit:''})).toBe('—');}
  expect(formatNumber(0)).toBe('0');expect(formatNumber(-1234.56)).toBe('-1,234.56');expect(formatNumber(.125)).toBe('0.125');
 });
 it('preserves full decimal and integer precision',()=>{expect(formatNumber('9007199254740993.123456789')).toBe('9,007,199,254,740,993.123456789');expect(formatNumber(9007199254740993n)).toBe('9,007,199,254,740,993');});
 it('uses confirmed currency grouping',()=>{expect(formatCurrency(3085360.14,'INR')).toBe('₹30,85,360.14');expect(formatCurrency(3085360.14,'USD')).toBe('$3,085,360.14');expect(formatCurrency(8379680.76,'INR')).toBe('₹83,79,680.76');});
 it('formats boundaries and trims compact decimals',()=>{
  for(const [v,label] of [[1000,'1K'],[1e6,'1M'],[1e9,'1B']] as const) expect(formatNumber(v,{compact:true})).toBe(label);
  expect(formatCurrency(1e5,'INR',{compact:true})).toBe('₹1L');expect(formatCurrency(1e7,'INR',{compact:true})).toBe('₹1Cr');expect(formatCurrency(1.2e6,'USD',{compact:true})).toBe('$1.2M');expect(formatAxisTick(50000,{currency:'INR',unit:'L'})).toBe('₹0.5L');
 });
 it('keeps axis labels unique and domains above data without mutation',()=>{
  for(const values of [[0],[-100,-10],[.000000001,.000000002],[999,1000],[1e6,1e6+1],[9e6,12e6],[1e15,2e15]]){
   const original=[...values];const a=numericAxis(values,true,{currency:'INR'});const labels=a.ticks.map(a.formatter);
   expect(a.domain[1]).toBeGreaterThan(Math.max(...values));expect(a.ticks.length).toBeGreaterThan(1);expect(new Set(labels).size).toBe(labels.length);expect(values).toEqual(original);
   const factor=a.step/10**Math.floor(Math.log10(a.step));expect([1,2,2.5,5,10].some(n=>Math.abs(n-factor)<1e-8)).toBe(true);
   if(a.unit)expect(labels.every(l=>l.endsWith(a.unit))).toBe(true);
  }
 });
 it('handles empty and invalid chart series',()=>{expect(numericAxis([NaN,Infinity]).ticks.length).toBeGreaterThan(1);});
 it('retains filename extensions and does not rename',()=>{const name='CONTROLLED-BENCHMARK-very-long-retail-v1.csv';const display=middleEllipsis(name);expect(display).toContain('…');expect(display.endsWith('.csv')).toBe(true);expect(middleEllipsis('retail.csv')).toBe('retail.csv');});
});
