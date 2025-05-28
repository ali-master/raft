# Security Best Practices

This guide covers security considerations and best practices for deploying and operating RAFT clusters in production environments.

## Table of Contents

- [Security Overview](#security-overview)
- [Authentication](#authentication)
- [Authorization](#authorization)
- [Encryption](#encryption)
- [Network Security](#network-security)
- [Secrets Management](#secrets-management)
- [Audit and Compliance](#audit-and-compliance)
- [Security Hardening](#security-hardening)
- [Vulnerability Management](#vulnerability-management)
- [Incident Response](#incident-response)
- [Security Checklist](#security-checklist)

## Security Overview

### Threat Model

Understanding potential threats to RAFT clusters:

```typescript
interface ThreatModel {
  // External Threats
  external: {
    unauthorizedAccess: 'Attackers gaining access to cluster',
    dataInterception: 'Network traffic being intercepted',
    denialOfService: 'Overwhelming cluster with requests',
    dataExfiltration: 'Stealing sensitive data'
  },
  
  // Internal Threats
  internal: {
    privilegeEscalation: 'Users gaining unauthorized permissions',
    dataLeakage: 'Accidental exposure of sensitive data',
    misconfiguration: 'Security weakened by poor configuration',
    insiderThreats: 'Malicious actors with legitimate access'
  },
  
  // Infrastructure Threats
  infrastructure: {
    nodeCompromise: 'Individual nodes being compromised',
    networkSegmentation: 'Lateral movement between systems',
    supplyChain: 'Compromised dependencies or images',
    physicalAccess: 'Unauthorized physical access to servers'
  }
}
```

### Security Principles

1. **Defense in Depth**: Multiple layers of security
2. **Least Privilege**: Minimal necessary permissions
3. **Zero Trust**: Verify everything, trust nothing
4. **Encryption Everywhere**: Protect data at rest and in transit
5. **Audit Everything**: Comprehensive logging and monitoring

## Authentication

### Node-to-Node Authentication

#### Mutual TLS (mTLS)

```typescript
class MutualTLSAuthenticator {
  private ca: Buffer;
  private cert: Buffer;
  private key: Buffer;
  
  constructor(config: TLSConfig) {
    this.ca = fs.readFileSync(config.caPath);
    this.cert = fs.readFileSync(config.certPath);
    this.key = fs.readFileSync(config.keyPath);
  }
  
  createSecureServer(): https.Server {
    return https.createServer({
      ca: this.ca,
      cert: this.cert,
      key: this.key,
      requestCert: true,
      rejectUnauthorized: true,
      // Strong cipher suites only
      ciphers: [
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-AES128-GCM-SHA256'
      ].join(':'),
      honorCipherOrder: true,
      minVersion: 'TLSv1.2'
    });
  }
  
  createSecureClient(targetNode: string): https.Agent {
    return new https.Agent({
      ca: this.ca,
      cert: this.cert,
      key: this.key,
      servername: targetNode, // For SNI
      checkServerIdentity: (hostname, cert) => {
        // Custom verification logic
        return this.verifyNodeIdentity(hostname, cert);
      }
    });
  }
  
  private verifyNodeIdentity(hostname: string, cert: any): Error | undefined {
    // Verify the certificate belongs to a valid cluster node
    const allowedNodes = this.getAllowedNodes();
    const certCN = cert.subject.CN;
    
    if (!allowedNodes.includes(certCN)) {
      return new Error(`Unauthorized node: ${certCN}`);
    }
    
    // Additional checks
    if (cert.issuer.CN !== this.expectedIssuer) {
      return new Error('Invalid certificate issuer');
    }
    
    return undefined;
  }
}
```

#### Pre-Shared Key Authentication

```typescript
class PSKAuthenticator {
  private keys: Map<string, string> = new Map();
  
  async authenticateRequest(req: Request): Promise<boolean> {
    const nodeId = req.headers['x-raft-node-id'];
    const timestamp = req.headers['x-raft-timestamp'];
    const signature = req.headers['x-raft-signature'];
    
    if (!nodeId || !timestamp || !signature) {
      return false;
    }
    
    // Check timestamp to prevent replay attacks
    const requestTime = parseInt(timestamp);
    const now = Date.now();
    if (Math.abs(now - requestTime) > 30000) { // 30 second window
      return false;
    }
    
    // Verify signature
    const psk = this.keys.get(nodeId);
    if (!psk) {
      return false;
    }
    
    const expectedSignature = this.calculateSignature(
      req.method,
      req.url,
      req.body,
      timestamp,
      psk
    );
    
    // Constant-time comparison
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }
  
  private calculateSignature(
    method: string,
    url: string,
    body: any,
    timestamp: string,
    psk: string
  ): string {
    const message = `${method}\n${url}\n${JSON.stringify(body)}\n${timestamp}`;
    return crypto
      .createHmac('sha256', psk)
      .update(message)
      .digest('hex');
  }
}
```

### Client Authentication

#### JWT Authentication

```typescript
class JWTAuthenticator {
  private publicKey: string;
  
  async authenticateClient(token: string): Promise<ClientIdentity | null> {
    try {
      const decoded = jwt.verify(token, this.publicKey, {
        algorithms: ['RS256'],
        issuer: 'raft-auth-service',
        audience: 'raft-cluster'
      });
      
      // Additional validation
      if (!this.isValidClient(decoded)) {
        return null;
      }
      
      return {
        clientId: decoded.sub,
        permissions: decoded.permissions,
        expiresAt: new Date(decoded.exp * 1000)
      };
    } catch (error) {
      console.error('JWT verification failed:', error);
      return null;
    }
  }
  
  private isValidClient(claims: any): boolean {
    // Check required claims
    if (!claims.sub || !claims.permissions) {
      return false;
    }
    
    // Check client is not revoked
    if (this.isRevoked(claims.sub)) {
      return false;
    }
    
    return true;
  }
}
```

#### API Key Authentication

```typescript
class APIKeyAuthenticator {
  private keyStore: SecureKeyStore;
  
  async authenticateAPIKey(apiKey: string): Promise<ClientIdentity | null> {
    // Hash the API key for storage
    const keyHash = crypto
      .createHash('sha256')
      .update(apiKey)
      .digest('hex');
    
    const keyData = await this.keyStore.getKey(keyHash);
    if (!keyData) {
      return null;
    }
    
    // Check if key is expired
    if (keyData.expiresAt && keyData.expiresAt < new Date()) {
      return null;
    }
    
    // Check rate limits
    if (!this.checkRateLimit(keyData.clientId)) {
      throw new Error('Rate limit exceeded');
    }
    
    // Log access
    await this.logAccess(keyData.clientId, 'api_key');
    
    return {
      clientId: keyData.clientId,
      permissions: keyData.permissions,
      rateLimit: keyData.rateLimit
    };
  }
}
```

## Authorization

### Role-Based Access Control (RBAC)

```typescript
interface Role {
  name: string;
  permissions: Permission[];
}

interface Permission {
  resource: string;
  actions: string[];
}

class RBACAuthorizer {
  private roles: Map<string, Role> = new Map([
    ['admin', {
      name: 'admin',
      permissions: [
        { resource: '*', actions: ['*'] }
      ]
    }],
    ['operator', {
      name: 'operator',
      permissions: [
        { resource: 'node', actions: ['read', 'update'] },
        { resource: 'cluster', actions: ['read'] },
        { resource: 'metrics', actions: ['read'] }
      ]
    }],
    ['viewer', {
      name: 'viewer',
      permissions: [
        { resource: '*', actions: ['read'] }
      ]
    }]
  ]);
  
  authorize(
    identity: ClientIdentity,
    resource: string,
    action: string
  ): boolean {
    const role = this.roles.get(identity.role);
    if (!role) {
      return false;
    }
    
    return role.permissions.some(permission => {
      const resourceMatch = permission.resource === '*' || 
                          permission.resource === resource;
      const actionMatch = permission.actions.includes('*') || 
                         permission.actions.includes(action);
      
      return resourceMatch && actionMatch;
    });
  }
}
```

### Attribute-Based Access Control (ABAC)

```typescript
interface Policy {
  id: string;
  effect: 'allow' | 'deny';
  conditions: Condition[];
}

class ABACAuthorizer {
  async authorize(
    subject: Subject,
    resource: Resource,
    action: string,
    context: Context
  ): Promise<boolean> {
    const applicablePolicies = await this.findApplicablePolicies(
      subject,
      resource,
      action
    );
    
    // Evaluate policies
    for (const policy of applicablePolicies) {
      const matched = this.evaluateConditions(
        policy.conditions,
        subject,
        resource,
        context
      );
      
      if (matched) {
        return policy.effect === 'allow';
      }
    }
    
    // Default deny
    return false;
  }
  
  private evaluateConditions(
    conditions: Condition[],
    subject: Subject,
    resource: Resource,
    context: Context
  ): boolean {
    return conditions.every(condition => {
      switch (condition.type) {
        case 'time':
          return this.evaluateTimeCondition(condition, context);
        case 'location':
          return this.evaluateLocationCondition(condition, context);
        case 'attribute':
          return this.evaluateAttributeCondition(condition, subject, resource);
        default:
          return false;
      }
    });
  }
}
```

## Encryption

### Data at Rest

#### Transparent Data Encryption

```typescript
class DataEncryption {
  private masterKey: Buffer;
  private dataKeys: Map<string, Buffer> = new Map();
  
  async encryptData(data: Buffer, context: string): Promise<EncryptedData> {
    // Generate or retrieve data encryption key
    const dataKey = await this.getDataKey(context);
    
    // Generate IV
    const iv = crypto.randomBytes(16);
    
    // Encrypt data
    const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(data),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv,
      authTag,
      keyId: context,
      algorithm: 'aes-256-gcm'
    };
  }
  
  async decryptData(encryptedData: EncryptedData): Promise<Buffer> {
    const dataKey = await this.getDataKey(encryptedData.keyId);
    
    const decipher = crypto.createDecipheriv(
      encryptedData.algorithm,
      dataKey,
      encryptedData.iv
    );
    decipher.setAuthTag(encryptedData.authTag);
    
    return Buffer.concat([
      decipher.update(encryptedData.encrypted),
      decipher.final()
    ]);
  }
  
  private async getDataKey(context: string): Promise<Buffer> {
    if (!this.dataKeys.has(context)) {
      // Derive data key from master key
      const dataKey = await this.deriveDataKey(context);
      this.dataKeys.set(context, dataKey);
    }
    
    return this.dataKeys.get(context)!;
  }
  
  private async deriveDataKey(context: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(this.masterKey, context, 100000, 32, 'sha256', 
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        }
      );
    });
  }
}
```

#### File System Encryption

```typescript
class FileSystemEncryption {
  async encryptFile(filePath: string, outputPath: string): Promise<void> {
    const input = fs.createReadStream(filePath);
    const output = fs.createWriteStream(outputPath);
    
    // Generate file key
    const fileKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    
    // Encrypt file key with master key
    const encryptedFileKey = await this.encryptFileKey(fileKey);
    
    // Write header
    output.write(Buffer.concat([
      Buffer.from('RAFT'), // Magic bytes
      Buffer.from([1, 0]), // Version
      encryptedFileKey,
      iv
    ]));
    
    // Encrypt file contents
    const cipher = crypto.createCipheriv('aes-256-cbc', fileKey, iv);
    
    input.pipe(cipher).pipe(output);
    
    return new Promise((resolve, reject) => {
      output.on('finish', resolve);
      output.on('error', reject);
    });
  }
}
```

### Data in Transit

#### TLS Configuration

```typescript
class TLSConfiguration {
  createSecureContext(): SecureContext {
    return tls.createSecureContext({
      // Certificate and key
      cert: fs.readFileSync('/certs/server.crt'),
      key: fs.readFileSync('/certs/server.key'),
      ca: fs.readFileSync('/certs/ca.crt'),
      
      // Strong security settings
      secureOptions: 
        constants.SSL_OP_NO_SSLv2 |
        constants.SSL_OP_NO_SSLv3 |
        constants.SSL_OP_NO_TLSv1 |
        constants.SSL_OP_NO_TLSv1_1,
      
      // Cipher configuration
      ciphers: [
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-GCM-SHA256',
        '!aNULL',
        '!MD5',
        '!DSS'
      ].join(':'),
      
      // Prefer server ciphers
      honorCipherOrder: true,
      
      // ECDH curve
      ecdhCurve: 'secp384r1'
    });
  }
}
```

## Network Security

### Firewall Rules

```bash
#!/bin/bash
# iptables rules for RAFT cluster

# Default policies
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT

# Allow RAFT ports from cluster nodes only
CLUSTER_NODES="10.0.1.10 10.0.1.11 10.0.1.12"
for node in $CLUSTER_NODES; do
  # RAFT communication
  iptables -A INPUT -p tcp -s $node --dport 3000:3010 -j ACCEPT
  
  # Metrics (from monitoring subnet)
  iptables -A INPUT -p tcp -s 10.0.2.0/24 --dport 9090 -j ACCEPT
done

# Allow SSH from bastion only
iptables -A INPUT -p tcp -s 10.0.0.5 --dport 22 -j ACCEPT

# Log dropped packets
iptables -A INPUT -j LOG --log-prefix "DROPPED: "
```

### Network Segmentation

```yaml
# Kubernetes NetworkPolicy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: raft-network-policy
  namespace: raft-system
spec:
  podSelector:
    matchLabels:
      app: raft
  policyTypes:
  - Ingress
  - Egress
  
  ingress:
  # Allow RAFT communication between nodes
  - from:
    - podSelector:
        matchLabels:
          app: raft
    ports:
    - protocol: TCP
      port: 3000
  
  # Allow metrics scraping
  - from:
    - namespaceSelector:
        matchLabels:
          name: monitoring
    - podSelector:
        matchLabels:
          app: prometheus
    ports:
    - protocol: TCP
      port: 9090
  
  egress:
  # Allow communication to other RAFT nodes
  - to:
    - podSelector:
        matchLabels:
          app: raft
    ports:
    - protocol: TCP
      port: 3000
  
  # Allow Redis access
  - to:
    - podSelector:
        matchLabels:
          app: redis
    ports:
    - protocol: TCP
      port: 6379
  
  # Allow DNS
  - to:
    - podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
```

### DDoS Protection

```typescript
class DDoSProtection {
  private requestCounts: Map<string, number[]> = new Map();
  private blacklist: Set<string> = new Set();
  
  async handleRequest(req: Request, res: Response, next: Function) {
    const clientIP = this.getClientIP(req);
    
    // Check blacklist
    if (this.blacklist.has(clientIP)) {
      return res.status(403).send('Forbidden');
    }
    
    // Rate limiting
    if (!this.checkRateLimit(clientIP)) {
      this.blacklist.add(clientIP);
      setTimeout(() => this.blacklist.delete(clientIP), 3600000); // 1 hour
      return res.status(429).send('Too Many Requests');
    }
    
    // Check request patterns
    if (this.isSuspiciousPattern(req)) {
      this.logSuspiciousActivity(clientIP, req);
      return res.status(400).send('Bad Request');
    }
    
    next();
  }
  
  private checkRateLimit(clientIP: string): boolean {
    const now = Date.now();
    const requests = this.requestCounts.get(clientIP) || [];
    
    // Remove old entries
    const recentRequests = requests.filter(time => now - time < 60000);
    
    // Check limits
    if (recentRequests.length >= 100) { // 100 requests per minute
      return false;
    }
    
    recentRequests.push(now);
    this.requestCounts.set(clientIP, recentRequests);
    
    return true;
  }
  
  private isSuspiciousPattern(req: Request): boolean {
    // Check for common attack patterns
    const suspicious = [
      /\.\.\//,           // Path traversal
      /<script/i,         // XSS attempts
      /union.*select/i,   // SQL injection
      /\x00/,            // Null bytes
    ];
    
    const url = req.url + JSON.stringify(req.body);
    return suspicious.some(pattern => pattern.test(url));
  }
}
```

## Secrets Management

### HashiCorp Vault Integration

```typescript
class VaultSecretsManager {
  private vault: Vault;
  private token: string;
  
  async initialize() {
    this.vault = new Vault({
      endpoint: process.env.VAULT_ADDR,
      token: await this.getVaultToken()
    });
    
    // Enable automatic token renewal
    this.startTokenRenewal();
  }
  
  async getSecret(path: string): Promise<any> {
    try {
      const response = await this.vault.read(`secret/data/${path}`);
      return response.data.data;
    } catch (error) {
      if (error.statusCode === 403) {
        // Token might be expired, try to renew
        await this.renewToken();
        return this.getSecret(path);
      }
      throw error;
    }
  }
  
  async rotateSecret(path: string): Promise<void> {
    const newSecret = crypto.randomBytes(32).toString('base64');
    
    await this.vault.write(`secret/data/${path}`, {
      data: {
        value: newSecret,
        rotated_at: new Date().toISOString(),
        version: Date.now()
      }
    });
    
    // Notify services about rotation
    await this.notifySecretRotation(path);
  }
  
  private async getVaultToken(): Promise<string> {
    // Use Kubernetes auth
    const jwt = fs.readFileSync(
      '/var/run/secrets/kubernetes.io/serviceaccount/token',
      'utf8'
    );
    
    const auth = await this.vault.kubernetesLogin({
      role: 'raft-cluster',
      jwt
    });
    
    return auth.auth.client_token;
  }
}
```

### Secrets Rotation

```typescript
class SecretsRotation {
  private rotationSchedule: Map<string, number> = new Map([
    ['tls_cert', 90 * 24 * 60 * 60 * 1000],      // 90 days
    ['api_keys', 30 * 24 * 60 * 60 * 1000],      // 30 days
    ['encryption_keys', 365 * 24 * 60 * 60 * 1000], // 1 year
  ]);
  
  async rotateSecrets() {
    for (const [secretType, interval] of this.rotationSchedule) {
      const lastRotation = await this.getLastRotation(secretType);
      
      if (Date.now() - lastRotation > interval) {
        await this.rotateSecret(secretType);
      }
    }
  }
  
  private async rotateSecret(secretType: string) {
    console.log(`Rotating ${secretType}`);
    
    switch (secretType) {
      case 'tls_cert':
        await this.rotateTLSCertificates();
        break;
      case 'api_keys':
        await this.rotateAPIKeys();
        break;
      case 'encryption_keys':
        await this.rotateEncryptionKeys();
        break;
    }
    
    await this.recordRotation(secretType);
  }
  
  private async rotateTLSCertificates() {
    // Generate new certificates
    const newCerts = await this.generateCertificates();
    
    // Update nodes one by one
    for (const node of this.cluster.getNodes()) {
      await this.updateNodeCertificate(node, newCerts);
    }
    
    // Revoke old certificates
    await this.revokeOldCertificates();
  }
}
```

## Audit and Compliance

### Audit Logging

```typescript
interface AuditEvent {
  timestamp: Date;
  eventType: string;
  actor: {
    type: 'user' | 'system' | 'node';
    id: string;
    ip?: string;
  };
  resource: {
    type: string;
    id: string;
  };
  action: string;
  result: 'success' | 'failure';
  details?: any;
}

class AuditLogger {
  private auditStream: fs.WriteStream;
  private syslog: Syslog;
  
  async logEvent(event: AuditEvent) {
    // Add integrity protection
    event.hash = this.calculateEventHash(event);
    
    // Log to multiple destinations
    await Promise.all([
      this.logToFile(event),
      this.logToSyslog(event),
      this.logToSIEM(event)
    ]);
    
    // Real-time alerting for critical events
    if (this.isCriticalEvent(event)) {
      await this.alertSecurityTeam(event);
    }
  }
  
  private calculateEventHash(event: AuditEvent): string {
    const content = JSON.stringify({
      ...event,
      hash: undefined
    });
    
    return crypto
      .createHmac('sha256', this.auditKey)
      .update(content)
      .digest('hex');
  }
  
  private isCriticalEvent(event: AuditEvent): boolean {
    const criticalEvents = [
      'authentication_failure',
      'authorization_failure',
      'configuration_change',
      'node_compromise',
      'data_breach'
    ];
    
    return criticalEvents.includes(event.eventType) ||
           (event.result === 'failure' && event.action.includes('delete'));
  }
}
```

### Compliance Monitoring

```typescript
class ComplianceMonitor {
  async runComplianceChecks(): Promise<ComplianceReport> {
    const checks = [
      this.checkEncryption(),
      this.checkAccessControls(),
      this.checkAuditLogs(),
      this.checkDataRetention(),
      this.checkSecurityPatches()
    ];
    
    const results = await Promise.all(checks);
    
    return {
      timestamp: new Date(),
      framework: 'SOC2', // or HIPAA, PCI-DSS, etc.
      passed: results.every(r => r.passed),
      checks: results
    };
  }
  
  private async checkEncryption(): Promise<ComplianceCheck> {
    const issues: string[] = [];
    
    // Check TLS versions
    const tlsVersion = await this.getTLSVersion();
    if (tlsVersion < 'TLSv1.2') {
      issues.push(`TLS version ${tlsVersion} is below minimum requirement`);
    }
    
    // Check data encryption
    const unencryptedData = await this.findUnencryptedData();
    if (unencryptedData.length > 0) {
      issues.push(`Found ${unencryptedData.length} unencrypted files`);
    }
    
    return {
      name: 'Encryption Compliance',
      passed: issues.length === 0,
      issues
    };
  }
}
```

## Security Hardening

### System Hardening

```bash
#!/bin/bash
# System hardening script

# Kernel parameters
cat >> /etc/sysctl.conf << EOF
# IP Spoofing protection
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Ignore ICMP redirects
net.ipv4.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0

# Ignore send redirects
net.ipv4.conf.all.send_redirects = 0

# Disable source packet routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0

# Log Martians
net.ipv4.conf.all.log_martians = 1

# Ignore ICMP ping requests
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Syn flood protection
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2
net.ipv4.tcp_syn_retries = 5
EOF

sysctl -p

# File permissions
chmod 600 /etc/shadow
chmod 644 /etc/passwd
chmod 600 /etc/gshadow
chmod 644 /etc/group

# Disable unnecessary services
systemctl disable avahi-daemon
systemctl disable cups
systemctl disable bluetooth

# Remove unnecessary packages
apt-get remove -y telnet rsh-client rsh-redone-client
```

### Container Security

```dockerfile
# Secure Dockerfile
FROM node:20-alpine AS builder

# Don't run as root
RUN addgroup -g 1001 -S raft && \
    adduser -S raft -u 1001

# Copy only necessary files
WORKDIR /app
COPY --chown=raft:raft package*.json ./
RUN npm ci --only=production

COPY --chown=raft:raft . .
RUN npm run build

# Production image
FROM gcr.io/distroless/nodejs20-debian11

# Copy from builder
COPY --from=builder --chown=1001:1001 /app/dist /app/dist
COPY --from=builder --chown=1001:1001 /app/node_modules /app/node_modules

# Run as non-root
USER 1001

# No shell, minimal attack surface
WORKDIR /app
CMD ["dist/index.js"]
```

### Application Security Headers

```typescript
class SecurityHeaders {
  apply(app: Express) {
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));
    
    // Additional headers
    app.use((req, res, next) => {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      res.removeHeader('X-Powered-By');
      next();
    });
  }
}
```

## Vulnerability Management

### Dependency Scanning

```typescript
class DependencyScanner {
  async scanDependencies(): Promise<VulnerabilityReport> {
    const vulnerabilities: Vulnerability[] = [];
    
    // Run multiple scanners
    const [npmAudit, snyk, owasp] = await Promise.all([
      this.runNpmAudit(),
      this.runSnyk(),
      this.runOWASP()
    ]);
    
    vulnerabilities.push(...npmAudit, ...snyk, ...owasp);
    
    // Deduplicate and prioritize
    const uniqueVulns = this.deduplicateVulnerabilities(vulnerabilities);
    const prioritized = this.prioritizeVulnerabilities(uniqueVulns);
    
    return {
      timestamp: new Date(),
      total: prioritized.length,
      critical: prioritized.filter(v => v.severity === 'critical').length,
      high: prioritized.filter(v => v.severity === 'high').length,
      medium: prioritized.filter(v => v.severity === 'medium').length,
      low: prioritized.filter(v => v.severity === 'low').length,
      vulnerabilities: prioritized
    };
  }
  
  private prioritizeVulnerabilities(vulns: Vulnerability[]): Vulnerability[] {
    return vulns.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      
      if (a.severity !== b.severity) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      
      // Sort by CVSS score if same severity
      return (b.cvss || 0) - (a.cvss || 0);
    });
  }
}
```

### Security Testing

```typescript
class SecurityTester {
  async runSecurityTests(): Promise<TestResults> {
    const tests = [
      this.testAuthentication(),
      this.testAuthorization(),
      this.testEncryption(),
      this.testInputValidation(),
      this.testRateLimiting(),
      this.testCSRF(),
      this.testXSS()
    ];
    
    const results = await Promise.all(tests);
    
    return {
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      tests: results
    };
  }
  
  private async testAuthentication(): Promise<TestResult> {
    const tests = [
      // Test invalid credentials
      async () => {
        const res = await this.request('/api/login', {
          username: 'invalid',
          password: 'invalid'
        });
        return res.status === 401;
      },
      
      // Test brute force protection
      async () => {
        for (let i = 0; i < 10; i++) {
          await this.request('/api/login', {
            username: 'test',
            password: 'wrong'
          });
        }
        const res = await this.request('/api/login', {
          username: 'test',
          password: 'wrong'
        });
        return res.status === 429; // Rate limited
      },
      
      // Test token expiration
      async () => {
        const expiredToken = this.generateExpiredToken();
        const res = await this.request('/api/protected', {
          headers: { Authorization: `Bearer ${expiredToken}` }
        });
        return res.status === 401;
      }
    ];
    
    const results = await Promise.all(tests.map(t => t()));
    
    return {
      name: 'Authentication Tests',
      passed: results.every(r => r),
      details: results
    };
  }
}
```

## Incident Response

### Incident Detection

```typescript
class IncidentDetector {
  private patterns: SecurityPattern[] = [
    {
      name: 'Brute Force Attack',
      detect: (events) => {
        const failedLogins = events.filter(e => 
          e.type === 'authentication_failure'
        );
        return failedLogins.length > 10;
      }
    },
    {
      name: 'Data Exfiltration',
      detect: (events) => {
        const downloads = events.filter(e => 
          e.type === 'data_access' && e.size > 1000000
        );
        return downloads.length > 5;
      }
    },
    {
      name: 'Privilege Escalation',
      detect: (events) => {
        return events.some(e => 
          e.type === 'permission_change' && 
          e.newRole === 'admin'
        );
      }
    }
  ];
  
  async detectIncidents(timeWindow: number): Promise<Incident[]> {
    const events = await this.getRecentEvents(timeWindow);
    const incidents: Incident[] = [];
    
    for (const pattern of this.patterns) {
      if (pattern.detect(events)) {
        incidents.push({
          id: generateId(),
          type: pattern.name,
          severity: this.calculateSeverity(pattern, events),
          timestamp: new Date(),
          events: events.filter(e => pattern.detect([e]))
        });
      }
    }
    
    return incidents;
  }
}
```

### Incident Response Plan

```typescript
class IncidentResponse {
  async handleIncident(incident: Incident) {
    // 1. Containment
    await this.containIncident(incident);
    
    // 2. Investigation
    const investigation = await this.investigate(incident);
    
    // 3. Eradication
    await this.eradicate(incident, investigation);
    
    // 4. Recovery
    await this.recover(incident);
    
    // 5. Lessons Learned
    await this.documentLessonsLearned(incident, investigation);
  }
  
  private async containIncident(incident: Incident) {
    switch (incident.type) {
      case 'Brute Force Attack':
        // Block attacker IPs
        const attackerIPs = this.extractAttackerIPs(incident);
        await this.blockIPs(attackerIPs);
        break;
        
      case 'Data Exfiltration':
        // Revoke access
        const compromisedAccounts = this.identifyCompromisedAccounts(incident);
        await this.revokeAccess(compromisedAccounts);
        break;
        
      case 'Node Compromise':
        // Isolate node
        await this.isolateNode(incident.affectedNode);
        break;
    }
    
    // Notify team
    await this.notifyIncidentResponseTeam(incident);
  }
}
```

## Security Checklist

### Pre-Deployment

- [ ] All dependencies scanned for vulnerabilities
- [ ] Security headers configured
- [ ] TLS certificates valid and properly configured
- [ ] Authentication mechanisms tested
- [ ] Authorization rules implemented and tested
- [ ] Encryption at rest configured
- [ ] Encryption in transit configured
- [ ] Secrets management system integrated
- [ ] Audit logging enabled
- [ ] Security monitoring configured

### Deployment

- [ ] Firewall rules configured
- [ ] Network segmentation implemented
- [ ] DDoS protection enabled
- [ ] Rate limiting configured
- [ ] Container security policies applied
- [ ] System hardening completed
- [ ] Security patches applied
- [ ] Backup encryption verified
- [ ] Incident response plan tested
- [ ] Security training completed

### Post-Deployment

- [ ] Regular vulnerability scans scheduled
- [ ] Penetration testing scheduled
- [ ] Security metrics monitored
- [ ] Compliance checks automated
- [ ] Incident response drills conducted
- [ ] Security patches applied regularly
- [ ] Access reviews conducted
- [ ] Audit logs reviewed
- [ ] Security training updated
- [ ] Documentation maintained

## Best Practices Summary

1. **Defense in Depth**: Implement multiple layers of security
2. **Least Privilege**: Grant minimum necessary permissions
3. **Zero Trust**: Verify everything, assume nothing
4. **Continuous Monitoring**: Monitor and alert on security events
5. **Regular Updates**: Keep all components patched and updated
6. **Incident Preparedness**: Have and test incident response procedures
7. **Security Culture**: Train all team members on security
8. **Compliance**: Maintain compliance with relevant standards
9. **Documentation**: Keep security documentation current
10. **Regular Audits**: Conduct regular security assessments

Following these security best practices helps ensure your RAFT cluster remains secure and resilient against threats.