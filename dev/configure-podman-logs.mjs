import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { podman } from './podman.mjs';

export async function configurePodmanLogs(socketPath) {
  const name = 'supabase_vector_YBuy';
  const containers = JSON.parse(execFileSync(podman, ['ps', '-a', '--filter', `name=^${name}$`, '--format', 'json'], { encoding: 'utf8' }));
  if (containers.length === 0) return;
  const [container] = JSON.parse(execFileSync(podman, ['inspect', name], { encoding: 'utf8' }));
  const dockerHost = 'DOCKER_HOST=unix:///var/run/docker.sock';
  if (container.Config.Env.includes(dockerHost)
    && container.Mounts.some(mount => mount.Destination === '/var/run/docker.sock')) return;
  const config = {
    ...container.Config,
    Env: [...container.Config.Env.filter(value => !value.startsWith('DOCKER_HOST=')), dockerHost],
    HostConfig: {
      ...container.HostConfig,
      Binds: [...(container.HostConfig.Binds ?? []), '/run/podman/podman.sock:/var/run/docker.sock:ro'],
    },
    NetworkingConfig: {
      EndpointsConfig: Object.fromEntries(Object.entries(container.NetworkSettings.Networks)
        .map(([network, settings]) => [network, { Aliases: settings.Aliases }])),
    },
  };
  async function api(method, path, body) {
    const payload = body ? JSON.stringify(body) : '';
    return await new Promise((resolve, reject) => {
      const req = request({
        socketPath, method, path,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      }, response => {
        let output = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { output += chunk; });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Podman log-container ${method} failed (${response.statusCode}): ${output}`));
          } else resolve();
        });
        response.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(30_000, () => req.destroy(new Error('Podman log-container API timed out.')));
      req.end(payload);
    });
  }
  const replacement = `${name}_socket`;
  await api('POST', `/containers/create?name=${replacement}`, config);
  execFileSync(podman, ['stop', name], { stdio: 'ignore' });
  try {
    await api('POST', `/containers/${replacement}/start`);
  } catch (error) {
    execFileSync(podman, ['start', name], { stdio: 'ignore' });
    await api('DELETE', `/containers/${replacement}?v=false`);
    throw error;
  }
  await api('DELETE', `/containers/${name}?v=false`);
  execFileSync(podman, ['rename', replacement, name], { stdio: 'ignore' });
  console.error('Configured Supabase logging through the local Podman Unix socket.');
}
