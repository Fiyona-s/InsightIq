"""Builds three small summary files from data/online-retail.csv for the Predictions demo.
AutoML trains on at most 5,000 rows and never samples by itself, so the owner makes a bounded file on purpose.
Sales lines = InvoiceNo not starting with C, Quantity > 0, UnitPrice > 0 (same rule as docs/demo/verify_questions.online_retail.json).
Run from the project folder: python3 docs/demo/make_online_retail_summaries.py   (needs pandas; do not use python -I, it hides installed packages)"""
import pandas as pd
df = pd.read_csv("data/online-retail.csv", dtype={"InvoiceNo": str, "StockCode": str, "CustomerID": str}, parse_dates=["InvoiceDate"])
s = df[~df["InvoiceNo"].str.startswith("C") & (df["Quantity"] > 0) & (df["UnitPrice"] > 0)].copy()
s["revenue"] = s["Quantity"] * s["UnitPrice"]
c = s.dropna(subset=["CustomerID"]).groupby("CustomerID").agg(
    country=("Country", lambda x: x.mode().iat[0]),
    invoices=("InvoiceNo", "nunique"),
    units_bought=("Quantity", "sum"),
    different_products=("StockCode", "nunique"),
    first=("InvoiceDate", "min"), last=("InvoiceDate", "max"),
    total_spend=("revenue", "sum")).reset_index()
c["days_between_first_and_last_order"] = (c["last"] - c["first"]).dt.days
c["total_spend"] = c["total_spend"].round(2)
c = c.drop(columns=["first", "last"]).rename(columns={"CustomerID": "customer_id"})
c.to_csv("data/online-retail-customers.csv", index=False)
d = s.assign(day=s["InvoiceDate"].dt.date).groupby("day").agg(revenue=("revenue", "sum"), invoices=("InvoiceNo", "nunique"), units=("Quantity", "sum")).reset_index()
d["revenue"] = d["revenue"].round(2)
d.to_csv("data/online-retail-daily.csv", index=False)
# 3) First orders (for "Predict a category"): one row per customer who first bought before 1 June 2011, so every one of them
#    had at least six months in the data to buy again. Features describe ONLY the first order; the label says whether they bought again.
f = s.dropna(subset=["CustomerID"]).copy()
first_ts = f.groupby("CustomerID")["InvoiceDate"].transform("min")
first = f[f["InvoiceDate"] == first_ts]
first_inv = first.groupby("CustomerID")["InvoiceNo"].min().rename("first_invoice")
f = f.merge(first_inv, left_on="CustomerID", right_index=True)
fo = f[f["InvoiceNo"] == f["first_invoice"]].groupby("CustomerID").agg(
    country=("Country", lambda x: x.mode().iat[0]),
    first_order_units=("Quantity", "sum"),
    first_order_different_products=("StockCode", "nunique"),
    first_order_value=("revenue", "sum"),
    first_order_month=("InvoiceDate", lambda x: int(x.min().month)),
    first_order_date=("InvoiceDate", "min"))
fo["bought_again"] = (f.groupby("CustomerID")["InvoiceNo"].nunique() >= 2).map({True: "yes", False: "no"})
fo = fo[fo["first_order_date"] < "2011-06-01"].drop(columns=["first_order_date"]).reset_index().rename(columns={"CustomerID": "customer_id"})
fo["first_order_value"] = fo["first_order_value"].round(2)
fo.to_csv("data/online-retail-first-orders.csv", index=False)
print(len(c), "customers;", len(d), "days;", len(fo), "first-order rows;", fo["bought_again"].value_counts().to_dict())
