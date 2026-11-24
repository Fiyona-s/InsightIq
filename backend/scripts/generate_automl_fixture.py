"""Generate an explicitly synthetic, deterministic retail CSV for local ML demos.
Never loaded automatically and never used as a benchmark answer source.
"""
import argparse,csv,random
from datetime import date,timedelta
from pathlib import Path

def generate(path,rows=600,seed=42):
    if not 120<=rows<=5000:raise ValueError('Use 120–5000 rows for the multi-task synthetic demo.')
    rng=random.Random(seed);path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('w',newline='') as output:
        writer=csv.writer(output);writer.writerow(['order_id','order_date','customer_id','category','product','region','sales_channel','quantity','unit_price_inr','discount_pct','order_status','net_revenue_inr'])
        for i in range(rows):
            category=rng.choice(['Apparel','Home','Electronics']);price=rng.choice([299,799,1299,2499]);quantity=rng.randint(1,5);discount=rng.choice([0,5,10,15]);status=rng.choices(['Delivered','Returned','Cancelled'],weights=[.8,.15,.05])[0]
            net=quantity*price*(1-discount/100)*(0 if status=='Cancelled' else .5 if status=='Returned' else 1)
            writer.writerow([f'SYNTH-{i:05}',(date(2025,1,1)+timedelta(days=i//3)).isoformat(),f'SYNTH-C{i%50:03}',category,category+' product',rng.choice(['North','South','West']),rng.choice(['Online','Store']),quantity,price,discount,status,round(net,2)])
    return path
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',default='fixtures/automl/SYNTHETIC-retail-600.csv');parser.add_argument('--rows',type=int,default=600);parser.add_argument('--seed',type=int,default=42);args=parser.parse_args();print('Wrote explicitly SYNTHETIC fixture:',generate(args.output,args.rows,args.seed))
