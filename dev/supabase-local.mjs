import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { podman } from './podman.mjs';
import { configurePodmanLogs } from './configure-podman-logs.mjs';

const machines = JSON.parse(execFileSync(podman, ['machine', 'inspect', 'podman-machine-default'], { encoding: 'utf8' }));
const machine = machines[0];
if (machine?.State !== 'running' || !machine.Rootful) {
  throw new Error('Start the rootful podman-machine-default machine in Podman Desktop before running local Supabase.');
}
const socket = process.platform === 'win32'
  ? machine.ConnectionInfo.PodmanPipe.Path
  : machine.ConnectionInfo.PodmanSocket.Path;
if (!socket) throw new Error('Podman machine Docker API socket is unavailable.');
const host = process.platform === 'win32' ? `npipe://${socket.replaceAll('\\', '/')}` : `unix://${socket}`;
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url)),
  ...process.argv.slice(2),
], {
  env: { ...process.env, DOCKER_HOST: host, DOCKER_CONTEXT: '' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status === 0 && process.platform === 'win32' && process.argv[2] === 'start') {
  await configurePodmanLogs(socket);
}
process.exit(result.status ?? 1);
