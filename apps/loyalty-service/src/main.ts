import '../../../scripts/load-env';
import 'reflect-metadata';
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
  const port = process.env.LOYALTY_SERVICE_PORT || 3007;
  await app.listen(port);
  console.log(`🚀 Loyalty & Promotions Service running on http://localhost:${port}`);
}
bootstrap();
