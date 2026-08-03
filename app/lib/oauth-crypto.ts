import { env } from "cloudflare:workers";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  if (!env.OAUTH_ENCRYPTION_KEY) {
    throw new Error("OAUTH_ENCRYPTION_KEY is not configured");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(env.OAUTH_ENCRYPTION_KEY),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(value: string): Promise<{ ciphertext: string; nonce: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    await encryptionKey(),
    encoder.encode(value),
  );
  return { ciphertext: toBase64(new Uint8Array(encrypted)), nonce: toBase64(nonce) };
}

export async function decryptToken(ciphertext: string, nonce: string): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(nonce) },
    await encryptionKey(),
    fromBase64(ciphertext),
  );
  return decoder.decode(decrypted);
}
