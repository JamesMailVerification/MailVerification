import { connect } from "cloudflare:sockets";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const DEFAULT_DAUM_MAILBOX = "Collie";

function quoteImap(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("INVALID_IMAP_CREDENTIAL");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (response: string) => boolean,
  maxLength = 32_768,
): Promise<string> {
  let response = "";
  while (response.length < maxLength) {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("IMAP_TIMEOUT")), 10_000)),
    ]);
    if (result.done) break;
    response += decoder.decode(result.value, { stream: true });
    if (predicate(response)) return response;
  }
  throw new Error("IMAP_RESPONSE_INCOMPLETE");
}

async function writeCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  tag: string,
  command: string,
  maxLength?: number,
): Promise<string> {
  await writer.write(encoder.encode(`${tag} ${command}\r\n`));
  return readUntil(reader, (response) => new RegExp(`(?:^|\\r\\n)${tag} (?:OK|NO|BAD)`, "i").test(response), maxLength);
}

function decodeMimeWord(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]+)\?=/gi, (_, charset: string, encoding: string, payload: string) => {
    try {
      let bytes: Uint8Array;
      if (encoding.toLowerCase() === "b") {
        const binary = atob(payload);
        bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      } else {
        const decoded = payload.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
        bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
      }
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return payload;
    }
  });
}

function headerValue(headers: string, name: string): string {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  return unfolded.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
}

function literalAfter(block: string, marker: RegExp): string {
  const match = marker.exec(block);
  if (!match || match.index === undefined) return "";
  const length = Number(match[1]);
  const start = match.index + match[0].length;
  return block.slice(start, start + length);
}

export type DaumMessageSummary = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
  unread: boolean;
  sourceUrl: string;
};

export async function readRecentDaumMessages(loginId: string, appPassword: string, mailboxName = DEFAULT_DAUM_MAILBOX, days = 7): Promise<DaumMessageSummary[]> {
  const socket = connect({ hostname: "imap.daum.net", port: 993 }, { secureTransport: "on" });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  try {
    const greeting = await readUntil(reader, (response) => response.includes("\r\n"));
    if (!/^\* OK/im.test(greeting)) throw new Error("IMAP_SERVER_UNAVAILABLE");

    const login = await writeCommand(writer, reader, "a101", `LOGIN ${quoteImap(loginId)} ${quoteImap(appPassword)}`);
    if (!/(?:^|\r\n)a101 OK/i.test(login)) throw new Error("IMAP_AUTHENTICATION_FAILED");

    const examine = await writeCommand(writer, reader, "a102", `EXAMINE ${quoteImap(mailboxName)}`);
    if (!/(?:^|\r\n)a102 OK/i.test(examine)) throw new Error("IMAP_MAILBOX_FAILED");

    const safeDays = days === 30 ? 30 : 7;
    // A busy custom mailbox can receive more than 30 messages in a day. Keep
    // enough of the newest UIDs so a same-day deadline is not dropped before
    // the client applies its Today/Unread/Recent filter.
    const resultLimit = 100;
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
    const sinceLabel = `${String(since.getUTCDate()).padStart(2, "0")}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][since.getUTCMonth()]}-${since.getUTCFullYear()}`;
    const search = await writeCommand(writer, reader, "a103", `UID SEARCH SINCE ${sinceLabel}`);
    if (!/(?:^|\r\n)a103 OK/i.test(search)) throw new Error("IMAP_SEARCH_FAILED");
    const uids = (search.match(/^\* SEARCH(?:\s+([\d ]+))?/im)?.[1]?.trim().split(/\s+/) ?? []).filter(Boolean).slice(-resultLimit).reverse();
    if (!uids.length) return [];

    const fetch = await writeCommand(
      writer,
      reader,
      "a104",
      `UID FETCH ${uids.join(",")} (UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)] BODY.PEEK[TEXT]<0.512>)`,
      1_500_000,
    );
    if (!/(?:^|\r\n)a104 OK/i.test(fetch)) throw new Error("IMAP_FETCH_FAILED");

    return fetch.split(/(?=\* \d+ FETCH \()/i).flatMap((block) => {
      const uid = block.match(/\bUID (\d+)/i)?.[1];
      if (!uid) return [];
      const headers = literalAfter(block, /BODY\[HEADER\.FIELDS \(SUBJECT FROM DATE\)\]\s+\{(\d+)\}\r\n/i);
      const body = literalAfter(block, /BODY\[TEXT\]<0>\s+\{(\d+)\}\r\n/i);
      const subject = decodeMimeWord(headerValue(headers, "Subject")) || "제목 없음";
      const from = decodeMimeWord(headerValue(headers, "From")) || "발신자 정보 없음";
      const dateValue = headerValue(headers, "Date");
      const parsedDate = new Date(dateValue);
      return [{
        id: `daum-${uid}`,
        threadId: uid,
        subject,
        from,
        receivedAt: Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toISOString(),
        snippet: decodeMimeWord(body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 220),
        unread: !/\\Seen/i.test(block.match(/FLAGS \(([^)]*)\)/i)?.[1] ?? ""),
        sourceUrl: "https://mail.daum.net/",
      }];
    }).slice(0, resultLimit);
  } finally {
    reader.releaseLock();
    writer.releaseLock();
    socket.close();
  }
}

export async function testDaumImapConnection(loginId: string, appPassword: string, mailboxName = DEFAULT_DAUM_MAILBOX): Promise<void> {
  const socket = connect({ hostname: "imap.daum.net", port: 993 }, { secureTransport: "on" });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  try {
    const greeting = await readUntil(reader, (response) => response.includes("\r\n"));
    if (!/^\* OK/im.test(greeting)) throw new Error("IMAP_SERVER_UNAVAILABLE");

    await writer.write(encoder.encode(`a001 LOGIN ${quoteImap(loginId)} ${quoteImap(appPassword)}\r\n`));
    const loginResponse = await readUntil(reader, (response) => /(?:^|\r\n)a001 (?:OK|NO|BAD)/i.test(response));
    if (!/(?:^|\r\n)a001 OK/i.test(loginResponse)) throw new Error("IMAP_AUTHENTICATION_FAILED");

    const mailboxResponse = await writeCommand(writer, reader, "a002", `EXAMINE ${quoteImap(mailboxName)}`);
    if (!/(?:^|\r\n)a002 OK/i.test(mailboxResponse)) throw new Error("IMAP_MAILBOX_FAILED");

    await writer.write(encoder.encode("a003 LOGOUT\r\n"));
  } finally {
    reader.releaseLock();
    writer.releaseLock();
    socket.close();
  }
}
