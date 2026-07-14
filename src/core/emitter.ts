export type Listener<P> = (payload: P) => void;

export interface Emitter<Events extends Record<string, unknown>> {
	on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void;
	off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void;
	emit<K extends keyof Events>(
		type: K,
		...payload: Events[K] extends undefined ? [] : [Events[K]]
	): void;
	clear(): void;
}

export function createEmitter<Events extends Record<string, unknown>>(): Emitter<Events> {
	const listeners = new Map<keyof Events, Set<Listener<never>>>();

	return {
		on(type, listener) {
			let set = listeners.get(type);
			if (!set) {
				set = new Set();
				listeners.set(type, set);
			}
			set.add(listener as Listener<never>);
			return () => this.off(type, listener);
		},
		off(type, listener) {
			listeners.get(type)?.delete(listener as Listener<never>);
		},
		emit(type, ...payload) {
			const set = listeners.get(type);
			if (!set) return;
			for (const listener of [...set]) {
				(listener as Listener<unknown>)(payload[0]);
			}
		},
		clear() {
			listeners.clear();
		}
	};
}
