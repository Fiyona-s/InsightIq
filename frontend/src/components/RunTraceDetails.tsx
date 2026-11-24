import {useId,useState} from 'react';
import type {AnalystRun} from '../api';
import {formatDate,formatNumber} from '../lib/formatters';
import {useDatasetNames} from '../lib/datasetNames';
import {estimatedCost,runStatusLabel,stepLabel,moveListFocus} from '../lib/runPresentation';
import {WorkflowInspector,SQLCode,RetrievalPanel} from './RunInsights';
// Each step is recorded twice (when it started and when it finished): label the events, never merge or hide them.
const eventStage=(status:string)=>{const label=runStatusLabel(status as never);return label==='In progress'?'Started':label==='Completed'?'Finished':label};
export default function RunTraceDetails({run,connection}:{run:AnalystRun;connection?:string}){
 const [eventId,setEventId]=useState<number|undefined>(run.events?.[0]?.id);const detailId=useId();const events=run.events||[];const event=events.find(e=>e.id===eventId)||events[0];
 const sql=run.executed_sql||run.sql;
 const summary=run.status==='succeeded'?'Execution completed. This does not establish answer accuracy.':run.status==='failed'?'The run failed. Recorded errors are available in Technical details.':run.status==='cancelled'?'The saved run is marked cancelled.':run.status==='clarification'?'The run needs clarification before it can answer.':'This run is still in progress.';
 const source=useDatasetNames().references.find(r=>r.id===run.dataset_id);
 const technical={id:run.id,dataset_id:run.dataset_id,dataset_name:run.dataset_name,status:run.status,current_step:run.current_step,error:run.error,error_code:run.error_code,sql:run.sql,executed_sql:run.executed_sql,type_mapping:run.type_mapping,conversions:run.conversions,attempt_history:run.attempt_history,events:run.events,metrics:run.metrics,result_metadata:run.result_metadata,retrieval:run.retrieval,pipeline:run.pipeline,prompt_version:run.prompt_version,prompt_hash:run.prompt_hash,workflow_version:run.workflow_version};
 return <div className="recorded-trace">
 {source?.archived&&<p className="insight-note">Archived dataset · historical run</p>}
 <p className="trace-outcome" role={run.status==='failed'?'alert':undefined}>{summary}</p>
 {run.clarification&&<p>Clarification: {run.clarification}</p>}
 <p className="insight-note">Started {formatDate(run.created_at,'datetime')} · {run.completed_at?'Completed '+formatDate(run.completed_at,'datetime'):'Completion time not recorded'}</p>
 <dl className="trace-metrics">
 <div><dt>Attempts</dt><dd>{run.attempts==null?'Unknown':formatNumber(run.attempts)}</dd></div>
 <div><dt>Total latency</dt><dd>{run.metrics.total_latency_ms==null?'Not recorded':formatNumber(run.metrics.total_latency_ms)+' ms'}</dd></div>
 <div><dt>Reported tokens</dt><dd>{run.metrics.total_tokens==null?'Unknown':formatNumber(run.metrics.total_tokens)}</dd></div>
 <div><dt>Estimated cost (USD)</dt><dd>{estimatedCost(run.metrics.estimated_cost_usd)}</dd></div>
 <div><dt>Model</dt><dd>{run.metrics.model||'Not recorded'}</dd></div>
 <div><dt>Result metadata</dt><dd>{run.result_metadata?formatNumber(run.result_metadata.row_count)+' rows · '+formatNumber(run.result_metadata.columns.length)+' columns':'No stored result metadata'}</dd></div>
 </dl>
 <section className="recorded-timeline" aria-label="Step timeline"><h3>Step timeline</h3><p className="insight-note">Recorded workflow events, not the model's internal reasoning. Each step appears twice: once when it started and once when it finished.</p>
 {events.length?<><ol onKeyDown={e=>moveListFocus(e,'button')} aria-label="Recorded steps">{events.map((e,i)=><li key={e.id}><button aria-pressed={event?.id===e.id} aria-controls={detailId} onClick={()=>setEventId(e.id)}><strong>{formatNumber(i+1)}. {stepLabel(e.step)}</strong><span>{eventStage(e.status)} · Attempt {formatNumber(e.attempt)}</span></button></li>)}</ol>
 <section id={detailId} className="trace-event-detail" aria-label="Selected step"><h4>{stepLabel(event.step)}</h4><p>{event.summary}</p><small>{formatDate(event.timestamp,'datetime')} · {eventStage(event.status)}</small><details><summary>Recorded event JSON</summary><pre tabIndex={0}>{JSON.stringify(event,null,2)}</pre></details></section></>:<p>No detailed workflow events were retained for this historical run.</p>}
 </section>
 {sql&&<details className="sql-viewer"><summary>{run.executed_sql?'Executed SQL':'Generated SQL — execution not completed'}</summary><pre tabIndex={0}><SQLCode sql={sql}/></pre></details>}
 <details className="trace-technical"><summary>Technical details</summary>{run.error&&<section><h3>Recorded error</h3><p>{run.error}</p><small>{run.error_code||'Error code not recorded'}</small></section>}<WorkflowInspector run={run} connection={connection}/>{run.retrieval&&<RetrievalPanel retrieval={run.retrieval}/>}<details><summary>Recorded trace JSON</summary><pre tabIndex={0}>{JSON.stringify(technical,null,2)}</pre></details></details>
 </div>;
}
