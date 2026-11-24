import {useDatasetNames} from '../lib/datasetNames';
import {middleEllipsis} from '../lib/filenames';
export default function DatasetName({name,datasetId,provenance=false,max=32}:{name:string;datasetId?:string;provenance?:boolean;max?:number}) {
  const names=useDatasetNames();
  if(datasetId)name=names.label(datasetId,name,provenance);
  const display = middleEllipsis(name,max);
  const cut = display.includes('…') ? display.indexOf('…') + 1 : Math.max(0, display.lastIndexOf('.'));
  return <span className="dataset-name" title={name}>
    <span className="dataset-name-prefix" aria-hidden="true">{display.slice(0,cut)}</span>
    <span className="dataset-name-suffix" aria-hidden="true">{display.slice(cut)}</span>
    <span className="sr-only">{name}</span>
  </span>;
}
