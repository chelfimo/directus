import { createHash, createHmac } from 'node:crypto';
import { defineOperationApi } from '@directus/extensions';
import { optionToString } from '@directus/utils';

type Options = {
	algorithm: 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512';
	value: string | unknown;
	outputFormat: 'hex' | 'base64';
	hmac?: boolean;
	secret?: string;
};

export default defineOperationApi<Options>({
	id: 'hash',

	handler: async ({ algorithm, value, outputFormat, hmac, secret }) => {
		if (!algorithm) {
			throw new Error('Hash algorithm is required');
		}

		if (value === undefined || value === null) {
			throw new Error('Value to hash is required');
		}

		const valueString = optionToString(value);
		const encoding = outputFormat === 'base64' ? 'base64' : 'hex';

		const algorithmMap: Record<string, string> = {
			md5: 'md5',
			sha1: 'sha1',
			sha256: 'sha256',
			sha384: 'sha384',
			sha512: 'sha512',
		};

		const cryptoAlgorithm = algorithmMap[algorithm];

		if (!cryptoAlgorithm) {
			throw new Error(`Unsupported hash algorithm: ${algorithm}`);
		}

		if (hmac) {
			if (!secret) {
				throw new Error('Secret is required for HMAC');
			}

			const secretString = optionToString(secret);
			const hmacHash = createHmac(cryptoAlgorithm, secretString);
			hmacHash.update(valueString);
			return hmacHash.digest(encoding);
		}

		const hash = createHash(cryptoAlgorithm);
		hash.update(valueString);
		return hash.digest(encoding);
	},
});
