# Examples: Raft KV Server

## 1. Basic Key-Value Operations (cURL)

### Set a Value
```bash
curl -X POST http://localhost:3000/kv/mykey -H "Content-Type: application/json" -d '{"value": "myvalue"}'
```

### Get a Value
```bash
curl http://localhost:3000/kv/mykey
```

### Delete a Value
```bash
curl -X DELETE http://localhost:3000/kv/mykey
```

### List All Keys
```bash
curl http://localhost:3000/kv
```

## 2. Health Checks

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/liveness
curl http://localhost:3000/health/readiness
```

## 3. Multi-Node Cluster (Docker Compose)

See the `README.md` for a sample `docker-compose.yml` to run a Raft cluster with multiple KV Server nodes.

## 4. Node.js Client Example

```js
const axios = require('axios');

async function setKey(key, value) {
  await axios.post(`http://localhost:3000/kv/${key}`, { value });
}

async function getKey(key) {
  const res = await axios.get(`http://localhost:3000/kv/${key}`);
  return res.data;
}

async function deleteKey(key) {
  await axios.delete(`http://localhost:3000/kv/${key}`);
}

(async () => {
  await setKey('foo', 'bar');
  console.log(await getKey('foo'));
  await deleteKey('foo');
})();
```

## 5. Swagger/OpenAPI

Visit [http://localhost:3000/api](http://localhost:3000/api) for interactive API docs.
