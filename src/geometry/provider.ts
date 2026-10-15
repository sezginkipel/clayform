/**
 * Opt-in provider interface for Image/Text to 3D generation.
 * Generates an organic base model and imports it as a mesh part.
 * Never runs a paid provider without explicit user credentials.
 */

export interface Generate3DInput {
	prompt?: string;
	image?: string; // local file path or base64 data
	resolution?: number;
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
	isConfigured(): boolean;
	estimateCost(input: Generate3DInput): ProviderCost;
	generate(input: Generate3DInput): Promise<ProviderResult>;
}

/** Local open-weight model runner (TRELLIS / TripoSR / Hunyuan3D via local HTTP server) */
export class Local3DProvider implements ImageTo3DProvider {
	id = 'local';
	name = 'Local Open-Weight Model (TRELLIS / TripoSR)';

	private endpoint(): string {
		return process.env.CLAYFORM_3D_ENDPOINT ?? 'http://127.0.0.1:8000';
	}

	isConfigured(): boolean {
		return !!process.env.CLAYFORM_3D_ENDPOINT;
	}

	estimateCost(): ProviderCost {
		return { usd: 0, note: 'Free: runs on your local GPU' };
	}

	async generate(input: Generate3DInput): Promise<ProviderResult> {
		const start = Date.now();
		const ep = this.endpoint();
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

/** Meshy API (v2 text-to-3d / image-to-3d) */
export class MeshyProvider implements ImageTo3DProvider {
	id = 'meshy';
	name = 'Meshy API (Cloud)';

	private apiKey(): string | undefined {
		return process.env.MESHY_API_KEY;
	}

	isConfigured(): boolean {
		return !!this.apiKey();
	}

	estimateCost(): ProviderCost {
		return { usd: 0.05, note: 'Approx $0.05 per preview/generation via Meshy API' };
	}

	async generate(input: Generate3DInput): Promise<ProviderResult> {
		const key = this.apiKey();
		if (!key) throw new Error('Meshy API key missing. Set MESHY_API_KEY environment variable.');
		const start = Date.now();
		// Dispatch task to Meshy API
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

		// Poll for completion (up to 90 seconds)
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

/** Registry of available providers */
export const PROVIDERS: Record<string, ImageTo3DProvider> = {
	local: new Local3DProvider(),
	meshy: new MeshyProvider()
};
