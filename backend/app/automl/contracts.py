"""Strict, bounded local ML requests and additive response contracts."""
from typing import Any,Dict,List,Literal,Optional
from uuid import UUID
from pydantic import BaseModel,ConfigDict,Field,model_validator

Task=Literal['regression','classification','clustering','anomaly','forecasting']
class Strict(BaseModel):
    model_config=ConfigDict(extra='forbid')
class Feature(Strict):
    name:str=Field(min_length=1,max_length=128)
    kind:Literal['numeric','categorical','datetime']
class RFM(Strict):
    customer:str
    date:str
    amount:str
    order:Optional[str]=None
    reference_date:Optional[str]=Field(default=None,max_length=32)
class Forecast(Strict):
    date_column:str
    measure:str
    frequency:Literal['day','week','month']='day'
    missing_periods:Literal['error','zero','forward_fill']='error'
    horizon:int=Field(default=7,ge=1,le=30)
    seasonal_period:int=Field(default=7,ge=2,le=12)
class TrainRequest(Strict):
    dataset_id:UUID
    title:str=Field(default='Local experiment',min_length=1,max_length=120)
    task:Task
    target:Optional[str]=Field(default=None,max_length=128)
    target_unit:Optional[str]=Field(default=None,max_length=32)
    features:List[Feature]=Field(default_factory=list,max_length=24)
    scaler:Literal['standard','robust','none']='standard'
    seed:int=Field(default=42,ge=0,le=2147483647)
    clusters:int=Field(default=3,ge=2,le=8)
    contamination:float=Field(default=.05,ge=.01,le=.3,allow_inf_nan=False)
    rfm:Optional[RFM]=None
    forecast:Optional[Forecast]=None
    confirm_feature_availability:Literal[True]
    @model_validator(mode='after')
    def relevant(self):
        if len({f.name for f in self.features})!=len(self.features):raise ValueError('Feature names must be unique.')
        supervised=self.task in {'regression','classification'}
        if supervised and not self.target:raise ValueError('A target is required for supervised learning.')
        if not supervised and self.target is not None:raise ValueError('This task does not use a target.')
        if self.rfm and (self.task!='clustering' or self.features):raise ValueError('RFM clustering derives its own features; do not select raw predictors.')
        if self.task=='forecasting':
            if self.forecast is None or self.features or self.rfm:raise ValueError('Forecasting requires only date/measure configuration, without raw features.')
        elif self.forecast:raise ValueError('Forecast configuration is only for forecasting.')
        elif not self.features and not self.rfm:raise ValueError('Select at least one feature.')
        return self
class PredictRequest(Strict):
    records:Optional[List[Dict[str,Any]]]=Field(default=None,min_length=1,max_length=500)
    dataset_id:Optional[UUID]=None
    horizon:Optional[int]=Field(default=None,ge=1,le=30)
    @model_validator(mode='after')
    def one_source(self):
        if sum(v is not None for v in (self.records,self.dataset_id,self.horizon))!=1:raise ValueError('Supply exactly one of records, a batch dataset, or forecast horizon.')
        return self
class CandidateInfo(BaseModel):
    algorithm:str
    status:Literal['completed','failed']
    training_metrics:Optional[Dict[str,Optional[float]]]=None
    validation_metrics:Optional[Dict[str,Optional[float]]]=None
    test_metrics:Optional[Dict[str,Optional[float]]]=None
    fit_seconds:float
    selected:bool
    model_id:Optional[str]=None
    error:Optional[str]=None
class ResultInfo(BaseModel):
    leaderboard:List[CandidateInfo]
    selected_model_id:str
    selection_metric:str
    selection_split:str
    split:Dict[str,Any]
    plots:Dict[str,List[Dict[str,Any]]]
    details:Dict[str,Any]
    rows_used:int
    warnings:List[str]
    scope:str
    feature_importance:Dict[str,Any]
class ExperimentInfo(BaseModel):
    id:str
    dataset_id:str
    dataset_name:str
    dataset_fingerprint:str
    title:str
    task:Task
    status:Literal['queued','running','completed','failed','cancelled']
    created_at:str
    updated_at:str
    completed_at:Optional[str]=None
    duration_seconds:Optional[float]=None
    configuration:TrainRequest
    limits:Dict[str,int]
    error:Optional[str]=None
    error_code:Optional[str]=None
    result:Optional[ResultInfo]=None
class ModelInfo(BaseModel):
    id:str
    experiment_id:str
    dataset_id:str
    dataset_fingerprint:str
    algorithm:str
    task:Task
    created_at:str
    hyperparameters:Dict[str,Any]
    metrics:Dict[str,Any]
    feature_schema:List[Feature]
    selected:bool
    selection_metric:str
    artifact_path:str
    artifact_sha256:str
    versions:Dict[str,str]
    configuration:TrainRequest
class PredictionInfo(BaseModel):
    id:str
    model_id:str
    dataset_id:Optional[str]=None
    created_at:str
    row_count:int
    scope:str
    columns:List[str]
    rows:List[Dict[str,Any]]
    offset:int=0
