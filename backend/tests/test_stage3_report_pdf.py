"""Stage 3 (final round): the dashboard PDF reads like a report; the technical detail lives in the appendix."""
import re
import pytest
from reportlab.pdfgen.canvas import Canvas
from app import reports

APPENDIX='Appendix: how this was calculated'


def widget(title='Total revenue',kind='kpi',value=8379680.760000008,name='total_revenue',custom=None,status='Current',money=None,rows=None):
    rows=rows if rows is not None else [[value]]
    columns=[{'name':name,'type':'DOUBLE','money':money}] if kind=='kpi' else [{'name':'region','type':'VARCHAR'},{'name':name,'type':'DOUBLE','money':money}]
    points=[] if kind=='kpi' else [{'x':i,'y':r[1],'label':r[0]} for i,r in enumerate(rows)]
    return {'id':'w-'+title,'kind':'chart','title':title,'display_title':title.title(),'custom_title':custom,'width':6,'height':3,
        'source':{'dataset_name':'shop-2026.csv','question':'What is the total revenue?','data_as_of':'2026-11-14T08:15:30.123456+00:00','last_successful_refresh':'2026-11-14T08:15:30+00:00','sql':'SELECT SUM(revenue) AS total_revenue FROM data','narrative_source':'computed','title':title},
        'freshness':{'label':'shop-2026.csv','status':status},
        'result':{'columns':columns,'rows':rows,'row_count':len(rows)},
        'chart':{'spec':{'kind':kind,'title':title},'points':points},
        'filters_applied':{'scope':'Filters select complete query-output rows.','unavailable':[]},
        'evidence':{'facts':[{'id':'f1','statement':'The query returned 1 rows.'}],'result_digest':'abcdef0123456789'},
        'summary':[{'fact_id':'f1','text':'The query returned 1 rows.'}],'filters':[]}


def view(widgets,**extra):
    return {'title':'Weekly numbers','description':'','filters':[],'widgets':widgets,'snapshot_notice':'Persisted query-output snapshots.',**extra}


@pytest.fixture
def capture(monkeypatch):
    paragraphs=[];strings=[];original=reports.Paragraph
    def para(text,*a,**k):
        paragraphs.append(text);return original(text,*a,**k)
    monkeypatch.setattr(reports,'Paragraph',para)
    for method in ('drawString','drawRightString'):
        real=getattr(Canvas,method)
        def spy(self,x,y,text,*a,_real=real,**k):
            strings.append(text);return _real(self,x,y,text,*a,**k)
        monkeypatch.setattr(Canvas,method,spy)
    return paragraphs,strings


def pages(raw):return len(re.findall(rb'/Type /Page\b(?!s)',raw))


def main_and_appendix(paragraphs):
    at=next(i for i,t in enumerate(paragraphs) if t==APPENDIX)
    return paragraphs[:at],paragraphs[at:]


def test_headline_first_with_header_project_date_and_footer(capture):
    paragraphs,strings=capture
    raw=reports.dashboard_pdf(view([widget()]),'Main Street shop')
    assert raw.startswith(b'%PDF-')
    main,appendix=main_and_appendix(paragraphs)
    assert main[0]=='Weekly numbers' and re.fullmatch(r'Project: Main Street shop · Prepared \d{1,2} [A-Z][a-z]{2} \d{4}',main[1])
    assert '8,379,680.76' in main and not any('8379680.760000008' in t for t in main)       # headline rounded for reading
    assert any('8379680.760000008' in t or '8,379,680.760000008' in t for t in appendix)     # exact value kept for checking
    caption=next(t for t in main if t.startswith('What is the total revenue?'))
    assert caption=='What is the total revenue? · Source: shop-2026.csv · Data as of 14 Nov 2026'
    assert 'Snapshot of your data; may be out of date' in strings and 'Page 1 of 2' in strings and 'Page 2 of 2' in strings


def test_two_kpi_tiles_per_page_and_appendix_is_last(capture):
    paragraphs,_=capture
    raw=reports.dashboard_pdf(view([widget('A'),widget('B'),widget('C')]),'P')
    assert pages(raw)==3        # [A B] / [C] / appendix
    main,appendix=main_and_appendix(paragraphs)
    assert [t for t in main if t in {'A','B','C'}]==['A','B','C']
    assert appendix[0]==APPENDIX


