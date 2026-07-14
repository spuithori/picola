import { describe, expect, it, vi } from 'vitest';
import { createEmitter } from './emitter.js';

type Events = {
	change: { index: number };
	closed: undefined;
};

describe('createEmitter', () => {
	it('delivers payloads to listeners', () => {
		const emitter = createEmitter<Events>();
		const listener = vi.fn();
		emitter.on('change', listener);
		emitter.emit('change', { index: 2 });
		expect(listener).toHaveBeenCalledWith({ index: 2 });
	});

	it('supports payload-less events', () => {
		const emitter = createEmitter<Events>();
		const listener = vi.fn();
		emitter.on('closed', listener);
		emitter.emit('closed');
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('returns an unsubscribe function', () => {
		const emitter = createEmitter<Events>();
		const listener = vi.fn();
		const off = emitter.on('change', listener);
		off();
		emitter.emit('change', { index: 0 });
		expect(listener).not.toHaveBeenCalled();
	});

	it('tolerates listeners unsubscribing during emit', () => {
		const emitter = createEmitter<Events>();
		const second = vi.fn();
		emitter.on('change', () => emitter.off('change', second));
		emitter.on('change', second);
		expect(() => emitter.emit('change', { index: 1 })).not.toThrow();
	});

	it('clear removes everything', () => {
		const emitter = createEmitter<Events>();
		const listener = vi.fn();
		emitter.on('change', listener);
		emitter.clear();
		emitter.emit('change', { index: 1 });
		expect(listener).not.toHaveBeenCalled();
	});
});
