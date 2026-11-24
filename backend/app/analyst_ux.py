"""Deterministic Analyst assistance and local feedback; never a trusted-example source."""
import json,re,shutil,sqlite3
from pathlib import Path
from uuid import UUID,uuid4
from typing import Optional,Literal
from fastapi import APIRouter,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from sqlalchemy import Column,String,Text,select,inspect,text
from sqlalchemy.orm import Session
from .persistence import utcnow
from .knowledge import digest


def register(base):
    return type('AnalystFeedback',(base,),dict(__tablename__='analyst_feedback',run_id=Column(String(36),primary_key=True),dataset_id=Column(String(36),nullable=True),rating=Column(String(20),nullable=True),reason=Column(Text,nullable=True),timestamp=Column(String(40),nullable=True)))


def migrate(engine,root,Feedback):
    if not inspect(engine).has_table('analyst_runs'):return
    columns={c['name'] for c in inspect(engine).get_columns('analyst_runs')}
    if 'thread_id' not in columns or not inspect(engine).has_table('analyst_feedback'):
        folder=root/'backups'/('analyst-v5-'+utcnow().replace(':','-'));folder.mkdir(parents=True)
        shutil.copytree(root,folder/'storage',ignore=shutil.ignore_patterns('backups','catalog.sqlite*'),dirs_exist_ok=True)
        if engine.dialect.name!='sqlite':raise RuntimeError('A verified database backup is required before Analyst migration.')
        with sqlite3.connect(engine.url.database) as a,sqlite3.connect(folder/'catalog.sqlite') as b:a.backup(b)
        with engine.begin() as c:
            if 'thread_id' not in columns:c.execute(text('ALTER TABLE analyst_runs ADD COLUMN thread_id VARCHAR(36) NULL'))
        Feedback.__table__.create(engine,checkfirst=True)


class Choice(BaseModel):
    model_config=ConfigDict(extra='forbid')
    kind:Literal['column','metric']
    name:str=Field(min_length=1,max_length=128)

class FeedbackInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    rating:Literal['helpful','not_helpful']
    reason:Optional[str]=Field(default=None,max_length=500)


def safe_label(name):return re.sub(r'[_\s]+',' ',name).strip()

