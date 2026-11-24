/** Builds the existing typed table contract; the server comparator remains authoritative. */
export function scalarExpected(value:string,column='',type='DOUBLE'){
 if(!value.trim())throw Error('Enter a value.');
 let cell:string|boolean|null=value;
 if(value.trim()==='NULL')cell=null;
 else if(type==='DOUBLE'||type==='BIGINT'){
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())||!Number.isFinite(Number(value)))throw Error('Enter a finite number.');
  if(type==='BIGINT'&&!/^[+-]?\d+$/.test(value.trim()))throw Error('Enter an integer.');
  cell=value.trim(); // Decimal strings preserve precision; existing validation/comparator accepts them.
 }else if(type==='BOOLEAN'){
  if(!['true','false'].includes(value.trim().toLowerCase()))throw Error('Enter true or false.');cell=value.trim().toLowerCase()==='true';
 }else if(type==='DATE'&&!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Use an ISO date: YYYY-MM-DD.');
 return {columns:[{name:column.trim()||'value',type}],rows:[[cell]],row_count:1};
}
