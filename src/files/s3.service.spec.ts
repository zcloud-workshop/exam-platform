import { S3Service } from './s3.service';

describe('S3 image presigning', () => {
  it('signs an encoded object path for GET with a 15 minute expiry', async () => {
    const previousEnv = { ...process.env };
    process.env.S3_ENDPOINT = 'https://storage.example.com';
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY = 'test-access-key';
    process.env.S3_SECRET_KEY = 'test-secret-key';
    try {
      const service = new S3Service();
      service.onModuleInit();
      const before = Date.now();
      const result = await service.presignGetObject(
        'question-banks/b/questions/q/images/a b.png',
      );
      const url = new URL(result.url);
      expect(url.origin).toBe('https://storage.example.com');
      expect(url.pathname).toBe(
        '/test-bucket/question-banks/b/questions/q/images/a%20b.png',
      );
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
      expect(Date.parse(result.expiresAt)).toBeGreaterThanOrEqual(
        before + 900000,
      );
      expect(Date.parse(result.expiresAt)).toBeLessThanOrEqual(
        Date.now() + 900000,
      );
    } finally {
      process.env = previousEnv;
    }
  });
});
