/**
 * Opt-in provider interface for Image/Text to 3D generation.
 * Generates an organic base model and imports it as a mesh part.
 * Strictly zero-cost by default: runs either on a free local server (Local3DProvider)
 * or via Bring-Your-Own-Key (BYOK) when the user explicitly provides their own API key.
 */

export interface Generate3DInput {
	prompt?: string;
	image?: string; // local file path, URL, or data URI
	resolution?: number;
	apiKey?: string; // BYOK (Bring Your Own Key) for cloud providers
	endpoint?: string; // Custom endpoint for local open-weight server
}

export interface ProviderCost {
	usd: number;
	note: string;
}

export interface ProviderResult {
	glbBytes: Uint8Array;
	provider: string;
	costUsd: number;
	latencyMs: number;
}

export interface ImageTo3DProvider {
	id: string;
	name: string;
	isConfigured(input?: Generate3DInput): boolean;
	estimateCost(input?: Generate3DInput): ProviderCost;
	generate(input: Generate3DInput): Promise<ProviderResult>;
}

/** Local open-weight model runner (TRELLIS / TripoSR / Hunyuan3D via local HTTP server) */
export class Local3DProvider implements ImageTo3DProvider {
	id = 'local';
	name = 'Local Open-Weight Model (TRELLIS / TripoSR / Hunyuan3D)';

	private resolveEndpoint(input?: Generate3DInput): string {
		return input?.endpoint ?? process.env.CLAYFORM_3D_ENDPOINT ?? 'http://127.0.0.1:8000';
	}

	isConfigured(input?: Generate3DInput): boolean {
		return Boolean(input?.endpoint || process.env.CLAYFORM_3D_ENDPOINT);
	}

	estimateCost(): ProviderCost {
		return { usd: 0, note: 'Free: runs on your own local machine/GPU' };
	}

	async generate(input: Generate3DInput): Promise<ProviderResult> {
		if (!input.prompt && !input.image) {
			throw new Error('Provide either a text prompt or an image for 3D generation.');
		}
		const start = Date.now();
		const ep = this.resolveEndpoint(input).replace(/\/$/, '');
		const res = await fetch(`${ep}/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: input.prompt, image: input.image, resolution: input.resolution ?? 64 })
		});
		if (!res.ok) throw new Error(`Local 3D provider at ${ep} returned HTTP ${res.status}: ${await res.text()}`);
		const buf = await res.arrayBuffer();
		return {
			glbBytes: new Uint8Array(buf),
			provider: this.name,
			costUsd: 0,
			latencyMs: Date.now() - start
		};
	}
}

/** Meshy API (v2 text-to-3d / image-to-3d) — Strictly BYOK (Bring Your Own Key) */
export class MeshyProvider implements ImageTo3DProvider {
	id = 'meshy';
	name = 'Meshy API (BYOK)';

	private resolveKey(input?: Generate3DInput): string | undefined {
		return input?.apiKey ?? process.env.MESHY_API_KEY;
	}

	isConfigured(input?: Generate3DInput): boolean {
		return Boolean(this.resolveKey(input));
	}

	estimateCost(): ProviderCost {
		return { usd: 0.05, note: 'BYOK (Pay-as-you-go on your own Meshy account)' };
	}

	async generate(input: Generate3DInput): Promise<ProviderResult> {
		const key = this.resolveKey(input);
		if (!key) {
			throw new Error(
				'Meshy is a BYOK (Bring Your Own Key) provider. Pass api_key in the tool call or set MESHY_API_KEY in your environment, or use provider: "local" for free local generation.'
			);
		}
		if (!input.prompt && !input.image) {
			throw new Error('Provide either a text prompt or an image for Meshy 3D generation.');
		}
		const start = Date.now();
		const endpoint = input.image ? 'https://api.meshy.ai/v1/image-to-3d' : 'https://api.meshy.ai/v2/text-to-3d';
		const body = input.image
			? { image_url: input.image }
			: { prompt: input.prompt, mode: 'preview', art_style: 'realistic' };

		const init = await fetch(endpoint, {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!init.ok) throw new Error(`Meshy API task creation failed (${init.status}): ${await init.text()}`);
		const task = (await init.json()) as { result: string };
		const taskId = task.result;

		let glbUrl: string | null = null;
		for (let i = 0; i < 30; i++) {
			await new Promise((r) => setTimeout(r, 3000));
			const poll = await fetch(`${endpoint}/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
			if (!poll.ok) continue;
			const data = (await poll.json()) as { status: string; model_urls?: { glb?: string } };
			if (data.status === 'SUCCEEDED' && data.model_urls?.glb) {
				glbUrl = data.model_urls.glb;
				break;
			}
			if (data.status === 'FAILED') throw new Error('Meshy 3D generation task failed');
		}

		if (!glbUrl) throw new Error('Timed out waiting for Meshy 3D generation result');
		const dl = await fetch(glbUrl);
		const bytes = new Uint8Array(await dl.arrayBuffer());
		return {
			glbBytes: bytes,
			provider: this.name,
			costUsd: 0.05,
			latencyMs: Date.now() - start
		};
	}
}

