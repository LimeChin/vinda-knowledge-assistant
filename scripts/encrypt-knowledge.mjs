import fs from "node:fs";
import crypto from "node:crypto";

const [inputFile, outputFile] = process.argv.slice(2);
const accessCode = process.env.VINDA_ASSISTANT_CODE;

if (!inputFile || !outputFile || !accessCode) {
  throw new Error("Usage: VINDA_ASSISTANT_CODE=<secret> node scripts/encrypt-knowledge.mjs <input.json> <output.json>");
}

const items = JSON.parse(fs.readFileSync(inputFile, "utf8"));
if (!Array.isArray(items) || !items.length) throw new Error("Knowledge input must be a non-empty array");

const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const iterations = 210000;
const key = crypto.pbkdf2Sync(accessCode, salt, iterations, 32, "sha256");
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const plaintext = Buffer.from(JSON.stringify(items), "utf8");
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

fs.writeFileSync(outputFile, JSON.stringify({
  version: 2,
  algorithm: "AES-GCM",
  kdf: "PBKDF2-SHA256",
  iterations,
  salt: salt.toString("base64"),
  iv: iv.toString("base64"),
  ciphertext: ciphertext.toString("base64"),
}));

console.log(JSON.stringify({ items: items.length, outputFile }));
