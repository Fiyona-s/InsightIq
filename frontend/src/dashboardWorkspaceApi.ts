import {request} from './api';
import type {Dashboard,SavedChart} from './phase4api';
const body=(value:unknown,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
export interface Attachment {duplicate:boolean;matches:string[];dashboard:Dashboard}
export interface Previous {id:string;chart:SavedChart;retained_at:string;reason:string}
export const dashboardWorkspaceApi={
 title:(id:string,widget:string,title:string|null,revision:number)=>request<Dashboard>(`/dashboards/${id}/widgets/${widget}/title`,body({title,revision},'PATCH')),
 attach:(id:string,chart_id:string,revision:number,duplicate_action='cancel',replace_widget_id?:string)=>request<Attachment>(`/dashboards/${id}/charts`,body({chart_id,revision,duplicate_action,replace_widget_id})),
 refresh:(id:string,widget:string,revision:number,expected_result_hash?:string)=>request<Dashboard>(`/dashboards/${id}/widgets/${widget}/refresh`,body({confirm_refresh:true,revision,expected_result_hash})),
 all:(id:string,revision:number)=>request<{results:{id:string;status:string;error:string|null}[];dashboard:Dashboard}>(`/dashboards/${id}/refresh-all`,body({confirm_refresh:true,revision})),
 history:(id:string,widget:string)=>request<{limit:number;snapshots:Previous[]}>(`/dashboards/${id}/widgets/${widget}/history`),
 duplicate:(id:string,widget:string)=>request<Dashboard>(`/dashboards/${id}/widgets/${widget}/duplicate`,body({})),
};
