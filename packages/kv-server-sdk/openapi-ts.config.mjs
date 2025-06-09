import { defaultPlugins } from "@hey-api/openapi-ts";

/** @type {import('@hey-api/openapi-ts').UserConfig} */
export default {
  input: "https://raft-kv-server.usestrict.dev/api/docs/openapi.json",
  output: {
    format: "prettier",
    path: "src/client",
    case: "camelCase",
    clean: true,
  },
  experimentalParser: true,
  name: "Raft KV Server SDK",
  plugins: [
    ...defaultPlugins,
    "@hey-api/client-fetch",
    "zod",
    "@hey-api/schemas",
    "@hey-api/typescript",
    {
      dates: true,
      name: "@hey-api/transformers",
    },
    {
      name: "@hey-api/sdk",
      validator: true,
      transformer: true,
    },
  ],
};
