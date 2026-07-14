const STATE_KEY = 'picola:open';

let pendingRewinds = 0;
let rewindWaiters: (() => void)[] = [];

function completeRewind(): void {
	pendingRewinds -= 1;
	if (pendingRewinds === 0 && rewindWaiters.length > 0) {
		const waiters = rewindWaiters;
		rewindWaiters = [];
		for (const waiter of waiters) waiter();
	}
}

function afterRewinds(fn: () => void): void {
	if (pendingRewinds === 0) fn();
	else rewindWaiters.push(fn);
}

export interface HistoryBinding {
	rewind(): void;
	dispose(): void;
}

export function bindHistory(onBack: () => void): HistoryBinding {
	let active = true;
	let pushed = false;

	const onPopState = () => {
		const state = history.state as Record<string, unknown> | null;
		if (state?.[STATE_KEY]) return;
		active = false;
		window.removeEventListener('popstate', onPopState);
		onBack();
	};

	afterRewinds(() => {
		if (!active) return;
		const previousState = history.state as Record<string, unknown> | null;
		history.pushState({ ...(previousState ?? {}), [STATE_KEY]: true }, '');
		pushed = true;
		window.addEventListener('popstate', onPopState);
	});

	return {
		rewind() {
			if (!active) return;
			active = false;
			window.removeEventListener('popstate', onPopState);
			if (!pushed) return;
			const state = history.state as Record<string, unknown> | null;
			if (state?.[STATE_KEY]) {
				pendingRewinds += 1;
				const consume = () => {
					window.removeEventListener('popstate', consume);
					completeRewind();
				};
				window.addEventListener('popstate', consume);
				history.back();
			}
		},
		dispose() {
			active = false;
			window.removeEventListener('popstate', onPopState);
		}
	};
}
