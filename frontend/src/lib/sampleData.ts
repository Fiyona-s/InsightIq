/** A small fictional shop, for trying the app. Built in code, so nothing is added to a workspace unless the owner presses the button. */
export const SAMPLE_FILE_NAME = "sample-shop-orders.csv";
const PRODUCTS: [string, number][] = [["Notebook", 4.5], ["Desk lamp", 24], ["Backpack", 39], ["Water bottle", 12], ["Headphones", 59]];
const REGIONS = ["North", "South", "East", "West"];
export function sampleCsv(): string {
  let seed = 7;
  const next = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const rows = ["order_id,order_date,product,region,quantity,unit_price,revenue"];
  for (let i = 1; i <= 60; i += 1) {
    const [product, price] = PRODUCTS[next(PRODUCTS.length)];
    const quantity = 1 + next(5), month = 1 + ((i - 1) % 6), day = 1 + next(28);
    rows.push([i, `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, product, REGIONS[next(4)], quantity, price.toFixed(2), (price * quantity).toFixed(2)].join(","));
  }
  return rows.join("\n") + "\n";
}
export const sampleFile = () => new File([sampleCsv()], SAMPLE_FILE_NAME, { type: "text/csv" });
