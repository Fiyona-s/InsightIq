"""Versioned additive application migrations. Existing tables are preserved."""
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, Integer, select, inspect
from sqlalchemy.orm import Session


def utcnow(): return datetime.now(timezone.utc).isoformat()


def register_phase4(base):
    class Migration(base):
        __tablename__='schema_migrations'
        version=Column(Integer,primary_key=True)
        applied_at=Column(String(40),nullable=False)
    models={}
    for name,table in [('Dashboard','dashboards'),('SavedChart','saved_charts'),('Evaluation','evaluation_jobs'),('BenchmarkInstall','benchmark_installs'),('MLExperiment','ml_experiments'),('MLModel','ml_models'),('MLPrediction','ml_predictions')]:
        models[name]=type(name,(base,),{'__tablename__':table,'id':Column(String(36),primary_key=True),
            'dataset_id':Column(String(36),nullable=True,index=True),'updated_at':Column(String(40),nullable=False,index=True),
            'payload':Column(Text,nullable=False)})
    return Migration,models


def migrate(engine,base,migration_model):
    # v1 records the existing Phase 1–3 catalog; v2 adds Phase 4 document tables.
    # create(checkfirst) is idempotent on both SQLite and SQLAlchemy PostgreSQL dialects.
    migration_model.__table__.create(engine,checkfirst=True)
    with Session(engine) as session:
        versions=set(session.scalars(select(migration_model.version)))
    for version,names in [(1,{'datasets','analyst_runs','knowledge_state','knowledge_examples'}),(2,{'dashboards','saved_charts','evaluation_jobs','benchmark_installs'}),(3,{'ml_experiments','ml_models','ml_predictions'}),(4,{'dataset_references','dataset_audit'}),(5,{'analyst_feedback'}),(6,{'dataset_revisions'}),(7,{'knowledge_drafts','knowledge_review_examples'}),(8,{'dashboard_widget_snapshots'}),(9,set()),(10,{'confirmed_column_types'}),(11,{'projects','project_items'}),(12,{'analyst_run_results'}),(13,{'dataset_sample_flags'}),(14,{'companies','users'}),(15,{'sessions','login_attempts','password_resets'}),(16,{'audit_events'}),(17,{'user_totp','recovery_codes'})]:
        if version in versions:continue
        with engine.begin() as connection:
            for table in base.metadata.sorted_tables:
                if table.name in names:table.create(connection,checkfirst=True)
            # A registry row is never written for a table that does not exist (the model must be registered on `base`).
            missing=[name for name in names if not inspect(connection).has_table(name)]
            if missing:raise RuntimeError('Cannot record schema version %s: missing table(s) %s.'%(version,', '.join(sorted(missing))))
            connection.execute(migration_model.__table__.insert().values(version=version,applied_at=utcnow()))
