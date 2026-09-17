/**
 * Spreadsheet paste.
 *
 * Copying a block of cells out of Sheets or Excel gives tab-separated text with
 * CRLF line breaks, and any cell containing a tab, comma, quote or newline
 * arrives wrapped in double quotes with internal quotes doubled. This parses
 * that faithfully, and falls back to comma splitting for a pasted CSV.
 */

function detectDelimiter(text: string): string {
  return text.includes("\t") ? "\t" : ",";
}

/** Split one delimited line, honouring quoted fields. */
function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"' && current === "") {
      quoted = true;
    } else if (char === delimiter) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseRows(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => splitLine(line, delimiter))
    .filter((fields) => fields.some((field) => field !== ""));
}

/**
 * Drop a header row if the first row looks like labels rather than data.
 * `dataHints` are lowercase words that only ever appear in real data.
 */
export function dropHeader(rows: string[][], headerHints: string[]): string[][] {
  const first = rows[0];
  if (!first) return rows;
  const joined = first.join(" ").toLowerCase();
  const looksLikeHeader = headerHints.some((hint) => joined.includes(hint));
  return looksLikeHeader ? rows.slice(1) : rows;
}

const TRUTHY = new Set(["yes", "y", "true", "1", "float", "x"]);

export function parseBoolean(value: string | undefined): boolean {
  return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
}

/** Match a free-text cell against a fixed set of options, case-insensitively. */
export function matchOption<T extends string>(
  value: string | undefined,
  options: readonly T[],
  aliases: Record<string, T> = {},
): T | null {
  if (!value) return null;
  const normalised = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  for (const option of options) {
    if (option.toLowerCase().replace(/[\s_-]+/g, "") === normalised) return option;
  }
  for (const [alias, option] of Object.entries(aliases)) {
    if (alias.toLowerCase().replace(/[\s_-]+/g, "") === normalised) return option;
  }
  return null;
}
