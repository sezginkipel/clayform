import pkg from '../../../package.json';

export const VERSION: string = pkg.version;
export const SITE_NAME = 'Clayform';
export const SITE_URL = 'https://clayform.sadelabs.site';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-card.png`;
export const DEFAULT_OG_ALT = 'Clayform — Open source 3D modeling, rigging, animation, and glTF export MCP server for AI agents';
export const DEFAULT_DESCRIPTION =
	'Clayform lets AI agents model, sculpt, rig, animate and export game-ready glTF 2.0 by editing a scene document, inspecting renders and reading geometric critics. Open source, no Blender, no GPU.';
export const REPO = 'https://github.com/sezginkipel/clayform';
export const NPM = 'https://www.npmjs.com/package/@s1444/clayform';
export const INSTALL = 'claude mcp add clayform -- npx -y @s1444/clayform mcp';

