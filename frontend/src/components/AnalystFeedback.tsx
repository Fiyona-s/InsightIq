import {ErrorState} from "./WorkspaceStates";
import {useEffect,useState} from 'react';
import {analystUXApi,type Feedback} from '../analystUXApi';
import {Button} from './ui/button';
export default function AnalystFeedback({runId}:{runId:string}){
 const [feedback,setFeedback]=useState<Feedback|null>(null),[open,setOpen]=useState(false),[category,setCategory]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let current=true;analystUXApi.feedback(runId).then(v=>{if(current)setFeedback(v)}).catch(()=>{});return()=>{current=false};},[runId]);
 async function save(rating:'helpful'|'not_helpful'){setBusy(true);setError('');try{setFeedback(await analystUXApi.rate(runId,rating,rating==='not_helpful'?[category,reason].filter(Boolean).join(': '):undefined));setOpen(false)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="analyst-feedback"><Button variant="ghost" aria-pressed={feedback?.rating==='helpful'} disabled={busy} onClick={()=>void save('helpful')}>Helpful</Button><Button variant="ghost" aria-pressed={feedback?.rating==='not_helpful'} disabled={busy} onClick={()=>setOpen(true)}>Not helpful</Button>{feedback?.rating&&<small role="status">Feedback saved</small>}{open&&<section aria-label="Feedback reason"><p>What could be better? (optional)</p><div className="analyst-chips">{['Wrong number','Wrong columns','Misunderstood question','Other'].map(c=><Button key={c} variant="outline" aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</Button>)}</div><label>Additional feedback<textarea value={reason} maxLength={500-(category?category.length+2:0)} onChange={e=>setReason(e.target.value)} /></label><Button disabled={busy} onClick={()=>void save('not_helpful')}>Save feedback</Button><Button variant="ghost" disabled={busy} onClick={()=>setOpen(false)}>Cancel feedback</Button></section>}{error&&<ErrorState as="p" role="alert">{error}</ErrorState>}</div>;
}
