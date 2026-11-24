from typing import Optional
from datetime import date
"""Local bounded PDF from persisted/filtered snapshots. No network asset loading."""
from .currency import format_money as source_money
from decimal import Decimal, InvalidOperation
from pathlib import Path
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

def report_font():
    for path in [Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),Path("/System/Library/Fonts/Geneva.ttf")]:
        if path.is_file():
            if "InsightReport" not in pdfmetrics.getRegisteredFontNames():pdfmetrics.registerFont(TTFont("InsightReport",str(path)))
            return "InsightReport"
    return "Helvetica"

def format_money(value,money=None,column_type=None):
    if value is None:return "NULL"
    code=(money or {}).get("currency")
    if code and not (money or {}).get("mixed"):
        raw=source_money(value,money)
        if not raw.startswith(code+" "):return raw
        amount=raw[len(code)+1:];negative=amount.startswith("-")
        symbols={"INR":"₹","USD":"$","EUR":"€","GBP":"£","JPY":"¥","KRW":"₩","CAD":"CA$","AUD":"A$","CNY":"CN¥"}
        return ("-" if negative else "")+symbols.get(code,code+" ")+amount.lstrip("-")
    if isinstance(value,bool):return str(value)
    if isinstance(value,(int,float,Decimal)) or (column_type and any(t in column_type for t in ["INT","DOUBLE","DECIMAL","FLOAT","REAL"])):
        try:
            number=Decimal(str(value))
            if not number.is_finite():return "—"
            text=format(number,",f")
            return text.rstrip("0").rstrip(".") if "." in text else text
        except InvalidOperation:return "—"
    return str(value)
STATUS_LABELS = {'Revision not recorded': 'Saved before change tracking'}


def status_label(status):
    """Plain wording for the stored freshness status; the stored value itself is unchanged."""
    return STATUS_LABELS.get(status or 'Revision not recorded', status or STATUS_LABELS['Revision not recorded'])

import io,json,copy,math
from datetime import datetime,timezone
from xml.sax.saxutils import escape
from fastapi import APIRouter,HTTPException,Request
from fastapi.responses import Response
from uuid import UUID
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak
from reportlab.graphics.shapes import Drawing,Rect,String,Line,Circle,PolyLine
from reportlab.graphics.charts.piecharts import Pie


def report_axis(values, include_zero=True, money=None):
    # Mirrors frontend/lib/chartAxis.ts: nice 1/2/2.5/5/10 steps, one unit,
    # at most one decimal and distinct labels. Presentation only.
    actual_min,actual_max=min(values),max(values)
    minimum=min(0,actual_min) if include_zero else actual_min
    maximum=max(0,actual_max) if include_zero else actual_max
    def rounded(n):return float(format(n,'.15g'))
    def nice(n):
        power=10**math.floor(math.log10(n))
        return next((v*power for v in [1,2,2.5,5,10] if v*power>=n*(1-1e-12)),10*power)
    code=(money or {}).get('currency') if not (money or {}).get('mixed') else None
    def unit(magnitude):
        choices=[(1e7,'Cr'),(1e5,'L'),(1e3,'K')] if code=='INR' else [(1e9,'B'),(1e6,'M'),(1e3,'K')]
        return next(((scale,label) for scale,label in choices if magnitude>=scale),(1,''))
    step=nice((maximum-minimum or abs(maximum)*.1 or 1)/5)
    low,high,scale,label=0,1,1,''
    for _ in range(5):
        low=rounded(math.floor(minimum/step)*step);high=rounded(math.ceil(maximum/step)*step)
        if high<=actual_max:high=rounded(high+step)
        if high<=low:high=rounded(low+step)
        magnitude=max(abs(low),abs(high));scale,label=unit(magnitude)
        quantum=scale/10 if label else .1 if magnitude>=.1 else 10**math.floor(math.log10(magnitude))/10 if magnitude else 0
        if step>=quantum:break
        step=nice(quantum)
    symbols={'INR':'₹','USD':'$','EUR':'€','GBP':'£','JPY':'¥','KRW':'₩','CAD':'CA$','AUD':'A$','CNY':'CN¥'}
    def formatter(value):
        amount=Decimal(str(value))/Decimal(str(scale));negative=amount<0;absolute=abs(amount)
        if not label and absolute and absolute<Decimal('.1'):
            mantissa,exponent=format(absolute,'.1E').split('E');text=mantissa.rstrip('0').rstrip('.')+'E'+str(int(exponent))
        else:
            from decimal import ROUND_HALF_UP
            text=format(absolute.quantize(Decimal('.1'),rounding=ROUND_HALF_UP),',f').rstrip('0').rstrip('.')
        return ('-' if negative else '')+(symbols.get(code,code+' ') if code else '')+text+label
    ticks=[]
    for i in range(30):
        value=rounded(low+i*step)
        if value>high+step*1e-9:break
        if not ticks or formatter(value)!=formatter(ticks[-1]):ticks.append(value)
    return low,high,ticks,formatter


