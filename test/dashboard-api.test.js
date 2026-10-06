import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('staff can sign in and load orders when analytics packages are unavailable', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === 'posthog-node' || specifier.startsWith('@opentelemetry/')) {
          throw new Error('Analytics package unavailable');
        }
        return nextResolve(specifier, context);
      },
    });
    const { default: login } = await import('./api/dashboard/login.js');
    const { default: orders } = await import('./api/dashboard/orders.js');
    function response() {
      return {
        headers: {}, code: 200,
        setHeader(key, value) { this.headers[key] = value; },
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; },
      };
    }
    let requests = 0;
    globalThis.fetch = async (url, options) => {
      requests++;
      const parsed = new URL(url);
      if (parsed.pathname === '/rest/v1/rpc/consume_api_rate_limit') {
        return { ok: true, json: async () => true };
      }
      assert.equal(parsed.origin, 'https://storage.example');
      assert.equal(parsed.pathname, '/rest/v1/orders');
      assert.equal(parsed.searchParams.get('select'), '*,order_trackers(*),order_sms_messages(*)');
      assert.equal(options.headers.apikey, 'test-service-key');
      return { ok: true, json: async () => [{ id: 'test-order', order_trackers: [] }] };
    };
    const signedIn = response();
    await login({ method: 'POST', headers: {}, body: { password: 'test-password' } }, signedIn);
    assert.equal(signedIn.code, 200);
    const cookie = signedIn.headers['Set-Cookie'].split(';')[0];
    const loaded = response();
    await orders({ method: 'GET', headers: { cookie } }, loaded);
    assert.equal(loaded.code, 200);
    assert.deepEqual(loaded.body, [{ id: 'test-order', order_trackers: [] }]);
    assert.equal(requests, 2);
    const unsigned = response();
    await orders({ method: 'GET', headers: {} }, unsigned);
    assert.equal(unsigned.code, 401);
    assert.equal(requests, 2);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../', import.meta.url),
    env: {
      ...process.env,
      DASHBOARD_PASSWORD: 'test-password',
      SUPABASE_URL: 'https://storage.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      POSTHOG_PROJECT_TOKEN: 'test-project-token',
      POSTHOG_HOST: 'https://analytics.example',
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
