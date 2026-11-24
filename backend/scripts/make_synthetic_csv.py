#!/usr/bin/env python3
"""Writes a SYNTHETIC orders CSV for load tests (fictional values, fixed seed). Never commit the output.
    python scripts/make_synthetic_csv.py --rows 500000 --out /tmp/synthetic-500k.csv
"""
import argparse
import random

REGIONS = ['North', 'South', 'East', 'West', 'Central']
PRODUCTS = ['Notebook', 'Desk lamp', 'Backpack', 'Water bottle', 'Headphones', 'Mouse', 'Keyboard', 'Monitor']
HEADER = 'order_id,order_date,customer_id,region,product,quantity,unit_price,revenue\n'


def lines(rows, seed=11):
    rng = random.Random(seed)
    for i in range(1, rows + 1):
        qty, price = rng.randint(1, 9), round(rng.uniform(3, 400), 2)
        yield f'{i},2025-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d},C{rng.randint(1, 50000)},{rng.choice(REGIONS)},{rng.choice(PRODUCTS)},{qty},{price},{round(qty * price, 2)}\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--rows', type=int, default=500_000)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    with open(args.out, 'w', encoding='utf-8', newline='') as handle:
        handle.write(HEADER)
        handle.writelines(lines(args.rows))
    print(args.out)


if __name__ == '__main__':
    main()