def chart_drawing(chart):
    points=chart['points'];kind=chart['spec']['kind']
    d=Drawing(480,220)
    font=report_font()
    if kind in {'table','kpi'}:return None
    if not points or any(isinstance(p.get(key),(int,float)) and abs(p[key])>9007199254740991 for p in points for key in ('x','y')):return None
    if kind=='donut':
        pie=Pie();pie.x=140;pie.y=10;pie.width=200;pie.height=200;pie.data=[p['y'] for p in points];pie.labels=[p.get('label','')[:40] for p in points];pie.innerRadius=.5
        palette=['#287b62','#8dad68','#d4b477','#6d94a6','#a08aae','#b77d65','#87aaa1','#a7af5a']
        for i in range(len(points)):pie.slices[i].fillColor=colors.HexColor(palette[i%8])
        d.add(pie);return d
    ys=[p['y'] for p in points];low,high,ticks,axis_format=report_axis(ys,kind in {'bar','line'},chart.get('money'));span=high-low or 1
    def py(v):return 30+(v-low)/span*160
    d.add(Line(45,py(0),465,py(0),strokeColor=colors.grey));d.add(Line(45,30,45,190,strokeColor=colors.grey))
    for v in ticks:d.add(String(0,py(v),axis_format(v),fontSize=8,fontName=font))
    if kind=='bar':
        width=400/max(1,len(points))
        for i,p in enumerate(points):
            d.add(Rect(50+i*width,min(py(0),py(p['y'])),width*.72,abs(py(p['y'])-py(0)),fillColor=colors.HexColor('#287b62'),strokeColor=None))
            d.add(String(50+i*width,12,p.get('label','')[:18],fontSize=7,fontName=font))
    else:
        xs=[p['x'] for p in points];left,right,_,x_format=report_axis(xs,False,chart.get('x_money'));xspan=right-left or 1
        xy=[(50+(p['x']-left)/xspan*400,py(p['y'])) for p in points]
        if kind=='line' and len(xy)>1:d.add(PolyLine([v for pair in xy for v in pair],strokeColor=colors.HexColor('#287b62')))
        for x,y in xy:d.add(Circle(x,y,2,fillColor=colors.HexColor('#287b62'),strokeColor=None))
        for value,x in ((left,50),(right,400)):
            label=datetime.fromtimestamp(value/1000,timezone.utc).date().isoformat() if kind=='line' else x_format(value)
            d.add(String(x,12,label,fontSize=7,fontName=font))
    return d


MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

def readable_date(value):
    """'2026-11-16T05:30:32+00:00' -> '16 Nov 2026'. Never a numeric, locale-dependent date."""
    if not value:return 'date not recorded'
    text=str(value)
    try:
        moment=datetime.fromisoformat(text.replace('Z','+00:00'))
        return f'{moment.day} {MONTHS[moment.month-1]} {moment.year}'
    except ValueError:return text[:10]

def friendly_value(value,money=None,column_type=None,percent=False):
    text=_friendly_value(value,money,column_type)
    return text+'%' if percent and value is not None and text not in {'—'} and not (money or {}).get('currency') else text
def _friendly_value(value,money=None,column_type=None):
    """Display rounding for reading (whole numbers exact, >=1 to 2 decimals, <1 to 4 significant digits).
    Confirmed-currency amounts keep going through format_money; exact values stay in the appendix."""
    if value is None:return '—'
    if (money or {}).get('currency') and not (money or {}).get('mixed'):return format_money(value,money,column_type)
    if isinstance(value,bool):return str(value)
    numeric=isinstance(value,(int,float,Decimal)) or (column_type and any(t in column_type for t in ['INT','DOUBLE','DECIMAL','FLOAT','REAL']))
    if not numeric:return str(value)
    try:number=Decimal(str(value))
    except InvalidOperation:return str(value)
    if not number.is_finite():return '—'
    if number==number.to_integral_value() or abs(number)>=Decimal('1e15'):return format(number.to_integral_value(),',f')
    if abs(number)>=1:return format(number.quantize(Decimal('0.01')),',f').rstrip('0').rstrip('.')
    return format(float(format(number,'.4g')),'f').rstrip('0').rstrip('.') or '0'

