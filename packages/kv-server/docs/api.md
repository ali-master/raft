# API Documentation

## Overview

The Raft KV Server provides a RESTful API for key-value operations with built-in encryption and distributed consensus. This document details all available endpoints, request/response formats, and error handling.

## Base URL

```
http://localhost:3000
```

## Authentication

Currently, the API does not require authentication. Future versions will implement JWT-based authentication.

## Endpoints

### Key-Value Operations

#### Set Value

```http
POST /kv/:key
```

Sets a value for the specified key. The value is automatically encrypted before storage.

**Path Parameters:**
- `key` (string, required): The key to set

**Request Body:**
```json
{
  "value": "string"
}
```

**Response:**
- `201 Created`: Value set successfully
- `400 Bad Request`: Invalid request body
- `500 Internal Server Error`: Server error

**Example:**
```bash
curl -X POST http://localhost:3000/kv/mykey \
  -H "Content-Type: application/json" \
  -d '{"value": "myvalue"}'
```

#### Get Value

```http
GET /kv/:key
```

Retrieves the value for the specified key. The value is automatically decrypted before being returned.

**Path Parameters:**
- `key` (string, required): The key to retrieve

**Response:**
- `200 OK`: Value retrieved successfully
  ```json
  {
    "value": "string"
  }
  ```
- `404 Not Found`: Key not found
- `500 Internal Server Error`: Server error

**Example:**
```bash
curl http://localhost:3000/kv/mykey
```

#### Delete Value

```http
DELETE /kv/:key
```

Deletes the value for the specified key.

**Path Parameters:**
- `key` (string, required): The key to delete

**Response:**
- `200 OK`: Value deleted successfully
- `404 Not Found`: Key not found
- `500 Internal Server Error`: Server error

**Example:**
```bash
curl -X DELETE http://localhost:3000/kv/mykey
```

#### List Keys

```http
GET /kv
```

Lists all available keys in the store.

**Response:**
- `200 OK`: List of keys
  ```json
  {
    "keys": ["string"]
  }
  ```
- `500 Internal Server Error`: Server error

**Example:**
```bash
curl http://localhost:3000/kv
```

### Health Checks

#### Full Health Check

```http
GET /health
```

Performs a comprehensive health check of all system components.

**Response:**
- `200 OK`: All components healthy
  ```json
  {
    "status": "ok",
    "details": {
      "kv-store": {
        "status": "up"
      },
      "raft": {
        "status": "up"
      },
      "encryption": {
        "status": "up"
      }
    }
  }
  ```
- `503 Service Unavailable`: One or more components unhealthy

**Example:**
```bash
curl http://localhost:3000/health
```

#### Liveness Probe

```http
GET /health/liveness
```

Checks if the service is alive and responding to requests.

**Response:**
- `200 OK`: Service is alive
- `503 Service Unavailable`: Service is not responding

**Example:**
```bash
curl http://localhost:3000/health/liveness
```

#### Readiness Probe

```http
GET /health/readiness
```

Checks if the service is ready to handle requests.

**Response:**
- `200 OK`: Service is ready
- `503 Service Unavailable`: Service is not ready

**Example:**
```bash
curl http://localhost:3000/health/readiness
```

## Error Handling

All errors follow a consistent format:

```json
{
  "statusCode": number,
  "message": "string",
  "error": "string",
  "details": object
}
```

### Common Error Codes

- `400 Bad Request`: Invalid request parameters
- `404 Not Found`: Resource not found
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error
- `503 Service Unavailable`: Service unavailable

## Rate Limiting

The API implements rate limiting to prevent abuse:

- Default: 100 requests per minute per IP
- Configurable via environment variables:
  - `RATE_LIMIT_MAX`
  - `RATE_LIMIT_WINDOW_MS`

## CORS

Cross-Origin Resource Sharing (CORS) is enabled and configurable:

- Default: Allow all origins (`*`)
- Configurable via environment variable: `CORS_ORIGIN`

## API Versioning

The current API version is v1. Future versions will be available at:

```
http://localhost:3000/v{version}
```

## Swagger Documentation

Interactive API documentation is available at:

```
http://localhost:3000/api
```

## Best Practices

1. **Error Handling**
   - Always check response status codes
   - Handle rate limiting errors
   - Implement retry logic for transient failures

2. **Performance**
   - Use connection pooling
   - Implement client-side caching
   - Batch operations when possible

3. **Security**
   - Use HTTPS in production
   - Rotate encryption keys regularly
   - Monitor for suspicious activity