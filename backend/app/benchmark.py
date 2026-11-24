"""Authored reference benchmark. Gold material is never passed to the agent/RAG."""
import csv,io,json
from pathlib import Path
from datetime import date,datetime,timezone
from decimal import Decimal,InvalidOperation
from collections import Counter
from .charts import is_numeric
from .knowledge import digest

VERSION='retail-v1'
MAPPING={'id':'BIGINT','revenue':'DOUBLE','quantity':'BIGINT','order_date':'DATE','manager_id':'BIGINT','target':'DOUBLE'}
FIXTURE=Path(__file__).resolve().parents[1]/'benchmarks'/'retail-v1.csv'


def authored_cases():
    cases=[]
    def add(category,question,sql,columns,rows,ordered=False,difficulty='easy'):
        cases.append({'id':f'q{len(cases)+1:02}','category':category,'difficulty':difficulty,'question':question,
            'reference_sql':sql,'expected':{'columns':[{'name':n,'type':t} for n,t in columns],'rows':rows,'row_count':len(rows)},
            'ordered':ordered,'expectation':'sql','verification':'pending'})
    add('select','List all customer names, retaining duplicate records, in id order.','SELECT customer FROM data ORDER BY id',[('customer','VARCHAR')],[[v] for v in ['Ada','Ben','Ada','Cleo','Ben','Dan','Eli','Fay']],True)
    add('select','List the distinct regions alphabetically.','SELECT DISTINCT region FROM data ORDER BY region',[('region','VARCHAR')],[['North'],['South'],['West']],True)
    add('select','List the first three order IDs in ascending order.','SELECT id FROM data ORDER BY id LIMIT 3',[('id','BIGINT')],[[1],[2],[3]],True)
    add('select','Which customers have a West-region order? Keep duplicate order rows.','SELECT customer FROM data WHERE region=\'West\'',[('customer','VARCHAR')],[['Cleo'],['Dan']])
    add('aggregation','How many order records are there?','SELECT COUNT(*) AS orders FROM data',[('orders','BIGINT')],[[8]])
    add('aggregation','What is the sum of revenue across all orders?','SELECT SUM(revenue) AS total_revenue FROM data',[('total_revenue','DOUBLE')],[[1000]])
    add('aggregation','What is average revenue per order?','SELECT AVG(revenue) AS average_revenue FROM data',[('average_revenue','DOUBLE')],[[125]])
    add('aggregation','What is minimum order revenue?','SELECT MIN(revenue) AS minimum_revenue FROM data',[('minimum_revenue','DOUBLE')],[[0]])
    add('aggregation','What is maximum order revenue?','SELECT MAX(revenue) AS maximum_revenue FROM data',[('maximum_revenue','DOUBLE')],[[300]])
    add('aggregation','What is total ordered quantity?','SELECT SUM(quantity) AS total_quantity FROM data',[('total_quantity','BIGINT')],[[25]])
    add('aggregation','How many distinct customers ordered?','SELECT COUNT(DISTINCT customer) AS customers FROM data',[('customers','BIGINT')],[[6]])
    add('group_by','Show total revenue for each region.','SELECT region,SUM(revenue) AS total_revenue FROM data GROUP BY region',[('region','VARCHAR'),('total_revenue','DOUBLE')],[['North',150],['South',400],['West',450]])
    add('group_by','Show order count for each region.','SELECT region,COUNT(*) AS orders FROM data GROUP BY region',[('region','VARCHAR'),('orders','BIGINT')],[['North',3],['South',3],['West',2]])
    add('group_by','Show total quantity for each region.','SELECT region,SUM(quantity) AS total_quantity FROM data GROUP BY region',[('region','VARCHAR'),('total_quantity','BIGINT')],[['North',6],['South',8],['West',11]])
    add('group_by','Show total revenue per customer.','SELECT customer,SUM(revenue) AS total_revenue FROM data GROUP BY customer',[('customer','VARCHAR'),('total_revenue','DOUBLE')],[['Ada',150],['Ben',300],['Cleo',150],['Dan',300],['Eli',0],['Fay',100]])
    add('group_by','Which regions have more than two orders?','SELECT region,COUNT(*) AS orders FROM data GROUP BY region HAVING COUNT(*)>2',[('region','VARCHAR'),('orders','BIGINT')],[['North',3],['South',3]])
    add('order_by','Show regions ranked by total revenue descending.','SELECT region,SUM(revenue) AS total_revenue FROM data GROUP BY region ORDER BY total_revenue DESC',[('region','VARCHAR'),('total_revenue','DOUBLE')],[['West',450],['South',400],['North',150]],True)
    add('order_by','Show the top two orders by revenue descending, then ID ascending.','SELECT id,revenue FROM data ORDER BY revenue DESC,id ASC LIMIT 2',[('id','BIGINT'),('revenue','DOUBLE')],[[6,300],[2,200]],True)
    add('order_by','List customer names alphabetically, keeping duplicate order rows.','SELECT customer FROM data ORDER BY customer',[('customer','VARCHAR')],[[v] for v in ['Ada','Ada','Ben','Ben','Cleo','Dan','Eli','Fay']],True)
    add('date_filter','What is total revenue from March 2026 orders?','SELECT SUM(revenue) AS total_revenue FROM data WHERE order_date>=CAST(\'2026-03-01\' AS DATE) AND order_date<CAST(\'2026-04-01\' AS DATE)',[('total_revenue','DOUBLE')],[[500]])
    add('date_filter','List IDs for January 2026 orders, ascending.','SELECT id FROM data WHERE order_date>=CAST(\'2026-01-01\' AS DATE) AND order_date<CAST(\'2026-02-01\' AS DATE) ORDER BY id',[('id','BIGINT')],[[1],[2]],True)
    add('date_filter','What is the earliest order date?','SELECT MIN(order_date) AS first_day FROM data',[('first_day','DATE')],[['2026-01-01']])
    add('date_filter','What is the latest order date?','SELECT MAX(order_date) AS last_day FROM data',[('last_day','DATE')],[['2026-03-04']])
    add('date_filter','Show monthly revenue totals in chronological order.','SELECT TRY_CAST(DATE_TRUNC(\'month\',order_date) AS DATE) AS month,SUM(revenue) AS total_revenue FROM data GROUP BY month ORDER BY month',[('month','DATE'),('total_revenue','DOUBLE')],[['2026-01-01',300],['2026-02-01',200],['2026-03-01',500]],True,'medium')
    add('numeric','Show revenue per unit for order ID 3.','SELECT revenue/quantity AS revenue_per_unit FROM data WHERE id=3',[('revenue_per_unit','DOUBLE')],[[50/3]])
    add('numeric','What is revenue after a hypothetical explicit 10 percent discount across all orders?','SELECT SUM(revenue*0.9) AS discounted_revenue FROM data',[('discounted_revenue','DOUBLE')],[[900]])
    add('numeric','What is the range between maximum and minimum order revenue?','SELECT MAX(revenue)-MIN(revenue) AS revenue_range FROM data',[('revenue_range','DOUBLE')],[[300]])
    add('numeric','Show each order ID with revenue times quantity, in ID order.','SELECT id,revenue*quantity AS product FROM data ORDER BY id',[('id','BIGINT'),('product','DOUBLE')],[[1,200],[2,800],[3,150],[4,750],[5,200],[6,1800],[7,0],[8,200]],True)
    add('metric','Define average revenue per unit as total revenue divided by total quantity. Return it.','SELECT SUM(revenue)/SUM(quantity) AS revenue_per_unit FROM data',[('revenue_per_unit','DOUBLE')],[[40]])
    add('metric','Define high-value orders as revenue at least 150. How many are there?','SELECT COUNT(*) AS high_value_orders FROM data WHERE revenue>=150',[('high_value_orders','BIGINT')],[[3]])
    add('metric','Define positive-revenue orders as revenue greater than zero. How many are there?','SELECT COUNT(*) AS positive_orders FROM data WHERE revenue>0',[('positive_orders','BIGINT')],[[7]])
    add('metric','What percentage of total revenue belongs to the West region?','SELECT 100.0*SUM(CASE WHEN region=\'West\' THEN revenue ELSE 0 END)/SUM(revenue) AS revenue_share_percent FROM data',[('revenue_share_percent','DOUBLE')],[[45]],False,'medium')
    add('filter','List IDs with revenue greater than 100, ascending.','SELECT id FROM data WHERE revenue>100 ORDER BY id',[('id','BIGINT')],[[2],[4],[6]],True)
    add('filter','List IDs with revenue exactly zero.','SELECT id FROM data WHERE revenue=0',[('id','BIGINT')],[[7]])
    add('filter','List IDs for the nonexistent East region.','SELECT id FROM data WHERE region=\'East\'',[('id','BIGINT')],[])
    add('filter','How many East-region orders are there?','SELECT COUNT(*) AS orders FROM data WHERE region=\'East\'',[('orders','BIGINT')],[[0]])
    add('join','Self-join orders to their manager order using a.manager_id=b.id; list each order ID and manager customer in ID order.','SELECT a.id,b.customer AS manager_customer FROM data a JOIN data b ON a.manager_id=b.id ORDER BY a.id',[('id','BIGINT'),('manager_customer','VARCHAR')],[[1,'Ada'],[2,'Ada'],[3,'Ada'],[4,'Ben'],[5,'Ada'],[6,'Ben'],[7,'Ada'],[8,'Ada']],True,'hard')
    add('join','Using a self join, list distinct customer names whose order manager has customer name Ben.','SELECT DISTINCT a.customer FROM data a JOIN data b ON a.manager_id=b.id WHERE b.customer=\'Ben\'',[('customer','VARCHAR')],[['Cleo'],['Dan']],False,'hard')
    add('join','Self-join by matching manager order ID and count the matched order pairs.','SELECT COUNT(*) AS matched_pairs FROM data a JOIN data b ON a.manager_id=b.id',[('matched_pairs','BIGINT')],[[8]],False,'medium')
    add('cte','Using a CTE of regional revenue, return regions with revenue greater than 200.','WITH totals AS (SELECT region,SUM(revenue) AS total_revenue FROM data GROUP BY region) SELECT region,total_revenue FROM totals WHERE total_revenue>200',[('region','VARCHAR'),('total_revenue','DOUBLE')],[['South',400],['West',450]],False,'medium')
    for category,question in [('ambiguous','Is performance good? No definition of good or performance metric is provided.'),('ambiguous','What is our profit? Costs and profit definition are not provided.'),('unanswerable','Join these orders to a separate private customer database and show their email addresses.'),('unanswerable','Delete all order records.'),('unanswerable','What will next year revenue be? No forecast model or assumptions are provided.')]:
        cases.append({'id':f'q{len(cases)+1:02}','category':category,'difficulty':'medium','question':question,'reference_sql':None,'expected':None,'ordered':False,'expectation':'abstain','verification':'verified','verification_method':'Authored unsupported/ambiguous request; no SQL is appropriate under current authorization.'})
    return cases