class AnalystUX:
    def __init__(self,analyst,Feedback):self.analyst,self.Feedback=analyst,Feedback;self.cache={}
    def active_item(self,identifier):
        item=self.analyst.get_item(identifier)
        if item.archived_at:raise HTTPException(409,'Restore this dataset before starting a new question.')
        return item
    def suggestions(self,identifier):
        item=self.analyst.get_item(identifier)
        if item.archived_at:return []
        _,profile,_,settings,_=self.analyst.knowledge.sync(identifier)
        key=digest([profile,settings.model_dump()])
        if self.cache.get(str(identifier),{}).get('key')==key:return self.cache[str(identifier)]['items']
        names={c['name'] for c in profile['columns']};dims=[];numeric=[];dates=[]
        with self.analyst.connector(self.analyst.root/(str(identifier)+'.duckdb')) as db:
            for c in profile['columns']:
                name=c['name'];typ=c['suggested_type']
                if re.search(r'(^id$|(?:^|_)id$|uuid|identifier|account|email|phone)',name,re.I):continue
                if typ in {'BIGINT','DOUBLE'}:numeric.append(name)
                elif typ in {'DATE','TIMESTAMP'}:dates.append(name)
                else:
                    quoted='"'+name.replace('"','""')+'"'
                    cardinality=db.execute('SELECT COUNT(DISTINCT '+quoted+') FROM records').fetchone()[0]
                    if 1<cardinality<=min(30,max(2,profile['rows']//2)):dims.append(name)
        # Stage 3 (D3): only offer sums for numbers the owner has defined or given a confirmed currency
        # to. Nothing is inferred from a column's name, except that percentage-like names never get a
        # "total" (adding percentages is meaningless). Names are shown exactly as in the file, unquoted.
        measures=sorted((n for n in numeric if n in settings.monetary_columns or n in settings.columns),key=lambda n:(n not in settings.monetary_columns,n))
        percentage_like=re.compile(r'(pct|percent|percentage)',re.I)
        totals=[n for n in measures if not percentage_like.search(n)]
        items=[]
        def add(question,kind,columns):
            if len(items)<5 and set(columns)<=names:items.append(dict(question=question,kind=kind,columns=columns))
        # Definitions are user-authored metadata; no benchmark gold or feedback is consulted.
        for metric in settings.metrics[:1]:
            from sqlglot import parse_one,exp
            try:cols=sorted({c.name for c in parse_one(metric.sql,read='duckdb').find_all(exp.Column)})
            except Exception:continue
            if cols:add('What is '+metric.name+'?','metric',cols)
        add('How many records are in this dataset?','count',[])
        if totals:
            m=totals[0];add('What is the total of '+m+'?','total',[m])
            if dims:
                d=dims[0];add('Show '+m+' by '+d+'.','grouped',[m,d]);add('Show the top 10 '+d+' by total '+m+'.','top',[m,d])
            if dates:add('Show total '+m+' by month using '+dates[0]+'.','trend',[m,dates[0]])
            if len(items)<4:add('What is the average of '+m+'?','average',[m])
        elif measures:add('What is the average of '+measures[0]+'?','average',[measures[0]])
        for d in dims:
            if len(items)<4:add('How many records are there for each '+d+'?','grouped_count',[d])
        if len(items)<4 and names:add('Show the first 10 records.','preview',sorted(names))
        if len(items)<4 and names:
            c=sorted(names)[0];add('How many non-empty values are in '+c+'?','count_values',[c]);add('How many missing values are in '+c+'?','missing',[c])
        self.cache[str(identifier)]={'key':key,'items':items};return items
    def choices(self,identifier):
        _,profile,_,settings,_=self.analyst.knowledge.sync(identifier)
        return [dict(kind='metric',name=m.name) for m in settings.metrics[:6]]+[dict(kind='column',name=c['name']) for c in profile['columns'] if not re.search(r'(^id$|_id$|uuid)',c['name'],re.I)][:6]
    def validate_choice(self,identifier,choice):
        if choice and choice.model_dump() not in self.choices(identifier):raise HTTPException(422,'Choose an existing column or confirmed metric.')
    def context(self,identifier,thread_id):
        if not thread_id:return []
        with Session(self.analyst.engine) as session:
            rows=list(session.scalars(select(self.analyst.Run).where(self.analyst.Run.thread_id==str(thread_id)).order_by(self.analyst.Run.created_at.desc())))
        if any(r.dataset_id!=str(identifier) for r in rows):raise HTTPException(409,'Start a new thread when changing datasets.')
        if any(json.loads(r.payload).get('activity_kind')=='evaluation' for r in rows):raise HTTPException(409,'Evaluation turns cannot be used as Analyst conversation context. Start a new question.')
        return [dict(question=d['question'],executed_sql=d.get('executed_sql'),result_summary=d.get('thread_result_summary')) for d in [json.loads(r.payload) for r in rows[:3]][::-1]]
    def summary(self,result,sql):
        # Rows are included only for a scalar or a genuinely aggregated result, never raw tables.
        from sqlglot import parse_one,exp
        tree=parse_one(sql,read='duckdb');aggregated=bool(tree.find(exp.AggFunc))
        rows=result['rows'][:1] if len(result['columns'])==1 and result['row_count']==1 else result['rows'][:5] if aggregated else []
        omitted=any(isinstance(v,str) and len(v)>256 for row in rows for v in row) or len(json.dumps(rows).encode())>8192
        return dict(columns=[c['name'] for c in result['columns']],row_count=result['row_count'],rows=[] if omitted else rows,values_omitted=omitted)
    def feedback(self,identifier,body=None):
        run=self.analyst.load(identifier)
        if body is not None and run['status']!='succeeded':raise HTTPException(409,'Feedback is available after an answer completes.')
        with Session(self.analyst.engine) as session:
            record=session.get(self.Feedback,str(identifier))
            if body is not None:
                if record is None:record=self.Feedback(run_id=str(identifier));session.add(record)
                record.dataset_id=run['dataset_id'];record.rating=body.rating;record.reason=body.reason.strip() if body.reason else None;record.timestamp=utcnow();session.commit();session.refresh(record)
            return dict(run_id=str(identifier),dataset_id=run['dataset_id'],rating=record.rating if record else None,reason=record.reason if record else None,timestamp=record.timestamp if record else None)
    def router(self):
        r=APIRouter(prefix='/api',tags=['Analyst assistance'])
        @r.get('/datasets/{identifier}/suggested-questions')
        def suggestions(identifier:UUID):
            with self.analyst.knowledge.lock:return self.suggestions(identifier)
        @r.get('/analyst/runs/{identifier}/feedback')
        def feedback(identifier:UUID):return self.feedback(identifier)
        @r.put('/analyst/runs/{identifier}/feedback')
        def save_feedback(identifier:UUID,body:FeedbackInput):return self.feedback(identifier,body)
        return r