def tile_title(w):
    """The owner's own text as saved; a readable form only for titles the system built from a column name."""
    if w.get('custom_title'):return w['custom_title']
    saved=(w.get('title') or '').strip()
    if saved and '_' not in saved:return saved
    return w.get('display_title') or saved or (w.get('source') or {}).get('title') or ('Insight note' if w.get('kind')=='text' else 'Chart')

def describe_filters(filters):
    parts=[]
    for f in filters or []:
        if f.get('kind')=='category':parts.append(f"{f['column']}: {', '.join(map(str,f.get('values') or []))}")
        else:parts.append(f"{f['column']}: {f.get('minimum') if f.get('minimum') not in (None,'') else 'any'} to {f.get('maximum') if f.get('maximum') not in (None,'') else 'any'}")
    return '; '.join(parts)

def dashboard_pdf(view,project_name=None,appendix=True):
    if len(view['widgets'])>24:raise HTTPException(413,'Reports support at most 24 widgets.')
    font=report_font()
    from reportlab.lib.styles import ParagraphStyle
    grey=colors.HexColor('#5b665f');green=colors.HexColor('#1d6a50');line=colors.HexColor('#d7ded9')
    st={'title':ParagraphStyle('t',fontName=font,fontSize=24,leading=29,spaceAfter=4),
        'meta':ParagraphStyle('m',fontName=font,fontSize=10,leading=14,textColor=grey),
        'h2':ParagraphStyle('h2',fontName=font,fontSize=16,leading=20,spaceBefore=4,spaceAfter=4,keepWithNext=1),
        'h3':ParagraphStyle('h3',fontName=font,fontSize=11,leading=15,spaceBefore=8,spaceAfter=2,keepWithNext=1),
        'body':ParagraphStyle('b',fontName=font,fontSize=10,leading=14),
        'small':ParagraphStyle('s',fontName=font,fontSize=9,leading=12,textColor=grey),
        'warn':ParagraphStyle('w',fontName=font,fontSize=10,leading=14,textColor=colors.HexColor('#8a4b08')),
        'kpi':ParagraphStyle('k',fontName=font,fontSize=30,leading=36,textColor=green,spaceBefore=6,spaceAfter=6),
        'code':ParagraphStyle('c',fontName=font,fontSize=8.5,leading=11,backColor=colors.HexColor('#f3f6f4'),borderPadding=4,spaceBefore=8,spaceAfter=8)}
    def p(text,style='body'):return Paragraph(escape(str(text)[:5000]).replace('\n','<br/>'),st[style])
    prepared=datetime.now(timezone.utc);prepared_text=f'Prepared {prepared.day} {MONTHS[prepared.month-1]} {prepared.year}'
    title=view['title'];story=[]
    story.append(p(title,'title'))
    story.append(p(' · '.join(x for x in [project_name and 'Project: '+project_name,prepared_text] if x),'meta'))
    if view.get('description'):story.append(p(view['description']))
    if view.get('filters'):story.append(p('Filters applied to this dashboard: '+describe_filters(view['filters']),'small'))
    if view.get('currency_notice'):story.append(p(view['currency_notice'],'small'))
    story.append(Spacer(1,10))
    widgets=view['widgets']
    def is_kpi(w):return w.get('kind')!='text' and 'source' in w and w['chart']['spec']['kind']=='kpi' and len(w['result']['rows'])==1 and len(w['result']['columns'])==1
    def caption(w):
        source=w['source'];name=w.get('freshness',{}).get('label') or source['dataset_name']
        return f"{source['question']} · Source: {name} · Data as of {readable_date(source.get('data_as_of') or source.get('last_successful_refresh'))}"
    def freshness_note(w):
        status=(w.get('freshness') or {}).get('status')
        if status=='Source changed':return p('The source file has changed since this snapshot, so these figures may be out of date.','warn')
        if status=='Source unavailable':return p('The source file is no longer available. This is the last saved snapshot.','warn')
        return None
    def conversion_note(w):
        quotes=w.get('currency_conversion') or []
        return p('Shown in '+quotes[0]['target_currency']+' using daily reference rates (details in the appendix).','small') if quotes else None
    def kpi_cell(w):
        column=w['result']['columns'][0];value=friendly_value(w['result']['rows'][0][0],column.get('money'),column['type'],column.get('percent'))
        cell=[p(tile_title(w),'h3'),p(value,'kpi'),p(caption(w),'small')]
        for extra in (freshness_note(w),conversion_note(w)):
            if extra:cell.append(extra)
        return cell
    def box(cells,widths):
        t=Table([cells],colWidths=widths,hAlign='LEFT')
        t.setStyle(TableStyle([('BOX',(0,0),(-1,-1),.6,line),('INNERGRID',(0,0),(-1,-1),.6,line),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),10)]));return t
    def data_table(w,exact=False):
        columns=w['result']['columns'];rows=w['result']['rows']
        if len(columns)>8:return [p(f'This table has {len(columns)} columns; use the CSV export for all columns.','small')]
        cell=(lambda v,c:(format_money(v,c.get('money'),c['type'])+('%' if c.get('percent') and v is not None else ''))[:160]) if exact else (lambda v,c:friendly_value(v,c.get('money'),c['type'],c.get('percent'))[:160])
        head=(lambda c:c['name']) if exact else (lambda c:(c['name'].replace('_',' ').strip().capitalize() or c['name']))   # front pages: readable headings; the appendix keeps the exact column names
        t=Table([[p(head(c),'small') for c in columns]]+[[p(cell(v,columns[i])) for i,v in enumerate(r)] for r in rows[:20]],repeatRows=1,hAlign='LEFT',colWidths=[516/max(1,len(columns))]*len(columns))
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#edf4ee')),('GRID',(0,0),(-1,-1),.3,colors.lightgrey),('VALIGN',(0,0),(-1,-1),'TOP')]))
        out=[t]
        if len(rows)>20:out.append(p(f'Showing the first 20 of {len(rows)} rows. The CSV export has every row.','small'))
        return out
    first=True;i=0
    while i<len(widgets):
        w=widgets[i]
        if not first:story.append(PageBreak())
        first=False
        if w.get('kind')=='text':
            story.extend([p(tile_title(w),'h2'),p('Your note (written by you, not checked by InsightIQ)','small'),p(w.get('text',''))]);i+=1;continue
        if 'source' not in w:
            story.extend([p(tile_title(w),'h2'),p('This tile\'s data is unavailable. '+str(w.get('error') or ''),'warn')]);i+=1;continue
        if is_kpi(w):
            pair=[w]
            if i+1<len(widgets) and is_kpi(widgets[i+1]) and 'source' in widgets[i+1]:pair.append(widgets[i+1])
            story.append(box([kpi_cell(x) for x in pair],[258]*len(pair)));i+=len(pair);continue
        story.append(p(tile_title(w),'h2'));story.append(p(caption(w),'small'))
        for extra in (freshness_note(w),conversion_note(w)):
            if extra:story.append(extra)
        story.append(Spacer(1,6))
        drawing=chart_drawing(w['chart'])
        if drawing:story.append(drawing)
        elif w['chart']['spec']['kind'] not in {'table','kpi'}:story.append(p('This chart could not be drawn; the values are in the table below.','small'))
        story.extend(data_table(w));i+=1
    if appendix:
        story.append(PageBreak());story.append(p('Appendix: how this was calculated','h2'))
        story.append(p('Included so the figures can be checked. Numbers on the earlier pages are rounded for reading; the tables here show the exact values.','small'))
        for w in widgets:
            if w.get('kind')=='text' or 'source' not in w:continue
            source=w['source'];result=w['result']
            story.append(p(tile_title(w),'h3'))
            story.append(p(f"Question: {source['question']}"))
            story.append(p(f"Source file: {w.get('freshness',{}).get('label') or source['dataset_name']} · Data as of {readable_date(source.get('data_as_of') or source.get('last_successful_refresh'))}"))
            story.append(p('Snapshot status: '+status_label((w.get('freshness') or {}).get('status')),'small'))
            story.append(p(w['filters_applied']['scope'],'small'))
            if w['filters_applied']['unavailable']:story.append(p('Filters that could not be applied: '+str(w['filters_applied']['unavailable']),'small'))
            if w.get('currency_unavailable'):story.append(p(w['currency_unavailable'],'small'))
            for quote in w.get('currency_conversion',[]):
                story.append(p('Converted column '+str(quote['column'])+': 1 '+quote['source_currency']+' = '+quote['rate']+' '+quote['target_currency']+'; '+quote['rate_source']+'; effective '+readable_date(quote['effective_date'])+'; fetched '+readable_date(quote['fetched_at'])+('; historical' if quote['historical'] else '; latest available daily reference'),'small'))
            story.extend(data_table(w,exact=True))
            story.append(p('Executed SQL (first 5,000 characters; full SQL in the dashboard\'s provenance):','small'));story.append(p(source['sql'],'code'))
            for fact in w['evidence']['facts'][:12]:story.append(p('['+fact['id']+'] '+fact['statement'],'small'))
            for n in w['summary']:story.append(p('Narrative ('+source['narrative_source']+'): '+n['text'],'small'))
            if w.get('fallback_reason'):story.append(p('Chart unavailable: '+w['fallback_reason'],'small'))
            story.append(p('Result digest: '+w['evidence']['result_digest'],'small'))
        story.append(Spacer(1,10))
        story.append(p('Limits: computed facts cover returned query rows, not causal conclusions or guaranteed business correctness. Snapshot data may be stale. Active filters apply to output rows only.','small'))
    class ReportCanvas(Canvas):
        def __init__(self,*args,**kwargs):
            super().__init__(*args,**kwargs);self._pages=[]
        def showPage(self):
            if len(self._pages)+1>80:raise HTTPException(413,'Report exceeds 80 pages; reduce widgets or export structured JSON/CSV.')
            self._pages.append(dict(self.__dict__));self._startPage()
        def save(self):
            total=len(self._pages)
            for number,state in enumerate(self._pages,1):
                self.__dict__.update(state)
                self.setFont(font,8);self.setFillColor(grey)
                self.setStrokeColor(line);self.line(48,36,564,36)
                self.drawString(48,24,'Snapshot of your data; may be out of date');self.drawCentredString(306,24,'InsightIQ')
                self.drawRightString(564,24,f'Page {number} of {total}')
                if number>1:self.drawString(48,764,title[:70]);self.drawRightString(564,764,(project_name+' · ' if project_name else '')+prepared_text)
                Canvas.showPage(self)
            Canvas.save(self)
    stream=io.BytesIO()
    SimpleDocTemplate(stream,pagesize=(612,792),leftMargin=48,rightMargin=48,topMargin=48,bottomMargin=48,title=title,author='InsightIQ').build(story,canvasmaker=ReportCanvas)
    raw=stream.getvalue()
    if len(raw)>8*1024*1024:raise HTTPException(413,'PDF exceeds 8 MiB.')
    return raw


