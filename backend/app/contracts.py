"""Typed Phase 4 response contracts, shared across persistence-backed endpoints."""
from typing import Dict,List,Literal,Optional,Union
from pydantic import BaseModel,Field
from .analyst import RunInfo,ResultColumn
from .charts import ChartSpec,ChartData
from .evidence import Evidence,NarrativeStatement
from .filters import ResultFilter


class Snapshot(BaseModel):
    columns:List[ResultColumn]=Field(max_length=100)
    rows:List[List[Optional[Union[str,int,float,bool]]]]=Field(max_length=1000)
    row_count:int=Field(ge=0,le=1000)


from .currency import Money


class SavedChartInfo(BaseModel):
    data_as_of:Optional[str]=None
    source_revision:Optional[dict]=None
    refreshed_at:Optional[str]=None
    result_hash:Optional[str]=None
    currency_metadata:Dict[str,Money]=Field(default_factory=dict)
    currency_metadata_provenance:Optional[dict]=None
    snapshot_digest:Optional[str]=None
    id:str
    title:str
    dataset_id:str
    dataset_name:str
    source_run_id:str
    question:str
    sql:str
    type_mapping:Dict[str,str]
    schema_signature:str
    spec:ChartSpec
    refresh_policy:Literal['snapshot','manual']
    created_at:str
    updated_at:str
    last_successful_refresh:str
    error:Optional[str]
    status:Literal['snapshot','refreshed','refresh_failed']
    summary:List[NarrativeStatement]
    narrative_source:str


class SavedChartRecord(SavedChartInfo):
    snapshot:Snapshot


class UnavailableFilter(BaseModel):
    column:str
    reason:str


class AppliedFilters(BaseModel):
    applied:List[ResultFilter]
    unavailable:List[UnavailableFilter]
    scope:str


class WidgetView(BaseModel):
    custom_title:Optional[str]=None
    default_title:Optional[str]=None
    display_title:Optional[str]=None
    original_title:Optional[str]=None
    freshness:Optional[dict]=None
    matching_widget_ids:List[str]=Field(default_factory=list)
    history_count:int=0
    currency_metadata_available:bool=False
    id:str
    chart_id:Optional[str]=None
    kind:Literal['chart','text']
    title:str
    text:str=''
    spec:Optional[ChartSpec]=None
    filters:List[ResultFilter]
    width:int
    height:int
    source:Optional[SavedChartInfo]=None
    result:Optional[Snapshot]=None
    chart:Optional[ChartData]=None
    chart_options:Optional[List[ChartSpec]]=None
    filters_applied:Optional[AppliedFilters]=None
    evidence:Optional[Evidence]=None
    fallback_reason:Optional[str]=None
    summary:Optional[List[NarrativeStatement]]=None
    error:Optional[str]=None


class DashboardView(BaseModel):
    id:str
    title:str
    description:str
    revision:int
    filters:List[ResultFilter]
    widgets:List[WidgetView]=Field(default_factory=list)
    created_at:str
    updated_at:str
    snapshot_notice:Optional[str]=None
    widget_count:Optional[int]=None


class CategoryScore(BaseModel):
    total:int
    correct:int


class EvaluationRate(BaseModel):
    numerator:int
    denominator:int
    value:Optional[float]
    unit:str
    description:str


class EvaluationMetrics(BaseModel):
    metrics_version:Optional[str]=None
    rates:Dict[str,EvaluationRate]=Field(default_factory=dict)
    latency_sample_size:int=0
    usage_sample_size:int=0
    cost_sample_size:int=0
    evaluated_count:Optional[int]=None
    correct_count:Optional[int]=None
    incorrect_count:Optional[int]=None
    missing_predictions:Optional[int]=None
    execution_failures:Optional[int]=None
    reference_failures:Optional[int]=None
    completed_cases:int
    accuracy:Optional[float]
    valid_sql_rate:Optional[float]
    execution_success_rate:Optional[float]
    result_accuracy:Optional[float]
    average_attempts:Optional[float]
    repair_success_rate:Optional[float]
    p50_latency_ms:Optional[float]
    p95_latency_ms:Optional[float]
    total_tokens:Optional[int]
    estimated_cost_usd:Optional[float]
    difficulties:Dict[str,CategoryScore]=Field(default_factory=dict)
    categories:Dict[str,CategoryScore]
    diagnostic_counts:Dict[str,int]
    wrong_join_rate:Optional[float]
    wrong_filter_rate:Optional[float]
    wrong_aggregation_rate:Optional[float]
    hallucinated_column_rate:Optional[float]
    hallucinated_table_rate:Optional[float]
    reviewed_cases:int
    diagnostic_note:str


class CauseReview(BaseModel):
    reviewed:bool
    labels:List[str]
    reason:str
    reviewed_at:str
    reviewer:str


class ComparisonDetails(BaseModel):
    policy:str
    strict_match:bool
    strict_reason:str
    column_names_match:bool
    positional_values_match:bool
    positional_reason:str
    alias_only_mismatch:bool
    notice:str


class EvaluationCase(BaseModel):
    ordered:bool=False
    comparison_details:Optional[ComparisonDetails]=None
    replay_diagnostics:Dict[str,str]=Field(default_factory=dict)
    case_id:str
    category:str
    difficulty:str
    question:str
    reference_sql:Optional[str]
    expected:Optional[Snapshot]
    actual:Optional[Snapshot]
    correct:Optional[bool]
    comparison:str
    run:Optional[RunInfo]=None
    status:Optional[str]=None
    source_evaluation_id:Optional[str]=None
    source_run_id:Optional[str]=None
    source_model:Optional[str]=None
    source_pipeline:Optional[str]=None
    replayed_sql:Optional[str]=None
    offline_latency_ms:Optional[int]=None
    failure_labels:List[str]
    review:Optional[CauseReview]=None


class PriceConfiguration(BaseModel):
    input:str
    output:str
    source:str


class EvaluationJob(BaseModel):
    prompt_version:Optional[str]=None
    prompt_hash:Optional[str]=None
    workflow_version:Optional[str]=None
    comparison_policy:Optional[str]=None
    id:str
    dataset_id:str
    dataset_fingerprint:str = "legacy-unrecorded"
    version:str
    case_ids:List[str]
    mode:Literal['paid','offline']='paid'
    source_evaluation_id:Optional[str]=None
    pipeline:Literal['baseline','rag','agentic','offline']
    max_spend_usd:float
    max_total_tokens:int
    confirm_paid_calls:bool
    status:Literal['queued','running','completed','failed','cancelled']
    created_at:str
    updated_at:str
    completed_at:Optional[str]
    model:str
    provider_endpoint:str
    pricing:PriceConfiguration
    results:List[EvaluationCase]=Field(default_factory=list)
    active_run_id:Optional[str]
    provider_calls:int
    reserved_tokens:int
    reserved_cost_usd:float
    error:Optional[str]
    metrics:Optional[EvaluationMetrics]


class DashboardSummary(BaseModel):
    id:str
    title:str
    description:str
    revision:int
    filters:List[ResultFilter]
    created_at:str
    updated_at:str
    widget_count:int
