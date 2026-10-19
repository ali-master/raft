<div align="center">
  <img src="../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>@usex/kv-server-sdk</h1>
  <p>A generated TypeScript client for Raft KV Server.</p>
  <p><a href="../../README.md">Workspace</a> · <a href="../kv-server/README.md">KV server</a> · <a href="../../docs/raft-spec-audit.md">Validation</a></p>
</div>

This package configures `@hey-api/openapi-ts` to generate a Fetch client, TypeScript types, Zod validators, schemas, and response transformers from the KV server's OpenAPI document. Generated source lives in `src/client`; compiled output lives in `lib/client`.

**Status:** the generator configuration is present, but generated client source is not checked in. The [contract audit](../../docs/raft-spec-audit.md) found that the current server schema produces a write validator that rejects the POST body. Successful generation and compilation do not establish a working HTTP contract.

## Generate and build

Use Bun >= 1.4.3. Install dependencies from the repository root:

```bash
bun install --frozen-lockfile
cd packages/kv-server-sdk
```

Start the [KV server](../kv-server/README.md#run-locally), then generate against its actual local API:

```bash
bun run generate:client -i http://127.0.0.1:3000/api/docs/openapi.json
bun run build
```

Without `-i`, [`openapi-ts.config.mjs`](./openapi-ts.config.mjs) uses the configured hosted schema URL. Use a schema from the server version you intend to call. Generation has `clean: true` and replaces `src/client`; keep handwritten code elsewhere.

The package entry point is `lib/client/index.js`, with declarations in `lib/client/index.d.ts`. Inspect `src/client/index.ts` for the operations exported by your generated schema. Do not assume operation names or response types from a different server revision.

## Validation

```bash
bun run test
```

The package test command currently allows zero tests. Its build prints a skip message when `src/client/index.ts` does not exist, so a green workspace build alone does not mean a usable SDK was produced.

Real generation, compilation, and server calls are exercised by the KV server's contract regression:

```bash
# From the repository root; requires Docker for isolated Redis.
bun run --cwd packages/kv-server test run test/integration/data-contract.spec.ts
```

That suite includes known failures. See the [audit](../../docs/raft-spec-audit.md) for the distinction between working GET/list requests and the failing generated POST contract.

## Related packages

- [KV server](../kv-server/README.md): routes, configuration, and OpenAPI location
- [Core engine](../raft/README.md): consensus and state-machine APIs
- [Raft Observatory](../raft/playground/README.md): cluster visualization and node metrics
- [Brand assets](../../assets/BRAND_ASSETS.md)

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
