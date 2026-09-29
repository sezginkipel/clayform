import { image, templates } from '$lib/docs';
import { entries } from '$lib/showcase';

export const load = () => ({
	templates,
	showcase: entries.slice(0, 1),
	shots: {
		goblin: image('goblin.png'),
		parts: image('goblin-parts.png'),
		walk: image('goblin-walk.png'),
		actions: image('actions.png'),
		camp: image('camp.png'),
		fire: image('fire.png')
	}
});
