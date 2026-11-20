const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const missing = required.filter(name => !process.env[name]?.trim());

if (missing.length) {
  console.error(`Missing required Netlify build variables: ${missing.join(', ')}`);
  console.error('Set them in the Netlify site environment before deploying.');
  process.exitCode = 1;
}

if (process.env.VITE_SUPABASE_URL?.trim()) {
  try {
    const url = new URL(process.env.VITE_SUPABASE_URL);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    console.error('VITE_SUPABASE_URL must be a valid HTTP(S) URL.');
    process.exitCode = 1;
  }
}
