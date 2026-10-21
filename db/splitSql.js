// db/splitSql.js
// Splits a .sql file into single statements, understanding the mysql client's `DELIMITER` command
// so the SAME file can be run by the mysql CLI and by the API's migration runner.
// Comment-only chunks are dropped; comments inside a statement are kept (the server ignores them).

const hasCode = (text) => text.split(/\r?\n/).some(l => l.trim() !== '' && !l.trim().startsWith('--'));

// Drops leading blank / comment-only lines so each statement starts with its first keyword.
const stripLeadingComments = (text) => {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('--'))) i++;
  return lines.slice(i).join('\n').trim();
};

export function splitSqlStatements(sql) {
  const out = [];
  let delimiter = ';';
  let buf = [];

  const flush = () => {
    const text = stripLeadingComments(buf.join('\n'));
    if (text && hasCode(text)) out.push(text);
    buf = [];
  };

  for (const line of String(sql).split(/\r?\n/)) {
    const m = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (m) { flush(); delimiter = m[1]; continue; }

    buf.push(line);
    const trimmed = line.trimEnd();
    if (!trimmed.trimStart().startsWith('--') && trimmed.endsWith(delimiter)) {
      const joined = buf.join('\n');
      const body = stripLeadingComments(joined.slice(0, joined.lastIndexOf(delimiter)));
      buf = [];
      if (body && hasCode(body)) out.push(body);
    }
  }
  flush();
  return out;
}

export default { splitSqlStatements };