def report_router(dashboards):
    router=APIRouter(prefix='/api/dashboards',tags=['Reports'])
    def report_view(identifier, target_currency, historical_date):
        view = dashboards.view(identifier)
        if target_currency:
            from .currency import converted_view
            converted=[]
            for widget in view['widgets']:
                try:
                    part=converted_view({**view,'widgets':[widget]},target_currency,dashboards.analyst.currency_rates,historical_date)
                    converted.extend(part['widgets'])
                except HTTPException as exc:
                    if exc.status_code not in {429,502,503,504}:raise
                    original=copy.deepcopy(widget)
                    original['currency_unavailable']='Rate unavailable for '+target_currency+'. Original source currencies retained. '+str(exc.detail)
                    converted.append(original)
            view={**view,'widgets':converted,'currency_notice':'Display currency: '+target_currency+'. Rates are daily reference rates; unconfirmed or unavailable currencies remain original and are identified per chart.'}
        return view
    @router.get('/{identifier}/report.pdf')
    def pdf(request:Request,identifier:UUID,target_currency:Optional[str]=None,historical_date:Optional[date]=None,appendix:bool=True):
        if not dashboards.report_slots.acquire(False):raise HTTPException(429,'Two reports are already generating; try again shortly.')
        try:
            view=report_view(identifier,target_currency,historical_date)
            try:
                from .projects import CURRENT
                project_name=request.app.state.projects.get(CURRENT.get())['name']
            except Exception:project_name=None
            return Response(dashboard_pdf(view,project_name,appendix),media_type='application/pdf',headers={'Content-Disposition':'attachment; filename="insightiq-dashboard.pdf"'})
        finally:dashboards.report_slots.release()
    @router.get('/{identifier}/report.json')
    def structured(identifier:UUID,target_currency:Optional[str]=None,historical_date:Optional[date]=None):
        raw=json.dumps(report_view(identifier,target_currency,historical_date),ensure_ascii=True).encode()
        if len(raw)>8*1024*1024:raise HTTPException(413,'Structured report exceeds 8 MiB; export individual widget CSV files instead.')
        return Response(raw,media_type='application/json',headers={'Content-Disposition':'attachment; filename="insightiq-dashboard.json"'})
    return router
