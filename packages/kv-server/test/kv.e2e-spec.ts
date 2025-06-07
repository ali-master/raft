import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { cleanupDataDir, createTempDataDir } from './shared/utils/temp-dir'; // Assuming this path
import * as supertest from 'supertest'; // Using supertest for HTTP requests

describe('KVController (E2E)', () => {
  let app: INestApplication;
  let server: any; // To store the underlying HTTP server for supertest
  let tempRaftDataDir: string;
  const testEncryptionKey = crypto.randomBytes(32).toString('hex'); // Valid 32-byte key as hex

  beforeAll(async () => {
    // Set environment variables for this test run
    // These will be picked up by ConfigService when AppModule is initialized
    tempRaftDataDir = await createTempDataDir();
    process.env.NODE_ENV = 'test'; // Important for ConfigModule to pick up .env.test if used
    process.env.PORT = '0'; // Use ephemeral port for testing, Nest will pick one
    process.env.RAFT_NODE_ID = 'e2e-test-node';
    process.env.RAFT_HTTP_PORT = '0'; // Raft internal port, also ephemeral
    process.env.RAFT_PEERS = ''; // Single node for E2E test simplicity
    process.env.RAFT_DATA_DIR = tempRaftDataDir;
    process.env.KV_ENCRYPTION_KEY = testEncryptionKey;
    process.env.RAFT_SNAPSHOT_THRESHOLD="1000"; // High to avoid snapshots during basic E2E

    // Mock console.warn for encryption service default key warning if key was bad (it shouldn't be here)
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});


    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule], // AppModule should import ConfigModule.forRoot({isGlobal: true})
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    // app.setGlobalPrefix('api'); // If you have a global prefix

    await app.init();
    await app.getHttpAdapter().getInstance().ready(); // Ensure Fastify is ready
    server = app.getHttpServer(); // Get the underlying HTTP server for supertest

    consoleWarnSpy.mockRestore(); // Restore console.warn
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (tempRaftDataDir) {
      await cleanupDataDir(tempRaftDataDir);
    }
    // Restore any other global mocks or environment variables if necessary
    delete process.env.NODE_ENV;
    delete process.env.KV_ENCRYPTION_KEY;
    // ... reset other env vars if they interfere with other tests
  });

  it('PUT /kv/:key then GET /kv/:key (Success)', async () => {
    const key = 'mykey';
    const value = 'myvalue';

    // PUT the key
    const putResponse = await supertest(server)
      .put(`/kv/${key}`)
      .send({ value })
      .expect(HttpStatus.NO_CONTENT);

    // GET the key
    const getResponse = await supertest(server)
      .get(`/kv/${key}`)
      .expect(HttpStatus.OK);

    expect(getResponse.body).toEqual({ key, value });
  });

  it('GET /kv/:nonexistentkey (Not Found)', async () => {
    const key = 'nonexistentkey';
    await supertest(server)
      .get(`/kv/${key}`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('DELETE /kv/:key then GET /kv/:key (Success and then Not Found)', async () => {
    const key = 'todeletekey';
    const value = 'todeletevalue';

    // PUT the key first
    await supertest(server)
      .put(`/kv/${key}`)
      .send({ value })
      .expect(HttpStatus.NO_CONTENT);

    // GET to confirm it's there
    const getResponse1 = await supertest(server)
      .get(`/kv/${key}`)
      .expect(HttpStatus.OK);
    expect(getResponse1.body).toEqual({ key, value });

    // DELETE the key
    await supertest(server)
      .delete(`/kv/${key}`)
      .expect(HttpStatus.NO_CONTENT);

    // GET again to confirm it's not found
    await supertest(server)
      .get(`/kv/${key}`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('PUT /kv/:key with invalid key format (Bad Request)', async () => {
    const invalidKey = 'my key with spaces'; // Contains spaces, violating KEY_REGEX
    const value = 'some value';

    await supertest(server)
      .put(`/kv/${invalidKey}`)
      .send({ value })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('PUT /kv/:key with invalid body (Bad Request)', async () => {
    const key = 'mykeyforinvalidbody';

    await supertest(server)
      .put(`/kv/${key}`)
      .send({ wrong_field: 'some value' }) // 'value' field is missing
      .expect(HttpStatus.BAD_REQUEST);
      // NestJS ValidationPipe with forbidNonWhitelisted: true should cause this
  });
});
