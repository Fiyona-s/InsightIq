"""Explicit local AutoML demonstration. No model-provider or embedding calls.

Uses a suitable registered retail dataset. Output is a measured summary, not raw
customer data. Run manually; nothing invokes this script during app startup.
"""
import argparse,json,time,urllib.request
from pathlib import Path
from urllib.parse import urlencode,urlsplit

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--api-base',default='http://127.0.0.1:8000/api');parser.add_argument('--dataset-id');parser.add_argument('--output',default='docs/PHASE6_AUTOML_DEMO_RESULTS.json');args=parser.parse_args()
    url=urlsplit(args.api_base)
    if url.hostname not in {'localhost','127.0.0.1','::1'}:parser.error('Demo API must be a local InsightIQ instance.')
    base=args.api_base.rstrip('/')
    def api(path,body=None):
        data=None if body is None else json.dumps(body).encode();request=urllib.request.Request(base+path,data=data,headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=130) as response:return json.load(response)
    datasets=api('/datasets');dataset=next((d for d in datasets if d['id']==args.dataset_id),None) if args.dataset_id else next((d for d in datasets if d['rows']>=60 and 'Retail_Demo' in d['name']),None)
    if not dataset:parser.error('Select a suitable registered retail dataset with --dataset-id; see the guide for synthetic fixture alternatives.')
    names={c['name'] for c in dataset['columns']};required={'customer_id','order_id','order_date','quantity','unit_price_inr','discount_pct','net_revenue_inr','order_status'}
    if not required.issubset(names):parser.error('Retail demo requires '+', '.join(sorted(required))+'; use the documented synthetic fixture path for other schemas.')
    features=[{'name':n,'kind':'numeric' if n in {'quantity','unit_price_inr','discount_pct'} else 'categorical'} for n in ['quantity','unit_price_inr','discount_pct','region','category','sales_channel'] if n in names]
    preview=api('/datasets/'+dataset['id']+'/preview?limit=1');first=dict(zip(preview['columns'],preview['rows'][0]))
    p=api('/automl/datasets/'+dataset['id']+'/profile?'+urlencode({'task':'regression','target':'net_revenue_inr'}))
    if not p['readiness']['ready']:raise RuntimeError('Retail dataset is unsuitable: '+' '.join(p['readiness']['reasons']))
    summary={'notice':'Actual local ML results on the explicitly selected registered retail dataset. No new LLM/provider/embedding calls. Single-record demonstration reuses a source row and is not a held-out evaluation. IID supervised splits do not establish future forecasting performance.','dataset':{'id':dataset['id'],'name':dataset['name'],'rows':dataset['rows'],'fingerprint':p['fingerprint'],'profile_sample':p['sampled_rows']},'experiments':[],'new_provider_calls':0,'new_embedding_calls':0}
    configs=[
        {'task':'regression','target':'net_revenue_inr','target_unit':'INR','features':features},
        {'task':'classification','target':'order_status','features':features},
        {'task':'clustering','features':[],'clusters':4,'rfm':{'customer':'customer_id','date':'order_date','amount':'net_revenue_inr','order':'order_id'}},
        {'task':'anomaly','features':[{'name':n,'kind':'numeric'} for n in ['quantity','unit_price_inr','net_revenue_inr']]},
        {'task':'forecasting','target_unit':'INR','features':[],'forecast':{'date_column':'order_date','measure':'net_revenue_inr','frequency':'day','missing_periods':'zero','horizon':7,'seasonal_period':7}},
    ]
    for cfg in configs:
        task=cfg['task'];configuration={'dataset_id':dataset['id'],'title':'Phase 6 retail — '+task,'seed':42,'confirm_feature_availability':True,**cfg}
        print('Training local',task,'(explicit configuration; no provider calls)',flush=True)
        job=api('/automl/experiments',configuration);deadline=time.monotonic()+135
        while time.monotonic()<deadline:
            job=api('/automl/experiments/'+job['id'])
            if job['status'] in {'completed','failed','cancelled'}:break
            time.sleep(.4)
        if job['status']!='completed':raise RuntimeError(task+' did not complete: '+str(job.get('error')))
        result=job['result'];model=api('/automl/models/'+result['selected_model_id'])
        if task=='forecasting':prediction=api('/automl/models/'+model['id']+'/predict',{'horizon':7})
        elif task in {'clustering','anomaly'}:prediction=api('/automl/models/'+model['id']+'/predict',{'dataset_id':dataset['id']})
        else:prediction=api('/automl/models/'+model['id']+'/predict',{'records':[{f['name']:first[f['name']] for f in cfg['features']}]})
        entry={'task':task,'experiment_id':job['id'],'configuration':job['configuration'],'status':job['status'],'duration_seconds':job['duration_seconds'],'rows_used':result['rows_used'],'selection_metric':result['selection_metric'],'selection_split':result['selection_split'],'leaderboard':result['leaderboard'],'model_registry':model,'scope':result['scope'],'warnings':result['warnings'],'prediction':{'id':prediction['id'],'row_count':prediction['row_count'],'scope':prediction['scope'],'export':'/api/automl/predictions/'+prediction['id']+'/export.csv'}}
        if task=='clustering':entry['rfm']={k:result['details'].get(k) for k in ['reference_date','frequency_definition','cluster_profiles','pca_explained_variance']}
        if task=='forecasting':entry['backtests']=result['details']['backtests'];entry['filled_period_count']=len(result['details']['missing_periods'])
        if task in {'regression','classification'}:entry['split_counts']={k:v['count'] for k,v in result['split'].items()}
        if task=='regression':
            batch=api('/automl/models/'+model['id']+'/predict',{'dataset_id':dataset['id']});entry['batch_prediction']={'id':batch['id'],'row_count':batch['row_count'],'scope':batch['scope'],'export':'/api/automl/predictions/'+batch['id']+'/export.csv'}
        summary['experiments'].append(entry)
        Path(args.output).write_text(json.dumps(summary,indent=2,allow_nan=False)+'\n')
        chosen=next(r for r in result['leaderboard'] if r['selected']);print(task,chosen['algorithm'],chosen['test_metrics'] or chosen['training_metrics'],flush=True)
    print('Saved actual measured summary:',args.output,flush=True)
if __name__=='__main__':main()
