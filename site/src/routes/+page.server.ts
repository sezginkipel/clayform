import { image, templates } from '$lib/docs';

export const load = () => ({
	templates,
	shots: {
		goblin: image('goblin.png'),
		parts: image('goblin-parts.png'),
		walk: image('goblin-walk.png'),
		actions: image('actions.png'),
		camp: image('camp.png'),
		fire: image('fire.png')
	}
});
