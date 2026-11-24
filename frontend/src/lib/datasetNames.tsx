import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {request,type Dataset} from '../api';
export interface DatasetReference {id:string;original_name:string;display_name:string|null;deleted:boolean;archived:boolean;label:string}
const Context=createContext<DatasetReference[]>([]);
export const displayName=(dataset:Dataset)=>dataset.display_name || dataset.name;
export function DatasetNamesProvider({children}:{children:ReactNode}) {
 const [references,setReferences]=useState<DatasetReference[]>([]);
 useEffect(()=>{let current=true;let version=0;const refresh=()=>{const requestVersion=++version;void request<DatasetReference[]>('/datasets/references').then(v=>{if(current&&requestVersion===version)setReferences(v)}).catch(()=>{});};refresh();window.addEventListener('insightiq:datasets-changed',refresh);return()=>{current=false;window.removeEventListener('insightiq:datasets-changed',refresh)};},[]);
 return <Context.Provider value={references}>{children}</Context.Provider>;
}
export function useDatasetNames(){const refs=useContext(Context);return {references:refs,label:(id:string,original:string,provenance=false)=>{const ref=refs.find(r=>r.id===id);if(!ref)return original;if(ref.deleted)return ref.label;return ref.display_name && provenance ? `${ref.display_name} (${ref.original_name})` : ref.label;},unavailable:(id:string)=>refs.some(r=>r.id===id&&(r.archived||r.deleted))};}
