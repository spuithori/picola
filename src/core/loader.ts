import type { Size } from './types.js';

/**
 * Resolve with the natural size of `img` once it is loaded and (where the
 * browser allows) decoded off the main thread. Rejects on a load failure
 * with nothing displayable.
 */
export function decodeImage(img: HTMLImageElement): Promise<Size> {
	const naturalSize = (): Size => ({ width: img.naturalWidth, height: img.naturalHeight });

	const whenLoaded: Promise<void> =
		img.complete && img.naturalWidth > 0
			? Promise.resolve()
			: new Promise((resolve, reject) => {
					const done = () => {
						img.removeEventListener('load', done);
						img.removeEventListener('error', fail);
						resolve();
					};
					const fail = () => {
						img.removeEventListener('load', done);
						img.removeEventListener('error', fail);
						reject(new Error(`picola: failed to load image "${img.currentSrc || img.src}"`));
					};
					img.addEventListener('load', done);
					img.addEventListener('error', fail);
				});

	return whenLoaded.then(() =>
		img.decode().then(naturalSize, naturalSize)
	);
}
