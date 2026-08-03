import { connect } from "cloudflare:sockets";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function quoteImap(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("INVALID_IMAP_CREDENTIAL");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (response: string) => boolean,
): Promise<string> {
  let response = "";
  while (response.length < 32_768) {
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

export async function testDaumImapConnection(loginId: string, appPassword: string): Promise<void> {
  const socket = connect({ hostname: "imap.daum.net", port: 993 }, { secureTransport: "on" });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  try {
    const greeting = await readUntil(reader, (response) => response.includes("\r\n"));
    if (!/^\* OK/im.test(greeting)) throw new Error("IMAP_SERVER_UNAVAILABLE");

    await writer.write(encoder.encode(`a001 LOGIN ${quoteImap(loginId)} ${quoteImap(appPassword)}\r\n`));
    const loginResponse = await readUntil(reader, (response) => /(?:^|\r\n)a001 (?:OK|NO|BAD)/i.test(response));
    if (!/(?:^|\r\n)a001 OK/i.test(loginResponse)) throw new Error("IMAP_AUTHENTICATION_FAILED");

    await writer.write(encoder.encode("a002 LOGOUT\r\n"));
  } finally {
    reader.releaseLock();
    writer.releaseLock();
    socket.close();
  }
}
