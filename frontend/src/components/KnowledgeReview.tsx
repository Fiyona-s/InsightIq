import {formatNumber} from "../lib/formatters";
import {ErrorState,LoadingState,EmptyState} from "./WorkspaceStates";
import {scalarExpected} from "../lib/scalarExpected";
import {useEffect,useState} from 'react';
import {reviewApi,type Review,type Draft,type Example} from '../knowledgeReviewApi';
import {Button} from './ui/button';
import {Modal} from './ui/overlay';
const labels:Record<string,string>={candidate:'Candidate',reference_failed:'Reference check failed',approved:'Approved',needs_recheck:'Needs re-check',legacy:'Legacy (not verified)'};
export default function KnowledgeReview({id,archived,onChanged,view='all'}:{id:string;archived:boolean;onChanged:()=>Promise<void>;view?:'all'|'drafts'|'examples'}){
 const [data,setData]=useState<Review|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sharing,setSharing]=useState(false),[rejected,setRejected]=useState(false),[all,setAll]=useState(false),[clearing,setClearing]=useState(false);
 async function reload(){setData(await reviewApi.get(id));}
 useEffect(()=>{let current=true;setData(null);setError('');reviewApi.get(id).then(v=>{if(current)setData(v)}).catch(e=>{if(current)setError(e.message)});return()=>{current=false};},[id]);
 async function act(task:()=>Promise<unknown>){setBusy(true);setError('');try{await task();await reload();await onChanged();}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 // Metric calculations (SQL) are never approved in bulk: each one is read and approved on its own (Stage 6).
 const eligible=data?.drafts.filter(d=>d.item_type!=='metric'&&['draft','edited'].includes(d.status)&&!d.stale&&d.check.passed&&!Object.values(d.current).some(Boolean))||[];
 return <div className="knowledge-review" aria-busy={busy}>
 {busy&&<p role="status">Checking your definitions…</p>}
 {error&&<ErrorState as="p" role="alert">{error}</ErrorState>}
 {!data&&!error&&<LoadingState as="p" role="status">Loading your suggestions…</LoadingState>}
 {view!=='examples'&&<section className="knowledge-draft-actions knowledge-card"><h2>AI drafts</h2><p>Review each suggestion before it becomes one of your definitions.</p>
 {archived?<p role="status">Archived dataset · definitions are read-only</p>:<Button variant="outline" disabled={busy} onClick={()=>setSharing(true)}>Draft with AI</Button>}</section>}
 {sharing&&<Modal open title="Data sharing" label="Draft data sharing" busy={busy} onClose={()=>setSharing(false)} footer={<><Button disabled={busy} variant="outline" onClick={()=>setSharing(false)}>Cancel</Button><Button disabled={busy} onClick={()=>void act(async()=>{await reviewApi.draft(id);setSharing(false)})}>Confirm and draft</Button></>}>
 <p>Review what will be sent to your AI provider.</p>
 <p>This draft sends only the dataset name, column names, inferred types, row counts, null counts and unique counts. No sample values, quality examples or row data.</p></Modal>}
 {data&&<>{view!=='examples'&&<section aria-label="Draft review" className="knowledge-card"><h2>Review drafts</h2>
 <label><input type="checkbox" checked={rejected} onChange={e=>setRejected(e.target.checked)}/> Show rejected drafts</label>
 {!data.drafts.length&&<EmptyState as="p">No drafts yet.</EmptyState>}
 {data.drafts.some(d=>d.status==='rejected')&&!archived&&<Button variant="outline" disabled={busy} onClick={()=>setClearing(true)}>Clear rejected drafts ({formatNumber(data.drafts.filter(d=>d.status==='rejected').length)})</Button>}
 {clearing&&<Modal open title="Clear rejected drafts?" label="Clear rejected drafts" busy={busy} onClose={()=>setClearing(false)} footer={<><Button variant="outline" onClick={()=>setClearing(false)}>Cancel</Button><Button disabled={busy} onClick={()=>void act(async()=>{await reviewApi.clearRejected(id,data.drafts.filter(d=>d.status==='rejected').length);setClearing(false)})}>Confirm clear rejected drafts</Button></>}><p>Clear {formatNumber(data.drafts.filter(d=>d.status==='rejected').length)} rejected drafts? Approved provenance is kept.</p></Modal>}
 {eligible.length>0&&!archived&&<Button variant="outline" disabled={busy} onClick={()=>setAll(true)}>Approve all descriptions ({formatNumber(eligible.length)})</Button>}
 {all&&<Modal open title="Approve all descriptions?" label="Approve all descriptions" busy={busy} onClose={()=>setAll(false)} footer={<><Button variant="outline" onClick={()=>setAll(false)}>Cancel</Button><Button disabled={busy} onClick={()=>void act(async()=>{await reviewApi.all(id,eligible.map(d=>d.id),data.revision);setAll(false)})}>Confirm {formatNumber(eligible.length)} approvals</Button></>}><p>Approve {formatNumber(eligible.length)} suggested descriptions? Metric calculations are not included: approve each metric on its own. Existing values require individual review.</p></Modal>}
 {data.drafts.filter(d=>rejected||d.status!=='rejected').map(d=><DraftItem key={d.id} draft={d} disabled={busy||archived} revision={data.revision} act={task=>act(task)} id={id}/>)}
 </section>}
 {view!=='drafts'&&<details id="knowledge-examples" open className="knowledge-card" aria-label="Verified examples"><summary>Verified examples {formatNumber(data.examples.filter(e=>e.status==='approved').length)}</summary>
 <p>Approval verifies agreement with your independent reference, not general correctness of the question’s meaning.</p>
 {!data.examples.length&&<EmptyState as="p">No examples yet. Propose a completed answer from Ask.</EmptyState>}
 {data.examples.map(e=><ExampleItem key={e.id} example={e} id={id} revision={data.revision} disabled={busy||archived} act={task=>act(task)}/>)}
 </details>}</>}
 </div>;
}
function DraftItem({draft:d,id,revision,disabled,act}:{draft:Draft;id:string;revision:string;disabled:boolean;act:(task:()=>Promise<unknown>)=>Promise<void>}){
 const [editing,setEditing]=useState(false),[content,setContent]=useState(d.content),[replace,setReplace]=useState(false),[rechecked,setRechecked]=useState(false);
 const reviewed=['approved','rejected'].includes(d.status),existing=Object.values(d.current).some(Boolean);
 const approve=()=>act(()=>reviewApi.review(id,d.id,{action:'approve',replace_existing:replace,confirm_revision:revision}));
 return <article className="knowledge-draft"><h3>{d.item_type==='description'?'Dataset description':d.item_key} <small>{({draft:'Suggested',edited:'Edited by you',approved:'Approved',rejected:'Rejected'} as Record<string,string>)[d.status]||d.status}</small></h3>
 {d.stale&&<p role="status">May be out of date</p>}
 <div className="knowledge-diff"><div><h4>Current</h4><pre>{Object.values(d.current).filter(Boolean).join('\n')||'Not set'}</pre></div><div><h4>Proposed</h4>{editing?Object.entries(content).map(([key,value])=><label key={key}>{key}<textarea aria-label={`Edit ${d.item_key} ${key}`} value={value} onChange={e=>setContent({...content,[key]:e.target.value})}/></label>):<pre>{Object.values(d.content).join('\n')}</pre>}</div></div>
 <p>{d.check.message}</p>
 {d.item_type==='metric'&&!reviewed&&<p className="insight-note">A metric is a calculation that runs on your data. Read it above, then approve it on its own.</p>}
 {d.status==='approved'&&<small>Drafted by AI, approved by you on {d.reviewed_at?.slice(0,10)}</small>}
 {!reviewed&&<>
 {d.stale&&<label><input type="checkbox" checked={rechecked} onChange={e=>setRechecked(e.target.checked)}/> I checked this against the latest version of the data</label>}
 {existing&&!editing&&<label><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/> Replace current value</label>}
 {editing?<Button disabled={disabled||(d.stale&&!rechecked)} onClick={()=>void act(async()=>{await reviewApi.review(id,d.id,{action:'edit',content,confirm_revision:revision});setEditing(false)})}>Save and check</Button>:<>
 <Button variant="outline" disabled={disabled||!d.check.passed||(existing&&!replace)||(d.stale&&!rechecked)} onClick={()=>void approve()}>Approve</Button>
 <Button disabled={disabled} variant="outline" onClick={()=>setEditing(true)}>Edit</Button></>}
 <Button disabled={disabled} variant="ghost" onClick={()=>void act(()=>reviewApi.review(id,d.id,{action:'reject'}))}>{existing?'Keep current':'Reject'}</Button>
 </>}
 </article>;
}
function ExampleItem({example:e,id,revision,disabled,act}:{example:Example;id:string;revision:string;disabled:boolean;act:(task:()=>Promise<unknown>)=>Promise<void>}){
 const [kind,setKind]=useState('scalar'),[reference,setReference]=useState(''),[independent,setIndependent]=useState(false),[deleting,setDeleting]=useState(false),[column,setColumn]=useState(''),[type,setType]=useState('DOUBLE');
 return <article className="knowledge-example"><h3>{labels[e.status]||e.status}</h3><p>{e.question}</p><pre>{e.sql}</pre><small>Reference: {e.reference_type||'Not supplied'} · Revision: {e.revision_number||'Unknown'} · Approved: {e.approved_at?.slice(0,10)||'Not approved'}</small>
 {e.check&&<p role="status">{e.check.message}</p>}
 {e.legacy?<Button disabled={disabled} onClick={()=>void act(()=>reviewApi.reverify(id,e.id))}>Re-verify</Button>:e.status!=='approved'&&<fieldset disabled={disabled}>
 <ol className="example-steps" aria-label="Steps to verify this example"><li>Write the answer yourself</li><li>Check it against the example</li><li>Approve it</li></ol>
 <label>Reference type<select value={kind} onChange={v=>setKind(v.target.value)}><option value="scalar">Your own answer (a single value)</option><option value="sql">Reference SQL</option><option value="expected">Typed table (advanced)</option></select></label>
 {kind==='scalar'?<><label>Single value<input value={reference} onChange={v=>setReference(v.target.value)}/></label><label>Column name (optional)<input value={column} onChange={v=>setColumn(v.target.value)} placeholder="value"/></label><label>Value type<select value={type} onChange={v=>setType(v.target.value)}>{['DOUBLE','BIGINT','VARCHAR','BOOLEAN','DATE'].map(t=><option key={t}>{t}</option>)}</select></label><small>Output aliases must match the independently authored reference. Blank column name uses value.</small></>:<label>{kind==='sql'?'Reference SQL':'Expected result JSON'}<textarea aria-label={kind==='sql'?'Reference SQL':'Expected result JSON'} value={reference} onChange={v=>setReference(v.target.value)} placeholder={kind==='sql'?'Your independently written SELECT':'{"columns":[{"name":"total","type":"DOUBLE"}],"rows":[[30]],"row_count":1}'}/></label>}
 <label><input type="checkbox" checked={independent} onChange={v=>setIndependent(v.target.checked)}/> I wrote this reference independently of the candidate SQL</label>
 <Button disabled={disabled||!independent||!reference.trim()} onClick={()=>void act(()=>reviewApi.check(id,e.id,{reference_type:kind==='scalar'?'expected':kind,independently_authored:true,...(kind==='sql'?{reference_sql:reference}:{expected:kind==='scalar'?scalarExpected(reference,column,type):JSON.parse(reference)})}))}>Check reference</Button>
 {e.check&&<p role="status" className="example-check-result">Check result: {e.check.message}</p>}
 <Button variant="outline" disabled={disabled||!e.check?.passed} onClick={()=>void act(()=>reviewApi.approve(id,e.id,revision))}>Approve example</Button>
 </fieldset>}
 <Button disabled={disabled} variant="ghost" onClick={()=>setDeleting(true)}>Delete example</Button>
 {deleting&&<Modal open title="Delete this example?" label="Delete example" busy={disabled} onClose={()=>setDeleting(false)} footer={<><Button variant="outline" onClick={()=>setDeleting(false)}>Cancel</Button><Button variant="danger" disabled={disabled} onClick={()=>void act(()=>reviewApi.remove(id,e.id))}>Confirm delete example</Button></>}><p>Delete this example and remove it from retrieval?</p></Modal>}
 </article>;
}
