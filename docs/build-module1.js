const fs = require('fs');
const path = require('path');

const baseDir = 'c:/Projects/pinaka-commerce-hub/apps/merchant-service/src';
const entitiesDir = path.join(baseDir, 'entities');

// 1. main.ts with CORS enabled
const mainTsCode = `import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { TracingInterceptor } from '@pinaka-delivery-hub/observability';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: '*',
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new TracingInterceptor());
  const port = process.env.MERCHANT_SERVICE_PORT || 3003;
  await app.listen(port);
  console.log(\`🚀 Merchant Service running on http://localhost:\${port}\`);
}
bootstrap();
`;
fs.writeFileSync(path.join(baseDir, 'main.ts'), mainTsCode, 'utf8');

console.log('✅ main.ts updated with CORS support!');
