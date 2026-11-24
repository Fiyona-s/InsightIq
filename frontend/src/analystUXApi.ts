import {request} from './api';
export interface Suggestion {question:string;kind:string;columns:string[]}
export interface Feedback {rating:'helpful'|'not_helpful'|null;reason:string|null;timestamp:string|null}
export const analystUXApi={suggestions:(id:string)=>request<Suggestion[]>(`/datasets/${id}/suggested-questions`),feedback:(id:string)=>request<Feedback>(`/analyst/runs/${id}/feedback`),rate:(id:string,rating:'helpful'|'not_helpful',reason?:string)=>request<Feedback>(`/analyst/runs/${id}/feedback`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating,reason:reason||null})})};
