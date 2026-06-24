import type { File } from '@directus/types';
import PQueue from 'p-queue';
import type { Upload } from 'tus-js-client';
import { i18n } from '@/lang';
import { notify } from '@/utils/notify';
import { uploadFile } from '@/utils/upload-file';

/** Per-file lifecycle state for a multi-file upload (DR-UC10). */
export type FileUploadState = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';

/** A unified abort handle per file (cancels the axios request and/or the tus upload). */
export interface FileUploadHandle {
	abort: () => void;
}

export async function uploadFiles(
	files: globalThis.File[],
	options?: {
		onProgressChange?: (percentages: number[]) => void;
		onChunkedUpload?: (controllers: (Upload | null)[]) => void;
		onFileStateChange?: (states: FileUploadState[]) => void;
		onControllersChange?: (handles: FileUploadHandle[]) => void;
		notifications?: boolean;
		preset?: Record<string, any>;
		folder?: string;
		maxConcurrency?: number;
	},
): Promise<(File | undefined)[]> {
	const progressHandler = options?.onProgressChange || (() => undefined);
	const progressForFiles = files.map(() => 0);
	const uploadControllers: (Upload | null)[] = Array(files.length).fill(null);

	const states: FileUploadState[] = files.map(() => 'queued');
	const abortControllers = files.map(() => new AbortController());

	const emitStates = () => options?.onFileStateChange?.([...states]);

	const setState = (index: number, state: FileUploadState) => {
		// A cancelled file is terminal: don't let a late progress/error update override it.
		if (states[index] === 'cancelled') return;
		states[index] = state;
		emitStates();
	};

	// Per-file abort handle: cancels the axios request (via signal) and the tus upload (via controller).
	const handles: FileUploadHandle[] = files.map((_file, index) => ({
		abort() {
			if (states[index] === 'done') return;
			states[index] = 'cancelled';
			abortControllers[index]!.abort();
			uploadControllers[index]?.abort();
			emitStates();
		},
	}));

	options?.onControllersChange?.(handles);
	emitStates();

	const uploadQueue = new PQueue({
		concurrency: options?.maxConcurrency && options.maxConcurrency > 0 ? options.maxConcurrency : Infinity,
	});

	const startUpload = async (file: globalThis.File, index: number): Promise<File | undefined> => {
		if (states[index] === 'cancelled') return undefined;

		setState(index, 'uploading');

		try {
			const result = await uploadFile(file, {
				...options,
				signal: abortControllers[index]!.signal,
				onProgressChange: (percentage: number) => {
					progressForFiles[index] = percentage;
					progressHandler(progressForFiles);
				},
				onChunkedUpload: (controller: Upload) => {
					uploadControllers[index] = controller;
					options?.onChunkedUpload?.(uploadControllers);
				},
			});

			// Re-read via cast: the abort handle can flip this to 'cancelled' during the await, which
			// TS's control-flow narrowing doesn't account for.
			if ((states[index] as FileUploadState) === 'cancelled') return undefined;

			if (result) {
				setState(index, 'done');
				return result;
			}

			setState(index, 'error');
			return undefined;
		} catch (error: any) {
			if ((states[index] as FileUploadState) === 'cancelled' || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') {
				setState(index, 'cancelled');
			} else {
				setState(index, 'error');
			}

			return undefined;
		}
	};

	// allSettled so one file's failure/cancellation never rejects the batch (DR-UC10).
	const results = await Promise.allSettled(
		files.map((file, index) => uploadQueue.add(() => startUpload(file, index), { throwOnTimeout: true })),
	);

	const uploadedFiles = results
		.map((result) => (result.status === 'fulfilled' ? result.value : undefined))
		.filter((value): value is File => !!value);

	if (options?.notifications && uploadedFiles.length > 0) {
		notify({
			title: i18n.global.t('upload_files_success', { count: uploadedFiles.length }),
		});
	}

	return uploadedFiles;
}
