/**
 * Client-Side API Key & Secret Vault Security
 * Web Crypto API (AES-GCM 256-bit) kullanarak API anahtarlarını
 * yerel depolamada düz metin (plaintext) olarak saklanmaktan korur.
 */

const SALT = "piyasaiq-vault-salt-2026-secure"

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  )
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(SALT),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

/**
 * Encrypt sensitive text (API Key or Secret) with AES-GCM 256-bit
 */
export async function encryptSensitive(plainText: string, deviceKey = "local_vault_key"): Promise<string> {
  if (!plainText) return ""
  if (typeof window === "undefined" || !window.crypto?.subtle) return plainText

  try {
    const key = await deriveKey(deviceKey)
    const iv = window.crypto.getRandomValues(new Uint8Array(12))
    const encodedData = new TextEncoder().encode(plainText)

    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encodedData
    )

    const ivB64 = btoa(String.fromCharCode(...iv))
    const encryptedB64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)))

    return `enc_v1:${ivB64}:${encryptedB64}`
  } catch (err) {
    console.error("Şifreleme hatası:", err)
    return plainText
  }
}

/**
 * Decrypt sensitive text from AES-GCM 256-bit
 */
export async function decryptSensitive(cipherText: string, deviceKey = "local_vault_key"): Promise<string> {
  if (!cipherText || !cipherText.startsWith("enc_v1:")) return cipherText
  if (typeof window === "undefined" || !window.crypto?.subtle) return cipherText

  try {
    const parts = cipherText.split(":")
    if (parts.length !== 3) return cipherText

    const iv = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0))
    const encryptedData = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0))

    const key = await deriveKey(deviceKey)
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encryptedData
    )

    return new TextDecoder().decode(decrypted)
  } catch (err) {
    console.error("Şifre çözme hatası:", err)
    return ""
  }
}

/**
 * Mask API key or secret for safe UI display (e.g. "vmPU...9x2A")
 */
export function maskSensitive(value: string): string {
  if (!value) return ""
  if (value.length <= 8) return "••••••••"
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`
}
