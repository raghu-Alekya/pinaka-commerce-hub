import '../../../scripts/load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { TracingInterceptor } from '@pinaka-delivery-hub/observability';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalInterceptors(new TracingInterceptor());
  const port = process.env.GATEWAY_PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Gateway Service running on http://localhost:${port}`);
}
bootstrap();
