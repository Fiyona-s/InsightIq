import {formatDisplayNumber} from './displayNumber';
import type {KeyboardEvent} from 'react';
import {formatNumber} from './formatters';
const statuses:Record<string,string>={succeeded:'Completed',failed:'Failed',cancelled:'Cancelled',clarification:'Needs clarification',queued:'Queued',generating:'Preparing answer',executing:'Running query',passed:'Passed',rejected:'Rejected',started:'Started',completed:'Completed',running:'In progress',stopped:'Stopped'};
export function runStatusLabel(value:string){return statuses[value]||value.replaceAll('_',' ')}
export function stepLabel(value:string){return ({retrieve_context:'Find context',plan:'Plan query',generate_sql:'Prepare SQL',retrieve:'Find context',generate:'Prepare SQL',validate:'Check SQL rules',execute:'Run query',repair:'Revise SQL',clarify:'Request clarification',narrate:'Summarize results',finish:'Finish run'} as Record<string,string>)[value]||value.replaceAll('_',' ')}
export function estimatedCost(value:number|null|undefined){return value==null||!Number.isFinite(value)?'Unknown':'$'+formatDisplayNumber(value)}
export function moveListFocus(event:KeyboardEvent<HTMLElement>,selector:string){
 if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
 const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(selector));const index=buttons.indexOf(event.target as HTMLButtonElement);if(index<0)return;
 event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)));buttons[next]?.focus();
}
