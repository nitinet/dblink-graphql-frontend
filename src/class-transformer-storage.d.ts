/**
 * `class-transformer` only ships type declarations under its `types/` entry
 * (re-exported from `class-transformer`'s main index), not alongside the
 * compiled `cjs/storage.js` file this package imports `defaultMetadataStorage`
 * from directly (see `typeMapper.ts` for why: reaching the module-scoped
 * singleton the `@Type()` decorator itself writes to, rather than a fresh one).
 * This ambient declaration types only the one method actually used.
 */
declare module 'class-transformer/cjs/storage.js' {
  interface TypeMetadata {
    typeFunction: () => unknown;
  }

  interface MetadataStorage {
    findTypeMetadata(target: new (...args: unknown[]) => unknown, propertyName: string): TypeMetadata | undefined;
  }

  export const defaultMetadataStorage: MetadataStorage;
}
