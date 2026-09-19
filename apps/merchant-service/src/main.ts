import 'reflect-metadata';
import '../../../scripts/load-env';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { TracingInterceptor } from '@pinaka-delivery-hub/observability';
import { AppModule } from './app.module';
import { normalizeTendorForm } from './vendor-tendor.form.pipe';


async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: '3mb' });
  app.use((req: { path?: string; body?: unknown }, _res: unknown, next: () => void) => {
    const path = String(req.path || '');
    if (
      req.body &&
      typeof req.body === 'object' &&
      !Array.isArray(req.body) &&
      (path.startsWith('/api/v1/tendors') || path.startsWith('/api/v1/tenders'))
    ) {
      req.body = normalizeTendorForm(req.body);
    }
    next();
  });
  app.enableCors({
    origin: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(origin => origin.trim()),
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: '*',
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new TracingInterceptor());
  const port = process.env.MERCHANT_SERVICE_PORT || 3003;
  await app.listen(port);
  console.log(`🚀 Merchant Service running on http://localhost:${port}`);
}
bootstrap();
