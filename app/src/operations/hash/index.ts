import { defineOperationApp } from '@directus/extensions';

export default defineOperationApp({
	id: 'hash',
	icon: 'tag',
	name: '$t:operations.hash.name',
	description: '$t:operations.hash.description',
	overview: ({ algorithm, outputFormat, hmac }) => [
		{
			label: '$t:operations.hash.algorithm',
			text: algorithm,
		},
		{
			label: '$t:operations.hash.output_format',
			text: outputFormat,
		},
		...(hmac
			? [
					{
						label: '$t:operations.hash.hmac',
						text: '$t:enabled',
					},
				]
			: []),
	],
	options: (panel) => {
		const isHmac = panel.hmac;

		const fields: any[] = [
			{
				field: 'algorithm',
				name: '$t:operations.hash.algorithm',
				type: 'string',
				meta: {
					width: 'half',
					interface: 'select-dropdown',
					options: {
						choices: [
							{
								text: 'MD5',
								value: 'md5',
							},
							{
								text: 'SHA-1',
								value: 'sha1',
							},
							{
								text: 'SHA-256',
								value: 'sha256',
							},
							{
								text: 'SHA-384',
								value: 'sha384',
							},
							{
								text: 'SHA-512',
								value: 'sha512',
							},
						],
					},
					note: '$t:operations.hash.algorithm_note',
				},
				schema: {
					default_value: 'sha256',
				},
			},
			{
				field: 'outputFormat',
				name: '$t:operations.hash.output_format',
				type: 'string',
				meta: {
					width: 'half',
					interface: 'select-dropdown',
					options: {
						choices: [
							{
								text: '$t:operations.hash.hex',
								value: 'hex',
							},
							{
								text: '$t:operations.hash.base64',
								value: 'base64',
							},
						],
					},
				},
				schema: {
					default_value: 'hex',
				},
			},
			{
				field: 'value',
				name: '$t:operations.hash.value',
				type: 'string',
				meta: {
					width: 'full',
					interface: 'input-multiline',
					options: {
						font: 'monospace',
						placeholder: '$t:operations.hash.value_placeholder',
					},
					note: '$t:operation_variables_note',
				},
			},
			{
				field: 'hmac',
				name: '$t:operations.hash.hmac',
				type: 'boolean',
				meta: {
					width: 'half',
					interface: 'boolean',
					note: '$t:operations.hash.hmac_note',
				},
				schema: {
					default_value: false,
				},
			},
		];

		if (isHmac) {
			fields.push({
				field: 'secret',
				name: '$t:operations.hash.secret',
				type: 'string',
				meta: {
					width: 'full',
					interface: 'input',
					options: {
						placeholder: '$t:operations.hash.secret_placeholder',
					},
					note: '$t:operation_variables_note',
				},
			});
		}

		return fields;
	},
});
