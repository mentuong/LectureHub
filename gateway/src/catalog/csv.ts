export function parseCsv(text: string): string[][] {
  // Remove BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  // Normalize line endings to LF
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // Check if next char is also a quote (escaped quote)
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === ',') {
        currentRow.push(currentField);
        currentField = "";
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = "";
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  // Add last field and row if any
  if (inQuotes) {
    // Unterminated quote, treat as end
    currentRow.push(currentField);
    rows.push(currentRow);
  } else if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Remove trailing empty lines
  while (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    if (lastRow.length === 1 && lastRow[0].trim() === "") {
      rows.pop();
    } else if (lastRow.every(f => f.trim() === "")) {
      rows.pop();
    } else {
      break;
    }
  }

  return rows;
}
