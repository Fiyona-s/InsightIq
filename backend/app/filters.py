"""Output-row filters: never pretend to reaggregate or filter source rows."""
from datetime import datetime,timezone
from decimal import Decimal,InvalidOperation
from typing import List,Literal,Optional,Union
from pydantic import BaseModel,ConfigDict,Field,model_validator
from .charts import is_numeric


class ResultFilter(BaseModel):
    model_config=ConfigDict(extra='forbid')
    column:str=Field(min_length=1,max_length=128)
    kind:Literal['category','numeric','date']
    values:List[str]=Field(default_factory=list,max_length=50)
    minimum:Optional[str]=Field(default=None,max_length=80)
    maximum:Optional[str]=Field(default=None,max_length=80)
    @model_validator(mode='after')
    def valid(self):
        if self.kind=='category':
            if not self.values or any(len(v)>500 for v in self.values):raise ValueError('Choose 1–50 category values, each at most 500 characters.')
        else:
            if self.minimum is None and self.maximum is None:raise ValueError('A range needs at least one bound.')
            bounds=[parse_bound(v,self.kind) if v is not None else None for v in (self.minimum,self.maximum)]
            if None not in bounds and bounds[0]>bounds[1]:raise ValueError('Minimum must not exceed maximum.')
        return self


def parse_bound(value,kind):
    try:
        if kind=='date':
            dt=datetime.fromisoformat(value.replace('Z','+00:00'))
            return (dt.astimezone(timezone.utc) if dt.tzinfo else dt).replace(tzinfo=None)
        number=Decimal(str(value))
        if not number.is_finite():raise ValueError()
        return number
    except (ValueError,InvalidOperation,TypeError):raise ValueError('Use finite numeric bounds or ISO date/timestamp bounds.')


def filter_rows(result,filters):
    rows=list(result['rows']);applied=[];unavailable=[]
    for raw in filters:
        rule=ResultFilter.model_validate(raw)
        indexes=[i for i,c in enumerate(result['columns']) if c['name']==rule.column]
        if len(indexes)!=1:
            unavailable.append({'column':rule.column,'reason':'Result column is absent or ambiguous.'});continue
        idx=indexes[0];col=result['columns'][idx]
        compatible=(rule.kind=='numeric' and is_numeric(col)) or (rule.kind=='date' and col['type'].startswith(('DATE','TIMESTAMP'))) or (rule.kind=='category' and not is_numeric(col) and not col['type'].startswith(('DATE','TIMESTAMP')))
        if not compatible:
            unavailable.append({'column':rule.column,'reason':'Filter type is incompatible with the result column.'});continue
        def accepts(row):
            value=row[idx]
            if value is None:return False
            if rule.kind=='category':return str(value) in rule.values
            try:
                value=parse_bound(value,rule.kind)
                maximum=parse_bound(rule.maximum,rule.kind) if rule.maximum is not None else None
                if maximum is not None and rule.kind=='date' and len(rule.maximum)==10:maximum=maximum.replace(hour=23,minute=59,second=59,microsecond=999999)
                return (rule.minimum is None or value>=parse_bound(rule.minimum,rule.kind)) and (maximum is None or value<=maximum)
            except ValueError:return False
        rows=[row for row in rows if accepts(row)];applied.append(rule.model_dump())
    return {**result,'rows':rows,'row_count':len(rows)}, {'applied':applied,'unavailable':unavailable,
        'scope':'Filters select complete query-output rows. Aggregated metrics are not recalculated from source data.'}
