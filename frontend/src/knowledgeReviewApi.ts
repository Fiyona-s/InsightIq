import {request} from './api';
export interface Draft {id:string;item_type:'description'|'column'|'metric';item_key:string;content:Record<string,string>;current:Record<string,unknown>;status:string;revision:string;stale:boolean;check:{passed:boolean;message:string};reviewed_at:string|null;provenance:{source:string;model:string;prompt_version:string}}
export interface Example {id:string;question:string;sql:string;status:string;reference_type:string|null;revision:string;revision_number?:number;approved_at:string|null;legacy?:boolean;check?:{passed:boolean;message:string}}
export interface Review {revision:string;drafts:Draft[];examples:Example[]}
const path=(id:string)=>`/datasets/${id}/knowledge`;
const body=(value:unknown,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
export const reviewApi={
 clearRejected:(id:string,count:number)=>request<{cleared_count:number}>(path(id)+'/drafts/clear-rejected',body({confirm:true,confirm_count:count})),
 get:(id:string)=>request<Review>(path(id)+'/review'),
 draft:(id:string)=>request<Draft[]>(path(id)+'/drafts',body({confirm_sharing:true})),
 review:(id:string,key:string,value:unknown)=>request<Draft[]>(path(id)+'/drafts/'+key,body(value,'PATCH')),
 all:(id:string,ids:string[],revision:string)=>request<Draft[]>(path(id)+'/drafts/approve-all',body({ids,confirm_count:ids.length,confirm_revision:revision})),
 propose:(id:string,runId:string)=>request<Example>(path(id)+'/candidates',body({run_id:runId})),
 check:(id:string,key:string,value:unknown)=>request<Example>(path(id)+'/candidates/'+key+'/check',body(value)),
 approve:(id:string,key:string,revision:string)=>request<Example>(path(id)+'/candidates/'+key+'/approve',body({approve:true,revision})),
 remove:(id:string,key:string)=>request(path(id)+'/candidates/'+key,body({confirm:true},'DELETE')),
 reverify:(id:string,key:string)=>request<Example>(path(id)+'/legacy/'+key+'/reverify',body({})),
};
