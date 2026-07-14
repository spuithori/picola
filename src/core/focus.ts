const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus inside `root` and restore the previously focused
 * element on cleanup. `root` itself is focused initially (give it
 * `tabindex="-1"`).
 */
export function trapFocus(root: HTMLElement): () => void {
	const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	root.focus({ preventScroll: true });

	const onKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Tab') return;
		const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
			(el) => el.offsetParent !== null || el === document.activeElement
		);
		if (focusable.length === 0) {
			event.preventDefault();
			return;
		}
		const first = focusable[0]!;
		const last = focusable[focusable.length - 1]!;
		const current = document.activeElement;

		if (event.shiftKey && (current === first || current === root)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && current === last) {
			event.preventDefault();
			first.focus();
		} else if (current && !root.contains(current)) {
			event.preventDefault();
			first.focus();
		}
	};

	document.addEventListener('keydown', onKeydown, true);
	return () => {
		document.removeEventListener('keydown', onKeydown, true);
		previous?.focus({ preventScroll: true });
	};
}
