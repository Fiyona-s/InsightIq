"""Read-only input hints reconstructed from recorded training rows. Never loads/fits a model."""
from fastapi import APIRouter, HTTPException
from uuid import UUID
from .data import read_dataset, missing, number, MLFailure


def input_schema(service, identifier):
    model = service.registered_model(identifier)
    job = service.store.get('MLExperiment', model['experiment_id'])
    output = {'model_id': model['id'], 'dataset_name': job['dataset_name'], 'dataset_fingerprint': model['dataset_fingerprint'],
              'source_status': 'unavailable', 'scope': 'Training ranges/categories not recorded or unavailable.',
              'features': [{**f, 'minimum': None, 'maximum': None, 'categories': [], 'hints_recorded': False} for f in model['feature_schema']]}
    try:
        with service.analyst.knowledge.lock:
            data = read_dataset(service.analyst, model['dataset_id'], allow_archived=True)
        if data['fingerprint'] != model['dataset_fingerprint']:
            output['source_status'] = 'changed'; return output
        output['source_status'] = 'matches recorded fingerprint'
        split = (job.get('result') or {}).get('split', {})
        indices = split.get('train', {}).get('row_indices')
        if indices is None and split.get('held_out') is False and not model['configuration'].get('rfm'):
            indices = list(range(len(data['rows'])))
        if indices is None: return output
        if any(type(i) is not int or i < 0 or i >= len(data['rows']) for i in indices): return output
        for feature in output['features']:
            if feature['name'] not in data['columns']: continue
            column = data['columns'].index(feature['name'])
            values = [data['rows'][i][column] for i in indices if not missing(data['rows'][i][column])]
            if feature['kind'] == 'numeric':
                finite = [number(v) for v in values]
                feature.update(minimum=min(finite) if finite else None, maximum=max(finite) if finite else None)
            elif feature['kind'] == 'categorical':
                feature['categories'] = sorted({str(v) for v in values})[:100]
            feature['hints_recorded'] = bool(values)
        output['scope'] = 'Reconstructed from stored source rows and recorded training split indices; source fingerprint matches. Hints only, not validation bounds.'
    except (HTTPException, MLFailure, ValueError, TypeError): pass
    return output


def router(service):
    api = APIRouter(prefix='/api/automl', tags=['AutoML presentation'])
    @api.get('/models/{identifier}/input-schema')
    def schema(identifier: UUID): return input_schema(service, identifier)
    from .contracts import TrainRequest
    @api.post('/validate-configuration')
    def validate(body:TrainRequest): return check_configuration(service,body)
    from .contracts import PredictRequest
    @api.post('/models/{identifier}/validate-input')
    def validate_input(identifier:UUID,body:PredictRequest): return validate_prediction(service,identifier,body)
    return api


def check_configuration(service, body):
    """Reuse existing admission/shape/split checks; never preprocesses or fits."""
    import json
    import numpy as np
    from .data import validate_features
    from .preprocessing import feature_array
    from .engine import supervised_split, rfm_data
    from .forecasting import aggregate
    config=body.model_dump(mode='json')
    try:
        data=service.snapshot(body.dataset_id)
        validate_features(data,config)
        if body.task in {'regression','classification'}:
            target=data['columns'].index(body.target)
            rows=[i for i,r in enumerate(data['rows']) if not missing(r[target])]
            x=feature_array(data,config['features'])[rows]
            y=np.array([number(data['rows'][i][target]) if body.task=='regression' else str(data['rows'][i][target]) for i in rows])
            supervised_split(x,y,body.task,body.seed,config['features'])
        elif body.task=='forecasting':
            _,values,_=aggregate(data,config['forecast'])
            maximum=min(30,max(0,(len(values)-12)//3))
            if body.forecast.horizon>maximum:raise MLFailure(f'Only {len(values)} periods available. Maximum horizon is {maximum}; three holdout windows need 12 earlier periods.')
        else:
            features=config['features']
            if config.get('rfm'):data,features,_=rfm_data(data,config)
            minimum=12 if body.task=='clustering' else 20
            if len(data['rows'])<minimum:raise MLFailure(f'Too few rows or customers to train (minimum {minimum}).')
            x=feature_array(data,features)
            if body.task=='clustering' and len({json.dumps(r.tolist(),default=str) for r in x})<body.clusters:raise MLFailure('Fewer distinct feature rows than requested clusters.')
        return {'ready':True,'reasons':[]}
    except (MLFailure,HTTPException,ValueError,TypeError) as exc:
        return {'ready':False,'reasons':[str(exc.detail) if isinstance(exc,HTTPException) else str(exc)]}


def validate_prediction(service, identifier, body):
    """Mirror the existing worker's scalar checks without loading an artifact or predicting."""
    from .data import moment
    model=service.registered_model(identifier)
    try:
        source=read_dataset(service.analyst,model['dataset_id'])
        if source['fingerprint']!=model['dataset_fingerprint']:raise HTTPException(409,'Training dataset fingerprint changed. Retrain before using this model.')
        if model['task']=='forecasting' and body.horizon is None:raise HTTPException(422,'Forecast models require a forecast horizon.')
        if body.horizon is not None and model['task']!='forecasting':raise HTTPException(422,'Only forecast models accept a forecast horizon.')
        if body.horizon is not None and body.horizon>(model['configuration'].get('forecast') or {}).get('horizon',0):raise HTTPException(422,'Forecast horizon exceeds the saved model horizon.')
        if body.horizon is not None:return {'valid':model['task']=='forecasting' and body.horizon<=(model['configuration'].get('forecast') or {}).get('horizon',0),'rows':body.horizon,'rejected_row_count':0,'rejected_rows':[]}
        data=read_dataset(service.analyst,body.dataset_id) if body.dataset_id else None
        if data and data['total_rows']>5000:raise HTTPException(422,'Batch prediction is limited to 5000 registered rows.')
        records=[dict(zip(data['columns'],row)) for row in data['rows']] if data else body.records or []
        if model['configuration'].get('rfm') and data:
            from .engine import rfm_data
            configuration={**model['configuration'],'rfm':{**model['configuration']['rfm'],'reference_date':(service.store.get('MLExperiment',model['experiment_id']).get('result') or {}).get('details',{}).get('reference_date')}}
            transformed,_,_=rfm_data(data,configuration)
            records=[dict(zip(transformed['columns'],row)) for row in transformed['rows']]
        errors=[];expected={f['name'] for f in model['feature_schema']}
        for index,record in enumerate(records):
            for name in expected-set(record):errors.append({'row':index+1,'field':name,'reason':'Missing required feature.'})
            if not data and set(record)-expected:errors.append({'row':index+1,'field':None,'reason':'Single records must contain exactly the saved feature names.'})
            for feature in model['feature_schema']:
                if feature['name'] not in record:continue
                value=record[feature['name']];reason=None
                if isinstance(value,(dict,list,bool)) or isinstance(value,str) and len(value)>512:reason='Use scalar values of at most 512 characters.'
                else:
                    try:
                        if feature['kind']=='numeric' and not missing(value):number(value)
                        elif feature['kind']=='datetime' and not missing(value):moment(value)
                    except (ValueError,TypeError,OverflowError):reason='Use a finite number or ISO date/time matching the saved feature type.'
                if reason:errors.append({'row':index+1,'field':feature['name'],'reason':reason})
        return {'valid':not errors,'rows':len(records),'rejected_row_count':len({e['row'] for e in errors}),'rejected_rows':errors[:100], 'error_limit':100}
    except MLFailure as exc:raise HTTPException(422,str(exc)) from exc
