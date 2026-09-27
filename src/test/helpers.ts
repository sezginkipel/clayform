import { FORMAT, type Part, type Scene } from '../core/schema.js';

export function scene(parts: Part[], extra: Partial<Scene> = {}): Scene {
	return { format: FORMAT, name: 'test', settings: { resolution: 64 }, parts, ...extra };
}

export const ball = (id: string, r: number, more: Partial<Part> = {}): Part => ({ id, shape: { type: 'sphere', radius: r }, ...more }) as Part;
