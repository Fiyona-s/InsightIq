import {useEffect} from 'react';
/** Complements native dialogs; applies one keyboard policy to existing custom dialogs. */
export default function DialogAccessibility(){useEffect(()=>{
 let current:HTMLElement|null=null,opener:HTMLElement|null=null,lastOutside=document.activeElement as HTMLElement|null;
 const visible=()=>Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(d=>d.tagName!=='DIALOG'&&d.getClientRects().length).at(-1)||null;
 const controls=(dialog:HTMLElement)=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')).filter(el=>el.getClientRects().length);
 function sync(){const next=visible();if(next===current)return;if(current&&!next){if(opener?.isConnected)opener.focus();opener=null}if(next){opener=current?opener:lastOutside;next.setAttribute('aria-modal','true');if(!next.contains(document.activeElement))(controls(next)[0]||next).focus()}current=next;}
 const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','style']});
 function focus(e:FocusEvent){if(!current&&!((e.target as HTMLElement).closest('[role="dialog"],dialog')))lastOutside=e.target as HTMLElement}
 function key(e:KeyboardEvent){if(!current)return;const nodes=controls(current),first=nodes[0],last=nodes.at(-1);if(e.key==='Tab'){if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}if(e.key==='Escape'){const cancel=nodes.find(n=>/^(cancel|close|keep editing|stay)/i.test(n.textContent?.trim()||''));if(cancel){e.preventDefault();cancel.click()}}}
 document.addEventListener('focusin',focus);document.addEventListener('keydown',key);sync();return()=>{observer.disconnect();document.removeEventListener('focusin',focus);document.removeEventListener('keydown',key)};
 },[]);return null}