def family(column):
    if is_numeric(column):return 'numeric'
    typ=column['type']
    if typ.startswith('TIMESTAMP'):return 'timestamp'
    return typ


def equivalent(actual,expected,ordered=False):
    if any(len(row)!=len(result['columns']) for result in (actual,expected) for row in result['rows']):return False,'Row width does not match typed column metadata.'
    if [c['name'] for c in actual['columns']]!=[c['name'] for c in expected['columns']]:return False,'Column names/semantic aliases differ.'
    if [family(c) for c in actual['columns']]!=[family(c) for c in expected['columns']]:return False,'Logical type families differ.'
    if len(actual['rows'])!=len(expected['rows']):return False,'Row count or duplicate multiplicity differs.'
    def equal_row(a,b):
        for col,x,y in zip(expected['columns'],a,b):
            if x is None or y is None:
                if x is not y:return False
            elif family(col)=='numeric':
                try:
                    xx,yy=Decimal(str(x)),Decimal(str(y))
                    if not xx.is_finite() or not yy.is_finite():
                        if str(xx)!=str(yy):return False
                    elif col['type'] in {'TINYINT','SMALLINT','INTEGER','BIGINT','HUGEINT','UTINYINT','USMALLINT','UINTEGER','UBIGINT','UHUGEINT'}:
                        if xx!=yy:return False
                    elif abs(xx-yy)>max(Decimal('1e-9'),Decimal('1e-6')*max(abs(xx),abs(yy))):return False
                except (ValueError,InvalidOperation):return False
            elif family(col)=='DATE':
                try:
                    if date.fromisoformat(str(x))!=date.fromisoformat(str(y)):return False
                except ValueError:return False
            elif family(col)=='timestamp':
                try:
                    xx=datetime.fromisoformat(str(x).replace('Z','+00:00'));yy=datetime.fromisoformat(str(y).replace('Z','+00:00'))
                    if xx!=yy:return False
                except ValueError:return False
            elif family(col)=='BOOLEAN':
                if type(x) is not bool or type(y) is not bool or x!=y:return False
            elif x!=y:return False
        return True
    if ordered:return (True,'Ordered typed rows match.') if all(equal_row(a,b) for a,b in zip(actual['rows'],expected['rows'])) else (False,'Ordered values differ.')
    # Benchmark <=8 rows; maximum matching preserves multiplicities under tolerance.
    if len(actual['rows'])>100:return False,'Unordered approximate comparison is limited to 100 rows.'
    matched={}
    def assign(i,seen):
        for j,row in enumerate(expected['rows']):
            if j in seen or not equal_row(actual['rows'][i],row):continue
            seen.add(j)
            if j not in matched or assign(matched[j],seen):matched[j]=i;return True
        return False
    ok=all(assign(i,set()) for i in range(len(actual['rows'])))
    return ok,'Typed multiset matches; duplicates and NULLs preserved.' if ok else 'Typed result values differ.'
