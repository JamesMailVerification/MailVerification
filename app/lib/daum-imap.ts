import { connect } from "cloudflare:sockets";

const encoder = new TextEncoder();
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
    // Keep the IMAP literal byte-for-byte. Decoding the whole response as
    // UTF-8 here corrupts EUC-KR text and binary attachments before the MIME
    // part's own charset and transfer encoding can be applied.
    response += Array.from(result.value, (byte) => String.fromCharCode(byte)).join("");
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

type MimeLeaf = { headers: string; payload: string };

function splitMimeEntity(value: string): { headers: string; body: string } {
  const separator = value.match(/\r?\n\r?\n/);
  if (!separator || separator.index === undefined) return { headers: "", body: value };
  const bodyStart = separator.index + separator[0].length;
  return { headers: value.slice(0, separator.index), body: value.slice(bodyStart) };
}

function mimeHeader(headers: string, name: string): string {
  return headerValue(headers, name);
}

function collectMimeLeaves(value: string, depth = 0): MimeLeaf[] {
  if (depth > 8) return [];
  const { headers, body } = splitMimeEntity(value);
  const contentType = mimeHeader(headers, "Content-Type") || "text/plain";
  const boundary = contentType.match(/boundary\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i)?.slice(1).find(Boolean);
  if (/^multipart\//i.test(contentType) && boundary) {
    const marker = `--${boundary}`;
    return body.split(marker).slice(1).flatMap((part) => {
      const cleaned = part.replace(/^\r?\n/, "").replace(/\r?\n--\s*$/, "").trimEnd();
      return cleaned && cleaned !== "--" ? collectMimeLeaves(cleaned, depth + 1) : [];
    });
  }
  if (/^message\/rfc822/i.test(contentType)) return collectMimeLeaves(body, depth + 1);
  return [{ headers, payload: body }];
}

function decodeTransferBytes(headers: string, payload: string): Uint8Array {
  const encoding = mimeHeader(headers, "Content-Transfer-Encoding").toLowerCase();
  if (encoding === "base64") {
    const compact = payload.replace(/\s+/g, "");
    const binary = atob(compact.padEnd(Math.ceil(compact.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  const decoded = encoding === "quoted-printable"
    ? payload.replace(/=\r?\n/g, "").replace(/=([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    : payload;
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0) & 0xff);
}

function decodeTextLeaf(leaf: MimeLeaf): string {
  try {
    const charset = mimeHeader(leaf.headers, "Content-Type").match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] ?? "utf-8";
    const bytes = decodeTransferBytes(leaf.headers, leaf.payload);
    try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
  } catch {
    return "";
  }
}

function decodeMailBody(value: string): string {
  const leaves = collectMimeLeaves(value);
  const textLeaves = leaves
    .filter((leaf) => /^text\/(?:html|plain)/i.test(mimeHeader(leaf.headers, "Content-Type") || "text/plain"))
    .map((leaf) => ({ leaf, text: decodeTextLeaf(leaf) }))
    .filter((part) => part.text.trim());
  const preferredLeaf = textLeaves
    .filter((part) => /^text\/html/i.test(mimeHeader(part.leaf.headers, "Content-Type")))
    .sort((a, b) => b.text.length - a.text.length)[0]
    ?? textLeaves.sort((a, b) => b.text.length - a.text.length)[0];
  if (preferredLeaf) return unwrapBase64Text(preferredLeaf.text);

  const mimeParts = [...value.matchAll(/(?:^|\r?\n--[^\r\n]+\r?\n)([\s\S]*?)\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/gi)];
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
        return [{ headers, text: new TextDecoder(charset).decode(bytes) }];
      } catch {
        return [{ headers, text: new TextDecoder("utf-8").decode(bytes) }];
      }
    } catch {
      return [];
    }
  });
  if (decodedBase64Parts.length) {
    const preferred = decodedBase64Parts
      .filter((part) => /Content-Type:\s*text\/html/i.test(part.headers))
      .sort((a, b) => b.text.length - a.text.length)[0]
      ?? decodedBase64Parts.sort((a, b) => b.text.length - a.text.length)[0];
    return unwrapBase64Text(preferred.text);
  }
  const quotedHtmlPart = mimeParts
    .filter((match) => /Content-Type:\s*text\/html/i.test(match[1]))
    .sort((a, b) => b[2].length - a[2].length)[0];
  if (quotedHtmlPart) {
    const charset = quotedHtmlPart[1].match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] ?? "utf-8";
    const decoded = quotedHtmlPart[2].replace(/=\r?\n/g, "").replace(/=([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    const partBytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    try { return new TextDecoder(charset).decode(partBytes); } catch { return new TextDecoder("utf-8").decode(partBytes); }
  }
  // Attachments or malformed binary-only messages must never be rendered as
  // body text. Returning an empty body lets the preview show a clear fallback.
  return "";
}

function buildMailPreviewDocument(value: string): string {
  let html = decodeMailBody(value);
  const embeddedImages: string[] = [];
  for (const leaf of collectMimeLeaves(value)) {
    const declaredMime = leaf.headers.match(/Content-Type:\s*image\/(png|jpe?g|gif|webp)/i)?.[1]?.toLowerCase();
    const fileMime = leaf.headers.match(/(?:name|filename)\s*=\s*["']?[^\r\n;"']+\.(png|jpe?g|gif|webp)/i)?.[1]?.toLowerCase();
    const mime = declaredMime ?? fileMime;
    if (!mime || !/Content-Transfer-Encoding:\s*base64/i.test(leaf.headers)) continue;
    const payload = leaf.payload.replace(/\s+/g, "");
    if (!payload || payload.length > 8_000_000) continue;
    const source = `data:image/${mime === "jpg" ? "jpeg" : mime};base64,${payload}`;
    const contentId = leaf.headers.match(/Content-ID:\s*<?([^>\s]+)>?/i)?.[1];
    const contentLocation = leaf.headers.match(/Content-Location:\s*([^\s]+)/i)?.[1];
    const before = html;
    if (contentId) html = html.replace(new RegExp(`cid:${contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi"), source);
    if (contentLocation) html = html.replaceAll(contentLocation, source);
    if (html === before && embeddedImages.length < 6) embeddedImages.push(source);
  }
  html = html
    .replace(/<script[\s\S]*?<\/script>|<iframe[\s\S]*?<\/iframe>|<object[\s\S]*?<\/object>|<embed[^>]*>|<form[\s\S]*?<\/form>/gi, "")
    .replace(/\s(?:on\w+|srcdoc)\s*=\s*(["']).*?\1/gi, "")
    .replace(/(?:javascript|data:text\/html)\s*:/gi, "");
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    const text = readableMailText(value) || "표시할 메일 내용이 없습니다.";
    html = `<pre>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
  }
  if (embeddedImages.length) html = `${embeddedImages.map((source) => `<img src="${source}" alt="메일 이미지">`).join("")}${html}`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:#fffefb;color:#34413b;font:14px/1.7 Arial,'Noto Sans KR',sans-serif}body{padding:18px;box-sizing:border-box}img{display:block;max-width:100%!important;height:auto!important;margin:0 auto 14px}table{max-width:100%!important}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style></head><body>${html}</body></html>`;
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

export async function readDaumMessagePreview(loginId: string, appPassword: string, mailboxName: string, uid: string): Promise<{ document: string }> {
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
    return { document: buildMailPreviewDocument(raw) };
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
