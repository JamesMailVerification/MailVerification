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

function unwrapBase64Text(value: string): string {
  let decoded = value;
  for (let depth = 0; depth < 3; depth += 1) {
    const compact = decoded.replace(/\s+/g, "");
    if (compact.length < 80 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) break;
    try {
      const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
      const binary = atob(padded);
      const next = new TextDecoder("utf-8").decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
      const readable = [...next].filter((character) => /[\x09\x0a\x0d\x20-\x7e가-힣]/.test(character)).length / Math.max(next.length, 1);
      if (readable < 0.85) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function decodeMailBody(value: string): string {
  const mimeParts = [...value.matchAll(/(?:^|\r?\n--[^\r\n]+\r?\n)([\s\S]*?)\r?\n\r?\n([A-Za-z0-9+/=\r\n]{16,})(?=\r?\n--|$)/gi)];
  const textParts = mimeParts.filter((match) => /Content-Type:\s*text\/(?:plain|html)/i.test(match[1]) && /Content-Transfer-Encoding:\s*base64/i.test(match[1]));
  // Some Daum messages place MIME headers in an unusual order or omit the
  // opening boundary from BODY[TEXT]. Keep a transfer-encoding fallback for
  // those messages instead of showing the raw Base64 payload in the preview.
  const base64Parts = textParts.length
    ? textParts.map((match) => ({ headers: match[1], payload: match[2] }))
    : [...value.matchAll(/Content-Transfer-Encoding:\s*base64[\s\S]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]{16,})/gi)].map((match) => ({
      headers: value.slice(Math.max(0, (match.index ?? 0) - 1000), match.index ?? 0),
      payload: match[1],
    }));
  const decodedBase64Parts = base64Parts.flatMap(({ headers, payload }) => {
    try {
      const charset = headers.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] ?? "utf-8";
      const binary = atob(payload.replace(/\s+/g, ""));
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      try {
        return [new TextDecoder(charset).decode(bytes)];
      } catch {
        return [new TextDecoder("utf-8").decode(bytes)];
      }
    } catch {
      return [];
    }
  });
  const source = decodedBase64Parts.length ? decodedBase64Parts.join(" ") : value;
  if (decodedBase64Parts.length) return unwrapBase64Text(source);
  const quotedPrintable = source
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  const bytes = Uint8Array.from(quotedPrintable, (character) => character.charCodeAt(0));
  try {
    return unwrapBase64Text(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return unwrapBase64Text(quotedPrintable);
  }
}

function extractMailImages(value: string): string[] {
  const images: string[] = [];
  let encodedBytes = 0;
  for (const match of value.matchAll(/(?:^|\r?\n--[^\r\n]+\r?\n)([\s\S]*?)\r?\n\r?\n([A-Za-z0-9+/=\r\n]{32,})(?=\r?\n--|$)/gi)) {
    const mime = match[1].match(/Content-Type:\s*image\/(png|jpe?g|gif|webp)/i)?.[1]?.toLowerCase();
    if (!mime || !/Content-Transfer-Encoding:\s*base64/i.test(match[1])) continue;
    const payload = match[2].replace(/\s+/g, "");
    if (!payload || encodedBytes + payload.length > 4_000_000 || images.length >= 6) continue;
    encodedBytes += payload.length;
    images.push(`data:image/${mime === "jpg" ? "jpeg" : mime};base64,${payload}`);
  }
  const html = decodeMailBody(value);
  for (const match of html.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
    if (images.length >= 6 || images.includes(match[1])) continue;
    images.push(match[1]);
  }
  return images;
}

function readableMailText(value: string): string {
  return decodeMimeWord(decodeMailBody(value)
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim());
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

export async function readDaumMessagePreview(loginId: string, appPassword: string, mailboxName: string, uid: string): Promise<{ text: string; images: string[] }> {
  if (!/^\d+$/.test(uid)) throw new Error("INVALID_MESSAGE_UID");
  const socket = connect({ hostname: "imap.daum.net", port: 993 }, { secureTransport: "on" });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  try {
    const greeting = await readUntil(reader, (response) => response.includes("\r\n"));
    if (!/^\* OK/im.test(greeting)) throw new Error("IMAP_SERVER_UNAVAILABLE");
    const login = await writeCommand(writer, reader, "p101", `LOGIN ${quoteImap(loginId)} ${quoteImap(appPassword)}`);
    if (!/(?:^|\r\n)p101 OK/i.test(login)) throw new Error("IMAP_AUTHENTICATION_FAILED");
    const examine = await writeCommand(writer, reader, "p102", `EXAMINE ${quoteImap(mailboxName)}`);
    if (!/(?:^|\r\n)p102 OK/i.test(examine)) throw new Error("IMAP_MAILBOX_FAILED");
    const fetched = await writeCommand(writer, reader, "p103", `UID FETCH ${uid} (BODY.PEEK[])`, 12_000_000);
    if (!/(?:^|\r\n)p103 OK/i.test(fetched)) throw new Error("IMAP_FETCH_FAILED");
    const raw = literalAfter(fetched, /BODY\[\]\s+\{(\d+)\}\r\n/i);
    if (!raw) throw new Error("IMAP_MESSAGE_NOT_FOUND");
    return { text: readableMailText(raw).slice(0, 20_000), images: extractMailImages(raw) };
  } finally {
    reader.releaseLock();
    writer.releaseLock();
    socket.close();
  }
}

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
      `UID FETCH ${uids.join(",")} (UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)] BODY.PEEK[TEXT]<0.16384>)`,
      3_000_000,
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
        snippet: readableMailText(body).replace(/\s+/g, " ").slice(0, 4000),
        unread: !/\\Seen/i.test(block.match(/FLAGS \(([^)]*)\)/i)?.[1] ?? ""),
        // Keep each message distinct when candidates are upserted. A shared
        // inbox URL caused forwarded messages with the same subject to replace
        // the original announcement and its schedule details.
        sourceUrl: `https://mail.daum.net/#morrow-${uid}`,
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
