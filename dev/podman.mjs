import { existsSync } from 'node:fs';
import { join } from 'node:path';

const userInstall = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Podman', 'podman.exe');
export const podman = process.platform === 'win32' && existsSync(userInstall) ? userInstall : 'podman';
