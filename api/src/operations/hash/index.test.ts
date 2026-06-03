import { createHash, createHmac } from 'node:crypto';
import { expect, test, describe } from 'vitest';
import config from './index.js';

describe('hash operation', () => {
	test('should hash a string with SHA-256 and hex output', async () => {
		const result = await config.handler(
			{
				algorithm: 'sha256',
				value: 'hello world',
				outputFormat: 'hex',
			},
			{} as any,
		);

		const expected = createHash('sha256').update('hello world').digest('hex');
		expect(result).toBe(expected);
	});

	test('should hash a string with SHA-256 and base64 output', async () => {
		const result = await config.handler(
			{
				algorithm: 'sha256',
				value: 'hello world',
				outputFormat: 'base64',
			},
			{} as any,
		);

		const expected = createHash('sha256').update('hello world').digest('base64');
		expect(result).toBe(expected);
	});

	test('should hash with MD5 algorithm', async () => {
		const result = await config.handler(
			{
				algorithm: 'md5',
				value: 'test',
				outputFormat: 'hex',
			},
			{} as any,
		);

		const expected = createHash('md5').update('test').digest('hex');
		expect(result).toBe(expected);
	});

	test('should hash with SHA-1 algorithm', async () => {
		const result = await config.handler(
			{
				algorithm: 'sha1',
				value: 'test',
				outputFormat: 'hex',
			},
			{} as any,
		);

		const expected = createHash('sha1').update('test').digest('hex');
		expect(result).toBe(expected);
	});

	test('should hash with SHA-384 algorithm', async () => {
		const result = await config.handler(
			{
				algorithm: 'sha384',
				value: 'test',
				outputFormat: 'hex',
			},
			{} as any,
		);

		const expected = createHash('sha384').update('test').digest('hex');
		expect(result).toBe(expected);
	});

	test('should hash with SHA-512 algorithm', async () => {
		const result = await config.handler(
			{
				algorithm: 'sha512',
				value: 'test',
				outputFormat: 'hex',
			},
			{} as any,
		);

		const expected = createHash('sha512').update('test').digest('hex');
		expect(result).toBe(expected);
	});

	test('should create HMAC with SHA-256', async () => {
		const result = await config.handler(
			{
				algorithm: 'sha256',
				value: 'hello world',
				outputFormat: 'hex',
				hmac: true,
				secret: 'my-secret-key',
			},
			{} as any,
		);

		const expected = createHmac('sha256', 'my-secret-key').update('hello world').digest('hex');
		expect(result).toBe(expected);
	});

	test('should create HMAC with base64 output', async () => {
		const result = await config.handler(
			{
				algorithm: 'sha256',
				value: 'hello world',
				outputFormat: 'base64',
				hmac: true,
				secret: 'my-secret-key',
			},
			{} as any,
		);

		const expected = createHmac('sha256', 'my-secret-key').update('hello world').digest('base64');
		expect(result).toBe(expected);
	});

	test('should error when algorithm is missing', async () => {
		await expect(
			config.handler(
				{
					value: 'test',
					outputFormat: 'hex',
				} as any,
				{} as any,
			),
		).rejects.toThrow('Hash algorithm is required');
	});

	test('should error when value is missing', async () => {
		await expect(
			config.handler(
				{
					algorithm: 'sha256',
					outputFormat: 'hex',
				} as any,
				{} as any,
			),
		).rejects.toThrow('Value to hash is required');
	});

	test('should error when value is null', async () => {
		await expect(
			config.handler(
				{
					algorithm: 'sha256',
					value: null,
					outputFormat: 'hex',
				} as any,
				{} as any,
			),
		).rejects.toThrow('Value to hash is required');
	});

	test('should error when HMAC is enabled but secret is missing', async () => {
		await expect(
			config.handler(
				{
					algorithm: 'sha256',
					value: 'test',
					outputFormat: 'hex',
					hmac: true,
				},
				{} as any,
			),
		).rejects.toThrow('Secret is required for HMAC');
	});

	test('should error with unsupported algorithm', async () => {
		await expect(
			config.handler(
				{
					algorithm: 'invalid-algo' as any,
					value: 'test',
					outputFormat: 'hex',
				},
				{} as any,
			),
		).rejects.toThrow('Unsupported hash algorithm: invalid-algo');
	});

	test('should handle empty string input', async () => {
		const result = await config.handler(
			{
				algorithm: 'sha256',
				value: '',
				outputFormat: 'hex',
			},
			{} as any,
		);

		const expected = createHash('sha256').update('').digest('hex');
		expect(result).toBe(expected);
	});

	test('should default to hex when outputFormat is invalid', async () => {
		const result = await config.handler(
			{
				algorithm: 'sha256',
				value: 'test',
				outputFormat: 'invalid' as any,
			},
			{} as any,
		);

		const expected = createHash('sha256').update('test').digest('hex');
		expect(result).toBe(expected);
	});
});
