import { createRequire } from 'node:module';

const cliRequire = createRequire(require.resolve('@nestjs/cli/package.json'));
const pluginRequire = createRequire(
  cliRequire.resolve('fork-ts-checker-webpack-plugin'),
);
const merge = pluginRequire('deepmerge') as <T>(target: object, source: T) => T;

function expectSafe(value: Record<string, unknown>) {
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(value.isAdmin).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(false);
}

describe('deepmerge prototype safety', () => {
  it('rejects __proto__ in source and target objects', () => {
    const malicious = JSON.parse(
      '{"__proto__":{"isAdmin":true},"debug":false}',
    ) as Record<string, unknown>;
    const target = Object.assign(Object.create(null) as object, { safe: true });
    const merged = merge(target, malicious);

    expectSafe(merged);
    expect(merged).toMatchObject({ safe: true, debug: false });
    expectSafe(merge({ session: null }, { session: malicious }).session);
    expectSafe(merge(malicious, { verbose: true }));
    expectSafe(merge({ list: [] as object[] }, { list: [malicious] }).list[0]);
  });

  it('preserves ordinary object, array and symbol merging', () => {
    const symbol = Symbol('key');
    const target = { nested: { a: 1 }, list: [1], [symbol]: 'old' };
    const result = merge(target, {
      nested: { b: 2 },
      list: [2],
      [symbol]: 'new',
    });

    expect(result).toEqual({
      nested: { a: 1, b: 2 },
      list: [1, 2],
      [symbol]: 'new',
    });
    expect(target.nested).toEqual({ a: 1 });
  });
});
