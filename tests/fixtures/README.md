# Sample kit lists for spec 117 (importing equipment)

These are read from the repository by `tests/specs/117-gear-import.cjs`. They are made up: no real person's kit, no real
serial numbers. Each is modelled on a kind of file people really have (docs/developers.md says where the column
headings come from).

| File | What it stands for |
|---|---|
| `gear-kit-app-sortly-style.csv` | A kit app's export in the layout Sortly documents: folders as rows, a price of one and a value of the lot, custom fields at the end. |
| `gear-kit-app-cheqroom-style.csv` | Another kit app's export in the layout Cheqroom documents: brand and model apart from the name, month-first dates, a written-down value. |
| `gear-rental-house-order.csv` | A rental house's order saved from Excel on Windows: semicolons, decimal commas, lines above the table, a heading over each group, a total. **It is in Windows-1252, not UTF-8, on purpose** (the spec checks that it still is): do not re-save it in an editor that converts. |
| `gear-insurer-schedule.xlsx` | An insurer's equipment schedule, written by openpyxl 3.1: inline strings, real date cells, currency formats, a title block, group headings, a total by formula with no saved result, a second sheet. |
| `gear-spreadsheet-template.xlsx` | A home-inventory style template, written by LibreOffice Calc from a CSV: shared strings, dates under a custom format. |

The spec also builds a third workbook by hand, for the corners of the format the two writers above do not produce.
