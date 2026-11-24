import {request,type Dataset} from './api';
export interface Dependency {id:string;title:string;timestamp:string|null}
export interface Dependencies {dataset_id:string;name:string;original_name:string;groups:Record<string,Dependency[]>;counts:Record<string,number>;has_dependencies:boolean;delete_blocked:boolean;benchmark_required:boolean;benchmark_warning:string|null}
export interface Confirmation {confirm_name:string;acknowledge_dependencies:boolean;acknowledge_benchmark:boolean}
export interface Outcome {id:string;status:'success'|'blocked'|'failed';reason:string|null}
const body=(value:unknown,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
export const lifecycleApi={
 dependencies:(id:string)=>request<Dependencies>(`/datasets/${id}/dependencies`),
 rename:(id:string,name:string)=>request<Dataset>(`/datasets/${id}`,body({display_name:name},'PATCH')),
 archive:(id:string)=>request<Dataset>(`/datasets/${id}/archive`,body({})),
 restore:(id:string)=>request<Dataset>(`/datasets/${id}/restore`,body({})),
 delete:(id:string,confirmation:Confirmation)=>request<void>(`/datasets/${id}`,body(confirmation,'DELETE')),
 /** Sample data is whatever the owner marks; nothing is guessed from a file name. */
 setSample:(id:string,isSample:boolean)=>request<Dataset>(`/datasets/${id}/sample`,body({is_sample:isSample},'PUT')),
 bulkSample:(ids:string[],isSample:boolean)=>request<{updated:number;is_sample:boolean}>('/datasets/bulk-sample',body({ids,is_sample:isSample})),
 bulkArchive:(ids:string[])=>request<Outcome[]>('/datasets/bulk-archive',body({ids})),
 bulkDelete:(items:(Confirmation&{id:string})[])=>request<Outcome[]>('/datasets/bulk-delete',body({items,confirm_word:'DELETE',confirm_count:items.length})),
};
