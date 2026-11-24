"""Deterministic parsing inside train-only scikit-learn pipelines."""
import numpy as np
from sklearn.base import BaseEstimator,TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder,StandardScaler,RobustScaler
from sklearn.impute import SimpleImputer
from .data import number,moment,missing,MLFailure

class ScalarParser(BaseEstimator,TransformerMixin):
    def __init__(self,kind='numeric'):self.kind=kind
    def fit(self,X,y=None):self.n_features_in_=np.asarray(X).shape[1];return self
    def transform(self,X):
        x=np.asarray(X,dtype=object)
        out=[]
        for row in x:
            vals=[]
            for value in row:
                if self.kind=='numeric':vals.append(number(value))
                elif self.kind=='categorical':vals.append(np.nan if missing(value) else str(value))
                else:
                    d=moment(value)
                    vals.extend([d.year,d.month,d.day,d.weekday()] if d else [np.nan]*4)
            out.append(vals)
        return np.asarray(out,dtype=object if self.kind=='categorical' else float)
    def get_feature_names_out(self,input_features=None):
        names=list(input_features) if input_features is not None else [f'x{i}' for i in range(self.n_features_in_)]
        return np.array([n+'_'+part for n in names for part in ['year','month','day','weekday']] if self.kind=='datetime' else names,dtype=object)

def preprocessor(features,scaler='standard'):
    blocks=[]
    for kind in ('numeric','categorical','datetime'):
        indices=[i for i,f in enumerate(features) if f['kind']==kind]
        if not indices:continue
        steps=[('parse',ScalarParser(kind)),('impute',SimpleImputer(strategy='most_frequent' if kind=='categorical' else 'median',keep_empty_features=True))]
        if kind=='categorical':steps.append(('encode',OneHotEncoder(handle_unknown='ignore',max_categories=20,sparse_output=False)))
        elif scaler!='none':steps.append(('scale',RobustScaler() if scaler=='robust' else StandardScaler()))
        blocks.append((kind,Pipeline(steps),indices))
    return ColumnTransformer(blocks,remainder='drop',sparse_threshold=0,verbose_feature_names_out=True)

def feature_array(data,features):
    indices=[data['columns'].index(f['name']) for f in features]
    x=np.asarray([[r[i] for i in indices] for r in data['rows']],dtype=object)
    if any(isinstance(v,str) and len(v)>512 for row in x for v in row):raise MLFailure('Selected ML feature values must be at most 512 characters.','feature_limit')
    return x