/** Tripo3D API — Strictly BYOK (Bring Your Own Key) */
export class TripoProvider implements ImageTo3DProvider {
	id = 'tripo';
	name = 'Tripo3D API (BYOK)';

	private resolveKey(input?: Generate3DInput): string | undefined {
		return input?.apiKey ?? process.env.TRIPO_API_KEY;
	}

	isConfigured(input?: Generate3DInput): boolean {
		return Boolean(this.resolveKey(input));
	}

	estimateCost(): ProviderCost {
		return { usd: 0.05, note: 'BYOK (Pay-as-you-go on your own Tripo3D account)' };
	}

	async generate(input: Generate3DInput): Promise<ProviderResult> {
		const key = this.resolveKey(input);
		if (!key) {
			throw new Error(
				'Tripo3D is a BYOK (Bring Your Own Key) provider. Pass api_key in the tool call or set TRIPO_API_KEY in your environment, or use provider: "local" for free local generation.'
			);
		}
		if (!input.prompt) {
			throw new Error('Provide a text prompt for Tripo3D generation.');
		}
		const start = Date.now();
		const endpoint = 'https://api.tripo3d.ai/v2/openapi/task';
		const init = await fetch(endpoint, {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'text_to_model', prompt: input.prompt })
		});
		if (!init.ok) throw new Error(`Tripo3D API task creation failed (${init.status}): ${await init.text()}`);
		const task = (await init.json()) as { data?: { task_id?: string } };
		const taskId = task.data?.task_id;
		if (!taskId) throw new Error('Tripo3D API did not return a task_id');

		let glbUrl: string | null = null;
		for (let i = 0; i < 30; i++) {
			await new Promise((r) => setTimeout(r, 3000));
			const poll = await fetch(`${endpoint}/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
			if (!poll.ok) continue;
			const res = (await poll.json()) as { data?: { status?: string; output?: { model?: string } } };
			if (res.data?.status === 'success' && res.data?.output?.model) {
				glbUrl = res.data.output.model;
				break;
			}
			if (res.data?.status === 'failed' || res.data?.status === 'cancelled') {
				throw new Error(`Tripo3D task ended with status: ${res.data.status}`);
			}
		}

		if (!glbUrl) throw new Error('Timed out waiting for Tripo3D generation result');
		const dl = await fetch(glbUrl);
		const bytes = new Uint8Array(await dl.arrayBuffer());
		return {
			glbBytes: bytes,
			provider: this.name,
			costUsd: 0.05,
			latencyMs: Date.now() - start
		};
	}
}

/** Registry of available providers */
export const PROVIDERS: Record<string, ImageTo3DProvider> = {
	local: new Local3DProvider(),
	meshy: new MeshyProvider(),
	tripo: new TripoProvider()
};

export async function generate3DMesh(providerId: 'local' | 'meshy' | 'tripo', input: Generate3DInput): Promise<ProviderResult> {
	const p = PROVIDERS[providerId];
	if (!p) throw new Error(`Unknown 3D provider "${providerId}" — choose local, meshy, or tripo`);
	return p.generate(input);
}
