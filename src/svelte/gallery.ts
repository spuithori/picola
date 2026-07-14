import type { Attachment } from 'svelte/attachments';

export interface GalleryOrigins {
	/** Attach to the thumbnail element shown for slide `index`. */
	attach(index: number): Attachment;
	/** Resolver to pass as the Lightbox `origin` prop. */
	origin(index: number): HTMLElement | null;
}

/**
 * Collects thumbnail elements via Svelte attachments so the open/close
 * transitions can fly from/to them:
 *
 * ```svelte
 * const gallery = createGalleryOrigins();
 * <img {@attach gallery.attach(i)} ... />
 * <Lightbox origin={gallery.origin} ... />
 * ```
 */
export function createGalleryOrigins(): GalleryOrigins {
	const elements = new Map<number, Element>();
	return {
		attach(index) {
			return (node) => {
				elements.set(index, node);
				return () => {
					if (elements.get(index) === node) elements.delete(index);
				};
			};
		},
		origin(index) {
			const element = elements.get(index);
			return element instanceof HTMLElement ? element : null;
		}
	};
}
