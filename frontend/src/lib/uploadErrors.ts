/**
 * Plain-words versions of the upload problems the server and the browser report (PRODUCT-POLISH P3).
 * The server's own messages are unchanged; this only decides what the owner reads. Unknown problems keep the original text in brackets.
 */
const KNOWN: [RegExp, string][] = [
  [/Select a \.csv file/i, "That file is not a CSV. In your spreadsheet choose Save as, then CSV, and try again."],
  [/Maximum upload size is ([\d.]+) MB/i, "That file is too big (the limit is $1 MB). Remove old rows or columns you do not need, or split it into smaller files, and try again."],
  [/Maximum ([\d,]+) rows/i, "That file has more than $1 rows. Split it into smaller files and upload them one at a time."],
  [/same number of fields as the header/i, "Some rows have a different number of columns than the first row. If a cell contains a comma, put that cell in quotes, then try again."],
  [/Column names must be unique/i, "Two columns have the same name. Rename one of them in your spreadsheet and try again."],
  [/nonempty column names/i, "Every column needs a name in the first row (up to 100 columns). Add the missing names and try again."],
  [/valid UTF-8 CSV/i, "We could not read that file. Save it as a UTF-8 CSV and try again."],
  [/Failed to fetch|NetworkError|Load failed/i, "We could not reach the app. Check that it is running, then try again."],
];
export function plainUploadError(message: string): string {
  const text = (message || "").trim();
  for (const [pattern, plain] of KNOWN) { const m = pattern.exec(text); if (m) return plain.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? ""); }
  return text ? `We could not import that file (${text}). Check that it opens as a table in a spreadsheet, then try again.` : "We could not import that file. Check that it opens as a table in a spreadsheet, then try again.";
}