def test_no_technical_text_or_model_written_claims_outside_the_appendix(capture):
    paragraphs,_=capture
    reports.dashboard_pdf(view([widget(),widget('By region','bar',rows=[['North',1250],['South',500]])]),'P')
    main,appendix=main_and_appendix(paragraphs)
    joined='\n'.join(main)
    for banned in ('SELECT','[f1]','Narrative','Result digest','Limits:','model-selected','Status: snapshot','error: None','Incompatible filters','Dashboard filters: []','Generated'):
        assert banned not in joined,banned
    assert not re.search(r'\d{4}-\d{2}-\d{2}T',joined)                      # no raw ISO timestamps
    tail='\n'.join(appendix)
    for needed in ('SELECT SUM(revenue)','[f1] The query returned 1 rows.','Narrative (computed)','Result digest: abcdef0123456789','Limits:','Question: What is the total revenue?'):
        assert needed in tail,needed


def test_empty_filters_are_omitted_and_real_filters_are_readable(capture):
    paragraphs,_=capture
    reports.dashboard_pdf(view([widget()]),'P')
    assert not any('Filters applied' in t for t in paragraphs)
    paragraphs.clear()
    reports.dashboard_pdf(view([widget()],filters=[{'column':'region','kind':'category','values':['North','South']}]),'P')
    assert 'Filters applied to this dashboard: region: North, South' in paragraphs


def test_appendix_can_be_left_out_but_is_included_by_default(capture):
    paragraphs,_=capture
    reports.dashboard_pdf(view([widget()]),'P')
    assert APPENDIX in paragraphs
    paragraphs.clear()
    reports.dashboard_pdf(view([widget()]),'P',appendix=False)
    assert APPENDIX not in paragraphs and not any('SELECT' in t for t in paragraphs)


def test_stale_source_is_said_plainly_on_the_tile_and_current_is_not_repeated(capture):
    paragraphs,_=capture
    reports.dashboard_pdf(view([widget(status='Source changed')]),'P')
    main,_=main_and_appendix(paragraphs)
    assert 'The source file has changed since this snapshot, so these figures may be out of date.' in main
    paragraphs.clear()
    reports.dashboard_pdf(view([widget(status='Current')]),'P')
    assert 'Current' not in main_and_appendix(paragraphs)[0]


def test_tile_titles_are_the_owners_text_unless_system_generated():
    assert reports.tile_title({'title':'Total revenue','display_title':'Total Revenue'})=='Total revenue'
    assert reports.tile_title({'title':'total_revenue_inr by category','display_title':'Total Revenue by Category'})=='Total Revenue by Category'
    assert reports.tile_title({'title':'total_revenue','display_title':'my numbers','custom_title':'my numbers'})=='my numbers'


def test_display_rounding_leaves_currency_formatting_alone():
    assert reports.friendly_value(8379680.760000008)=='8,379,680.76'
    assert reports.friendly_value(0.7103658536585366)=='0.7104'
    assert reports.friendly_value(2400)=='2,400' and reports.friendly_value(None)=='—'
    money={'currency':'INR'}
    assert reports.friendly_value(1250000,money,'DOUBLE')==reports.format_money(1250000,money,'DOUBLE')
    assert reports.readable_date('2026-11-16T05:30:32.417553+00:00')=='16 Nov 2026' and reports.readable_date(None)=='date not recorded'


def test_chart_tile_has_chart_and_table_and_is_one_per_page(capture):
    paragraphs,_=capture
    raw=reports.dashboard_pdf(view([widget('By region','bar',rows=[['North',1250],['South',500]]),widget('Other','bar',rows=[['East',10]])]),'P')
    assert pages(raw)==3            # chart / chart / appendix
    main,_=main_and_appendix(paragraphs)
    assert 'By region' in main and 'Other' in main


def test_front_table_headings_are_readable_and_the_appendix_keeps_exact_column_names(capture):
    paragraphs,_=capture
    reports.dashboard_pdf(view([widget(title='Revenue by region',kind='bar',name='total_revenue',rows=[['North',10],['South',20]])]),'Shop')
    main,appendix=main_and_appendix(paragraphs)
    assert 'Total revenue' in main and 'total_revenue' not in main
    assert 'total_revenue' in appendix
