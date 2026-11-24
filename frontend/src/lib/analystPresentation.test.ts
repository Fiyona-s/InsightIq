import {describe,it,expect} from 'vitest';
import {answerSentence,findings,humanLabel,errorReason,beVerb} from './analystPresentation';
import type {AnalystResults} from '../api';
const result=(rows:AnalystResults['rows'],name='total_revenue',money?:{currency:string}):AnalystResults=>({columns:[{name,type:'DOUBLE',money}],rows,row_count:rows.length,offset:0,expires_in_seconds:600});
it('formats a scalar without inferring currency from names',()=>{expect(answerSentence(result([[1000]]))).toBe('Your total revenue is 1,000.');expect(answerSentence(result([[8379680.76]],'total_revenue_inr'))).toBe('Your total revenue is 8,379,680.76.');expect(answerSentence(result([[8379680.76]],'total_revenue_inr',{currency:'INR'}))).toBe('Your total revenue is ₹83,79,680.76.');expect(answerSentence(result([[1000]],'total_revenue',{currency:'USD'}))).toBe('Your total revenue is $1,000.00.');});
it('handles empty and NULL results without inventing zero',()=>{expect(answerSentence(result([]))).toBe('No rows matched this question.');expect(answerSentence(result([[null]]))).toBe('Your total revenue is unavailable because this query returned no value.');});
it('describes grouped results and only produces a source-linked top finding',()=>{const r={...result([['West',1200],['East',500]]),columns:[{name:'region',type:'VARCHAR'},{name:'revenue',type:'DOUBLE'}]};expect(answerSentence(r)).toBe('Revenue by region: 2 rows.');const chart={spec:{kind:'bar' as const,x:0,y:1,title:'Revenue by region',null_policy:'omit_with_count' as const,zero_baseline:true as const},points:[{row:0,label:'West',value:1200,y:1200}],note:'',omitted_rows:0};expect(findings(r,chart,[{id:'f7',method:'top_n',value:'1200',statement:'technical prose is not displayed',source:{columns:[1,0],rows:[0],result_digest:'d',formula:'rank',scope:'returned'}}])).toEqual([{id:'f7',text:'West is highest at 1,200.'}]);});
it('never repeats a scalar in findings or exposes citation jargon',()=>{expect(findings(result([[1000]]),{} as never,[])).toEqual([]);expect(humanLabel('total_recognized_revenue_inr')).toBe('Total recognized revenue');});

it('uses honest actionable error reasons without exposing technical details',()=>{expect(errorReason('not_configured')).toContain('not configured');expect(errorReason('provider_auth')).toContain('denied access');expect(errorReason('timeout')).toContain('too long');expect(errorReason('validation_error')).toContain('safe query');});

describe('one row with several columns (e.g. "which region has the most revenue")', () => {
  const two = (rows: AnalystResults['rows']): AnalystResults => ({ columns: [{ name: 'region', type: 'VARCHAR' }, { name: 'total_revenue', type: 'DOUBLE' }], rows, row_count: rows.length, offset: 0, expires_in_seconds: 600 });
  it('names the row instead of showing an unlabeled number', () => {
    expect(answerSentence(two([['East', 109219.5]]))).toBe('East — total revenue: 109,219.5');
  });
  it('rounds for reading but never claims more than the row says (no "highest" the data did not state)', () => {
    const text = answerSentence(two([['East', 109219.50000001]]));
    expect(text).toBe('East — total revenue: 109,219.5');
    expect(text).not.toMatch(/highest|lowest|best|most/i);
  });
  it('keeps several rows as before', () => {
    expect(answerSentence(two([['East', 1], ['West', 2]]))).toBe('Total revenue by region: 2 rows.');
  });
  it('lists every column for other one-row shapes', () => {
    const r: AnalystResults = { columns: [{ name: 'region', type: 'VARCHAR' }, { name: 'orders', type: 'BIGINT' }, { name: 'avg_price', type: 'DOUBLE' }], rows: [['East', 30, 412.5]], row_count: 1, offset: 0, expires_in_seconds: 600 };
    expect(answerSentence(r)).toBe('region: East · orders: 30 · average price: 412.5');
  });
});

describe('"highest" and "lowest" come only from the executed query', () => {
  const row: AnalystResults = { columns: [{ name: 'region', type: 'VARCHAR' }, { name: 'total_revenue', type: 'DOUBLE' }], rows: [['East', 109219.5]], row_count: 1, offset: 0, expires_in_seconds: 600 };
  const sql = (order: string) => `SELECT region, SUM(revenue) AS total_revenue FROM data GROUP BY region ${order}`;
  it('says highest when the query sorts that measure descending and keeps one row', () => {
    expect(answerSentence(row, undefined, sql('ORDER BY total_revenue DESC LIMIT 1'))).toBe('East has the highest total revenue: 109,219.5');
    expect(answerSentence(row, undefined, sql('ORDER BY SUM(revenue) DESC\nLIMIT 1;'))).toBe('East has the highest total revenue: 109,219.5');
  });
  it('says lowest for ascending', () => {
    expect(answerSentence(row, undefined, sql('ORDER BY total_revenue ASC LIMIT 1'))).toBe('East has the lowest total revenue: 109,219.5');
  });
  it('stays neutral when the query does not prove it', () => {
    for (const order of ['', 'LIMIT 1', 'ORDER BY region DESC LIMIT 1', 'ORDER BY total_revenue DESC, region LIMIT 1', 'ORDER BY total_revenue DESC LIMIT 3'])
      expect(answerSentence(row, undefined, sql(order)), order).toBe('East — total revenue: 109,219.5');
    expect(answerSentence(row)).toBe('East — total revenue: 109,219.5');
  });
});

it('spells out common abbreviations in a sentence the owner reads', () => {
  expect(humanLabel('avg_discount_pct')).toBe('Average discount percent');
  expect(humanLabel('total_qty')).toBe('Total quantity');
  expect(humanLabel('revenue_USD')).toBe('Revenue');
  expect(answerSentence(result([[6.4583]], 'avg_discount_pct'))).toBe('Your average discount percent is 6.46.');   // no % unless the owner confirmed the column
});

it('uses "are" for a plural label and "is" otherwise', () => {
  expect(beVerb('Total orders')).toBe('are');
  expect(beVerb('Sales')).toBe('are');
  expect(beVerb('Total revenue')).toBe('is');
  expect(beVerb('Status')).toBe('is');
  expect(beVerb('Gross')).toBe('is');
  expect(beVerb('Analysis')).toBe('is');
  expect(answerSentence(result([[120]], 'total_orders'))).toBe('Your total orders are 120.');
  expect(answerSentence(result([[1000]]))).toBe('Your total revenue is 1,000.');
});
