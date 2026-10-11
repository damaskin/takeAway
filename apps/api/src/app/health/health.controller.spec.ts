import { HealthController } from './health.controller';
import type { ReadinessService } from './readiness.service';

describe('GET /health', () => {
  const env = process.env;
  const commit = 'a414936f0c0e1d2b3a4c5d6e7f8091a2b3c4d5e6';

  beforeEach(() => {
    process.env = {
      ...env,
      BUILD_COMMIT: commit,
      BUILD_VERSION: 'v1.4.0-3-ga414936',
      BUILD_TIME: '2026-10-10T12:00:00Z',
      HEALTH_TOKEN: 'ops-health-token',
    };
  });

  afterEach(() => {
    process.env = env;
  });

  const controller = () => new HealthController({} as ReadinessService);

  it('tells anyone only that it is alive, and a short commit for the deploy gate', () => {
    expect(controller().check()).toEqual({ status: 'ok', commit: 'a414936f0c0e' });
    expect(controller().check('wrong-token')).toEqual({ status: 'ok', commit: 'a414936f0c0e' });
  });

  it('answers the full build triple and uptime to X-Health-Token', () => {
    expect(controller().check('ops-health-token')).toMatchObject({
      status: 'ok',
      commit,
      version: 'v1.4.0-3-ga414936',
      builtAt: '2026-10-10T12:00:00Z',
      uptime: expect.any(Number),
    });
  });

  it('never matches while no token is configured, whatever is sent', () => {
    delete process.env['HEALTH_TOKEN'];
    expect(controller().check('')).toEqual({ status: 'ok', commit: 'a414936f0c0e' });
    expect(controller().check('anything')).toEqual({ status: 'ok', commit: 'a414936f0c0e' });
  });
});
