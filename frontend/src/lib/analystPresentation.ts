import {displayAmount} from './displayNumber';
import type {AnalystResults,ChartData,EvidenceFact} from '../api';
import {displayMoney} from './currency';
type DisplayState=NonNullable<Parameters<typeof displayMoney>[2]>;
import {formatNumber} from './formatters';
/** "is" or "are": a label whose last word is a plural noun ("total orders", "sales") takes "are". */
export function beVerb(label:string){const w=(label.trim().split(' ').pop()||'').toLowerCase();return /(ss|us|is|ics)$/.test(w)?'is':/s$/.test(w)?'are':'is';}
const ABBREVIATIONS:Record<string,string>={avg:'average',pct:'percent',qty:'quantity'};
export function humanLabel(name:string){const text=name.replace(/_(INR|USD|EUR|GBP|AED|CAD|AUD|JPY|SGD)$/i,'').replaceAll('_',' ').trim().split(' ').map(w=>ABBREVIATIONS[w.toLowerCase()]??w).join(' ');return text?text[0].toUpperCase()+text.slice(1):'Result';}
const numeric=(type:string)=>/INT|DOUBLE|FLOAT|DECIMAL|REAL/i.test(type);
/** "highest"/"lowest" only when the executed query itself sorts that measure (one sort key) and keeps one row. A fact about the query, never a guess. */
export function rankWord(sql:string|undefined,measure:string):'highest'|'lowest'|null{
 if(!sql)return null;
 const flat=sql.replace(/\s+/g,' ').replace(/;\s*$/,'');
 const m=/\bORDER BY ([^,]+?) (ASC|DESC)(?: NULLS (?:FIRST|LAST))? LIMIT 1$/i.exec(flat);
 if(!m)return null;
 const expr=m[1].trim().replace(/"/g,''),alias=measure.replace(/"/g,'');
 const escaped=m[1].trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const aliased=new RegExp(escaped+' AS "?'+alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"?(?:,| FROM)','i').test(flat);
 if(expr.toLowerCase()!==alias.toLowerCase()&&!aliased)return null;
 return m[2].toUpperCase()==='DESC'?'highest':'lowest';
}
export function answerSentence(result:AnalystResults,state?:DisplayState,sql?:string){
 if(!result.row_count)return 'No rows matched this question.';
 if(result.row_count===1&&result.columns.length===1){if(!result.rows.length)return 'One result is available in the data table.';const c=result.columns[0],v=result.rows[0][0];return v==null?`Your ${humanLabel(c.name).toLowerCase()} is unavailable because this query returned no value.`:`Your ${humanLabel(c.name).toLowerCase()} ${beVerb(humanLabel(c.name))} ${displayAmount(v,c.money,state,c.type,c.percent)}.`;}
 const measure=result.columns.find(c=>numeric(c.type)),category=result.columns.find(c=>!numeric(c.type));
 // One row with several columns (for example "which region has the most revenue"): say what the row is,
 // using only its own values. Nothing is added about why it is that row.
 if(result.row_count===1&&result.rows.length===1&&result.columns.length>1){
  const row=result.rows[0],shown=result.columns.map((c,i)=>row[i]==null?'no value':displayAmount(row[i],c.money,state,c.type,c.percent));
  if(measure&&category&&result.columns.length===2){const ci=result.columns.indexOf(category),mi=result.columns.indexOf(measure);const rank=rankWord(sql,measure.name);return rank?`${shown[ci]} has the ${rank} ${humanLabel(measure.name).toLowerCase()}: ${shown[mi]}`:`${shown[ci]} — ${humanLabel(measure.name).toLowerCase()}: ${shown[mi]}`;}
  return result.columns.map((c,i)=>`${humanLabel(c.name).toLowerCase()}: ${shown[i]}`).join(' · ');
 }
 const rows=`${formatNumber(result.row_count)} ${result.row_count===1?'row':'rows'}`;
 if(measure&&category){const label=humanLabel(measure.name)+' by '+humanLabel(category.name).toLowerCase();return `${label[0].toUpperCase()+label.slice(1)}: ${rows}.`;}
 return `${rows} with ${result.columns.map(c=>humanLabel(c.name).toLowerCase()).join(', ')}.`;
}
export function findings(result:AnalystResults,chart:ChartData,facts:EvidenceFact[],state?:DisplayState){
 if(result.row_count<2)return [];
 const top=facts.find(f=>f.method==='top_n');if(!top)return [];
 const point=chart.points.find(p=>p.row===top.source.rows[0]);const column=result.columns[top.source.columns[0]];
 if(!point?.label||!column)return [];
 return [{id:top.id,text:`${point.label} is highest at ${displayAmount(point.value,column.money,state,column.type,column.percent)}.`}];
}
export function calculationSteps(rows:number,sql:string,converted:boolean){return ['Read the selected dataset.',...(converted?['Used your confirmed column types.']:[]),...(/\bWHERE\b/i.test(sql)?['Kept the rows matching your filters.']:[]),...(/\bGROUP BY\b/i.test(sql)?['Grouped the rows by the requested categories.']:[]),...(/\b(SUM|AVG|COUNT|MIN|MAX)\s*\(/i.test(sql)?['Calculated the requested measure from those rows.']:[]),`Returned ${formatNumber(rows)} ${rows===1?'row':'rows'}.`];}
export function errorReason(code?:string|null){
 if(code==='timeout')return 'The query took too long. Try a narrower question.';
 if(code==='result_limit')return 'The result is too large. Ask for a summary or fewer rows.';
 if(code==='not_configured'||code==='configuration_error')return 'The AI provider is not configured. Check the local provider settings before retrying.';
 if(code==='provider_auth')return 'The configured AI provider denied access. Check its credentials or model permissions.';
 if(code==='provider_rate_limit')return 'The AI provider has reached its rate or credit limit. Try again later.';
 if(code?.startsWith('provider_'))return 'The configured AI provider is unavailable or could not prepare a query. Try again or edit your question.';
 if(code==='validation_error'||code==='repeated_sql')return 'We could not form a safe query. Try a clearer measure or a narrower question.';
 return 'We could not complete this question. Review it and your confirmed types, then try again.';
}

/** Two or more groups sharing the top value are said to be tied (never one picked silently). Only when every row is loaded. */
function topTie(result:AnalystResults,state?:DisplayState){
 const measure=result.columns.find(c=>numeric(c.type)),category=result.columns.find(c=>!numeric(c.type));
 if(!measure||!category||result.row_count<2||result.rows.length!==result.row_count)return null;
 const mi=result.columns.indexOf(measure),ci=result.columns.indexOf(category);
 const values=result.rows.map(r=>r[mi]),nums=values.map(v=>typeof v==='number'?v:v==null||v===''?NaN:Number(v));
 if(nums.some(n=>Number.isNaN(n)))return null;
 const top=Math.max(...nums),leaders=result.rows.filter((_,i)=>nums[i]===top).map(r=>String(r[ci]));
 if(leaders.length<2)return null;
 const shown=displayAmount(values[nums.indexOf(top)],measure.money,state,measure.type,measure.percent);
 const label=humanLabel(measure.name)+' by '+humanLabel(category.name).toLowerCase();
 const head=label[0].toUpperCase()+label.slice(1);
 if(leaders.length===result.row_count)return `${head}: all ${formatNumber(leaders.length)} are ${shown}.`;
 const names=leaders.length===2?leaders.join(' and '):leaders.slice(0,-1).join(', ')+' and '+leaders[leaders.length-1];
 return `${head}: ${names} are tied for highest at ${shown}.`;
}
/** The one lead sentence of an answer. When a source-linked top finding exists, it completes the sentence ("Revenue by region: West is highest at 2,100."); otherwise the plain row summary stands alone. Nothing is added that the data and its evidence do not state. */
export function leadSentence(answer:string,notes:{text:string}[],result?:AnalystResults,state?:DisplayState){const tie=result?topTie(result,state):null;if(tie)return tie;const m=/^(.*): [\d,]+ rows?\.$/.exec(answer);return m&&notes[0]?`${m[1]}: ${notes[0].text}`:answer;}
