/**
 * AES-128-CFB8 stream cipher — Minecraft uses the shared secret as both key and IV.
 * Uses Node native crypto.
 */

import { createCipheriv, createDecipheriv } from "node:crypto";

/** Create an AES-128-CFB8 encryptor. Secret is used as both key and IV. */
export const createEncryptor = (
	secret: Buffer,
): { update: (data: Buffer) => Buffer } =>
	createCipheriv("aes-128-cfb8", secret, secret);

/** Create an AES-128-CFB8 decryptor. Secret is used as both key and IV. */
export const createDecryptor = (
	secret: Buffer,
): { update: (data: Buffer) => Buffer } =>
	createDecipheriv("aes-128-cfb8", secret, secret);
